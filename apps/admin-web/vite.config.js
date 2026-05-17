import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, proxy the API routes to the local Fastify backend so cookies are
// same-origin (no CORS) and the dashboard "just works" against localhost:8787.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/admin': { target: 'http://localhost:8787', changeOrigin: true },
      '/v1': { target: 'http://localhost:8787', changeOrigin: true }
    }
  }
})
