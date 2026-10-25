@echo off
setlocal
REM Start the managed ArduPilot SITL + Zola relay session in WSL.
echo [zola] starting the managed ArduPilot SITL session...
for /f "usebackq delims=" %%P in (`wsl wslpath -u "%~dp0"`) do set "ZOLA_LINUX_DIR=%%P"
if not defined ZOLA_LINUX_DIR (
  echo [zola] could not resolve this checkout inside WSL.
  exit /b 1
)
start "ZOLA-SITL + RELAY" wsl -e bash -lc "cd '%ZOLA_LINUX_DIR%' && exec bash bridge/sitl-session.sh"

REM Reuse an existing app server; otherwise start the Zola app on port 3001.
netstat -ano | findstr ":3001" | findstr "LISTENING" >nul
if errorlevel 1 start "ZOLA-APP" /D "%~dp0" cmd /c "npm run dev"

echo [zola] waiting for the relay and app to start...
timeout /t 50 /nobreak >nul
start "" http://localhost:3001/zola

echo.
echo  ==============================================
echo   ZOLA SITL SESSION STARTED
echo   1. Use BODY - REAL and relay URL ws://localhost:8765
echo   2. Wait for fresh battery telemetry before takeoff
echo   3. Press ARM ^& TAKE OFF and confirm
echo   4. Land from the panel, or run stop-sim.bat
echo  ==============================================
echo   Close the ZOLA-APP window to stop the local app server.
echo  ==============================================
pause