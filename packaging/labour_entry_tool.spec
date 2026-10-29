# PyInstaller build of the Windows package: python -m PyInstaller packaging/labour_entry_tool.spec
# (from the repository root, after `npm run build` in frontend/). Makes dist/LabourEntryTool/ with
# LabourEntryTool.exe; Python and every package are inside, nothing needs installing.
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

ROOT = Path(SPECPATH).parent
BACKEND = ROOT / "backend"

hidden = collect_submodules("uvicorn")  # picks its loops and protocols by name at run time
hidden += ["app.api.entries", "app.api.health", "app.api.registration", "app.api.setup",
           "app.api.timecards", "python_calamine", "pyxlsb", "openpyxl", "tkinter",
           "tkinter.filedialog"]  # fmt: skip
datas = collect_data_files("app", includes=["static/**/*"])  # the entry UI and the health page
try:  # live Excel (Windows only)
    hidden += collect_submodules("xlwings", filter=lambda m: ".pro" not in m)
    hidden += ["win32com", "win32com.client", "pythoncom", "pywintypes"]
    datas += collect_data_files("xlwings")
except Exception:
    pass

a = Analysis(
    [str(ROOT / "packaging" / "launcher.py")],
    pathex=[str(BACKEND)],
    hiddenimports=hidden,
    datas=datas,
    excludes=["pytest", "ruff", "IPython", "matplotlib", "numpy", "pandas"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="LabourEntryTool",
    console=True,  # the window shows the tool is running; closing it stops the tool
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="LabourEntryTool", upx=False)
