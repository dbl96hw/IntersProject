from pathlib import Path

import pytest

from data_engine.settings import data_dir


@pytest.fixture(autouse=True)
def _isolated_state(tmp_path, monkeypatch):
    """Every test writes its override log / build artefacts to a fresh temp dir."""
    monkeypatch.setenv("DATA_ENGINE_STATE_DIR", str(tmp_path / "state"))


@pytest.fixture(scope="session")
def mock_dir() -> Path:
    path = data_dir()
    if not (path.exists() and any(path.glob("*.csv"))):
        pytest.skip(f"UC4 mock data not found in {path} (set DATA_ENGINE_DATA_DIR)")
    return path


@pytest.fixture(scope="session")
def engine(mock_dir, tmp_path_factory):
    from data_engine import DataEngine
    return DataEngine.from_directory(mock_dir, overrides_path=tmp_path_factory.mktemp("ov") / "overrides.jsonl")
