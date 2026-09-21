import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// base './' — относительные пути: сборка раздаётся из любой подпапки. С диска (file://)
// не открывается — модульный скрипт блокируется CORS, нужен HTTP-сервер
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
  },
})
