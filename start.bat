@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Apex - Inspironics

rem  Runs Apex: the home dashboard plus both projects behind one address.
rem
rem    start.bat            dev  - http://localhost:5173
rem    start.bat prod       builds both projects, then serves them on 4173
rem    start.bat prod 4180  the same, on a port of your choosing
rem
rem  Three processes start in dev: a vite dev server for each project, and the
rem  Apex gateway that fronts them. Only the gateway's port is ever opened - it
rem  proxies /showcase and /vault through to the two child servers.
rem
rem  Leave this window open while you use Apex. Stop it with stop.bat.

cd /d "%~dp0"

set "SHOWCASE_DIR=inspironics-innovation-showcase"
set "VAULT_DIR=slide vault"
set "GATEWAY_PORT=5173"
set "SHOWCASE_PORT=5174"
set "VAULT_PORT=5175"

set "MODE=dev"
if /i "%~1"=="prod" (
    set "MODE=prod"
    set "GATEWAY_PORT=4173"
    rem  4173 is vite's default preview port, so another project may already have
    rem  it. Pass your own to step around that:  start.bat prod 4180
    if not "%~2"=="" set "GATEWAY_PORT=%~2"
)
set "APEX_PORT=%GATEWAY_PORT%"

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Node.js was not found on PATH.
    echo   Install it from https://nodejs.org and run this again.
    echo.
    pause
    exit /b 1
)

rem  A stale server on one of these ports would make the gateway proxy to the
rem  wrong process, so refuse to start rather than half-work. In dev that means
rem  all three; in prod only the gateway's, since no child servers run.
set "CHECK_PORTS=%GATEWAY_PORT% %SHOWCASE_PORT% %VAULT_PORT%"
if /i "%MODE%"=="prod" set "CHECK_PORTS=%GATEWAY_PORT%"

for %%P in (%CHECK_PORTS%) do (
    call :port_pid %%P
    if defined PID (
        echo.
        echo   Port %%P is already in use by PID !PID!.
        echo   Run stop.bat first, or serve on another port:  start.bat prod 4180
        echo.
        pause
        exit /b 1
    )
)

call :ensure_deps "%SHOWCASE_DIR%" "Innovation Showcase"
if errorlevel 1 exit /b 1
call :ensure_deps "%VAULT_DIR%" "SlidesVault"
if errorlevel 1 exit /b 1

echo.
echo   Apex - Inspironics
echo   ----------------------------------------------------
echo     mode        %MODE%
echo     dashboard   http://localhost:%GATEWAY_PORT%/
echo     showcase    http://localhost:%GATEWAY_PORT%/showcase/
echo     vault       http://localhost:%GATEWAY_PORT%/vault/
echo.

if /i "%MODE%"=="prod" goto :prod

rem ---------------------------------------------------------------- dev ----
rem  Each child runs in its own window so its logs stay readable and stop.bat
rem  can close it. The gateway runs here, in the foreground.

echo   Starting the Innovation Showcase dev server...
start "Apex - Innovation Showcase" /min /d "%~dp0%SHOWCASE_DIR%" cmd /c npx vite

echo   Starting the SlidesVault dev server...
start "Apex - SlidesVault" /min /d "%~dp0%VAULT_DIR%" cmd /c npx vite

echo.
echo   The dashboard opens as soon as the gateway is up. Both projects finish
echo   booting behind it - a card reading "Starting" turns "Ready" on its own.
echo.
echo   Keep this window open. stop.bat shuts everything down.
echo.

node "%~dp0apex\server.mjs" --open
goto :done

rem --------------------------------------------------------------- prod ----
:prod
echo   Building the Innovation Showcase...
pushd "%SHOWCASE_DIR%"
call npm run build
if errorlevel 1 (
    popd
    echo.
    echo   The Innovation Showcase build failed - see the output above.
    echo.
    pause
    exit /b 1
)
popd

echo.
echo   Building SlidesVault...
pushd "%VAULT_DIR%"
call npm run build
if errorlevel 1 (
    popd
    echo.
    echo   The SlidesVault build failed - see the output above.
    echo.
    pause
    exit /b 1
)
popd

echo.
node "%~dp0apex\server.mjs" prod --open

:done
echo.
echo   Apex stopped.
echo.
pause
exit /b 0

rem  Installs a project's dependencies on first run.
:ensure_deps
if not exist "%~1\node_modules\" (
    echo.
    echo   Installing dependencies for %~2. This only happens on the first run...
    echo.
    pushd "%~1"
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        popd
        echo.
        echo   npm install failed for %~2 - see the output above.
        echo.
        pause
        exit /b 1
    )
    popd
)
exit /b 0

rem  Sets PID to the process listening on the port passed in, or leaves it unset.
:port_pid
set "PID="
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr /r /c:":%~1 .*LISTENING"') do (
    if not defined PID set "PID=%%P"
)
exit /b 0
