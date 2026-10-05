import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Go API lives on 127.0.0.1:8080 by default. Everything under /api is
// proxied there in development so the browser only ever talks to Vite.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: process.env.ARCHVIZ_API ?? 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
})
