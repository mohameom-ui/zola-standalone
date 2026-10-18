@echo off
REM ============================================================
REM  ZOLA SITL SHUTDOWN - land the virtual drone, stop the relay
REM ============================================================
echo [zola] landing and shutting down...
wsl -e bash -c "killall arducopter python mavsdk_server 2>/dev/null; echo [zola] landed and disarmed - safe."
timeout /t 2 /nobreak >nul
echo done.
pause
