import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/sim1':  { target:'http://localhost:8001', changeOrigin:true, rewrite:p=>p.replace(/^\/sim1/,'') },
      '/sim2':  { target:'http://localhost:8002', changeOrigin:true, rewrite:p=>p.replace(/^\/sim2/,'') },
      '/sim3':  { target:'http://localhost:8003', changeOrigin:true, rewrite:p=>p.replace(/^\/sim3/,'') },
      '/sim4':  { target:'http://localhost:8004', changeOrigin:true, rewrite:p=>p.replace(/^\/sim4/,'') },
      '/sim5':  { target:'http://localhost:8005', changeOrigin:true, rewrite:p=>p.replace(/^\/sim5/,'') },
      '/real1': { target:'http://localhost:8006', changeOrigin:true, rewrite:p=>p.replace(/^\/real1/,'') },
      '/real2': { target:'http://localhost:8007', changeOrigin:true, rewrite:p=>p.replace(/^\/real2/,'') },
      '/api/db':{ target:'http://localhost:8001', changeOrigin:true },
    }
  },
  build: { outDir:'dist', chunkSizeWarningLimit:1200 }
})
