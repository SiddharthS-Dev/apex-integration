@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem ============================================================================
rem  Inspironics SlidesVault - start
rem
rem    start.bat            start the dev server on port 5173
rem    start.bat 3000       start the dev server on port 3000
rem    start.bat preview    build for production, then serve dist/ on port 4173
rem
rem  Stop it again with stop.bat (pass the same argument, if you used one).
rem ============================================================================

cd /d "%~dp0"

set "MODE=dev"
set "PORT=5173"

if /I "%~1"=="preview" (
  set "MODE=preview"
  set "PORT=4173"
  if not "%~2"=="" set "PORT=%~2"
) else (
  if not "%~1"=="" set "PORT=%~1"
)

rem Project folder without the trailing backslash - used to tell our own server
rem apart from any other app that happens to hold the same port.
set "PROJECT=%~dp0"
if "%PROJECT:~-1%"=="\" set "PROJECT=%PROJECT:~0,-1%"

set "BASE44APP="
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%K in (".env") do (
    if /I "%%K"=="VITE_BASE44_APP_ID" if not "%%L"=="" set "BASE44APP=%%L"
  )
)

echo.
echo  Inspironics SlidesVault
echo  Presentation Knowledge Hub
echo  ----------------------------------------
echo   mode : %MODE%
echo   port : %PORT%
echo.

rem --- prerequisites ---------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo  [x] Node.js was not found on PATH.
  echo      Install it from https://nodejs.org/ ^(version 18 or newer^) and try again.
  goto :fail
)

where npm >nul 2>&1
if errorlevel 1 (
  echo  [x] npm was not found on PATH.
  goto :fail
)

rem --- is the port already taken? --------------------------------------------
call :portOwner %PORT%
if "%OWNER%"=="ours" (
  echo  [i] SlidesVault is already running on port %PORT% ^(PID %OWNERPID%^).
  echo      Opening it in your browser. Run stop.bat first if you want a fresh start.
  start "" "http://localhost:%PORT%/"
  goto :done
)
if "%OWNER%"=="foreign" (
  echo  [x] Port %PORT% is already in use by another application ^(PID %OWNERPID%^):
  echo        %OWNERNAME%
  echo      Leaving it alone. Start SlidesVault on a free port instead, e.g.
  if /I "%MODE%"=="preview" (
    echo        start.bat preview 4200
  ) else (
    echo        start.bat 5200
  )
  goto :fail
)

rem --- dependencies ----------------------------------------------------------
if not exist "node_modules" (
  echo  [*] First run - installing dependencies. This takes a minute...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo  [x] npm install failed. Fix the errors above and try again.
    goto :fail
  )
  echo.
)

rem --- production build, preview mode only -----------------------------------
if /I "%MODE%"=="preview" (
  echo  [*] Building for production...
  call npm run build
  if errorlevel 1 (
    echo  [x] The build failed. Fix the errors above and try again.
    goto :fail
  )
  echo.
)

rem --- launch ----------------------------------------------------------------
rem The web app proxies /api to the API server, so both have to be up: opening
rem the UI on its own leaves every request failing against a dead backend.
echo  [*] Starting the API server on port 4000...
start "SlidesVault API (port 4000)" /MIN cmd /c "npm run dev:api"

echo  [*] Starting the %MODE% server...
if /I "%MODE%"=="preview" (
  start "SlidesVault preview server (port %PORT%)" /MIN cmd /c "npm run preview --workspace @slidesvault/web -- --port %PORT% --strictPort"
) else (
  start "SlidesVault dev server (port %PORT%)" /MIN cmd /c "npm run dev --workspace @slidesvault/web -- --port %PORT% --strictPort"
)

rem --- wait for it to accept connections --------------------------------------
set /a TRIES=0
:waitloop
set /a TRIES+=1
call :portOwner %PORT%
if "%OWNER%"=="ours" goto :ready
if %TRIES% GEQ 60 (
  echo  [x] The server did not come up within 60 seconds.
  echo      Check the minimised "SlidesVault %MODE% server" window for the error.
  goto :fail
)
ping -n 2 127.0.0.1 >nul
goto :waitloop

:ready
echo.
echo  [ok] SlidesVault is running.
echo.
echo       URL  : http://localhost:%PORT%/
echo       PID  : %OWNERPID%
if /I "%MODE%"=="preview" (
  echo       Stop : stop.bat preview
) else (
  if "%PORT%"=="5173" ( echo       Stop : stop.bat ) else ( echo       Stop : stop.bat %PORT%)
)
echo.
if defined BASE44APP (
  echo       Backend: Base44 app %BASE44APP%
  echo       Sign in with your Base44 account.
) else (
  echo       Backend: local demo catalog ^(no VITE_BASE44_APP_ID set^)
  echo       Sign in with a seeded demo account ^(password: slidesvault^)
  echo         admin  : avery.raman@inspironics.net
  echo         member : sana.kapoor@inspironics.net
)
echo.

start "" "http://localhost:%PORT%/"

:done
endlocal
exit /b 0

:fail
echo.
pause
endlocal
exit /b 1

rem ---------------------------------------------------------------------------
rem  :portOwner <port>
rem  Sets OWNER to "free", "ours" (a process launched from this folder) or
rem  "foreign", plus OWNERPID / OWNERNAME for whatever is holding the port.
rem ---------------------------------------------------------------------------
:portOwner
set "OWNER=free"
set "OWNERPID="
set "OWNERNAME="
set "PORTLIST=%TEMP%\slidesvault-port-%~1-%RANDOM%%RANDOM%.txt"

powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in @((Get-NetTCPConnection -LocalPort %~1 -State Listen -ErrorAction SilentlyContinue).OwningProcess) } | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, $_.Name, ($_.CommandLine -replace '\s+', ' ') }" > "%PORTLIST%" 2>nul

if not exist "%PORTLIST%" exit /b 0
for /f "usebackq tokens=1,2,* delims=|" %%A in ("%PORTLIST%") do (
  if not defined OWNERPID (
    set "OWNERPID=%%A"
    set "OWNERNAME=%%B"
  )
  echo %%C | findstr /I /C:"%PROJECT%" >nul 2>&1
  if not errorlevel 1 (
    set "OWNER=ours"
    set "OWNERPID=%%A"
    set "OWNERNAME=%%B"
  ) else (
    if not "!OWNER!"=="ours" set "OWNER=foreign"
  )
)

del /q "%PORTLIST%" >nul 2>&1
exit /b 0
