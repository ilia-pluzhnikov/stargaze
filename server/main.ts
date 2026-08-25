import { createApp } from './app'

// Primary — STARGAZE_*; QUESTLOG_* читается вечно (фолбэк после ренейма 2026-07).
const storePath = process.env.STARGAZE_STORE ?? process.env.QUESTLOG_STORE
if (!storePath) {
  console.error('env STARGAZE_STORE не задан')
  process.exit(1)
}
const publicDir = process.env.STARGAZE_PUBLIC ?? process.env.QUESTLOG_PUBLIC ?? './public'
const port = Number(process.env.STARGAZE_PORT ?? process.env.QUESTLOG_PORT ?? 8643)

createApp({ storePath, publicDir }).listen(port, '127.0.0.1', () => {
  console.log(`stargaze api: http://127.0.0.1:${port} · store: ${storePath} · public: ${publicDir}`)
})
