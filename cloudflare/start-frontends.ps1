# start-frontends.ps1
# Starts all 6 frontend services in separate PowerShell windows in tunnel mode.
# Run from the project root:
#   .\cloudflare\start-frontends.ps1

$ErrorActionPreference = "Stop"

$frontends = @(
    @{ Path = "gateway-dashboard\frontend"; Name = "Gateway Dashboard (Port 5178)" },
    @{ Path = "auth-service\frontend"; Name = "Auth Service (Port 5173)" },
    @{ Path = "face-verification\frontend"; Name = "Face Verification (Port 5174)" },
    @{ Path = "tracking-geofencing\frontend"; Name = "Tracking & Geofencing (Port 5175)" },
    @{ Path = "anomaly-detection\frontend"; Name = "Anomaly Detection (Port 5176)" },
    @{ Path = "schedule-monitoring\frontend"; Name = "Schedule Monitoring (Port 5177)" }
)

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host " Secure Elder Care - Starting Frontends" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

foreach ($fe in $frontends) {
    $fullPath = "$PSScriptRoot\..\$($fe.Path)"
    Write-Host "[INFO] Starting $($fe.Name) in new window..." -ForegroundColor Yellow
    
    # Launch new PowerShell window running npm run dev
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", "cd '$fullPath'; Write-Host 'Starting $($fe.Name) in tunnel mode...' -ForegroundColor Cyan; npm run dev -- --host 127.0.0.1 --mode tunnel"
    
    Start-Sleep -Milliseconds 500
}

Write-Host ""
Write-Host "[SUCCESS] All 6 frontends started in separate windows." -ForegroundColor Green
Write-Host ""
