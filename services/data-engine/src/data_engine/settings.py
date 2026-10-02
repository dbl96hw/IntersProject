"""Paths and configuration loading.

Everything that a breeder, the SME or a teammate might want to change lives in
`config/*.yaml`, never hard-coded in Python. Paths can be overridden with
environment variables so the same code runs locally, in CI and in a container.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

# src/data_engine/settings.py -> parents[2] = services/data-engine, parents[4] = repo root
_PACKAGE_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = Path(__file__).resolve().parents[4] if len(Path(__file__).resolve().parents) > 4 else _PACKAGE_ROOT


def config_dir() -> Path:
    """Directory holding sources.yaml and rules.yaml."""
    return Path(os.environ.get("DATA_ENGINE_CONFIG_DIR", _PACKAGE_ROOT / "config"))


def data_dir() -> Path:
    """Directory with the UC4 exports (CSV / XLSX / JSON).

    Default: the integrated V2 drop of 2026-10-02 (`data/synthetic/uc4_v2`, the 8 root CSVs of the
    Syngenta zip). The 29-Sep drop in `data/synthetic/uc4` is deprecated and kept as a test fixture.
    Override with DATA_ENGINE_DATA_DIR.
    """
    return Path(os.environ.get("DATA_ENGINE_DATA_DIR", _REPO_ROOT / "data" / "synthetic" / "uc4_v2"))


def legacy_data_dir() -> Path:
    """The deprecated 29-Sep drop (trial-level verdicts), used by the tests of the trial-level logic."""
    return _REPO_ROOT / "data" / "synthetic" / "uc4"


def state_dir() -> Path:
    """Writable directory for the override audit log and build artefacts."""
    path = Path(os.environ.get("DATA_ENGINE_STATE_DIR", _PACKAGE_ROOT / ".state"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def lib_dir() -> Path:
    """Where compiled native back-ends live (per machine, gitignored).

    Separate from state_dir so that tests, which isolate their state in temp
    directories, still find the libraries built once for this machine.
    """
    path = Path(os.environ.get("DATA_ENGINE_LIB_DIR", _PACKAGE_ROOT / ".state"))
    path.mkdir(parents=True, exist_ok=True)
    return path


@lru_cache(maxsize=None)
def load_yaml(name: str) -> dict[str, Any]:
    """Load `config/<name>.yaml` once per process."""
    with open(config_dir() / f"{name}.yaml", encoding="utf-8") as fh:
        return yaml.safe_load(fh)
