@echo off
REM Records the Apex demo against a RUNNING Apex (start.bat first). Optional: run-capture.bat http://localhost:4173
cd /d "%~dp0"
node capture.mjs %*
echo.
echo Finished. Tell Claude "capture done" - it reads the out folder directly.
pause
