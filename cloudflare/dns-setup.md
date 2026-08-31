# DNS Setup Guide — Secure Elder Care Cloudflare Tunnel

After running `setup-tunnel.ps1`, you must create CNAME DNS records in the Cloudflare dashboard so the subdomains resolve to your tunnel.

## Step 1 — Get Your Tunnel ID

Run this command and copy the ID for `secure-eldercare`:
```powershell
.\cloudflare\cloudflared.exe tunnel list
```

Your Tunnel ID looks like: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`

## Step 2 — Open Cloudflare Dashboard

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Select your domain
3. Click **DNS** in the left sidebar
4. Click **Add record** for each row below

## Step 3 — Create CNAME Records

Create one record per subdomain. Replace `<TUNNEL_ID>` with your actual tunnel ID.

| Type  | Name          | Target                                  | Proxy |
|-------|---------------|-----------------------------------------|-------|
| CNAME | eldercare     | `<TUNNEL_ID>.cfargotunnel.com`          | ✅ ON |
| CNAME | auth          | `<TUNNEL_ID>.cfargotunnel.com`          | ✅ ON |
| CNAME | face          | `<TUNNEL_ID>.cfargotunnel.com`          | ✅ ON |
| CNAME | tracking      | `<TUNNEL_ID>.cfargotunnel.com`          | ✅ ON |
| CNAME | anomaly       | `<TUNNEL_ID>.cfargotunnel.com`          | ✅ ON |
| CNAME | schedule      | `<TUNNEL_ID>.cfargotunnel.com`          | ✅ ON |
| CNAME | api-auth      | `<TUNNEL_ID>.cfargotunnel.com`          | ✅ ON |
| CNAME | api-face      | `<TUNNEL_ID>.cfargotunnel.com`          | ✅ ON |
| CNAME | api-tracking  | `<TUNNEL_ID>.cfargotunnel.com`          | ✅ ON |
| CNAME | api-anomaly   | `<TUNNEL_ID>.cfargotunnel.com`          | ✅ ON |
| CNAME | api-schedule  | `<TUNNEL_ID>.cfargotunnel.com`          | ✅ ON |
| CNAME | api-gateway   | `<TUNNEL_ID>.cfargotunnel.com`          | ✅ ON |

> **Important:** Make sure the orange cloud icon (Proxy) is **ON** for all records. This routes traffic through Cloudflare's network.

## Step 4 — Update `.env.tunnel` Files

Open each `*.env.tunnel` file in every frontend folder and replace `yourdomain.com` with your actual domain.

Example for `anomaly-detection/frontend/.env.tunnel`:
```env
VITE_ANOMALY_BACKEND_URL=https://api-anomaly.YOUR-ACTUAL-DOMAIN.com/api/anomaly
```

## Step 5 — Start Everything

```powershell
# Terminal 1-6: Start each backend
cd auth-service\backend && python run.py
cd face-verification\backend && python run.py
cd tracking-geofencing\backend && python run.py
cd anomaly-detection\backend && python run.py
cd schedule-monitoring\backend && python run.py
cd gateway-dashboard\backend && python run.py

# Terminal 7-12: Start each frontend in tunnel mode
cd auth-service\frontend && npm run dev -- --mode tunnel
cd face-verification\frontend && npm run dev -- --mode tunnel
cd tracking-geofencing\frontend && npm run dev -- --mode tunnel
cd anomaly-detection\frontend && npm run dev -- --mode tunnel
cd schedule-monitoring\frontend && npm run dev -- --mode tunnel
cd gateway-dashboard\frontend && npm run dev -- --mode tunnel

# Terminal 13: Start the tunnel
.\cloudflare\start-tunnel.ps1
```

## Step 6 — Share With Teammates

Send teammates this single URL:
```
https://eldercare.yourdomain.com
```

They can log in from any device, anywhere in the world.

## Troubleshooting

| Problem | Solution |
|---|---|
| CNAME not resolving | Wait 1-5 min for DNS propagation |
| Tunnel not connecting | Confirm `cloudflared.exe` is running, check `config.yml` Tunnel ID |
| CORS error in browser | Verify backend was restarted after CORS changes |
| WebSocket drops | Cloudflare free plan has 100s WS timeout — this is expected; the dashboard auto-reconnects |
| `401 Unauthorized` from API | Token is in localStorage — open browser DevTools → Application → Local Storage and check `access_token` exists |
