@echo off
rem ZOLA — daily launch: her dev brain on :3001 + the panel in your browser
cd /d "%~dp0"
echo [zola] starting her dev brain on http://localhost:3001 ...
start "zola-dev" cmd /c "npm run dev"
timeout /t 12 /nobreak >nul
start http://localhost:3001
echo [zola] panel opening. Close the zola-dev window to stop her.
