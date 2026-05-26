import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy all bot backends through this dev server for zero CORS issues
const proxy = {}
for (let i = 1; i <= 8; i++) {
  proxy[`/b${i}`] = {
    target: `http://127.0.0.1:${8000 + i}`,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/b\d/, ''),
  }
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy,
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
})
