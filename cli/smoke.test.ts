import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedStore } from '../src/data/seed'

const CLI = join(process.cwd(), 'dist-node', 'cli.js')

function cli(args: string[], store: string) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, STARGAZE_STORE: store },
  })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

describe('смоук собранного cli.js', () => {
  beforeAll(() => {
    const b = spawnSync('npm', ['run', 'build:cli'], { encoding: 'utf8', shell: true })
    if (b.status !== 0) throw new Error(`build:cli упал:\n${b.stdout}\n${b.stderr}`)
  }, 120_000)

  it('import → propose → accept → complete → status → validate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ql-smoke-'))
    const store = join(dir, 'store.json')
    const dump = join(dir, 'dump.json')
    writeFileSync(dump, JSON.stringify(seedStore()), 'utf8')
    expect(cli(['import', dump], store).code).toBe(0)
    expect(cli(['propose-quest', '--title', 'Смоук', '--type', 'short', '--xp', '15', '--note', 'проверка'], store).code).toBe(0)
    const proposed = JSON.parse(cli(['quests', '--proposed', '--json'], store).out) as { id: string }[]
    expect(proposed).toHaveLength(1)
    expect(cli(['accept', proposed[0].id], store).code).toBe(0)
    expect(cli(['complete', proposed[0].id], store).code).toBe(2) // short без --result — отказ
    expect(cli(['complete', proposed[0].id, '--result', 'смоук прошёл'], store).code).toBe(0)
    const status = cli(['status'], store)
    expect(status.code).toBe(0)
    expect(status.out).toMatch(/ур\./)
    expect(cli(['validate'], store).code).toBe(0)
  }, 60_000)
})

const PORT = 8791
const BASE = `http://127.0.0.1:${PORT}`

let child: ChildProcess
let serveStore: string

async function waitHealth(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return
    } catch {
      // сервер ещё поднимается
    }
    if (Date.now() > deadline) throw new Error('serve не поднялся за отведённое время')
    await new Promise((r) => setTimeout(r, 200))
  }
}

describe('смоук stargaze serve', () => {
  beforeAll(async () => {
    // describe-блоки одного файла идут последовательно: бандл уже собран
    // первым describe; пересборка здесь устроила бы гонку записи только
    // при выносе в отдельный файл — поэтому serve-смоук живёт в этом.
    if (!existsSync(CLI)) {
      const b = spawnSync('npm', ['run', 'build:cli'], { encoding: 'utf8', shell: true })
      if (b.status !== 0) throw new Error(`build:cli упал:\n${b.stdout}\n${b.stderr}`)
    }
    const dir = mkdtempSync(join(tmpdir(), 'sg-serve-'))
    serveStore = join(dir, 'data', 'store.json') // вложенный каталог: serve обязан создать его сам
    const pub = join(dir, 'public')
    mkdirSync(pub)
    writeFileSync(join(pub, 'index.html'), '<!doctype html><title>stub</title>', 'utf8')
    child = spawn(process.execPath, [CLI, 'serve', '--store', serveStore, '--port', String(PORT), '--public', pub])
    await waitHealth()
  }, 120_000)

  afterAll(() => {
    child?.kill()
  })

  it('первый запуск создаёт демо-store на диске', async () => {
    expect(existsSync(serveStore)).toBe(true)
    const s = (await (await fetch(`${BASE}/api/store`)).json()) as { version: number; stars: unknown[] }
    expect(s.version).toBe(3)
    expect(s.stars.length).toBeGreaterThan(0)
  })

  it('отдаёт статику', async () => {
    const r = await fetch(`${BASE}/`)
    expect(r.status).toBe(200)
    expect(await r.text()).toContain('stub')
  })

  it('Origin-гейт: чужой Origin — 403, свой и отсутствующий — проходят до валидации', async () => {
    const evil = await fetch(`${BASE}/api/action`, {
      method: 'POST',
      body: '{"type":"nope"}',
      headers: { origin: 'https://evil.example' },
    })
    expect(evil.status).toBe(403)
    const same = await fetch(`${BASE}/api/action`, {
      method: 'POST',
      body: '{"type":"nope"}',
      headers: { origin: `http://127.0.0.1:${PORT}` },
    })
    expect(same.status).toBe(400) // прошёл гейт, срезан валидацией действия
    const agent = await fetch(`${BASE}/api/action`, { method: 'POST', body: '{"type":"nope"}' })
    expect(agent.status).toBe(400) // без Origin (CLI/агент) — гейт не мешает
  })
})
