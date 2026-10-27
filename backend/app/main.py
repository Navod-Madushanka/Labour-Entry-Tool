"""FastAPI app: API routes plus the static pages (PLAN.md §3). Run with ``python -m app.main``."""

from __future__ import annotations

import sys
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse

from app import __version__
from app.api import entries, health
from app.audit.backups import BackupManager
from app.audit.store import AuditStore
from app.config import Config, load_config
from app.excel.worker import ExcelWorker
from app.service import EntryService

STATIC = Path(__file__).parent / "static"
LOCALHOST = "127.0.0.1"


def live_service(config: Config) -> EntryService:
    """The service for the real workbook: xlwings, the audit database and the backup folder."""
    from app.excel import xlwings_adapter

    return EntryService(
        lambda: xlwings_adapter.connect(config),
        config,
        AuditStore(config.audit.db),
        BackupManager(config.backups.dir, config.backups.keep),
    )


def excel_worker() -> ExcelWorker:
    if sys.platform == "win32":
        from app.excel.xlwings_adapter import com_init, com_uninit

        return ExcelWorker(init=com_init, cleanup=com_uninit)
    return ExcelWorker()


def create_app(
    config: Config | None = None,
    service_factory: Callable[[Config], EntryService] | None = None,
) -> FastAPI:
    config = config or load_config()
    worker: ExcelWorker | None = None

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        if worker is not None:
            worker.stop()

    app = FastAPI(title="Labour Entry Tool", version=__version__, lifespan=lifespan)
    app.state.config = config
    app.state.snapshots = health.SnapshotCache()
    app.state.excel_disabled = (
        None if config.excel.enabled else "Live Excel is switched off (excel.enabled in config)."
    )
    service: EntryService | None = None

    def get_service() -> EntryService:
        """Created on first use, so the audit database only appears once it is needed."""
        nonlocal service, worker
        if app.state.excel_disabled is not None:
            raise HTTPException(503, app.state.excel_disabled)
        if service is None:
            service = (service_factory or live_service)(config)
            worker = excel_worker()
            app.state.worker = worker
        return service

    app.state.get_service = get_service
    app.include_router(health.router)
    app.include_router(entries.router)

    @app.get("/", include_in_schema=False)
    def index() -> RedirectResponse:
        return RedirectResponse("/health")

    @app.get("/health", include_in_schema=False)
    def health_page() -> FileResponse:
        return FileResponse(STATIC / "health.html")

    return app


def bind_host(config: Config) -> str:
    """Localhost unless LAN access is switched on (PLAN.md §3, default off)."""
    return config.server.host if config.server.allow_lan else LOCALHOST


def main() -> None:
    import uvicorn

    config = load_config()
    host = bind_host(config)
    print(f"Labour Entry Tool: http://{'localhost' if host == LOCALHOST else host}:"
          f"{config.server.port}/health")  # fmt: skip
    uvicorn.run(create_app(config), host=host, port=config.server.port)


if __name__ == "__main__":
    main()
