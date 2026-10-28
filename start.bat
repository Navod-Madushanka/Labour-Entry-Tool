@echo off
rem Labour Entry Tool: double-click to start. The first run sets everything up (a few minutes).
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo First run: setting up the tool. This needs the internet once...
  py -3.11 -m venv .venv 2>nul || python -m venv .venv
  if not exist ".venv\Scripts\python.exe" (
    echo Could not find Python 3.11 or newer. Install it from python.org, then run this again.
    pause
    exit /b 1
  )
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
  ".venv\Scripts\python.exe" -m pip install -e backend
  if errorlevel 1 (
    echo Setup failed. Check the internet connection and run this again.
    rmdir /s /q .venv
    pause
    exit /b 1
  )
)
echo Starting the Labour Entry Tool. Keep this window open while you work; close it to stop.
".venv\Scripts\python.exe" -m app.main --open
pause
