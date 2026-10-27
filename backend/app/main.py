"""FastAPI app: API routes plus the static pages (PLAN.md §3). Run with ``python -m app.main``."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, RedirectResponse

from app import __version__
from app.api import health
from app.config import Config, load_config

STATIC = Path(__file__).parent / "static"
LOCALHOST = "127.0.0.1"


def create_app(config: Config | None = None) -> FastAPI:
    app = FastAPI(title="Labour Entry Tool", version=__version__)
    app.state.config = config or load_config()
    app.state.snapshots = health.SnapshotCache()
    app.include_router(health.router)

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
