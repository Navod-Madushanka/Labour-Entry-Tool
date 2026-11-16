"""Automatic updates of the Windows package, safe for the data.

How it works (the usual pattern of desktop updaters, e.g. Sparkle, Tauri):

1. **Check**: the latest release on GitHub (public repository: no token, no account on the PC).
   Only the version is asked for; nothing about the PC, the user or the workbooks is sent.
2. **Download** in the background: the zip and its Ed25519 signature, into the data folder.
3. **Verify** the signature with the public key built into this package. The private key exists
   only as a GitHub Actions secret, so a zip that was not built and signed by this repository's
   own pipeline (a tampered download, a fake release) is refused and deleted. No signing key set
   up yet: nothing is ever downloaded (updates stay off).
4. **Install** only when the person presses *Restart to update*, or at the next start of the tool:
   never in the middle of work. The program folder is swapped for the new one by a small script
   after the tool has stopped; the old folder is kept as ``LabourEntryTool.previous`` (rollback),
   and config.yaml is carried over.

The data (backups, the change log, settings, history: ``data_dir()``) is outside the program
folder and is never touched. Waiting entries are kept by the browser and come back after the
restart. Excel's workbook stays open in Excel. The page reloads itself on the new version.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

from pydantic import BaseModel

from app import __version__
from app.config import data_dir

log = logging.getLogger("labour.update")

REPO = "Navod-Madushanka/Labour-Entry-Tool"
LATEST = f"https://api.github.com/repos/{REPO}/releases/latest"
ZIP_NAME = "LabourEntryTool-windows.zip"
EXE = "LabourEntryTool.exe"
MAX_ZIP = 400 * 1024 * 1024  # bytes: a release is ~60 MB; anything far bigger is not ours
CHECK_EVERY = 6 * 3600.0  # seconds
FIRST_CHECK = 90.0  # seconds after start (the start page reads the workbook first)
KEY_FILE = Path(__file__).with_name("update_key.pub")  # written by the release build
ALLOWED_HOSTS = ("https://github.com/", "https://objects.githubusercontent.com/",
                 "https://release-assets.githubusercontent.com/")  # fmt: skip


class UpdateState(BaseModel):
    current: str = __version__
    latest: str | None = None
    state: str = "idle"  # idle | checking | downloading | ready | up_to_date | error | off
    notes: str | None = None  # the release's text (what is new)
    error: str | None = None
    auto: bool = True  # check and download by itself (Updates switch)
    can_install: bool = False  # the Windows package (not a copy run from source)
    checked_at: float | None = None


def version_key(text: str) -> tuple[int, ...]:
    """"v1.0.57" -> (1, 0, 57); junk -> () (never newer)."""
    m = re.fullmatch(r"v?(\d+(?:\.\d+){0,3})", text.strip())
    return tuple(int(x) for x in m.group(1).split(".")) if m else ()


def is_newer(latest: str, current: str) -> bool:
    return version_key(latest) > version_key(current) and bool(version_key(current))


def packaged() -> bool:
    return bool(getattr(sys, "frozen", False)) and sys.platform == "win32"


def install_dir() -> Path:
    return Path(sys.executable).resolve().parent


def public_key() -> bytes | None:
    try:
        raw = base64.b64decode(KEY_FILE.read_text(encoding="ascii").strip(), validate=True)
    except (OSError, ValueError):
        return None
    return raw if len(raw) == 32 else None


def verify(data: bytes, signature: bytes, key: bytes) -> bool:
    """Ed25519 signature of the whole zip."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    try:
        Ed25519PublicKey.from_public_bytes(key).verify(signature, data)
    except (InvalidSignature, ValueError):
        return False
    return True


def safe_extract(zf: zipfile.ZipFile, dest: Path) -> None:
    """Every member must land inside ``dest`` (no "../" or absolute paths: zip-slip)."""
    root = dest.resolve()
    for member in zf.infolist():
        target = (dest / member.filename).resolve()
        if root not in target.parents and target != root:
            raise ValueError(f"unsafe path in the update: {member.filename}")
    zf.extractall(dest)


class Updater:
    def __init__(self, folder: Path | None = None, fetch=None):
        self.folder = folder or data_dir() / "updates"
        self._fetch = fetch or _fetch
        self._lock = threading.Lock()
        self.state = UpdateState(auto=self._settings().get("auto", True), can_install=packaged())
        if public_key() is None:
            self.state.state, self.state.error = "off", "Updates are not signed yet."
        if (ready := self.ready()) is not None:
            self.state.state, self.state.latest = "ready", ready["version"]
            self.state.notes = ready.get("notes")

    # --- settings and the staged update ---

    def _settings(self) -> dict:
        try:
            return json.loads((self.folder / "settings.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def set_auto(self, on: bool) -> UpdateState:
        self.folder.mkdir(parents=True, exist_ok=True)
        (self.folder / "settings.json").write_text(json.dumps({"auto": on}), encoding="utf-8")
        self.state.auto = on
        return self.state

    def ready(self) -> dict | None:
        """The verified update waiting to be installed: {"version", "folder", "notes"}."""
        try:
            info = json.loads((self.folder / "ready.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not (Path(info.get("folder", "")) / EXE).exists() or not is_newer(info["version"], __version__):
            return None
        return info

    # --- check and download ---

    def check(self, download: bool = True) -> UpdateState:
        """Ask GitHub for the latest release; newer and ``download``: fetch and verify it."""
        key = public_key()
        if key is None:
            return self.state
        if not self._lock.acquire(blocking=False):
            return self.state  # one at a time
        try:
            self.state.state, self.state.error = "checking", None
            release = json.loads(self._fetch(LATEST, 1024 * 1024))
            latest = str(release.get("tag_name", ""))
            self.state.checked_at = time.time()
            self.state.latest, self.state.notes = latest.lstrip("v"), (release.get("body") or "")[:4000]
            if not is_newer(latest, __version__):
                self.state.state = "up_to_date"
                return self.state
            if self.ready() and self.ready()["version"] == self.state.latest:
                self.state.state = "ready"
                return self.state
            if not download:
                self.state.state = "idle"
                return self.state
            assets = {a.get("name"): a.get("browser_download_url", "") for a in release.get("assets", [])}
            zip_url, sig_url = assets.get(ZIP_NAME), assets.get(ZIP_NAME + ".sig")
            if not zip_url or not sig_url:
                raise ValueError(f"release {latest} has no signed Windows package")
            self.state.state = "downloading"
            self._stage(self.state.latest, zip_url, sig_url, key, self.state.notes)
            self.state.state = "ready"
        except Exception as exc:  # network down, GitHub busy, bad signature: try again later
            log.warning("update check failed: %s", exc)
            self.state.state, self.state.error = "error", str(exc)[:300]
        finally:
            self._lock.release()
        return self.state

    def _stage(self, version: str, zip_url: str, sig_url: str, key: bytes, notes: str | None) -> None:
        for url in (zip_url, sig_url):
            if not url.startswith(ALLOWED_HOSTS):
                raise ValueError(f"download from an unexpected place: {url}")
        data = self._fetch(zip_url, MAX_ZIP)
        signature = base64.b64decode(self._fetch(sig_url, 4096).strip(), validate=True)
        if not verify(data, signature, key):
            raise ValueError("the download's signature is wrong: not installed (deleted)")
        self.folder.mkdir(parents=True, exist_ok=True)
        dest = self.folder / version
        shutil.rmtree(dest, ignore_errors=True)
        dest.mkdir(parents=True)
        with zipfile.ZipFile(_bytes_file(data)) as zf:
            safe_extract(zf, dest)
        app = next((p.parent for p in dest.rglob(EXE)), None)
        if app is None:
            shutil.rmtree(dest, ignore_errors=True)
            raise ValueError(f"{EXE} is not in the update")
        (self.folder / "ready.json").write_text(
            json.dumps({"version": version, "folder": str(app), "notes": notes}), encoding="utf-8"
        )
        for old in self.folder.iterdir():  # older downloads
            if old.is_dir() and old.name != version:
                shutil.rmtree(old, ignore_errors=True)
        log.info("update %s downloaded and verified", version)

    def run_in_background(self) -> None:
        """Check after start, then every few hours, while the automatic switch is on."""
        if not packaged() or public_key() is None:
            return

        def loop() -> None:
            time.sleep(FIRST_CHECK)
            while True:
                if self.state.auto and self.state.state != "ready":
                    self.check()
                time.sleep(CHECK_EVERY)

        threading.Thread(target=loop, name="updater", daemon=True).start()

    # --- install ---

    def install(self, relaunch: bool = True) -> bool:
        """Swap the program folder for the verified update after this process ends, then start it
        again. Returns False (nothing done) when there is no update or this is not the package."""
        info = self.ready()
        if info is None or not packaged():
            return False
        script = swap_script(install_dir(), Path(info["folder"]), os.getpid(), relaunch,
                             self.folder / "ready.json")  # fmt: skip
        path = Path(tempfile.gettempdir()) / f"labour-update-{os.getpid()}.cmd"
        path.write_text(script, encoding="utf-8")
        flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        subprocess.Popen(["cmd.exe", "/c", str(path)], cwd=tempfile.gettempdir(),
                         creationflags=flags, close_fds=True)  # fmt: skip
        return True


def swap_script(app: Path, new: Path, pid: int, relaunch: bool, ready: Path) -> str:
    """A Windows batch file: wait for the tool to stop, keep the old folder as .previous, move the
    new one in, carry config.yaml over, start it. If the move fails the old folder is put back."""
    prev = app.with_name(app.name + ".previous")
    return "\r\n".join([
        "@echo off",
        "rem Labour Entry Tool update: swaps the program folder (your data folder is not touched).",
        f'set "APP={app}"', f'set "NEW={new}"', f'set "PREV={prev}"',
        ":wait",
        f'tasklist /FI "PID eq {pid}" | find "{pid}" >nul && (timeout /t 1 /nobreak >nul & goto wait)',
        'if exist "%PREV%" rmdir /s /q "%PREV%"',
        'move "%APP%" "%PREV%" >nul || goto fail',
        'move "%NEW%" "%APP%" >nul || (move "%PREV%" "%APP%" >nul & goto fail)',
        'if exist "%PREV%\\config.yaml" copy /y "%PREV%\\config.yaml" "%APP%\\config.yaml" >nul',
        f'del "{ready}" >nul 2>&1',
        f'start "" "%APP%\\{EXE}"' if relaunch else "rem (no restart)",
        "goto end",
        ":fail",
        f'start "" "%APP%\\{EXE}"' if relaunch else "rem (no restart)",
        ":end",
        '(goto) 2>nul & del "%~f0"',
    ])  # fmt: skip


def _bytes_file(data: bytes):
    import io

    return io.BytesIO(data)


def _fetch(url: str, limit: int) -> bytes:
    """HTTPS GET with a size limit. A plain User-Agent: nothing about this PC or its user."""
    if not url.startswith("https://"):
        raise ValueError("updates come over HTTPS only")
    req = urllib.request.Request(url, headers={"User-Agent": "LabourEntryTool-updater",
                                               "Accept": "application/vnd.github+json, */*"})  # fmt: skip
    with urllib.request.urlopen(req, timeout=60) as res:  # noqa: S310 (https only, checked above)
        data = res.read(limit + 1)
    if len(data) > limit:
        raise ValueError("the download is bigger than expected")
    return data
