"""Compile the optional native back-ends: `python -m data_engine.accel.build`.

* knn   (always buildable: only needs a C++17 compiler, multithreaded with std::thread)
* docs  (needs the Poppler C++ and Tesseract development packages, found via pkg-config)

Explicit on purpose: the engine never compiles code implicitly. Whatever cannot
be built is simply not used; the Python back-ends cover every feature.
"""

from __future__ import annotations

import shlex
import shutil
import subprocess
import sys
from pathlib import Path

from . import lib_path

HERE = Path(__file__).resolve().parent


def _compiler() -> str | None:
    return next((c for c in ("g++", "clang++") if shutil.which(c)), None)


def _pkg_config(*packages: str) -> list[str] | None:
    if not shutil.which("pkg-config"):
        return None
    try:
        out = subprocess.check_output(["pkg-config", "--cflags", "--libs", *packages], text=True,
                                      stderr=subprocess.DEVNULL)
        return shlex.split(out)
    except subprocess.CalledProcessError:
        return None


def build_knn() -> Path | None:
    out = lib_path("knn")
    cxx = _compiler()
    if cxx:
        flags = ["-O3", "-std=c++17", "-shared", "-pthread"] + ([] if sys.platform == "win32" else ["-fPIC"])
        subprocess.run([cxx, *flags, str(HERE / "knn.cpp"), "-o", str(out)], check=True)
        return out
    if sys.platform == "win32" and shutil.which("cl"):
        subprocess.run(["cl", "/O2", "/LD", "/EHsc", "/std:c++17", str(HERE / "knn.cpp"), f"/Fe:{out}"], check=True)
        return out
    return None


def build_docs() -> Path | None:
    cxx = _compiler()
    libs = _pkg_config("poppler-cpp", "tesseract", "lept")
    if not cxx or libs is None:
        return None
    out = lib_path("docs")
    flags = ["-O2", "-std=c++17", "-shared", "-pthread"] + ([] if sys.platform == "win32" else ["-fPIC"])
    subprocess.run([cxx, *flags, str(HERE / "docs.cpp"), "-o", str(out), *libs], check=True)
    return out


def main() -> None:
    knn = build_knn()
    print(f"knn : {'built ' + str(knn) if knn else 'no C++ compiler found -> NumPy back-end'}")
    docs = build_docs()
    print(f"docs: {'built ' + str(docs) if docs else 'poppler-cpp/tesseract dev packages not found -> Python back-ends'}")


if __name__ == "__main__":
    main()
