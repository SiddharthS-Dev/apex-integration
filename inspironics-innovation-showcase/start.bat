@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Inspironics Innovation Showcase

rem  Runs the showcase locally: the API (Dropbox sync, auth, content proxy) and
rem  the web app.
rem
rem    start.bat          API on :4100 + web dev server on http://localhost:5180
rem    start.bat prod     build the web app, then serve everything from the API
rem                       on http://localhost:4100 (one origin, like production)
rem    start.bat demo     web app only, on the bundled demo backend (no server,
rem                       static corpus, browser-only accounts)
rem
rem  Leave this window open while you use the site.
rem  Stop it with Ctrl+C here, or by running stop.bat.

cd /d "%~dp0"

set "MODE=dev"
if /i "%~1"=="prod" set "MODE=prod"
if /i "%~1"=="demo" set "MODE=demo"

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Node.js was not found on PATH.
    echo   Install Node 22.5 or newer from https://nodejs.org and run this again.
    echo.
    pause
    exit /b 1
)

set "PORTS=4100 5180"
if /i "%MODE%"=="prod" set "PORTS=4100"
if /i "%MODE%"=="demo" set "PORTS=5180"
for %%T in (%PORTS%) do (
    call :port_pid %%T
    if defined PID (
        echo.
        echo   Port %%T is already in use by PID !PID!.
        echo   Run stop.bat first, or free the port and try again.
        echo.
        pause
        exit /b 1
    )
)

if not exist "node_modules\" (
    echo.
    echo   Installing dependencies. This only happens on the first run...
    echo.
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo   npm install failed - see the output above.
        echo.
        pause
        exit /b 1
    )
)

if not exist "apps\api\.env" if not "%MODE%"=="demo" (
    copy /y "apps\api\.env.example" "apps\api\.env" >nul
    echo.
    echo   Created apps\api\.env from the example. Add DROPBOX_APP_KEY and
    echo   DROPBOX_APP_SECRET there to connect Dropbox.
)

echo.
echo   Inspironics Innovation Showcase
echo   ---------------------------------------------------
echo     mode  %MODE%
if /i "%MODE%"=="dev"  echo     web   http://localhost:5180
if /i "%MODE%"=="dev"  echo     api   http://localhost:4100
if /i "%MODE%"=="prod" echo     url   http://localhost:4100
if /i "%MODE%"=="demo" echo     url   http://localhost:5180   (demo backend)
echo.
echo   Keep this window open. Ctrl+C or stop.bat shuts it down.
echo.

if /i "%MODE%"=="prod" (
    call npm run build
    if errorlevel 1 (
        echo.
        echo   Build failed - see the output above.
        echo.
        pause
        exit /b 1
    )
    start "" "http://localhost:4100"
    set "SERVE_WEB=true"
    call npm start
) else if /i "%MODE%"=="demo" (
    set "VITE_BACKEND=local"
    call npm run dev:web
) else (
    call npm run dev
)

echo.
echo   Server stopped.
echo.
pause
exit /b 0

rem  Sets PID to the process listening on the port passed in, or leaves it unset.
:port_pid
set "PID="
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr /r /c:":%~1 .*LISTENING"') do (
    if not defined PID set "PID=%%P"
)
exit /b 0
