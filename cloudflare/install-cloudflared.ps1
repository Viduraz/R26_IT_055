# install-cloudflared.ps1
# Downloads the latest cloudflared.exe for Windows into this directory.
# Run once from the project root:
#   .\cloudflare\install-cloudflared.ps1

$ErrorActionPreference = "Stop"
$outFile = "$PSScriptRoot\cloudflared.exe"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Secure Elder Care — cloudflared Setup  " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $outFile) {
    Write-Host "✅ cloudflared.exe already exists at:" -ForegroundColor Green
    Write-Host "   $outFile" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Run '.\cloudflare\cloudflared.exe --version' to confirm it works." -ForegroundColor Yellow
    exit 0
}

Write-Host "📥 Downloading cloudflared.exe (latest stable)..." -ForegroundColor Cyan
$url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

try {
    Invoke-WebRequest -Uri $url -OutFile $outFile -UseBasicParsing
    Write-Host ""
    Write-Host "✅ Downloaded to: $outFile" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next step — run the setup script:" -ForegroundColor Yellow
    Write-Host "   .\cloudflare\setup-tunnel.ps1" -ForegroundColor White
} catch {
    Write-Host ""
    Write-Host "❌ Download failed: $_" -ForegroundColor Red
    Write-Host "Please download manually from:" -ForegroundColor Yellow
    Write-Host "   https://github.com/cloudflare/cloudflared/releases" -ForegroundColor White
    exit 1
}
