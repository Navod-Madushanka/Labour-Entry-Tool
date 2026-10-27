"""One thread owns every COM object; all workbook calls run on it in order (PLAN.md §2 rule 4).

API handlers ``await worker.run(fn, ...)``; the job runs on the worker thread and its result or
exception comes back through a future.
"""

from __future__ import annotations

import asyncio
import queue
import threading
from collections.abc import Callable
from concurrent.futures import Future
from typing import Any, TypeVar

T = TypeVar("T")

_STOP = object()


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
                try:
                    future.set_result(fn(*args, **kwargs))
                except BaseException as exc:  # handed to the caller
                    future.set_exception(exc)
        finally:
            if self._cleanup:
                self._cleanup()
