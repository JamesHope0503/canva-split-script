@echo off
setlocal
cd /d "%~dp0"
set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo Missing .venv. Run launch.bat first.
  pause
  exit /b 1
)
"%PY%" "%~dp0build_portable.py"
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)
