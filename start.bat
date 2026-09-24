@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Apex - Inspironics

rem  Runs Apex: the home dashboard plus both projects behind one address.
rem
rem    start.bat            dev  - http://localhost:5173
rem    start.bat prod       builds both projects, then serves them on 4173
rem    start.bat prod 4180  the same, on a port of your choosing
rem
rem  Five processes start in dev: a vite dev server and an API server for each
rem  project, and the Apex gateway that fronts them all. Only the gateway's port
rem  is ever opened - it proxies /showcase and /vault through to the dev
rem  servers, and /showcase/api and /vault/api through to the APIs. In prod the
rem  gateway serves the two builds itself, and the APIs still run beside it.
rem
rem  Each child is started through apex\run.mjs, which gives it exactly its own
rem  environment from apex\projects.mjs. Setting variables here would not work:
rem  both APIs read PORT and DROPBOX_REDIRECT_URI, and both web apps read
rem  VITE_API_BASE_URL, so one project's values would leak into the other's.
rem
rem  Leave this window open while you use Apex. Stop it with stop.bat.

cd /d "%~dp0"

set "SHOWCASE_DIR=inspironics-innovation-showcase"
set "VAULT_DIR=slide vault"
set "GATEWAY_PORT=5173"
set "SHOWCASE_PORT=5174"
set "VAULT_PORT=5175"
set "SHOWCASE_API_PORT=4176"
set "VAULT_API_PORT=4175"
set "RUN=%~dp0apex\run.mjs"

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

rem  Clear our own leftovers first.
rem
rem  If the gateway window is closed or crashes, the child servers outlive it
rem  and keep holding their ports. Refusing to start in that state stranded you:
rem  the browser said ERR_CONNECTION_REFUSED on 5173 and this script said the
rem  ports were busy - with our own orphans. stop.mjs only ever touches
rem  processes belonging to this folder, so this is safe to run every time.
node "%~dp0apex\stop.mjs" --quiet

rem  Anything still holding a port now belongs to someone else, so say whose it
rem  is rather than killing it.
set "CHECK_PORTS=%GATEWAY_PORT% %SHOWCASE_PORT% %VAULT_PORT% %SHOWCASE_API_PORT% %VAULT_API_PORT%"
if /i "%MODE%"=="prod" set "CHECK_PORTS=%GATEWAY_PORT% %SHOWCASE_API_PORT% %VAULT_API_PORT%"

for %%P in (%CHECK_PORTS%) do (
    call :port_pid %%P
    if defined PID (
        echo.
        echo   Port %%P is in use by PID !PID!, which does not belong to this
        echo   folder, so Apex will not touch it.
        echo.
        echo   Stop that program and run this again, or move Apex's ports in
        echo   apex\projects.mjs. In prod you can pass one:  start.bat prod 4180
        echo.
        pause
        exit /b 1
    )
)

call :ensure_deps "%SHOWCASE_DIR%" "Innovation Showcase"
if errorlevel 1 exit /b 1
call :ensure_deps "%VAULT_DIR%" "SlidesVault"
if errorlevel 1 exit /b 1

rem  Each API needs its .env: it holds the Dropbox app key and the key that
rem  encrypts the refresh token. Say so here rather than leave a card stuck on
rem  "Starting".
call :ensure_env "%VAULT_DIR%" "SlidesVault"
if errorlevel 1 exit /b 1
call :ensure_env "%SHOWCASE_DIR%" "Innovation Showcase"
if errorlevel 1 exit /b 1

echo.
echo   Apex - Inspironics
echo   ----------------------------------------------------
echo     mode           %MODE%
echo     dashboard      http://localhost:%GATEWAY_PORT%/
echo     showcase       http://localhost:%GATEWAY_PORT%/showcase/
echo     showcase api   http://localhost:%GATEWAY_PORT%/showcase/api/
echo     vault          http://localhost:%GATEWAY_PORT%/vault/
echo     vault api      http://localhost:%GATEWAY_PORT%/vault/api/
echo.
echo   Dropbox redirect URIs - register each exactly in the Dropbox App Console:
node "%RUN%" redirects %GATEWAY_PORT%
echo.

if /i "%MODE%"=="prod" goto :prod

rem ---------------------------------------------------------------- dev ----
rem  Each child runs in its own window so its logs stay readable and stop.bat
rem  can close it. The gateway runs here, in the foreground.

echo   Starting the Innovation Showcase dev server and API...
start "Apex - Innovation Showcase" /min cmd /c node "%RUN%" showcase web dev %GATEWAY_PORT%
start "Apex - Innovation Showcase API" /min cmd /c node "%RUN%" showcase api dev %GATEWAY_PORT%

echo   Starting the SlidesVault dev server and API...
start "Apex - SlidesVault" /min cmd /c node "%RUN%" vault web dev %GATEWAY_PORT%
start "Apex - SlidesVault API" /min cmd /c node "%RUN%" vault api dev %GATEWAY_PORT%

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
node "%RUN%" showcase build %GATEWAY_PORT%
if errorlevel 1 (
    echo.
    echo   The Innovation Showcase build failed - see the output above.
    echo.
    pause
    exit /b 1
)

echo.
echo   Building SlidesVault...
node "%RUN%" vault build %GATEWAY_PORT%
if errorlevel 1 (
    echo.
    echo   The SlidesVault build failed - see the output above.
    echo.
    pause
    exit /b 1
)

echo.
echo   Starting the APIs...
start "Apex - Innovation Showcase API" /min cmd /c node "%RUN%" showcase api prod %GATEWAY_PORT%
start "Apex - SlidesVault API" /min cmd /c node "%RUN%" vault api prod %GATEWAY_PORT%

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

rem  Creates a project's apps\api\.env from its .env.example on first run, then
rem  stops so the Dropbox credentials can be filled in.
:ensure_env
if not exist "%~1\apps\api\.env" (
    copy /y "%~1\apps\api\.env.example" "%~1\apps\api\.env" >nul
    echo.
    echo   Created %~1\apps\api\.env from its example.
    echo   Fill in DROPBOX_APP_KEY, DROPBOX_APP_SECRET, the encryption key and
    echo   BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD in it, then run
    echo   start.bat again.
    echo.
    pause
    exit /b 1
)
exit /b 0

rem  Sets PID to the process listening on the port passed in, or leaves it unset.
:port_pid
set "PID="
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr /r /c:":%~1 .*LISTENING"') do (
    if not defined PID set "PID=%%P"
)
exit /b 0
