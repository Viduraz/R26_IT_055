import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // When accessed through the reverse proxy via /skeleton/ subpath,
  // Vite must set base='/skeleton/' so all asset URLs include that prefix.
  // This ensures /@vite/client, /src/main.jsx, etc. are requested as
  // /skeleton/@vite/client, /skeleton/src/main.jsx — which the proxy
  // correctly routes back to port 3000.
  const base = mode === 'tunnel' ? '/skeleton/' : '/'

  return {
    base,
    plugins: [react()],
    server: {
      port: 3000,
      // Allow all hosts so the tunnel can reach Vite
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8007',
          changeOrigin: true,
        },
        '/ws/stream': {
          target: 'ws://127.0.0.1:8007',
          ws: true,
          changeOrigin: true,
        },
        '/ws/ip-stream': {
          target: 'ws://127.0.0.1:8007',
          ws: true,
          changeOrigin: true,
        },
        '/health': {
          target: 'http://127.0.0.1:8007',
          changeOrigin: true,
        },
      },
    },
  }
})
