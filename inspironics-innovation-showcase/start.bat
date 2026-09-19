@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Inspironics Innovation Showcase

rem  Runs the showcase locally.
rem
rem    start.bat          dev server on http://localhost:5173
rem    start.bat 5174     dev server on a different port
rem    start.bat prod     production build, then serve it on 4173
rem
rem  Leave this window open while you use the site.
rem  Stop it with Ctrl+C here, or by running stop.bat.

cd /d "%~dp0"

set "PORT=5173"
set "MODE=dev"

if /i "%~1"=="prod" (
    set "MODE=prod"
    set "PORT=4173"
) else if not "%~1"=="" (
    set "PORT=%~1"
)

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Node.js was not found on PATH.
    echo   Install it from https://nodejs.org and run this again.
    echo.
    pause
    exit /b 1
)

call :port_pid %PORT%
if defined PID (
    echo.
    echo   Port %PORT% is already in use by PID !PID!.
    echo   Run stop.bat first, or pick another port:  start.bat 5174
    echo.
    pause
    exit /b 1
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

echo.
echo   Inspironics Innovation Showcase
echo   ---------------------------------------------------
echo     mode  %MODE%
echo     url   http://localhost:%PORT%
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
    call npx vite preview --port %PORT% --strictPort --open
) else (
    call npx vite --port %PORT% --strictPort --open
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
