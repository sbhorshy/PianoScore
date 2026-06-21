import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 不向上查找根目录的 vite.config.ts（legacy 前端）
    root: __dirname,
  },
})
