@echo off
echo Setting up 5etools with ngrok tunneling...
echo.

cd /d "%~dp0"

echo Installing dependencies...
npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo Setup complete!
echo.
echo To start the server: npm start
echo To start the tunnel: npm run tunnel
echo.
echo Or use the batch files:
echo - start-server.bat
echo - start-ngrok-tunnel.bat
echo.
pause