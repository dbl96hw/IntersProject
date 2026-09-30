"""Unit tests for the mathematical claims made in the docstrings (no data needed)."""

import numpy as np
import pandas as pd
import pytest

from data_engine import accel, parallel
from data_engine.calibrate import auc, bayes_ceiling
from data_engine.encode import encode_cyclic, encode_nominal, helmert_basis
from data_engine.profile import shannon_entropy
from data_engine.spectral import SpectralModel, chi2_quantile


# --- encodings --------------------------------------------------------------------
@pytest.mark.parametrize("k", [2, 3, 5, 8])
def test_helmert_is_orthonormal_basis_of_standard_irrep(k):
    h = helmert_basis(k)
    assert h.shape == (k, k - 1)
    np.testing.assert_allclose(h.T @ h, np.eye(k - 1), atol=1e-12)   # orthonormal
    np.testing.assert_allclose(np.ones(k) @ h, 0.0, atol=1e-12)      # orthogonal to the trivial irrep


def test_nominal_encoding_is_isometric_and_equivariant():
    x = pd.Series(list("abcab"))
    z, _ = encode_nominal(x)
    # All distinct categories are equidistant (sqrt 2), as in one-hot: no spurious order.
    d = {(i, j): np.linalg.norm(z[i] - z[j]) for i in range(3) for j in range(3) if i < j}
    np.testing.assert_allclose(list(d.values()), np.sqrt(2.0))
    # Relabelling the categories changes the coordinates only by an orthogonal map.
    z2, _ = encode_nominal(x.map({"a": "c", "b": "a", "c": "b"}))
    g = np.linalg.lstsq(z, z2, rcond=None)[0]
    np.testing.assert_allclose(g.T @ g, np.eye(2), atol=1e-10)


def test_cyclic_encoding_joins_december_and_january():
    z, _ = encode_cyclic(pd.Series(["2024-12-31", "2025-01-01", "2025-07-01"]))
    assert np.linalg.norm(z[0] - z[1]) < 0.05 < np.linalg.norm(z[0] - z[2])
    np.testing.assert_allclose(np.linalg.norm(z, axis=1), 1.0)      # lives on U(1)


# --- entropy ----------------------------------------------------------------------
def test_entropy_is_exactly_zero_for_constant_and_empty_columns():
    assert shannon_entropy(pd.Series([None] * 10)) == 0.0
    assert shannon_entropy(pd.Series(["x"] * 10)) == 0.0
    assert shannon_entropy(pd.Series(["x", "y"] * 5)) == pytest.approx(1.0)
    assert shannon_entropy(pd.Series(["x", None] * 5)) == pytest.approx(1.0)  # presence is information


# --- spectral ---------------------------------------------------------------------
@pytest.fixture
def correlated():
    rng = np.random.default_rng(0)
    latent = rng.normal(size=(400, 3))
    return latent @ rng.normal(size=(3, 8)) + 0.05 * rng.normal(size=(400, 8))


def test_eckart_young_error_is_exact(correlated):
    m = SpectralModel.fit(correlated, [f"f{i}" for i in range(8)], energy=0.95)
    xc = correlated - m.mean
    approx = m.scores(correlated) @ m.components.T
    err = np.linalg.norm(xc - approx) ** 2 / np.linalg.norm(xc) ** 2
    assert err == pytest.approx(m.truncation_error_rel, rel=1e-9)
    assert m.k == 3  # rank-3 signal is recovered


def test_whitening_and_mahalanobis_match_explicit_inverse(correlated):
    m = SpectralModel.fit(correlated, [f"f{i}" for i in range(8)], energy=1.0)
    w = m.whiten(correlated)
    np.testing.assert_allclose(np.cov(w, rowvar=False), np.eye(m.k), atol=1e-8)
    cov = np.cov(correlated, rowvar=False)
    xc = correlated - m.mean
    explicit = np.einsum("ij,jk,ik->i", xc, np.linalg.pinv(cov), xc)
    np.testing.assert_allclose(m.hotelling_t2(correlated), explicit, rtol=1e-5)


def test_t2_contributions_sum_exactly(correlated):
    m = SpectralModel.fit(correlated, [f"f{i}" for i in range(8)])
    for i in (0, 7, 99):
        assert m.contributions(correlated[i]).sum() == pytest.approx(m.hotelling_t2(correlated[[i]])[0], rel=1e-10)


def test_chi2_quantile_fallback_is_accurate(monkeypatch):
    exact = chi2_quantile(0.975, 10)
    import builtins
    real_import = builtins.__import__

    def no_scipy(name, *a, **k):
        if name.startswith("scipy"):
            raise ImportError
        return real_import(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", no_scipy)
    assert chi2_quantile(0.975, 10) == pytest.approx(exact, rel=0.01)


# --- calibration helpers ------------------------------------------------------------
def test_bayes_ceiling_counts_irreducible_conflicts():
    x = pd.DataFrame({"a": [1, 1, 1, 0, 0]})
    y = pd.Series(["F", "F", "H", "H", "H"])
    c = bayes_ceiling(x, y)
    assert c["max_correct"] == 4 and c["inputs_with_conflicting_labels"] == 1


def test_auc_matches_sklearn():
    sk = pytest.importorskip("sklearn.metrics")
    rng = np.random.default_rng(1)
    y = rng.integers(0, 2, 200)
    s = y + rng.normal(size=200)
    s[:20] = np.round(s[:20])  # include ties
    assert auc(y, s) == pytest.approx(sk.roc_auc_score(y, s), abs=1e-12)


# --- parallel policy (hardware-aware) ------------------------------------------------
def _hw(cpus: int, ram_gb: float):
    from data_engine.system import HardwareProfile
    ram = int(ram_gb * 2**30)
    return HardwareProfile("test", "3", cpus, cpus, cpus, ram, ram, None, ram // 2)


def test_small_workloads_stay_inline():
    assert parallel.plan([50_000] * 7, "csv", hw=_hw(8, 16)).executor == "inline"


def test_large_workloads_parallelise_and_respect_cpu_count():
    p = parallel.plan([200_000_000] * 12, "csv", hw=_hw(4, 64))
    assert p.executor == "thread" and p.workers == 4 and p.cpu_limit == 4
    assert p.predicted_parallel_s < p.predicted_serial_s


def test_ram_limits_the_number_of_workers():
    # 200 MB CSV -> ~1.6 GB in memory per worker; 4 GB RAM -> 2 GB budget -> 1 worker fits
    p = parallel.plan([200_000_000] * 12, "csv", hw=_hw(16, 4))
    assert p.memory_limit == 1 and p.workers == 1


def test_task_larger_than_budget_is_reported():
    p = parallel.plan([2_000_000_000], "csv", hw=_hw(8, 8))
    assert any("memory budget" in w for w in p.warnings)


def test_gil_bound_kinds_never_use_threads():
    assert parallel.plan([50_000_000] * 8, "xlsx", hw=_hw(8, 64)).executor in {"process", "inline"}


def test_hardware_probe_is_consistent():
    from data_engine.system import probe
    hw = probe()
    assert 1 <= hw.physical_cores <= hw.logical_cpus
    assert 1 <= hw.usable_cpus <= hw.logical_cpus
    assert 0 < hw.memory_budget_bytes <= hw.ram_available_bytes <= hw.ram_total_bytes
    assert 1 <= hw.compute_threads() <= hw.io_threads()


def test_karp_flatt():
    assert parallel.karp_flatt(2.0, 2) == pytest.approx(0.0)
    assert parallel.karp_flatt(1.0, 4) == pytest.approx(1.0)


# --- accelerators ---------------------------------------------------------------------
def test_numpy_chunking_follows_ram_budget():
    assert accel.numpy_chunk_rows(1_000_000, budget_bytes=240_000_000) == 10
    assert accel.numpy_chunk_rows(10, budget_bytes=2**30) == 65_536


def test_knn_backends_agree():
    rng = np.random.default_rng(3)
    a, b = rng.normal(size=(50, 6)), rng.normal(size=(300, 6))
    i_np, d_np = accel.knn(a, b, 5, backend="numpy")
    brute = ((a[:, None, :] - b[None, :, :]) ** 2).sum(-1)
    np.testing.assert_array_equal(i_np, np.argsort(brute, axis=1)[:, :5])
    for backend, ok in accel.available().items():
        if ok and backend != "numpy":
            for threads in (1, 3):  # the multithreaded split must not change the result
                i2, d2 = accel.knn(a, b, 5, backend=backend, threads=threads)
                np.testing.assert_array_equal(i_np, i2)
                np.testing.assert_allclose(d_np, d2, atol=1e-10)
