"""FastAPI app: API routes plus the static pages (PLAN.md §3). Run with ``python -m app.main``."""

from __future__ import annotations

import sys
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api import entries, health, registration, setup, timecards
from app.audit.backups import BackupManager
from app.audit.store import AuditStore
from app.config import Config, load_config
from app.excel.worker import ExcelWorker
from app.service import EntryService

STATIC = Path(__file__).parent / "static"
APP = STATIC / "app"
LOCALHOST = "127.0.0.1"


def demo_service(config: Config, snapshot: Path) -> EntryService:
    """An in-memory copy of a workbook (.xlsb or snapshot .json): try the whole UI without Excel.
    Writes stay in memory; audit and backups go to a temporary folder."""
    import tempfile

    from app.excel.fake_adapter import FakeWorkbook
    from app.health import read_snapshot

    fake = FakeWorkbook(read_snapshot(snapshot, config.template), config.template)
    work = Path(tempfile.mkdtemp(prefix="labour_demo_"))
    audit = AuditStore(work / "audit.sqlite")
    backups = BackupManager(work / "backups", config.backups.keep)
    return EntryService(lambda: fake, config, audit, backups, mode="demo")


def excel_worker() -> ExcelWorker:
    if sys.platform == "win32":
        from app.excel.xlwings_adapter import com_init, com_uninit

        return ExcelWorker(init=com_init, cleanup=com_uninit)
    return ExcelWorker()


def create_app(
    config: Config | None = None,
    service_factory: Callable[[Config], EntryService] | None = None,
) -> FastAPI:
    """Without ``service_factory`` the workbook is chosen on the start page (``api/setup``)."""
    config = config or load_config()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        if app.state.worker is not None:
            app.state.worker.stop()

    app = FastAPI(
        title="Pattern-Based Labour Entry Assistant", version=__version__, lifespan=lifespan
    )
    app.state.config = config
    app.state.snapshots = health.SnapshotCache()
    app.state.excel_disabled = (
        None if config.excel.enabled else "Live Excel is switched off (excel.enabled in config)."
    )
    app.state.service = None
    app.state.worker = None
    app.state.session = setup.Session(config)

    def get_worker() -> ExcelWorker:
        if app.state.worker is None:
            app.state.worker = excel_worker()
        return app.state.worker

    def get_service() -> EntryService:
        """Created on first use, so the audit database only appears once it is needed."""
        if app.state.excel_disabled is not None:
            raise HTTPException(503, app.state.excel_disabled)
        if app.state.service is None:
            if service_factory is None:
                raise HTTPException(409, "Choose the workbook on the start page first.")
            app.state.service = service_factory(app.state.config)
        get_worker()
        return app.state.service

    def set_service(service: EntryService, cfg: Config) -> None:
        """The start page chose a workbook: later calls go to it."""
        app.state.config = cfg
        app.state.excel_disabled = None
        app.state.service = service

    app.state.get_worker = get_worker
    app.state.get_service = get_service
    app.state.set_service = set_service
    app.state.has_service = lambda: app.state.service is not None or service_factory is not None
    app.state.registrations = registration.FileCache()
    app.include_router(health.router)
    app.include_router(entries.router)
    app.include_router(registration.router)
    app.include_router(setup.router)
    app.include_router(timecards.router)

    if (APP / "index.html").exists():  # the built entry UI (frontend/, `npm run build`)
        app.mount("/app", StaticFiles(directory=APP, html=True), name="app")

    @app.get("/", include_in_schema=False)
    def index() -> RedirectResponse:
        return RedirectResponse("/app/" if (APP / "index.html").exists() else "/health")

    @app.get("/health", include_in_schema=False)
    def health_page() -> FileResponse:
        return FileResponse(STATIC / "health.html")

    return app


def bind_host(config: Config) -> str:
    """Localhost unless LAN access is switched on (PLAN.md §3, default off)."""
    return config.server.host if config.server.allow_lan else LOCALHOST


def main(argv: list[str] | None = None) -> None:
    import argparse
    import threading
    import webbrowser

    import uvicorn

    parser = argparse.ArgumentParser(
        prog="python -m app.main", description="Pattern-Based Labour Entry Assistant"
    )
    parser.add_argument("--config", type=Path, help="config.yaml to use (optional)")
    parser.add_argument("--demo", type=Path, metavar="FILE",
                        help="practice on a copy of FILE (.xlsb or snapshot .json) in memory; "
                             "Excel is not used and nothing is saved")  # fmt: skip
    parser.add_argument("--registration", type=Path, action="append", metavar="FILE",
                        help="registration .xlsx to check (repeat for more); replaces the "
                             "config list")  # fmt: skip
    parser.add_argument("--open", action="store_true", help="open the start page in the browser")
    args = parser.parse_args(argv)
    config = load_config(args.config)
    if args.registration:
        config = config.model_copy(update={"registration_files": args.registration})
    if args.demo and not args.demo.exists():
        parser.error(f"file not found: {args.demo}")
    app = create_app(config)
    if args.demo:
        setup.choose(app, args.demo, args.demo.name, practice=True, real_file=False)
        app.state.session.book.ready = True  # straight to entry; "Change workbook" runs the checks
        print(f"PRACTICE MODE on {args.demo.name}: changes stay in memory, Excel is not touched.")
    host = bind_host(config)
    url = f"http://{'localhost' if host == LOCALHOST else host}:{config.server.port}/"
    print(f"Pattern-Based Labour Entry Assistant: {url}  (close this window to stop it)")
    if args.open:
        threading.Timer(1.5, webbrowser.open, (url,)).start()
    uvicorn.run(app, host=host, port=config.server.port)


if __name__ == "__main__":
    main()
