import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { 
    port: 3001, 
    proxy: {
      // Bot 1 API
      '/api/bot1': { 
        target: 'http://localhost:8001', 
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/bot1/, '/api')
      },
      // Bot 2 API  
      '/api/bot2': {
        target: 'http://localhost:8002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/bot2/, '/api')
      },
      // Default API (falls back to Bot 1)
      '/api': { 
        target: 'http://localhost:8001', 
        changeOrigin: true 
      },
      '/ws': { target: 'ws://localhost:8001', ws: true },
    }
  },
  build: { 
    outDir: 'dist', 
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        }
      }
    }
  },
  define: {
    'process.env': {}
  }
})