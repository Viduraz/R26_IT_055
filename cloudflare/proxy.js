// cloudflare/proxy.js
// Native Node.js Reverse Proxy for Secure Elder Care monorepo.
// Listens on port 8080 and routes to UIs (via base path) and APIs (via endpoints).
// No dependencies required. Run using: node cloudflare/proxy.js

const http = require('http');
const net = require('net');

const PORT = 8080;

// Helper to determine the target address and port for a given URL.
// Vite dev servers with `base` configured expect the full prefixed path to arrive.
// Do NOT strip path prefixes — Vite handles that internally.
function getRouteTarget(url) {
  // ── Frontends ─────────────────────────────────────────────────────────────
  // IMPORTANT: Do NOT strip the base prefix here.
  // Each Vite dev server has `base` set (e.g. base: "/auth/") and expects the
  // full prefixed path to arrive (e.g. /auth/login). Vite strips the base itself
  // internally. Stripping here causes Vite to receive /login without the base,
  // triggering its "public base URL" 404 error.
  if (url.startsWith('/auth/') || url === '/auth') {
    return { host: '127.0.0.1', port: 5173 };
  }
  if (url.startsWith('/face/') || url === '/face') {
    return { host: '127.0.0.1', port: 5174 };
  }
  if (url.startsWith('/tracking/') || url === '/tracking') {
    return { host: '127.0.0.1', port: 5175 };
  }
  if (url.startsWith('/anomaly/') || url === '/anomaly') {
    return { host: '127.0.0.1', port: 5176 };
  }
  if (url.startsWith('/schedule/') || url === '/schedule') {
    return { host: '127.0.0.1', port: 5177 };
  }
  if (url.startsWith('/marketplace/') || url === '/marketplace') {
    return { host: '127.0.0.1', port: 5179 };
  }
  if (url.startsWith('/skeleton/')) {
    return { host: '127.0.0.1', port: 3000 }; // Skeleton has its own base='/skeleton/'
  }

  // ── APIs (no prefix stripping — backends expect the full /api/... path) ───
  if (url.startsWith('/api/auth')) {
    return { host: '127.0.0.1', port: 8000 };
  }
  if (url.startsWith('/api/face')) {
    return { host: '127.0.0.1', port: 8001 };
  }
  if (url.startsWith('/api/tracking')) {
    return { host: '127.0.0.1', port: 8002 };
  }
  if (url.startsWith('/api/anomaly')) {
    return { host: '127.0.0.1', port: 8003 };
  }
  if (url.startsWith('/api/schedule') || url.startsWith('/api/monitoring')) {
    return { host: '127.0.0.1', port: 8004 };
  }
  if (url.startsWith('/api/geofence')) {
    return { host: '127.0.0.1', port: 8002 };
  }
  if (url.startsWith('/api/gateway') || url.startsWith('/api/dashboard')) {
    return { host: '127.0.0.1', port: 8005 };
  }
  if (url.startsWith('/api/marketplace')) {
    return { host: '127.0.0.1', port: 8006 };
  }
  if (url.startsWith('/api/skeleton')) {
    return { host: '127.0.0.1', port: 8007 };
  }
  if (url.startsWith('/ws/stream') || url.startsWith('/ws/ip-stream')) {
    return { host: '127.0.0.1', port: 8007 };
  }

  // ── Fallback: Gateway Dashboard (served at root '/') ─────────────────────
  return { host: '127.0.0.1', port: 5178 };
}

// Create HTTP server
const server = http.createServer((req, res) => {
  const target = getRouteTarget(req.url);

  console.log(`[HTTP Proxy] ${req.method} ${req.url} -> http://${target.host}:${target.port}${req.url}`);

  // Set up proxy request headers (ensure host points to target)
  const headers = { ...req.headers };
  headers['host'] = `${target.host}:${target.port}`;

  const proxyReq = http.request({
    host: target.host,
    port: target.port,
    path: req.url,
    method: req.method,
    headers: headers
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[HTTP Proxy Error] ${req.url}: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Bad Gateway: Proxy connection failed to ${target.host}:${target.port}\nError: ${err.message}`);
    } else {
      res.end();
    }
  });

  req.pipe(proxyReq);
});

// Handle WebSocket upgrades (Vite HMR and FastAPI live tracking/anomaly WS streams)
server.on('upgrade', (req, socket, head) => {
  const target = getRouteTarget(req.url);

  console.log(`[WS Proxy] UPGRADE ${req.url} -> ws://${target.host}:${target.port}${req.url}`);

  const targetSocket = net.connect(target.port, target.host, () => {
    // Reconstruct raw HTTP handshake request headers
    let rawRequest = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = req.rawHeaders[i];
      const val = req.rawHeaders[i + 1];
      if (key.toLowerCase() === 'host') {
        rawRequest += `Host: ${target.host}:${target.port}\r\n`;
      } else {
        rawRequest += `${key}: ${val}\r\n`;
      }
    }
    rawRequest += '\r\n';

    targetSocket.write(rawRequest);
    if (head && head.length > 0) {
      targetSocket.write(head);
    }

    // Pipe the sockets together
    socket.pipe(targetSocket);
    targetSocket.pipe(socket);
  });

  targetSocket.on('error', (err) => {
    console.error(`[WS Proxy Error] ${req.url} -> ws://${target.host}:${target.port} failed: ${err.message}`);
    socket.destroy();
  });

  socket.on('error', (err) => {
    targetSocket.destroy();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n================================================================`);
  console.log(`🚀 Secure Elder Care Local Reverse Proxy is running on port ${PORT}`);
  console.log(`================================================================`);
  console.log(`Routing mappings:`);
  console.log(`  - /auth/*     -> http://localhost:5173  (Auth UI)`);
  console.log(`  - /face/*     -> http://localhost:5174  (Face UI)`);
  console.log(`  - /tracking/* -> http://localhost:5175  (Tracking UI)`);
  console.log(`  - /anomaly/*  -> http://localhost:5176  (Anomaly UI)`);
  console.log(`  - /schedule/* -> http://localhost:5177  (Schedule UI)`);
  console.log(`  - /marketplace/* -> http://localhost:5179  (Marketplace UI)`);
  console.log(`  - /skeleton/*  -> http://localhost:3000  (Skeleton-ID UI)`);
  console.log(`  - /api/auth   -> http://localhost:8000  (Auth Backend)`);
  console.log(`  - /api/face   -> http://localhost:8001  (Face Backend)`);
  console.log(`  - /api/track  -> http://localhost:8002  (Tracking Backend)`);
  console.log(`  - /api/anom   -> http://localhost:8003  (Anomaly Backend)`);
  console.log(`  - /api/sched  -> http://localhost:8004  (Schedule Backend)`);
  console.log(`  - /api/gate   -> http://localhost:8005  (Gateway Backend)`);
  console.log(`  - /api/marketplace -> http://localhost:8006 (Marketplace Backend)`);
  console.log(`  - /api/skeleton -> http://localhost:8007 (Skeleton-ID Backend)`);
  console.log(`  - /* (Root)   -> http://localhost:5178  (Gateway UI)`);

  console.log(`================================================================\n`);

  // ── Keepalive ping ──────────────────────────────────────────────────────
  // Cloudflare QUIC tunnels drop idle connections after ~9 minutes.
  // Pinging ourselves every 30s keeps the connection alive and prevents 530 errors.
  setInterval(() => {
    const req = http.get(`http://127.0.0.1:${PORT}/_proxy_keepalive`, (res) => {
      res.resume(); // Drain the response to free memory
    });
    req.on('error', () => { }); // Silently ignore — proxy might be momentarily busy
    req.end();
  }, 30_000);
});
