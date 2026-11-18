@echo off
REM Renders the Apex demo from the REAL capture in .\out using the saved edit plan (produce_v2.py).
REM Needs: Python 3 (py launcher) and ffmpeg on PATH (winget install Gyan.FFmpeg). Everything installs into .venv-win here, not globally.
cd /d "%~dp0"
where ffmpeg >nul 2>nul || (echo ffmpeg not found on PATH. Run: winget install Gyan.FFmpeg   then reopen this window. & pause & exit /b 1)
where ffprobe >nul 2>nul || (echo ffprobe not found on PATH. & pause & exit /b 1)
powershell -NoProfile -Command "Get-PSDrive C,E | Select Name,@{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}} | Format-Table"
if not exist .venv-win (py -3 -m venv .venv-win || python -m venv .venv-win)
.venv-win\Scripts\python -m pip install -q kokoro-onnx pillow soundfile numpy || (echo pip install failed & pause & exit /b 1)
.venv-win\Scripts\python produce_v2.py || (echo Production failed - see the message above & pause & exit /b 1)
.venv-win\Scripts\python qa.py
echo.
echo Done. Outputs: Apex_Demo_Final\  (tell Claude "render done")
pause
