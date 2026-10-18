@echo off
REM ============================================================
REM  ZOLA SITL LAUNCHER - her first flight, one double-click
REM  Boots: virtual ArduCopter -> relay -> browser
REM ============================================================
echo [zola] booting her virtual drone...

REM 1. the virtual quad (ArduCopter SITL, headless)
start "ZOLA-SITL" wsl -e bash -c "cd ~/ardupilot && ~/aura-venv/bin/python Tools/autotest/sim_vehicle.py -v ArduCopter --no-mavproxy -w; exec bash"

REM 2. wait for the flight controller to settle
echo [zola] waiting 25s for the flight controller...
timeout /t 25 /nobreak >nul

REM 3. the relay (her MAVLink bridge; relaxed arming = SITL only)
start "ZOLA-RELAY" wsl -e bash -c "cd ~/aura-bridge && ~/aura-venv/bin/python -u aura_relay.py --connection 'udpin:0.0.0.0:14551' --relaxed-arming; exec bash"

REM 4. the app with her panel
start "" http://localhost:3000

echo.
echo  ==============================================
echo   ZOLA SITL IS UP.
echo   1. Open the app if it did not open (localhost:3000)
echo   2. Press F7 or click the robot icon
echo   3. Click  BODY - REAL  (address ws://172.x.x.x:8765
echo      is prefilled; if localhost fails, run: wsl hostname -I)
echo   4. She arms and takes off. Say: come here
echo  ==============================================
echo   To land and shut down: run stop-sim.bat
echo  ==============================================
pause
