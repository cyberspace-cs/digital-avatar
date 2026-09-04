import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/digital-avatar/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8090',
      '/socket.io': { target: 'http://localhost:8090', ws: true },
    },
  },
  preview: {
    port: 4173,
    // preview 跑生产构建：请求带 /digital-avatar 前缀，rewrite 剥掉后再转发本地后端
    proxy: {
      '^/digital-avatar/api': {
        target: 'http://localhost:8090',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/digital-avatar/, ''),
      },
      '^/digital-avatar/socket.io': {
        target: 'http://localhost:8090',
        ws: true,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/digital-avatar/, ''),
      },
    },
  },
})
