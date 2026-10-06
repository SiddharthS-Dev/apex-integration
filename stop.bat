@echo off
setlocal EnableExtensions
title Apex - stop

rem  Stops everything start.bat launched: the Apex gateway and every project's dev
rem  and API servers.
rem
rem    stop.bat            the standard ports (apex\projects.mjs lists them)
rem    stop.bat 4180       the standard ports and a custom prod gateway port
rem                        (start.bat prod 4180) - in addition, not instead
rem
rem  Only processes belonging to this folder are stopped - another project's
rem  dev server sitting on the same port is reported and left alone.

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Node.js was not found on PATH.
    echo.
    pause
    exit /b 1
)

echo.
echo   Stopping Apex...
echo.

node "%~dp0apex\stop.mjs" %*

echo.
pause
exit /b 0
