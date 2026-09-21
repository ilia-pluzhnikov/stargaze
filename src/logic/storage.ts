// Node-only: доступ к store.json на диске. НЕ импортировать из браузерного кода
// (src/components, src/hooks, src/App) — только cli/ и server/.
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Store } from '../types'
import { migrateStore } from './migrate'
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

const v3BackupPath = (storePath: string) => `${storePath}.v3.bak`

/** Файл store: parse → migrateStore → validateStore. raw и migrated нужны withStore для бэкапа. */
function readStoreFile(path: string): { store: Store; raw: string; migrated: boolean } {
  const raw = readFileSync(path, 'utf8') // отсутствие файла = ошибка, не тихий seed
  const parsed = JSON.parse(raw) as unknown
  // чтение без побочных эффектов: старый формат мигрируется в памяти, файл не трогаем —
  // на диск v4 ляжет при первой обычной записи
  const current = migrateStore(parsed)
  const errors = validateStore(current)
  if (errors.length) throw new Error(`store невалиден (${path}):\n  ${errors.join('\n  ')}`)
  return { store: current as Store, raw, migrated: current !== parsed }
}

export function loadStore(path: string): Store {
  return readStoreFile(path).store
}

function assertValid(path: string, store: Store): void {
  const errors = validateStore(store)
  if (errors.length) throw new StoreValidationError(errors, path)
}

function writeStoreFile(path: string, store: Store): void {
  const tmp = join(dirname(path), `.store.json.tmp-${process.pid}`)
  writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', 'utf8')
  renameSync(tmp, path) // атомарная замена
}

/** Страховка необратимой миграции: исходный текст файла старого формата кладётся рядом
 * один раз и никогда не перезаписывается. Тот же tmp+rename, что у записи store. */
function backupOnce(path: string, raw: string): void {
  const bak = v3BackupPath(path)
  if (existsSync(bak)) return
  const tmp = join(dirname(path), `.store.v3.bak.tmp-${process.pid}`)
  writeFileSync(tmp, raw, 'utf8')
  renameSync(tmp, bak)
}

export function saveStore(path: string, store: Store): void {
  assertValid(path, store)
  writeStoreFile(path, store)
}

/** Лок → load → fn → save → unlock. Если fn вернула тот же объект (no-op редьюсера) — не пишем. */
export function withStore(path: string, fn: (s: Store) => Store, opts: LockOpts = {}): Store {
  acquireLock(path, opts)
  try {
    const { store: current, raw, migrated } = readStoreFile(path)
    const next = fn(current)
    if (next !== current) {
      assertValid(path, next) // отказ записи не оставляет следов — в том числе бэкапа
      if (migrated) backupOnce(path, raw)
      writeStoreFile(path, next)
    }
    return next
  } finally {
    releaseLock(path)
  }
}
