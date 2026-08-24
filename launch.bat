@echo off
setlocal
cd /d "%~dp0"
set "VENV=%~dp0.venv"
set "PY=%VENV%\Scripts\python.exe"
set "LOG=%~dp0launch.log"

if exist "%LOG%" del "%LOG%"

if not exist "%PY%" (
  echo Preparing Python environment...
  py -3 -m venv "%VENV%"
  if not exist "%PY%" python -m venv "%VENV%"
  if not exist "%PY%" (
    echo Python 3 not found. Please install Python 3 first.
    pause
    exit /b 1
  )
  "%PY%" -m pip install -q -r "%~dp0requirements.txt"
  if errorlevel 1 (
    echo pip install failed.
    pause
    exit /b 1
  )
)

start "" /D "%~dp0" "%PY%" "%~dp0app.py"

ping 127.0.0.1 -n 3 >nul
if exist "%LOG%" (
  echo Launch failed. See launch.log
  type "%LOG%"
  pause
)
