// Node-only: доступ к store.json на диске. НЕ импортировать из браузерного кода
// (src/components, src/hooks, src/App) — только cli/ и server/.
import { mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Store } from '../types'
import { validateStore } from './validate'

export interface LockOpts {
  timeoutMs?: number // сколько ждать чужой лок
  staleMs?: number // старше этого — лок считается протухшим (умер владелец)
}
const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_STALE_MS = 10_000
const RETRY_MS = 50

const lockPath = (storePath: string) => `${storePath}.lock`

/** Отказ записи/чтения из-за невалидного store — отличима от структурных ошибок (диск, JSON). */
export class StoreValidationError extends Error {
  constructor(
    public errors: string[],
    path: string,
  ) {
    super(`отказ записи невалидного store (${path}):\n  ${errors.join('\n  ')}`)
    this.name = 'StoreValidationError'
  }
}

/** Синхронный сон без busy-loop. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function acquireLock(storePath: string, opts: LockOpts = {}): void {
  const lock = lockPath(storePath)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      mkdirSync(lock) // атомарно: занять может ровно один процесс
      return
    } catch (e) {
      // mkdir упал не из-за занятого лока (ENOENT — нет родительской директории,
      // EACCES — нет прав и т.п.) — структурная ошибка, ждать бессмысленно.
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      let stale = false
      try {
        stale = Date.now() - statSync(lock).mtimeMs > staleMs
      } catch {
        // лок исчез между попытками — не считаем протухшим и не крутим цикл
        // вхолостую: падаем ниже, в общую проверку дедлайна и сон
      }
      if (stale) {
        try {
          rmdirSync(lock)
        } catch {
          // гонка снятия протухшего лока — не страшно
        }
        continue
      }
      if (Date.now() >= deadline) throw new Error(`не дождался лока ${lock} за ${timeoutMs}мс`)
      sleepSync(RETRY_MS)
    }
  }
}

export function releaseLock(storePath: string): void {
  try {
    rmdirSync(lockPath(storePath))
  } catch {
    // уже снят
  }
}

export function loadStore(path: string): Store {
  const raw = readFileSync(path, 'utf8') // отсутствие файла = ошибка, не тихий seed
  const parsed = JSON.parse(raw) as unknown
  const errors = validateStore(parsed)
  if (errors.length) throw new Error(`store невалиден (${path}):\n  ${errors.join('\n  ')}`)
  return parsed as Store
}

export function saveStore(path: string, store: Store): void {
  const errors = validateStore(store)
  if (errors.length) throw new StoreValidationError(errors, path)
  const tmp = join(dirname(path), `.store.json.tmp-${process.pid}`)
  writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', 'utf8')
  renameSync(tmp, path) // атомарная замена
}

/** Лок → load → fn → save → unlock. Если fn вернула тот же объект (no-op редьюсера) — не пишем. */
export function withStore(path: string, fn: (s: Store) => Store, opts: LockOpts = {}): Store {
  acquireLock(path, opts)
  try {
    const current = loadStore(path)
    const next = fn(current)
    if (next !== current) saveStore(path, next)
    return next
  } finally {
    releaseLock(path)
  }
}
