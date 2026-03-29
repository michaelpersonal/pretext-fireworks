import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true,
    https: false,
  },
  build: {
    target: 'es2020',
  },
})
