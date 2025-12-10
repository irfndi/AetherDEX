import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': resolve(__dirname, '.'),
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
    },
    server: {
        host: '0.0.0.0',
        port: 3000,
        open: false,
    },
})
