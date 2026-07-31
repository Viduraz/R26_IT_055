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
    @{ Path = "gateway-dashboard\backend"; Name = "Gateway Backend" },
    @{ Path = "caregiver-marketplace\backend"; Name = "Marketplace Backend" },
    @{ Path = "skeleton-identification\backend"; Name = "Skeleton Backend (8006)" }
)

$frontends = @(
    @{ Path = "gateway-dashboard\frontend"; Name = "Gateway UI (5178)" },
    @{ Path = "auth-service\frontend"; Name = "Auth UI (5173)" },
    @{ Path = "face-verification\frontend"; Name = "Face UI (5174)" },
    @{ Path = "tracking-geofencing\frontend"; Name = "Tracking UI (5175)" },
    @{ Path = "anomaly-detection\frontend"; Name = "Anomaly UI (5176)" },
    @{ Path = "schedule-monitoring\frontend"; Name = "Schedule UI (5177)" },
    @{ Path = "caregiver-marketplace\frontend"; Name = "Marketplace UI (5179)" },
    @{ Path = "skeleton-identification\frontend"; Name = "Skeleton UI (3000)" }
)


# ── 1. Start Backends ──────────────────────────────────────────────────
Write-Host "[INFO] Starting 8 FastAPI Backends (minimized)..." -ForegroundColor Yellow
foreach ($be in $backends) {
    $fullPath = Join-Path $PSScriptRoot $be.Path
    $proc = Start-Process -FilePath "python" -ArgumentList "run.py" -WorkingDirectory $fullPath -WindowStyle Minimized -PassThru
    $processes += $proc
    Start-Sleep -Milliseconds 200
}
Write-Host "[SUCCESS] Backends started." -ForegroundColor Green
Write-Host ""

# ── 2. Start Frontends ─────────────────────────────────────────────────
Write-Host "[INFO] Starting 8 React Frontends in tunnel mode (minimized)..." -ForegroundColor Yellow

foreach ($fe in $frontends) {
    $fullPath = Join-Path $PSScriptRoot $fe.Path

    # Skeleton-ID frontend requires:
    #   --host 0.0.0.0   : bind all interfaces (proxy connects via 127.0.0.1)
    #   --mode tunnel     : activates base='/skeleton/' in vite.config.js
    if ($fe.Name -like "*Skeleton*") {
        $proc = Start-Process -FilePath "powershell.exe" -ArgumentList "-Command", "npm run dev -- --host 0.0.0.0 --mode tunnel" -WorkingDirectory $fullPath -WindowStyle Minimized -PassThru
    } else {
        $proc = Start-Process -FilePath "powershell.exe" -ArgumentList "-Command", "npm run dev -- --host 127.0.0.1 --mode tunnel" -WorkingDirectory $fullPath -WindowStyle Minimized -PassThru
    }
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

# ── Kill any leftover cloudflared / proxy processes from a previous session ──
Write-Host "[INFO] Cleaning up any leftover tunnel processes..." -ForegroundColor Yellow
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
# Give the OS a moment to release file handles
Start-Sleep -Milliseconds 500

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
# --protocol http2  : Use HTTP/2 over TLS instead of QUIC — avoids QUIC idle-timeout 530 errors
# --no-autoupdate   : Don't auto-restart cloudflared mid-session
$tunnelProcess = Start-Process -FilePath $cloudflared -ArgumentList "tunnel --url http://localhost:8080 --protocol http2 --no-autoupdate" -RedirectStandardError $tunnelLog -NoNewWindow -PassThru

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
        Write-Host "====================================================================" -ForegroundColor Green
        Write-Host "  *** YOUR LIVE SECURE ELDERCARE TUNNEL IS READY! ***" -ForegroundColor Green
        Write-Host "====================================================================" -ForegroundColor Green
        Write-Host "  Copy and share this public URL with your teammates:" -ForegroundColor White
        Write-Host ""
        Write-Host "  >>  $url" -ForegroundColor Cyan
        Write-Host "  >>  $url/skeleton/" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "====================================================================" -ForegroundColor Green
        Write-Host "  Press [Ctrl + C] in this window to stop and close all services." -ForegroundColor Red
        Write-Host "====================================================================" -ForegroundColor Green
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
