param(
    [Parameter(Position=0)]
    [string]$Action
)

switch ($Action) {
    "start" {
        Write-Host "Starting Sociallabs API Server..." -ForegroundColor Green
        pm2 start ecosystem.config.js
        pm2 save
        pm2 status
    }
    "stop" {
        Write-Host "Stopping Sociallabs API Server..." -ForegroundColor Yellow
        pm2 stop sociallabs-api
    }
    "restart" {
        Write-Host "Restarting Sociallabs API Server..." -ForegroundColor Cyan
        pm2 restart sociallabs-api
        pm2 status
    }
    "status" {
        pm2 status
        pm2 info sociallabs-api
    }
    "logs" {
        pm2 logs sociallabs-api
    }
    "build" {
        Write-Host "Building production version..." -ForegroundColor Blue
        npm run build
        Write-Host "Build complete!" -ForegroundColor Green
        Write-Host "Run '.\server.ps1 restart' to apply changes"
    }
    "deploy" {
        Write-Host "Full deployment: build + restart..." -ForegroundColor Magenta
        npm run build
        pm2 restart sociallabs-api
        pm2 save
        Write-Host "Deployment complete!" -ForegroundColor Green
        pm2 status
    }
    "install" {
        Write-Host "Installing dependencies..." -ForegroundColor Blue
        npm install
        Write-Host "Generating Prisma client..." -ForegroundColor Blue
        npm run prisma:generate
        Write-Host "Building..." -ForegroundColor Blue
        npm run build
        Write-Host "Installation complete!" -ForegroundColor Green
    }
    default {
        Write-Host ""
        Write-Host "Sociallabs VPS Backend Server Management" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Usage: .\server.ps1 [command]"
        Write-Host ""
        Write-Host "Commands:"
        Write-Host "  install   Install dependencies and build"
        Write-Host "  start     Start the server"
        Write-Host "  stop      Stop the server"
        Write-Host "  restart   Restart the server"
        Write-Host "  status    Show server status"
        Write-Host "  logs      Show server logs"
        Write-Host "  build     Build production version"
        Write-Host "  deploy    Build and restart (full deployment)"
        Write-Host ""
        Write-Host "Server URL: http://localhost:4000"
        Write-Host ""
    }
}
