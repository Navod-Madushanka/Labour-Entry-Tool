"""LabourEntryTool.exe (Pattern-Based Labour Entry Assistant): start the tool and open it in the
browser (the Windows package).

Double-clicked a second time while it runs, it only opens the browser. Any error stays on screen
until Enter is pressed, so the window does not just vanish.
"""

from __future__ import annotations

import socket
import sys
import traceback
import webbrowser

NAME = "Pattern-Based Labour Entry Assistant"


def already_running(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def selftest() -> None:
    """``--selftest``: the parts that only load when used (Excel, the file dialog, the readers)
    are in the package. Used by the build (.github/workflows/windows-package.yml)."""
    import importlib

    from app.main import APP

    names = ["app.main", "app.updater", "python_calamine", "pyxlsb", "openpyxl", "uvicorn",
             "cryptography.hazmat.primitives.asymmetric.ed25519"]
    if sys.platform == "win32":  # live Excel and the Browse dialog are Windows only
        names += ["xlwings", "win32com.client", "pythoncom", "tkinter.filedialog"]
    for name in names:
        importlib.import_module(name)
    if not (APP / "index.html").exists():
        raise SystemExit(f"entry UI missing: {APP}")
    print("selftest ok:", ", ".join(names))


def make_update_key() -> None:
    """``--make-update-key``: a new signing key for the updates (once, by the repository owner).
    The secret goes into GitHub only (Settings > Secrets and variables > Actions, named
    UPDATE_SIGNING_KEY); it is not saved anywhere on this PC."""
    import base64

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    key = Ed25519PrivateKey.generate()
    raw = key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
                            serialization.NoEncryption())  # fmt: skip
    print("Copy this line into GitHub > Settings > Secrets and variables > Actions >")
    print("New repository secret, named UPDATE_SIGNING_KEY. Do not share it with anyone else.\n")
    print(base64.b64encode(raw).decode())
    print("\nThen close this window: the key is not stored on this PC.")


def run() -> None:
    from app.config import load_config
    from app.main import main
    from app.updater import Updater

    port = load_config().server.port
    if already_running(port):
        print(f"The {NAME} is already running: opening it in the browser.")
        webbrowser.open(f"http://localhost:{port}/")
        return
    # A verified update waiting from the last session: installed now, before any work starts.
    if Updater().install():
        print("Installing the update (your data is not touched); the tool starts again in a moment.")
        return
    print(f"Starting the {NAME}. Keep this window open while you work; close it to stop.")
    main(["--open", *sys.argv[1:]])


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        selftest()
        sys.exit(0)
    if sys.argv[1:] == ["--make-update-key"]:
        make_update_key()
        input("\nPress Enter to close this window.")
        sys.exit(0)
    try:
        run()
    except (KeyboardInterrupt, SystemExit):
        pass
    except Exception:
        traceback.print_exc()
        input("\nThe tool stopped because of the error above. Press Enter to close this window.")
