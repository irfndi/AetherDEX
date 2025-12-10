import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    watch: false,
    setupFiles: ['./test/setup.ts'],
    reporters: ['verbose', 'json', 'html'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      thresholds: {
        global: {
          branches: 60,
          functions: 60,
          lines: 60,
          statements: 60,
        },
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '~/': path.resolve(__dirname, './'),
    },
  },
  define: {
    global: 'globalThis',
  },
})