import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/auth': 'http://127.0.0.1:3000',
      '/q': 'http://127.0.0.1:3000',
      '/stats': 'http://127.0.0.1:3000',
      '/health': 'http://127.0.0.1:3000'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
