@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Stop Inspironics Innovation Showcase

rem  Stops the local showcase servers.
rem
rem    stop.bat           stops the API (4100) and web (5180) servers
rem    stop.bat 5181      stops the server on a specific port

cd /d "%~dp0"

set "PORTS=4100 5180"
if not "%~1"=="" set "PORTS=%~1"

set "KILLED= "

echo.
for %%T in (%PORTS%) do (
    for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr /r /c:":%%T .*LISTENING"') do (
        rem  A port can appear twice (IPv4 and IPv6) - only kill each PID once.
        echo !KILLED! | findstr /c:" %%P " >nul
        if errorlevel 1 (
            echo   Stopping port %%T, PID %%P ...
            taskkill /PID %%P /T /F >nul 2>&1
            if errorlevel 1 (
                echo     could not stop PID %%P - it may belong to another user.
            ) else (
                echo     stopped.
                set "KILLED=!KILLED!%%P "
            )
        )
    )
)

if "!KILLED!"==" " (
    echo   Nothing was listening on: %PORTS%
) else (
    echo.
    echo   Showcase stopped.
)
echo.
timeout /t 4 /nobreak >nul 2>&1
exit /b 0
