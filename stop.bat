@echo off
setlocal EnableExtensions
title Apex - stop

rem  Stops everything start.bat launched: the Apex gateway and both project dev
rem  servers.
rem
rem    stop.bat            the standard ports (5173, 5174, 5175, 4173)
rem    stop.bat 4180       also look at a custom prod port
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
