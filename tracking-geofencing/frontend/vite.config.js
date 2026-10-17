import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/tracking/',
  server: {
    port: 5175,
    proxy: {
      '/api/face': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
      '/api/tracking': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/api/geofence': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
    },
  },
})

