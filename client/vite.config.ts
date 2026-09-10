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
  build: {
    rollupOptions: {
      output: {
        // V2.0 Task 8 主 JS 分包：
        // - react-vendor：UI 内核，极少变动 → 长效缓存
        // - live2d-vendor：PIXI + pixi-live2d-display（占体积大头），与舞台逻辑解耦
        // - net-vendor：socket.io 客户端
        // 舞台代码 AppStage 经 App.tsx 动态 import 单独成 chunk，首屏引导包极小；
        // 角色包（models/* 二进制 + model3.json）本就是运行时 URL 按需拉取，不进 JS 包
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor'
          if (id.includes('pixi-live2d-display') || id.includes('pixi.js') || id.includes('@pixi')) {
            return 'live2d-vendor'
          }
          if (id.includes('socket.io-client') || id.includes('engine.io-client')) return 'net-vendor'
          return undefined
        },
      },
    },
  },
})
