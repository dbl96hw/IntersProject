"""C++ document back-end (Poppler + Tesseract) loaded through ctypes.

Built by `python -m data_engine.accel.build` when the poppler-cpp and tesseract
development packages are present. Thread count for scanned PDFs comes from the
hardware probe (physical cores): each thread owns one Tesseract instance.
"""

from __future__ import annotations

import ctypes
from functools import lru_cache
from pathlib import Path

from ..accel import lib_path
from ..system import probe


@lru_cache(maxsize=1)
def _lib():
    path = lib_path("docs")
    if not path.exists():
        return None
    try:
        lib = ctypes.CDLL(str(path))
    except OSError:
        return None
    lib.de_pdf_pages.argtypes = [ctypes.c_char_p]
    lib.de_pdf_pages.restype = ctypes.c_int
    lib.de_pdf_text.argtypes = [ctypes.c_char_p]
    lib.de_pdf_text.restype = ctypes.c_void_p
    lib.de_ocr_image.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_int)]
    lib.de_ocr_image.restype = ctypes.c_void_p
    lib.de_pdf_ocr.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
    lib.de_pdf_ocr.restype = ctypes.c_void_p
    lib.de_free.argtypes = [ctypes.c_void_p]
    lib.de_free.restype = None
    return lib


def available() -> bool:
    return _lib() is not None


def _take(ptr) -> str:
    """Copy a malloc'd C string into Python and free it on the C side."""
    if not ptr:
        return ""
    try:
        return ctypes.string_at(ptr).decode("utf-8", errors="replace")
    finally:
        _lib().de_free(ptr)


def pdf_text(path: Path) -> list[str]:
    pages = _take(_lib().de_pdf_text(str(path).encode())).split("\f")
    return pages[:-1] if pages and pages[-1] == "" else pages


def pdf_ocr(path: Path, lang: str, dpi: int = 300) -> tuple[list[str], float | None]:
    conf = ctypes.c_int(0)
    text = _take(_lib().de_pdf_ocr(str(path).encode(), lang.encode(), dpi, probe().compute_threads(),
                                   ctypes.byref(conf)))
    pages = text.split("\f")
    return (pages[:-1] if pages and pages[-1] == "" else pages), float(conf.value)


def ocr_image(path: Path, lang: str) -> tuple[str, float | None]:
    conf = ctypes.c_int(0)
    return _take(_lib().de_ocr_image(str(path).encode(), lang.encode(), ctypes.byref(conf))), float(conf.value)
