"""UC4 data engine: deterministic-first ingestion, triage and analysis.

Layer map (each module is one layer; data flows top to bottom):

    ingest      read any supported file, adaptive parallelism (Amdahl policy)
    detect      assign each table to a logical source by header signature
    profile     "renormalization": drop zero-information columns, type inference
    canonical   join the sources on MATERIAL / TRIAL / LOCATION keys
    rules       versioned thresholds -> colour + evidence  (decides the colour)
    encode      symmetry-aware feature encodings (affine, S_k, U(1), ordinal)
    spectral    SVD, truncation bound, whitening, anomaly + similarity
    calibrate   Bayes ceiling, calibrated ambiguity model, ROC vs rule baseline
    accel       optional C++ / Julia kernels for large, dense workloads
    engine      facade used by the API, the MCP server and the agent

Design rule shared with the whole team: the deterministic engine decides the
colour; statistics and the LLM only qualify and explain it; the breeder has the
last word (overrides are logged, never silently applied to the rules).
"""

__all__ = ["DataEngine"]
__version__ = "0.1.0"


def __getattr__(name: str):
    # Lazy import: lets individual layers be imported (and tested) without
    # pulling in the whole engine and its optional dependencies.
    if name == "DataEngine":
        from .engine import DataEngine
        return DataEngine
    raise AttributeError(name)
