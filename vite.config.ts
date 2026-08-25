import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// base './' — собранный dist/index.html открывается двойным кликом без сервера
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
  },
})
