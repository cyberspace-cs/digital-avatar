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
})
