param(
    [Parameter(Position=0)]
    [string]$Action
)

$ErrorActionPreference = "Stop"

function Assert-CommandExists {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Name,
        [Parameter(Mandatory=$true)]
        [string]$Hint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Host ""
        Write-Host "ERROR: '$Name' 명령을 찾을 수 없습니다." -ForegroundColor Red
        Write-Host $Hint -ForegroundColor Yellow
        exit 1
    }
}

function Invoke-CheckedCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true, Position=0)]
        [string]$Exe,
        [Parameter(ValueFromRemainingArguments=$true)]
        [string[]]$ArgumentList
    )

    & $Exe @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "ERROR: 명령 실패: $Exe $($ArgumentList -join ' ')" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

switch ($Action) {
    "start" {
        Write-Host "Starting Sociallabs API Server..." -ForegroundColor Green
        Assert-CommandExists -Name "pm2" -Hint "해결: Node.js(npm) 설치 후 'npm i -g pm2' 실행, 또는 PATH에 pm2가 포함되었는지 확인하세요."
        Invoke-CheckedCommand pm2 start ecosystem.config.js
        Invoke-CheckedCommand pm2 save
        Invoke-CheckedCommand pm2 status
    }
    "stop" {
        Write-Host "Stopping Sociallabs API Server..." -ForegroundColor Yellow
        Assert-CommandExists -Name "pm2" -Hint "해결: Node.js(npm) 설치 후 'npm i -g pm2' 실행, 또는 PATH에 pm2가 포함되었는지 확인하세요."
        Invoke-CheckedCommand pm2 stop sociallabs-api
    }
    "restart" {
        Write-Host "Restarting Sociallabs API Server..." -ForegroundColor Cyan
        Assert-CommandExists -Name "pm2" -Hint "해결: Node.js(npm) 설치 후 'npm i -g pm2' 실행, 또는 PATH에 pm2가 포함되었는지 확인하세요."
        Invoke-CheckedCommand pm2 restart sociallabs-api
        Invoke-CheckedCommand pm2 status
    }
    "status" {
        Assert-CommandExists -Name "pm2" -Hint "해결: Node.js(npm) 설치 후 'npm i -g pm2' 실행, 또는 PATH에 pm2가 포함되었는지 확인하세요."
        Invoke-CheckedCommand pm2 status
        Invoke-CheckedCommand pm2 info sociallabs-api
    }
    "logs" {
        Assert-CommandExists -Name "pm2" -Hint "해결: Node.js(npm) 설치 후 'npm i -g pm2' 실행, 또는 PATH에 pm2가 포함되었는지 확인하세요."
        Invoke-CheckedCommand pm2 logs sociallabs-api
    }
    "build" {
        Write-Host "Building production version..." -ForegroundColor Blue
        Assert-CommandExists -Name "npm" -Hint "해결: Node.js를 설치하고, 새 터미널을 열어 'node -v' / 'npm -v'가 동작하는지 확인하세요."
        Invoke-CheckedCommand npm run build
        Write-Host "Build complete!" -ForegroundColor Green
        Write-Host "Run '.\server.ps1 restart' to apply changes"
    }
    "deploy" {
        Write-Host "Full deployment: build + restart..." -ForegroundColor Magenta
        Assert-CommandExists -Name "npm" -Hint "해결: Node.js를 설치하고, 새 터미널을 열어 'node -v' / 'npm -v'가 동작하는지 확인하세요."
        Assert-CommandExists -Name "pm2" -Hint "해결: Node.js(npm) 설치 후 'npm i -g pm2' 실행, 또는 PATH에 pm2가 포함되었는지 확인하세요."
        Invoke-CheckedCommand npm run build
        Invoke-CheckedCommand pm2 restart sociallabs-api
        Invoke-CheckedCommand pm2 save
        Write-Host "Deployment complete!" -ForegroundColor Green
        Invoke-CheckedCommand pm2 status
    }
    "install" {
        Write-Host "Installing dependencies..." -ForegroundColor Blue
        Assert-CommandExists -Name "npm" -Hint "해결: Node.js를 설치하고, 새 터미널을 열어 'node -v' / 'npm -v'가 동작하는지 확인하세요."
        Invoke-CheckedCommand npm install
        Write-Host "Generating Prisma client..." -ForegroundColor Blue
        Invoke-CheckedCommand npm run prisma:generate
        Write-Host "Building..." -ForegroundColor Blue
        Invoke-CheckedCommand npm run build
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
