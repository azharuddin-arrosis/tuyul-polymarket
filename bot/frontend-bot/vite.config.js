import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Per-bot port allocation — passed via env var from run.sh:
//   VITE_FE_PORT  → frontend port (default 3001)
//   VITE_BE_PORT  → backend port  (default 8000)
//   VITE_BOT_ID   → bot identifier (just for display)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const fePort = parseInt(env.VITE_FE_PORT || process.env.VITE_FE_PORT || '3001')
  const bePort = parseInt(env.VITE_BE_PORT || process.env.VITE_BE_PORT || '8000')
  return {
    plugins: [react()],
    define: {
      '__BOT_ID__': JSON.stringify(env.VITE_BOT_ID || process.env.VITE_BOT_ID || ''),
    },
    server: {
      port: fePort,
      proxy: {
        '/api': { target: `http://localhost:${bePort}`, changeOrigin: true },
        '/ws':  { target: `ws://localhost:${bePort}`,   ws: true },
      },
    },
    build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
  }
})
