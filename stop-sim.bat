@echo off
setlocal
REM Stop only the session created by bridge/sitl-session.sh; never kill all Python processes.
echo [zola] requesting a controlled SITL shutdown...
wsl -e bash -lc "pidfile=/tmp/zola-sitl-session.pid; if [ ! -s $pidfile ]; then echo '[zola] no managed SITL session is running'; exit 0; fi; pid=$(cat $pidfile); if ! kill -0 $pid 2>/dev/null; then rm -f $pidfile; echo '[zola] removed stale session marker'; exit 0; fi; kill -INT $pid; echo '[zola] waiting up to 60 seconds for landing and shutdown'; i=0; while [ $i -lt 60 ]; do if ! kill -0 $pid 2>/dev/null; then echo '[zola] session stopped safely'; exit 0; fi; sleep 1; i=$((i+1)); done; echo '[zola] session is still active; check /tmp/zola-relay.log and the flight controller'"
echo.
echo If the session is still active, inspect the relay log and flight controller before closing its WSL window.
pause