from pathlib import Path

import pytest

from data_engine.settings import data_dir, legacy_data_dir


@pytest.fixture(autouse=True)
def _isolated_state(tmp_path, monkeypatch):
    """Every test writes its override log / build artefacts to a fresh temp dir."""
    monkeypatch.setenv("DATA_ENGINE_STATE_DIR", str(tmp_path / "state"))


@pytest.fixture(scope="session")
def mock_dir() -> Path:
    """The 29-Sep drop (deprecated, trial-level verdicts): the fixture of the trial-level tests."""
    path = legacy_data_dir()
    if not (path.exists() and any(path.glob("*.csv"))):
        pytest.skip(f"UC4 29-Sep mock data not found in {path}")
    return path


@pytest.fixture(scope="session")
def v2_dir() -> Path:
    """The integrated V2 drop (2026-10-02): the engine's default data."""
    path = data_dir()
    if not (path.exists() and (path / "candidate_recommendations_synthetic.csv").exists()):
        pytest.skip(f"UC4 V2 data not found in {path}")
    return path


@pytest.fixture(scope="session")
def engine_v2(v2_dir, tmp_path_factory):
    from data_engine import DataEngine
    return DataEngine.from_directory(v2_dir, overrides_path=tmp_path_factory.mktemp("ov2") / "overrides.jsonl",
                                     save_runs=False)


@pytest.fixture(scope="session")
def engine(mock_dir, tmp_path_factory):
    from data_engine import DataEngine
    return DataEngine.from_directory(mock_dir, overrides_path=tmp_path_factory.mktemp("ov") / "overrides.jsonl")
