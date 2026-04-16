@echo off
echo Pushing 5etools setup to GitHub...
echo.

cd /d "%~dp0"

echo Step 1: Initialize git repository (if not already done)
git init
git add .
git commit -m "Initial commit: 5etools local setup with ngrok tunneling"

echo.
echo Step 2: Create GitHub repository at https://github.com/new
echo - Repository name: 5etools-local-setup
echo - Make it public or private as preferred
echo.

set /p repo_url="Enter your GitHub repository URL: "

echo.
echo Step 3: Push to GitHub...
git branch -M main
git remote add origin %repo_url%
git push -u origin main

echo.
echo ✅ Repository pushed to GitHub!
echo.
echo Your repository is now live at: %repo_url%
echo Share this with others to help them set up their own 5etools instance!
echo.
pause