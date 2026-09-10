import { defineConfig } from 'vitest/config'

/**
 * Node 22 的 node:sqlite 内置模块不在旧版 vite-node 的内置清单里，
 * 会被误当成源码解析（Failed to load url sqlite）。
 * 把所有 node: 前缀模块标记为 external，交给 Node 原生加载。
 *
 * 另外：Windows 上 node:sqlite 原生模块【首次】加载约 3s（负载波动更久），
 * 默认 5s testTimeout 会让每个 worker 的首个测试偶发超时 → 放宽到 20s。
 */
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000,
    // node:sqlite 原生模块首次加载慢（Windows+杀软 ~3-20s），并行 worker 会各自付一次
    // 且同时竞争磁盘 → 串行跑：首个文件加载一次，后续文件复用进程缓存
    fileParallelism: false,
    server: {
      deps: {
        external: [/^node:/],
      },
    },
  },
})
