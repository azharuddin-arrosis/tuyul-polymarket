import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dashboard runs on port 3000 by default. Reads bots.json from public/.
// Fetches stats from each bot's backend directly (CORS allowed by main.py).
export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
})
