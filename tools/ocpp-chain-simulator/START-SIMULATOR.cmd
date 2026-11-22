@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if errorlevel 1 goto failed

echo ChargeVisor OCPP Simulator - free local setup
where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher not found. Install Python 3.10+ from https://www.python.org/downloads/
  goto failed
)

rem Keep packages out of deep Windows ZIP paths to avoid MAX_PATH issues.
if defined LOCALAPPDATA (
  set "VENV_DIR=%LOCALAPPDATA%\ChargeVisor\ocpp-chain-venv"
) else (
  set "VENV_DIR=%TEMP%\ChargeVisor-ocpp-chain-venv"
)
set "PY=%VENV_DIR%\Scripts\python.exe"

rem Detect and automatically discard incomplete or corrupted pip installations.
if not exist "%PY%" goto make_venv
"%PY%" -m pip --version >nul 2>nul
if not errorlevel 1 goto packages
echo The existing Python environment is damaged. Recreating it...
rmdir /s /q "%VENV_DIR%"
if exist "%VENV_DIR%" goto failed

:make_venv
echo Creating Python environment at %VENV_DIR% ...
py -3 -m venv "%VENV_DIR%"
if errorlevel 1 goto failed
if not exist "%PY%" goto failed
"%PY%" -m pip --version >nul 2>nul
if not errorlevel 1 goto packages
echo Repairing pip...
"%PY%" -m ensurepip --upgrade
if errorlevel 1 goto failed

:packages
"%PY%" -c "import ocpp, websockets" >nul 2>nul
if not errorlevel 1 goto launch
echo Installing free open-source OCPP packages...
"%PY%" -m pip install -r requirements.txt
if errorlevel 1 goto failed

:launch
"%PY%" desktop_simulator.py
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo ERROR: The simulator could not start. Please screenshot the lines above.
pause
exit /b 1
