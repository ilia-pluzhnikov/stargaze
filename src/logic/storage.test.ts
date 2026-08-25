import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedStore } from '../data/seed'
import { acquireLock, loadStore, releaseLock, saveStore, withStore } from './storage'

const tmp = () => join(mkdtempSync(join(tmpdir(), 'ql-')), 'store.json')

describe('storage', () => {
  it('roundtrip save → load', () => {
    const p = tmp()
    const s = seedStore()
    saveStore(p, s)
    expect(loadStore(p)).toEqual(s)
  })
  it('load: отсутствующий файл — throw', () => {
    expect(() => loadStore(tmp())).toThrow()
  })
  it('load: битый JSON — throw', () => {
    const p = tmp()
    writeFileSync(p, '{оборвано', 'utf8')
    expect(() => loadStore(p)).toThrow()
  })
  it('load: невалидный store — throw со списком ошибок', () => {
    const p = tmp()
    writeFileSync(p, JSON.stringify({ version: 99 }), 'utf8')
    expect(() => loadStore(p)).toThrow(/version/)
  })
  it('save: отказывается писать невалидное, файл не меняется', () => {
    const p = tmp()
    saveStore(p, seedStore())
    const before = loadStore(p)
    expect(() => saveStore(p, { ...seedStore(), version: 99 } as never)).toThrow(/version/)
    expect(loadStore(p)).toEqual(before)
  })
  it('save: не оставляет tmp-файлов', () => {
    const p = tmp()
    saveStore(p, seedStore())
    expect(readdirSync(join(p, '..')).filter((f) => f.includes('tmp'))).toEqual([])
  })
  it('withStore применяет fn под локом и снимает лок', () => {
    const p = tmp()
    saveStore(p, seedStore())
    const out = withStore(p, (s) => ({ ...s, character: { ...s.character, name: 'Новый' } }))
    expect(out.character.name).toBe('Новый')
    expect(loadStore(p).character.name).toBe('Новый')
    expect(readdirSync(join(p, '..')).filter((f) => f.endsWith('.lock'))).toEqual([])
  })
  it('withStore: fn вернула тот же reference — файл не перезаписывается', () => {
    const p = tmp()
    saveStore(p, seedStore())
    const mtime1 = statSync(p).mtimeMs
    withStore(p, (s) => s)
    expect(statSync(p).mtimeMs).toBe(mtime1)
  })
  it('свежий чужой лок: withStore бросает по таймауту', () => {
    const p = tmp()
    saveStore(p, seedStore())
    mkdirSync(`${p}.lock`)
    expect(() => withStore(p, (s) => s, { timeoutMs: 200 })).toThrow(/лок/)
    releaseLock(p)
  })
  it('протухший лок снимается автоматически', () => {
    const p = tmp()
    saveStore(p, seedStore())
    mkdirSync(`${p}.lock`)
    const old = (Date.now() - 60_000) / 1000
    utimesSync(`${p}.lock`, old, old)
    expect(() => withStore(p, (s) => s, { timeoutMs: 500 })).not.toThrow()
  })
  it('acquireLock/releaseLock парные', () => {
    const p = tmp()
    acquireLock(p)
    releaseLock(p)
    acquireLock(p, { timeoutMs: 100 }) // не бросает — лок был снят
    releaseLock(p)
  })
  it('несуществующая родительская директория — падаем сразу, а не висим до таймаута', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ql-'))
    const p = join(dir, 'no-such-subdir', 'store.json')
    const start = Date.now()
    let caught: unknown
    try {
      acquireLock(p, { timeoutMs: 20_000 }) // большой таймаут — регресс должен зависнуть надолго
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).not.toMatch(/не дождался лока/) // не таймаут — структурная ошибка
    expect((caught as NodeJS.ErrnoException).code).toBe('ENOENT')
    expect(Date.now() - start).toBeLessThan(2_000) // упали сразу, не досидели до дедлайна
  })
})
