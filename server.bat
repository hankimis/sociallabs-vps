@echo off
setlocal

set "ACTION=%1"

if "%ACTION%"=="" goto help

if "%ACTION%"=="start" (
    echo Starting Sociallabs API Server...
    pm2 start ecosystem.config.js
    pm2 save
    pm2 status
    goto end
)

if "%ACTION%"=="stop" (
    echo Stopping Sociallabs API Server...
    pm2 stop sociallabs-api
    goto end
)

if "%ACTION%"=="restart" (
    echo Restarting Sociallabs API Server...
    pm2 restart sociallabs-api
    pm2 status
    goto end
)

if "%ACTION%"=="status" (
    pm2 status
    pm2 info sociallabs-api
    goto end
)

if "%ACTION%"=="logs" (
    pm2 logs sociallabs-api
    goto end
)

if "%ACTION%"=="build" (
    echo Building production version...
    call npm run build
    echo Build complete!
    echo Run 'server.bat restart' to apply changes
    goto end
)

if "%ACTION%"=="deploy" (
    echo Full deployment: build + restart...
    call npm run build
    pm2 restart sociallabs-api
    pm2 save
    echo Deployment complete!
    pm2 status
    goto end
)

if "%ACTION%"=="install" (
    echo Installing dependencies...
    call npm install
    echo Generating Prisma client...
    call npm run prisma:generate
    echo Building...
    call npm run build
    echo Installation complete!
    goto end
)

:help
echo.
echo Sociallabs VPS Backend Server Management
echo.
echo Usage: server.bat [command]
echo.
echo Commands:
echo   install   Install dependencies and build
echo   start     Start the server
echo   stop      Stop the server
echo   restart   Restart the server
echo   status    Show server status
echo   logs      Show server logs
echo   build     Build production version
echo   deploy    Build and restart (full deployment)
echo.
echo Server URL: http://localhost:4000
echo.

:end
endlocal
