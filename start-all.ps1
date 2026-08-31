# start-all.ps1
# Master script to run the entire Secure Elder Care project in one command.
# Starts 8 backends, 8 frontends (minimized), the local proxy, and optional Cloudflare Quick Tunnel.
# Press Ctrl+C in this window to stop everything cleanly.
#
# Usage:
#   .\start-all.ps1             (Default: starts services + Cloudflare tunnel, with fallback to local mode)
#   .\start-all.ps1 -LocalOnly  (Local mode only: starts services + local proxy without Cloudflare)

param(
    [switch]$NoTunnel,
    [switch]$LocalOnly
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "   Secure Elder Care - Start All Services & Tunnel  " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""

$processes = @()

# Python executable for services without a dedicated venv.
# NOTE: The root .venv is incomplete (missing uvicorn etc.), so we use the full
# system Python311 installation which has all packages installed globally.
$rootPython = "C:\Users\vidur\AppData\Local\Programs\Python\Python311\python.exe"

$backends = @(
    @{ Path = "auth-service\backend";            Name = "Auth Backend (8000)";        Python = $rootPython },
    @{ Path = "face-verification\backend";       Name = "Face Backend (8001)";        Python = $rootPython },
    @{ Path = "tracking-geofencing\backend";     Name = "Tracking Backend (8002)";    Python = $rootPython },
    @{ Path = "anomaly-detection\backend";       Name = "Anomaly Backend (8003)";     Python = "$PSScriptRoot\anomaly-detection\backend\venv\Scripts\python.exe" },
    @{ Path = "schedule-monitoring\backend";     Name = "Schedule Backend (8004)";    Python = $rootPython },
    @{ Path = "gateway-dashboard\backend";       Name = "Gateway Backend (8005)";     Python = $rootPython },
    @{ Path = "caregiver-marketplace\backend";   Name = "Marketplace Backend (8006)"; Python = $rootPython },
    @{ Path = "skeleton-identification\backend"; Name = "Skeleton Backend (8007)";    Python = $rootPython }
)

$frontends = @(
    @{ Path = "gateway-dashboard\frontend";      Name = "Gateway UI (5178)" },
    @{ Path = "auth-service\frontend";           Name = "Auth UI (5173)" },
    @{ Path = "face-verification\frontend";      Name = "Face UI (5174)" },
    @{ Path = "tracking-geofencing\frontend";    Name = "Tracking UI (5175)" },
    @{ Path = "anomaly-detection\frontend";      Name = "Anomaly UI (5176)" },
    @{ Path = "schedule-monitoring\frontend";    Name = "Schedule UI (5177)" },
    @{ Path = "caregiver-marketplace\frontend";  Name = "Marketplace UI (5179)" },
    @{ Path = "skeleton-identification\frontend"; Name = "Skeleton UI (3000)" }
)

# --- 1. Start Backends ---
Write-Host "[INFO] Starting 8 FastAPI Backends (minimized)..." -ForegroundColor Yellow
foreach ($be in $backends) {
    $fullPath = Join-Path $PSScriptRoot $be.Path
    Write-Host "  -> $($be.Name)" -ForegroundColor Gray
    $proc = Start-Process -FilePath $be.Python -ArgumentList "run.py" -WorkingDirectory $fullPath -WindowStyle Minimized -PassThru
    $processes += $proc
    Start-Sleep -Milliseconds 300
}
Write-Host "[SUCCESS] Backends started." -ForegroundColor Green
Write-Host ""

# --- 2. Start Frontends ---
Write-Host "[INFO] Starting 8 React Frontends in tunnel mode (minimized)..." -ForegroundColor Yellow

foreach ($fe in $frontends) {
    $fullPath = Join-Path $PSScriptRoot $fe.Path

    if ($fe.Name -like "*Skeleton*") {
        $proc = Start-Process -FilePath "powershell.exe" -ArgumentList "-Command", "npm run dev -- --host 0.0.0.0 --mode tunnel" -WorkingDirectory $fullPath -WindowStyle Minimized -PassThru
    } else {
        $proc = Start-Process -FilePath "powershell.exe" -ArgumentList "-Command", "npm run dev -- --host 127.0.0.1 --mode tunnel" -WorkingDirectory $fullPath -WindowStyle Minimized -PassThru
    }
    $processes += $proc
    Start-Sleep -Milliseconds 150
}
Write-Host "[SUCCESS] Frontends started." -ForegroundColor Green
Write-Host ""

# --- 3. Start Local Reverse Proxy ---
$cloudflared = "$PSScriptRoot\cloudflare\cloudflared.exe"
$proxyScript = "$PSScriptRoot\cloudflare\proxy.js"
$tunnelLog   = "$PSScriptRoot\tunnel.log"

# Clean up previous cloudflared processes
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300
if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }

# Kill any process already holding port 8080 (prevents EADDRINUSE on re-run)
$port8080Line = netstat -ano | Select-String ":8080 " | Select-String "LISTEN"
if ($port8080Line) {
    $parts = ($port8080Line.ToString()).Trim() -split '\s+'
    $pid8080 = $parts[-1]
    Write-Host "[INFO] Port 8080 in use by PID $pid8080 - killing it..." -ForegroundColor Yellow
    Stop-Process -Id ([int]$pid8080) -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

Write-Host "[INFO] Starting local Node.js reverse proxy on port 8080..." -ForegroundColor Yellow
$proxyProcess = Start-Process -FilePath "node" -ArgumentList $proxyScript -NoNewWindow -PassThru
Start-Sleep -Seconds 2

if ($proxyProcess.HasExited) {
    Write-Host "[ERROR] Failed to start Node.js reverse proxy." -ForegroundColor Red
    foreach ($p in $processes) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    exit 1
}
Write-Host "[SUCCESS] Reverse proxy is running on http://localhost:8080" -ForegroundColor Green
Write-Host ""

# --- 4. Start Cloudflare Tunnel (with auto-retry & local fallback) ---
$tunnelProcess = $null
$linkFound = $false
$publicUrl = ""

$skipTunnel = $NoTunnel -or $LocalOnly -or (-not (Test-Path $cloudflared))

if (-not $skipTunnel) {
    Write-Host "[INFO] Starting Cloudflare Quick Tunnel..." -ForegroundColor Yellow
    Write-Host "Waiting for Cloudflare to generate your public link..." -ForegroundColor Gray

    $maxAttempts = 3
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }

        # Alternate protocol arguments if retrying
        if ($attempt -eq 1) {
            $cfArgs = "tunnel --url http://localhost:8080 --no-autoupdate"
        } else {
            $cfArgs = "tunnel --url http://localhost:8080 --protocol http2 --no-autoupdate"
        }

        $tunnelProcess = Start-Process -FilePath $cloudflared -ArgumentList $cfArgs -RedirectStandardError $tunnelLog -NoNewWindow -PassThru

        # Wait up to 15 seconds for public URL in log
        $timeoutSec = 15
        for ($i = 0; $i -lt $timeoutSec; $i++) {
            if ($tunnelProcess.HasExited) { break }
            if (Test-Path $tunnelLog) {
                $logContent = Get-Content $tunnelLog -ErrorAction SilentlyContinue
                $linkLine = $logContent | Where-Object { $_ -match "https://[a-zA-Z0-9\-]+\.trycloudflare\.com" } | Select-Object -First 1
                if ($linkLine) {
                    $linkString = [string]$linkLine
                    if ($linkString -match "(https://[a-zA-Z0-9\-]+\.trycloudflare\.com)") {
                        $publicUrl = $Matches[1]
                        $linkFound = $true
                        break
                    }
                }
            }
            Start-Sleep -Seconds 1
        }

        if ($linkFound) { break }

        # Attempt failed, stop process and retry
        if ($tunnelProcess -and -not $tunnelProcess.HasExited) {
            Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
        }
        if ($attempt -lt $maxAttempts) {
            Write-Host "[INFO] Retrying Cloudflare tunnel (attempt $($attempt + 1)/$maxAttempts)..." -ForegroundColor Yellow
            Start-Sleep -Seconds 2
        }
    }
}

try {
    Write-Host ""
    if ($linkFound) {
        Write-Host "====================================================================" -ForegroundColor Green
        Write-Host "  *** YOUR LIVE SECURE ELDERCARE TUNNEL IS READY! ***" -ForegroundColor Green
        Write-Host "====================================================================" -ForegroundColor Green
        Write-Host "  Public Cloudflare URL:" -ForegroundColor White
        Write-Host "  >>  $publicUrl" -ForegroundColor Cyan
        Write-Host "  >>  $publicUrl/skeleton/" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  Local Reverse Proxy URL:" -ForegroundColor White
        Write-Host "  >>  http://localhost:8080" -ForegroundColor Yellow
        Write-Host "====================================================================" -ForegroundColor Green
    } else {
        Write-Host "====================================================================" -ForegroundColor Yellow
        Write-Host "  *** SECURE ELDERCARE IS RUNNING IN LOCAL MODE ***" -ForegroundColor Yellow
        Write-Host "====================================================================" -ForegroundColor Yellow
        Write-Host "  Local Reverse Proxy:      http://localhost:8080" -ForegroundColor Cyan
        Write-Host "  Gateway Dashboard:        http://localhost:5178 (or http://localhost:8080)" -ForegroundColor White
        Write-Host "  Tracking and Geofencing:  http://localhost:5175 (or http://localhost:8080/tracking/)" -ForegroundColor White
        Write-Host "  Face Verification:        http://localhost:5174 (or http://localhost:8080/face/)" -ForegroundColor White
        Write-Host "  Auth Service:             http://localhost:5173 (or http://localhost:8080/auth/)" -ForegroundColor White
        Write-Host "  Anomaly Detection:        http://localhost:5176 (or http://localhost:8080/anomaly/)" -ForegroundColor White
        Write-Host "  Schedule Monitoring:      http://localhost:5177 (or http://localhost:8080/schedule/)" -ForegroundColor White
        Write-Host "  Marketplace:              http://localhost:5179 (or http://localhost:8080/marketplace/)" -ForegroundColor White
        Write-Host "  Skeleton ID:              http://localhost:3000 (or http://localhost:8080/skeleton/)" -ForegroundColor White
        Write-Host "====================================================================" -ForegroundColor Yellow
    }

    Write-Host "  Press [Ctrl + C] in this window to stop and close all services." -ForegroundColor Red
    Write-Host "====================================================================" -ForegroundColor Green
    Write-Host ""

    # Keep running until user terminates
    if ($linkFound -and $tunnelProcess -and -not $tunnelProcess.HasExited) {
        $tunnelProcess.WaitForExit()
    } else {
        while (-not $proxyProcess.HasExited) {
            Start-Sleep -Seconds 2
        }
    }
}
finally {
    Write-Host ""
    Write-Host "[INFO] Shutting down all services cleanly..." -ForegroundColor Yellow

    # Stop cloudflared
    if ($tunnelProcess -and -not $tunnelProcess.HasExited) {
        Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    # Stop proxy
    if ($proxyProcess -and -not $proxyProcess.HasExited) {
        Stop-Process -Id $proxyProcess.Id -Force -ErrorAction SilentlyContinue
    }

    # Stop all backends and frontends
    foreach ($p in $processes) {
        if ($p -and -not $p.HasExited) {
            Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        }
    }

    # Clean up temp log
    if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }

    Write-Host "[SUCCESS] All services stopped cleanly. Have a nice day!" -ForegroundColor Green
}
