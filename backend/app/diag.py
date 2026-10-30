"""A log file on each PC, to find out afterwards why the tool was slow or stuck there.

``Labour Entry Tool/logs/labour-tool.log`` in the data folder (rotated: 3 files of 1 MB). It gets
the start-up (version, Windows, memory), Excel jobs over 2 s and requests over 5 s, and errors.
"""

from __future__ import annotations

import logging
import platform
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from app import __version__

LOG_NAME = "labour-tool.log"


def memory_mb() -> tuple[int, int] | None:
    """(total, free) physical memory in MB on Windows; None elsewhere."""
    if sys.platform != "win32":
        return None
    import ctypes

    class MemoryStatus(ctypes.Structure):
        _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong)] + [
            (name, ctypes.c_ulonglong)
            for name in ("ullTotalPhys", "ullAvailPhys", "ullTotalPageFile", "ullAvailPageFile",
                         "ullTotalVirtual", "ullAvailVirtual", "ullAvailExtendedVirtual")
        ]  # fmt: skip

    status = MemoryStatus()
    status.dwLength = ctypes.sizeof(MemoryStatus)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        return None
    return status.ullTotalPhys // 2**20, status.ullAvailPhys // 2**20


def setup_logging(folder: Path) -> Path | None:
    """Log the tool's own messages ("labour.*") to a file in ``folder``; None if it can't be
    written there (the tool runs on without it)."""
    try:
        folder.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(folder / LOG_NAME, maxBytes=1_000_000, backupCount=2,
                                      encoding="utf-8")  # fmt: skip
    except OSError:
        return None
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logger = logging.getLogger("labour")
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    mem = memory_mb()
    logger.info(
        "start: version %s, Python %s, %s%s", __version__, platform.python_version(),
        platform.platform(), f", memory {mem[0]} MB, free {mem[1]} MB" if mem else "",
    )  # fmt: skip
    return folder / LOG_NAME
