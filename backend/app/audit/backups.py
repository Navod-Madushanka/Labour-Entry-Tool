"""Backup copy of the workbook before the first write of a session; keeps the newest N copies."""

from __future__ import annotations

import datetime as dt
import glob
from collections.abc import Callable
from pathlib import Path


class BackupManager:
    def __init__(self, directory: str | Path, keep: int = 10):
        self.directory = Path(directory)
        self.keep = keep
        self._made: dict[str, Path] = {}  # workbook name -> this session's backup

    def session_backup(self, workbook: str) -> Path | None:
        return self._made.get(workbook)

    def ensure(self, workbook: str, save_copy: Callable[[Path], None]) -> Path:
        """This session's backup of ``workbook``, made now if it does not exist yet."""
        if (path := self._made.get(workbook)) is not None:
            return path
        path = self.make(workbook, save_copy)
        self._made[workbook] = path
        return path

    def make(self, workbook: str, save_copy: Callable[[Path], None]) -> Path:
        self.directory.mkdir(parents=True, exist_ok=True)
        name = Path(workbook)
        stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        path = self.directory / f"{name.stem}_{stamp}{name.suffix}"
        n = 1
        while path.exists():
            path = self.directory / f"{name.stem}_{stamp}-{n}{name.suffix}"
            n += 1
        save_copy(path)
        if not path.exists():
            raise OSError(f"backup copy was not created: {path}")
        self.prune(workbook)
        return path

    def prune(self, workbook: str) -> list[Path]:
        """Delete all but the newest ``keep`` backups of this workbook; returns the deleted ones."""
        name = Path(workbook)
        mine = sorted(
            (
                p
                for p in self.directory.glob(
                    f"{glob.escape(name.stem)}_*{glob.escape(name.suffix)}"
                )
                if p.is_file()
            ),
            key=lambda p: (p.stat().st_mtime, p.name),
        )
        doomed = mine[: max(len(mine) - self.keep, 0)]
        for p in doomed:
            p.unlink()
        return doomed
