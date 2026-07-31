import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
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
})
