@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem ============================================================================
rem  Inspironics SlidesVault - stop
rem
rem    stop.bat             stop the dev server on port 5173
rem    stop.bat 3000        stop the server on port 3000
rem    stop.bat preview     stop the preview server on port 4173
rem    stop.bat all         stop every SlidesVault server started from here
rem
rem  Only processes launched from this folder are ever stopped, so a server
rem  belonging to another project on the same port is left untouched.
rem ============================================================================

cd /d "%~dp0"

set "PROJECT=%~dp0"
if "%PROJECT:~-1%"=="\" set "PROJECT=%PROJECT:~0,-1%"

echo.
echo  Inspironics SlidesVault - stop
echo  ----------------------------------------

if /I "%~1"=="all" goto :stopall

set "PORT=5173"
if /I "%~1"=="preview" (
  set "PORT=4173"
  if not "%~2"=="" set "PORT=%~2"
) else (
  if not "%~1"=="" set "PORT=%~1"
)

call :stopPort %PORT%
echo.
endlocal
exit /b 0

rem ---------------------------------------------------------------------------
rem  Stops every node process started from this folder, whatever port it is on.
rem ---------------------------------------------------------------------------
:stopall
set "LIST=%TEMP%\slidesvault-all-%RANDOM%.txt"
set "KILLED="

powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*%PROJECT%*' } | ForEach-Object { $_.ProcessId }" > "%LIST%" 2>nul

for /f "usebackq" %%P in ("%LIST%") do (
  taskkill /PID %%P /T /F >nul 2>&1
  if not errorlevel 1 (
    echo  [ok] Stopped SlidesVault process %%P.
    set "KILLED=1"
  )
)
del /q "%LIST%" >nul 2>&1

if not defined KILLED echo  [i] No SlidesVault server is running.
echo.
endlocal
exit /b 0

rem ---------------------------------------------------------------------------
rem  :stopPort <port>
rem  Stops the listener on one port, but only when it came from this folder.
rem ---------------------------------------------------------------------------
:stopPort
set "P=%~1"
set "LIST=%TEMP%\slidesvault-stop-%P%.txt"
set "KILLED="
set "FOREIGN="

powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in @((Get-NetTCPConnection -LocalPort %P% -State Listen -ErrorAction SilentlyContinue).OwningProcess) } | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, $_.Name, ($_.CommandLine -replace '\s+', ' ') }" > "%LIST%" 2>nul

for /f "usebackq tokens=1,2,* delims=|" %%A in ("%LIST%") do (
  echo %%C | findstr /I /C:"%PROJECT%" >nul 2>&1
  if errorlevel 1 (
    echo  [i] Port %P% is held by another application ^(PID %%A, %%B^) - left running.
    set "FOREIGN=1"
  ) else (
    taskkill /PID %%A /T /F >nul 2>&1
    if not errorlevel 1 (
      echo  [ok] Stopped SlidesVault on port %P% ^(PID %%A^).
      set "KILLED=1"
    ) else (
      echo  [x] Could not stop PID %%A. Try running this script as administrator.
    )
  )
)
del /q "%LIST%" >nul 2>&1

if not defined KILLED if not defined FOREIGN echo  [i] Nothing from this project was running on port %P%.
exit /b 0
