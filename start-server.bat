@echo off
cd /d "%~dp0"
echo Starting 5etools server on http://localhost:3000/
echo Press Ctrl+C to stop
echo.
node server.js
pause