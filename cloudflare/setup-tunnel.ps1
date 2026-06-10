# setup-tunnel.ps1
# One-time setup: authenticate with Cloudflare and create the named tunnel.
# Run ONCE from the project root:
#   .\cloudflare\setup-tunnel.ps1
#
# After this script:
#   1. Copy the Tunnel ID printed below
#   2. Open cloudflare\config.yml and replace <TUNNEL_ID> with it
#   3. Create DNS CNAME records (see cloudflare\dns-setup.md)
#   4. Run .\cloudflare\start-tunnel.ps1 to go live

$ErrorActionPreference = "Stop"
$cloudflared = "$PSScriptRoot\cloudflared.exe"
$tunnelName  = "secure-eldercare"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Secure Elder Care — Tunnel Setup (Run Once)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── Check cloudflared exists ──────────────────────────────────────────────────
if (-not (Test-Path $cloudflared)) {
    Write-Host "❌ cloudflared.exe not found. Run install-cloudflared.ps1 first." -ForegroundColor Red
    exit 1
}

# ── Step 1: Login ─────────────────────────────────────────────────────────────
Write-Host "STEP 1: Authenticating with Cloudflare..." -ForegroundColor Yellow
Write-Host "A browser window will open. Log in and select your domain." -ForegroundColor Gray
Write-Host ""
& $cloudflared tunnel login

Write-Host ""
Write-Host "✅ Authentication complete." -ForegroundColor Green
Write-Host ""

# ── Step 2: Create Tunnel ─────────────────────────────────────────────────────
Write-Host "STEP 2: Creating tunnel '$tunnelName'..." -ForegroundColor Yellow
Write-Host ""
& $cloudflared tunnel create $tunnelName

Write-Host ""
Write-Host "✅ Tunnel created." -ForegroundColor Green
Write-Host ""

# ── Step 3: List tunnels ──────────────────────────────────────────────────────
Write-Host "STEP 3: Your tunnels (copy the ID for '$tunnelName'):" -ForegroundColor Yellow
Write-Host ""
& $cloudflared tunnel list

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " NEXT STEPS:" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Copy the Tunnel ID shown above for 'secure-eldercare'" -ForegroundColor White
Write-Host "2. Open: cloudflare\config.yml" -ForegroundColor White
Write-Host "   Replace: tunnel: <TUNNEL_ID>" -ForegroundColor Gray
Write-Host "   Replace: credentials-file: C:\Users\<YOUR_USERNAME>\.cloudflared\<TUNNEL_ID>.json" -ForegroundColor Gray
Write-Host "   Replace: yourdomain.com with your actual domain" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Read dns-setup.md to create DNS CNAME records" -ForegroundColor White
Write-Host "4. Update all .env.tunnel files with your actual domain" -ForegroundColor White
Write-Host "5. Run: .\cloudflare\start-tunnel.ps1" -ForegroundColor White
Write-Host ""
