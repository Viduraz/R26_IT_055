# start-all.ps1
# Master script to run the entire Secure Elder Care project in one command.
# Starts 6 backends, 6 frontends (minimized), the local proxy, and the Cloudflare Quick Tunnel.
# Press Ctrl+C in this window to stop everything cleanly.
#
# Run from the project root:
#   .\start-all.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "   Secure Elder Care - Start All Services & Tunnel  " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""

$processes = @()

# Define services
$backends = @(
    @{ Path = "auth-service\backend"; Name = "Auth Backend" },
    @{ Path = "face-verification\backend"; Name = "Face Backend" },
    @{ Path = "tracking-geofencing\backend"; Name = "Tracking Backend" },
    @{ Path = "anomaly-detection\backend"; Name = "Anomaly Backend" },
    @{ Path = "schedule-monitoring\backend"; Name = "Schedule Backend" },
    @{ Path = "gateway-dashboard\backend"; Name = "Gateway Backend" }
)

$frontends = @(
    @{ Path = "gateway-dashboard\frontend"; Name = "Gateway UI (5178)" },
    @{ Path = "auth-service\frontend"; Name = "Auth UI (5173)" },
    @{ Path = "face-verification\frontend"; Name = "Face UI (5174)" },
    @{ Path = "tracking-geofencing\frontend"; Name = "Tracking UI (5175)" },
    @{ Path = "anomaly-detection\frontend"; Name = "Anomaly UI (5176)" },
    @{ Path = "schedule-monitoring\frontend"; Name = "Schedule UI (5177)" }
)

# ── 1. Start Backends ──────────────────────────────────────────────────
Write-Host "[INFO] Starting 6 FastAPI Backends (minimized)..." -ForegroundColor Yellow
foreach ($be in $backends) {
    $fullPath = Join-Path $PSScriptRoot $be.Path
    $proc = Start-Process -FilePath "python" -ArgumentList "run.py" -WorkingDirectory $fullPath -WindowStyle Minimized -PassThru
    $processes += $proc
    Start-Sleep -Milliseconds 200
}
Write-Host "[SUCCESS] Backends started." -ForegroundColor Green
Write-Host ""

# ── 2. Start Frontends ─────────────────────────────────────────────────
Write-Host "[INFO] Starting 6 React Frontends in tunnel mode (minimized)..." -ForegroundColor Yellow
foreach ($fe in $frontends) {
    $fullPath = Join-Path $PSScriptRoot $fe.Path
    $proc = Start-Process -FilePath "powershell.exe" -ArgumentList "-Command", "npm run dev -- --host 127.0.0.1 --mode tunnel" -WorkingDirectory $fullPath -WindowStyle Minimized -PassThru
    $processes += $proc
    Start-Sleep -Milliseconds 200
}
Write-Host "[SUCCESS] Frontends started." -ForegroundColor Green
Write-Host ""

# ── 3. Start Local Proxy and Cloudflare Tunnel ──────────────────────────
$cloudflared = "$PSScriptRoot\cloudflare\cloudflared.exe"
$proxyScript = "$PSScriptRoot\cloudflare\proxy.js"
$tunnelLog   = "$PSScriptRoot\tunnel.log"

if (-not (Test-Path $cloudflared)) {
    Write-Host "[ERROR] cloudflared.exe not found. Run cloudflare\install-cloudflared.ps1 first." -ForegroundColor Red
    # Cleanup before exit
    foreach ($p in $processes) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    exit 1
}

# Remove old logs if they exist
if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }

# Start local reverse proxy in the background
Write-Host "[INFO] Starting local Node.js reverse proxy on port 8080..." -ForegroundColor Yellow
$proxyProcess = Start-Process -FilePath "node" -ArgumentList $proxyScript -NoNewWindow -PassThru
Start-Sleep -Seconds 2

if ($proxyProcess.HasExited) {
    Write-Host "[ERROR] Failed to start Node.js reverse proxy." -ForegroundColor Red
    foreach ($p in $processes) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    exit 1
}
Write-Host "[SUCCESS] Reverse proxy is running." -ForegroundColor Green
Write-Host ""

Write-Host "[INFO] Starting Cloudflare Quick Tunnel..." -ForegroundColor Yellow
Write-Host "Waiting for Cloudflare to generate your public link (takes ~5-10 seconds)..." -ForegroundColor Gray

# Run cloudflared in the background and redirect logs to a temp file
$tunnelProcess = Start-Process -FilePath $cloudflared -ArgumentList "tunnel --url http://localhost:8080" -RedirectStandardError $tunnelLog -NoNewWindow -PassThru

try {
    $linkFound = $false
    $url = ""
    
    # Loop and read the log file until the link is generated
    while (-not $tunnelProcess.HasExited) {
        if (Test-Path $tunnelLog) {
            $logContent = Get-Content $tunnelLog -ErrorAction SilentlyContinue
            $linkLine = $logContent | Where-Object { $_ -match "https://[a-zA-Z0-9\-]+\.trycloudflare\.com" } | Select-Object -First 1
            if ($linkLine) {
                # Force to string and extract using capture group
                $linkString = [string]$linkLine
                if ($linkString -match "(https://[a-zA-Z0-9\-]+\.trycloudflare\.com)") {
                    $url = $Matches[1]
                    $linkFound = $true
                    break
                }
            }
        }
        Start-Sleep -Seconds 1
    }

    if ($linkFound) {
        Write-Host ""
        Write-Host "=====================================================================" -ForegroundColor Green
        Write-Host " 🎉  YOUR LIVE SECURE ELDERCARE TUNNEL IS READY!" -ForegroundColor Green
        Write-Host "=====================================================================" -ForegroundColor Green
        Write-Host "  Copy and share this public URL with your teammates:" -ForegroundColor White
        Write-Host ""
        Write-Host "  👉  $url" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "=====================================================================" -ForegroundColor Green
        Write-Host "  Press [Ctrl + C] in this window to stop and close all services." -ForegroundColor Red
        Write-Host "=====================================================================" -ForegroundColor Green
        Write-Host ""
        
        # Keep process open and wait for user interruption
        $tunnelProcess.WaitForExit()
    } else {
        Write-Host "[ERROR] Cloudflare tunnel failed to start or did not return a link." -ForegroundColor Red
        if (Test-Path $tunnelLog) {
            Get-Content $tunnelLog -Tail 10
        }
    }
}
finally {
    Write-Host ""
    Write-Host "[INFO] Shutting down all services cleanly..." -ForegroundColor Yellow
    
    # Stop the tunnel if running
    if (-not $tunnelProcess.HasExited) {
        Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
    }
    
    # Stop the local proxy
    Stop-Process -Id $proxyProcess.Id -Force -ErrorAction SilentlyContinue
    
    # Stop all backends and frontends
    foreach ($p in $processes) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
    
    # Clean up temp log
    if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }
    
    Write-Host "[SUCCESS] All services stopped cleanly. Have a nice day!" -ForegroundColor Green
}
