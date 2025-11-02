# Quick Launch Script for Veo Dongle Raspberry Pi
# Usage: .\launch.ps1

Write-Host "🚀 Launching Veo Dongle Raspberry Pi..." -ForegroundColor Green
Write-Host ""

# Check if we should use WSL or Windows
$UseWSL = $false

if (Get-Command wsl -ErrorAction SilentlyContinue) {
    Write-Host "WSL detected. Would you like to launch in WSL? (Recommended)" -ForegroundColor Yellow
    Write-Host "Press 'Y' for WSL, any other key for Windows" -ForegroundColor Yellow
    $choice = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    
    if ($choice.Character -eq 'y' -or $choice.Character -eq 'Y') {
        $UseWSL = $true
    }
    Write-Host ""
}

if ($UseWSL) {
    Write-Host "Launching in WSL..." -ForegroundColor Cyan
    wsl bash -c "cd /mnt/c/Users/amaen/source/veo_dongle/raspberry-pi && npm start"
} else {
    Write-Host "Launching in Windows..." -ForegroundColor Cyan
    
    # Navigate to project directory
    Set-Location $PSScriptRoot
    
    # Check Node.js
    $nodeVersion = node --version
    Write-Host "Node.js version: $nodeVersion" -ForegroundColor Green
    
    # Launch
    npm start
}


