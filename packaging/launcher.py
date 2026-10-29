"""LabourEntryTool.exe: start the tool and open it in the browser (the Windows package).

Double-clicked a second time while it runs, it only opens the browser. Any error stays on screen
until Enter is pressed, so the window does not just vanish.
"""

from __future__ import annotations

import socket
import sys
import traceback
import webbrowser


def already_running(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def selftest() -> None:
    """``--selftest``: the parts that only load when used (Excel, the file dialog, the readers)
    are in the package. Used by the build (.github/workflows/windows-package.yml)."""
    import importlib

    from app.main import APP

    names = ["app.main", "python_calamine", "pyxlsb", "openpyxl", "uvicorn"]
    if sys.platform == "win32":  # live Excel and the Browse dialog are Windows only
        names += ["xlwings", "win32com.client", "pythoncom", "tkinter.filedialog"]
    for name in names:
        importlib.import_module(name)
    if not (APP / "index.html").exists():
        raise SystemExit(f"entry UI missing: {APP}")
    print("selftest ok:", ", ".join(names))


def run() -> None:
    from app.config import load_config
    from app.main import main

    port = load_config().server.port
    if already_running(port):
        print("The Labour Entry Tool is already running: opening it in the browser.")
        webbrowser.open(f"http://localhost:{port}/")
        return
    print("Starting the Labour Entry Tool. Keep this window open while you work; close it to stop.")
    main(["--open", *sys.argv[1:]])


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        selftest()
        sys.exit(0)
    try:
        run()
    except (KeyboardInterrupt, SystemExit):
        pass
    except Exception:
        traceback.print_exc()
        input("\nThe tool stopped because of the error above. Press Enter to close this window.")
