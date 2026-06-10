# start-tunnel.ps1
# Starts the local Node.js proxy and launches a free Cloudflare Quick Tunnel.
# Run from the project root whenever you want to go live:
#   .\cloudflare\start-tunnel.ps1
#
# Prerequisites:
#   - Node.js installed
#   - cloudflared.exe present (run install-cloudflared.ps1)
#   - All backends running (python run.py in each service)
#   - All frontends running in tunnel mode (npm run dev -- --mode tunnel in each service)

$ErrorActionPreference = "Stop"
$cloudflared = "$PSScriptRoot\cloudflared.exe"
$proxyScript = "$PSScriptRoot\proxy.js"

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host " Secure Elder Care — Starting Tunnel  " -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $cloudflared)) {
    Write-Host "[ERROR] cloudflared.exe not found. Run install-cloudflared.ps1 first." -ForegroundColor Red
    exit 1
}

# ── Start local reverse proxy ───────────────────────────────────────────
Write-Host "[INFO] Starting local Node.js reverse proxy on port 8080..." -ForegroundColor Yellow
$proxyProcess = Start-Process -FilePath "node" -ArgumentList $proxyScript -NoNewWindow -PassThru
Start-Sleep -Seconds 2

# Check if proxy started successfully
if ($proxyProcess.HasExited) {
    Write-Host "[ERROR] Failed to start Node.js reverse proxy. Check your Node installation." -ForegroundColor Red
    exit 1
}
Write-Host "[SUCCESS] Reverse proxy is running." -ForegroundColor Green
Write-Host ""

# ── Start Cloudflare Quick Tunnel ───────────────────────────────────────
Write-Host "[INFO] Starting Cloudflare Quick Tunnel..." -ForegroundColor Yellow
Write-Host "------------------------------------------------------------" -ForegroundColor Gray
Write-Host "Cloudflare will print your public HTTPS URL below." -ForegroundColor Cyan
Write-Host "Look for a line like: https://xxxxx.trycloudflare.com" -ForegroundColor Cyan
Write-Host "------------------------------------------------------------" -ForegroundColor Gray
Write-Host ""

try {
    # Forward port 8080 to a free quick tunnel
    & $cloudflared tunnel --url http://localhost:8080
}
finally {
    # Clean up proxy process when tunnel is stopped
    Write-Host ""
    Write-Host "[INFO] Stopping local reverse proxy..." -ForegroundColor Yellow
    Stop-Process -Id $proxyProcess.Id -Force -ErrorAction SilentlyContinue
    Write-Host "[SUCCESS] Stopped." -ForegroundColor Green
}
