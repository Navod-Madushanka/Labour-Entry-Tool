"""One thread owns every COM object; all workbook calls run on it in order (PLAN.md §2 rule 4).

API handlers ``await worker.run(fn, ...)``; the job runs on the worker thread and its result or
exception comes back through a future.
"""

from __future__ import annotations

import asyncio
import logging
import queue
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future
from typing import Any, TypeVar

T = TypeVar("T")

_STOP = object()
SLOW = 2.0  # seconds: a job taking longer goes into the log (to find slow PCs and stuck Excel)
log = logging.getLogger("labour.excel")


class ExcelWorker:
    def __init__(
        self,
        init: Callable[[], None] | None = None,
        cleanup: Callable[[], None] | None = None,
        name: str = "excel-worker",
    ):
        self._jobs: queue.Queue = queue.Queue()
        self._init, self._cleanup = init, cleanup
        self._thread = threading.Thread(target=self._loop, name=name, daemon=True)
        self._thread.start()

    def submit(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> Future[T]:
        future: Future[T] = Future()
        self._jobs.put((future, fn, args, kwargs))
        return future

    async def run(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        return await asyncio.wrap_future(self.submit(fn, *args, **kwargs))

    def call(
        self, fn: Callable[..., T], *args: Any, timeout: float | None = None, **kwargs: Any
    ) -> T:
        """Blocking variant for scripts."""
        return self.submit(fn, *args, **kwargs).result(timeout)

    @property
    def thread(self) -> threading.Thread:
        return self._thread

    def stop(self, timeout: float | None = 5) -> None:
        self._jobs.put(_STOP)
        self._thread.join(timeout)

    def _loop(self) -> None:
        if self._init:
            self._init()
        try:
            while (job := self._jobs.get()) is not _STOP:
                future, fn, args, kwargs = job
                if not future.set_running_or_notify_cancel():
                    continue
                started = time.perf_counter()
                try:
                    future.set_result(fn(*args, **kwargs))
                except BaseException as exc:  # handed to the caller
                    log.warning(
                        "%s failed after %.1f s: %s", _name(fn), time.perf_counter() - started, exc
                    )
                    future.set_exception(exc)
                else:
                    if (took := time.perf_counter() - started) > SLOW:
                        log.info("%s took %.1f s (%d waiting)", _name(fn), took, self._jobs.qsize())
        finally:
            if self._cleanup:
                self._cleanup()


def _name(fn: Callable[..., Any]) -> str:
    """A readable name for a job: a lambda shows where it was written (file:line)."""
    name = getattr(fn, "__qualname__", repr(fn))
    code = getattr(fn, "__code__", None)
    if not code or "lambda" not in name:
        return name
    file = code.co_filename.replace("\\", "/").rsplit("/", 1)[-1]
    return f"{name} ({file}:{code.co_firstlineno})"
