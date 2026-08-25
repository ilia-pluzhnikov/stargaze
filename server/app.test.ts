import { afterEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedStore } from '../src/data/seed'
import { saveStore } from '../src/logic/storage'
import type { Store } from '../src/types'
import { createApp } from './app'

let server: Server | undefined
afterEach(() => new Promise<void>((res) => (server ? server.close(() => res()) : res())))

async function start(opts?: { store?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), 'ql-srv-'))
  const storePath = join(dir, 'store.json')
  if (opts?.store !== false) saveStore(storePath, seedStore())
  const publicDir = join(dir, 'public')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(publicDir)
  writeFileSync(join(publicDir, 'index.html'), '<!doctype html>привет', 'utf8')
  server = createApp({ storePath, publicDir })
  await new Promise<void>((res) => server!.listen(0, '127.0.0.1', res))
  const { port } = server!.address() as AddressInfo
  return { base: `http://127.0.0.1:${port}`, storePath }
}

describe('api', () => {
  it('health', async () => {
    const { base } = await start()
    const r = await fetch(`${base}/api/health`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
  })
  it('GET /api/store отдаёт store', async () => {
    const { base } = await start()
    const s = (await (await fetch(`${base}/api/store`)).json()) as Store
    expect(s.version).toBe(3)
  })
  it('GET /api/store без файла — 503', async () => {
    const { base } = await start({ store: false })
    expect((await fetch(`${base}/api/store`)).status).toBe(503)
  })
  it('POST /api/action применяет и возвращает канон', async () => {
    const { base } = await start()
    const before = (await (await fetch(`${base}/api/store`)).json()) as Store
    const quest = before.quests.find((q) => q.type === 'repeating' && q.status === 'active')!
    const r = await fetch(`${base}/api/action`, {
      method: 'POST',
      body: JSON.stringify({ type: 'completeQuest', questId: quest.id, day: '2026-07-07', ts: '2026-07-07T10:00:00.000Z' }),
    })
    expect(r.status).toBe(200)
    const after = (await r.json()) as Store
    expect(after.xpLog.length).toBe(before.xpLog.length + 1)
  })
  it('битый JSON — 400; неизвестный type — 400', async () => {
    const { base } = await start()
    expect((await fetch(`${base}/api/action`, { method: 'POST', body: '{сломано' })).status).toBe(400)
    expect((await fetch(`${base}/api/action`, { method: 'POST', body: JSON.stringify({ type: 'взлом' }) })).status).toBe(400)
  })
  it('отказ validate при записи — 422 с errors, файл на диске не меняется', async () => {
    const { base, storePath } = await start()
    const before = readFileSync(storePath, 'utf8')
    const r = await fetch(`${base}/api/action`, {
      method: 'POST',
      body: JSON.stringify({ type: 'importStore', store: { version: 3 } }),
    })
    expect(r.status).toBe(422)
    const body = (await r.json()) as { error: string; errors: string[] }
    expect(Array.isArray(body.errors)).toBe(true)
    expect(body.errors.length).toBeGreaterThan(0)
    expect(readFileSync(storePath, 'utf8')).toBe(before)
  })
  it('конкурентные POST не теряют события', async () => {
    const { base } = await start()
    const before = (await (await fetch(`${base}/api/store`)).json()) as Store
    const quest = before.quests.find((q) => q.type === 'repeating' && q.status === 'active')!
    const days = Array.from({ length: 8 }, (_, i) => `2026-06-${String(10 + i).padStart(2, '0')}`)
    await Promise.all(days.map((day) =>
      fetch(`${base}/api/action`, {
        method: 'POST',
        body: JSON.stringify({ type: 'completeQuest', questId: quest.id, day, ts: `${day}T10:00:00.000Z` }),
      }),
    ))
    const after = (await (await fetch(`${base}/api/store`)).json()) as Store
    expect(after.xpLog.length).toBe(before.xpLog.length + days.length)
  })
  it('гейт по детям: completeQuest эпика с active-ребёнком → 422, store не изменён', async () => {
    const { base, storePath } = await start()
    const epic = { id: 'q_epic', title: 'Эпик', type: 'mid', skillId: null, xpReward: 50, status: 'active', createdAt: 'T1' }
    const child = { id: 'q_child', title: 'Шаг 1', type: 'short', skillId: null, xpReward: 10, status: 'active', parentQuestId: 'q_epic', createdAt: 'T2' }
    for (const quest of [epic, child])
      expect((await fetch(`${base}/api/action`, { method: 'POST', body: JSON.stringify({ type: 'addQuest', quest }) })).status).toBe(200)
    const before = readFileSync(storePath, 'utf8')
    const r = await fetch(`${base}/api/action`, {
      method: 'POST',
      body: JSON.stringify({ type: 'completeQuest', questId: 'q_epic', day: '2026-07-29', ts: '2026-07-29T10:00:00.000Z', result: { summary: 'итог' } }),
    })
    expect(r.status).toBe(422)
    const body = (await r.json()) as { error: string; children: { id: string; title: string }[] }
    expect(body.error).toMatch(/подквест/)
    expect(body.children).toEqual([{ id: 'q_child', title: 'Шаг 1' }])
    expect(readFileSync(storePath, 'utf8')).toBe(before)
  })

  it('гейт по детям: с force → 200, skippedQuestIds в итоге, ребёнок active', async () => {
    const { base } = await start()
    const epic = { id: 'q_epic', title: 'Эпик', type: 'mid', skillId: null, xpReward: 50, status: 'active', createdAt: 'T1' }
    const child = { id: 'q_child', title: 'Шаг 1', type: 'short', skillId: null, xpReward: 10, status: 'active', parentQuestId: 'q_epic', createdAt: 'T2' }
    for (const quest of [epic, child])
      await fetch(`${base}/api/action`, { method: 'POST', body: JSON.stringify({ type: 'addQuest', quest }) })
    const r = await fetch(`${base}/api/action`, {
      method: 'POST',
      body: JSON.stringify({ type: 'completeQuest', questId: 'q_epic', day: '2026-07-29', ts: '2026-07-29T10:00:00.000Z', result: { summary: 'итог' }, force: true }),
    })
    expect(r.status).toBe(200)
    const after = (await r.json()) as Store
    const p = after.quests.find((q) => q.id === 'q_epic')!
    expect(p.status).toBe('done')
    expect(p.result?.skippedQuestIds).toEqual(['q_child'])
    expect(after.quests.find((q) => q.id === 'q_child')?.status).toBe('active')
  })

  it('статика: / отдаёт index.html', async () => {
    const { base } = await start()
    const r = await fetch(`${base}/`)
    expect(r.status).toBe(200)
    expect(await r.text()).toMatch(/привет/)
  })
  it('выход из корня статики — 404', async () => {
    const { base } = await start()
    expect((await fetch(`${base}/..%2f..%2fetc%2fpasswd`)).status).toBe(404)
    expect((await fetch(`${base}/нет-такого.js`)).status).toBe(404)
  })
})

describe('API: экономика искр', () => {
  const TS = '2026-09-10T05:00:00.000Z'
  const DAY = '2026-09-10'
  const fixture = (): Store => ({
    version: 3, character: { name: 'И', avatar: '🧙' },
    skills: [{ id: 's1', emoji: '⚔️', name: 'Навык', wantStatement: '', hue: 200, archived: false, createdAt: TS }],
    stars: [{ id: 'c1', skillId: 's1', parentStarId: null, tier: 'S', title: 'Вершина', createdAt: TS }],
    xpLog: [],
    quests: [{ id: 'q1', title: 'Контракт', type: 'short', skillId: 's1', xpReward: 100, dueDate: '2026-09-20', status: 'active', createdAt: TS }],
    ledger: [{ id: 'l1', ts: TS, day: DAY, kind: 'adjust', amount: 50, note: 'сид' }],
    wishlist: [
      { id: 'w1', title: 'Массаж', kind: 'small', price: 80, createdAt: TS },
      { id: 'w2', title: 'iPhone', kind: 'big', starId: 'c1', createdAt: TS },
    ],
  })

  async function withApp(store: Store, fn: (base: string, storePath: string) => Promise<void>) {
    const dir = mkdtempSync(join(tmpdir(), 'sparks-api-'))
    const storePath = join(dir, 'store.json')
    writeFileSync(storePath, JSON.stringify(store), 'utf8')
    const app = createApp({ storePath, publicDir: dir })
    await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', () => resolve()))
    const { port } = app.address() as AddressInfo
    try {
      await fn(`http://127.0.0.1:${port}`, storePath)
    } finally {
      await new Promise((resolve) => app.close(resolve))
    }
  }
  const post = (base: string, action: unknown) =>
    fetch(`${base}/api/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) })

  it('недостаток искр → 422, store не изменён', () =>
    withApp(fixture(), async (base, storePath) => {
      const before = readFileSync(storePath, 'utf8')
      const res = await post(base, { type: 'purchaseItem', itemId: 'w1', day: DAY, ts: TS, opId: 'op1' })
      expect(res.status).toBe(422)
      expect(((await res.json()) as { error: string }).error).toContain('не хватает искр')
      expect(readFileSync(storePath, 'utf8')).toBe(before)
    }))
  it('claim до зажигания звезды → 422, store не изменён', () =>
    withApp(fixture(), async (base, storePath) => {
      const before = readFileSync(storePath, 'utf8')
      const res = await post(base, { type: 'claimReward', itemId: 'w2', ts: TS })
      expect(res.status).toBe(422)
      expect(((await res.json()) as { error: string }).error).toContain('не зажжена')
      expect(readFileSync(storePath, 'utf8')).toBe(before)
    }))
  it('claim после зажигания звезды → 200 с claimedAt', () =>
    withApp(fixture(), async (base) => {
      expect((await post(base, { type: 'lightStar', starId: 'c1', ts: TS })).status).toBe(200)
      const res = await post(base, { type: 'claimReward', itemId: 'w2', ts: TS })
      expect(res.status).toBe(200)
      const s = (await res.json()) as Store
      expect(s.wishlist!.find((w) => w.id === 'w2')!.claimedAt).toBe(TS)
    }))
  // устаревший day (payload агента, консервы офлайн-очереди) считался бы по дешёвой
  // провизии: гейт API обязан смотреть на тот же день, что и редьюсер, иначе
  // отказ ядра приезжает тихим 200 — ровно тем, чего цикл избегал на этих путях
  it('покупка с устаревшим day → 422 по дню из ts, а не тихий 200', () =>
    withApp({ ...fixture(), ledger: [{ id: 'l1', ts: TS, day: DAY, kind: 'adjust', amount: 100, note: 'сид' }] },
      async (base, storePath) => {
        const before = readFileSync(storePath, 'utf8')
        // контракт просрочен на потолок к 2026-10-05: провизия −100 съедает весь баланс
        const res = await post(base, { type: 'purchaseItem', itemId: 'w1', day: DAY, ts: '2026-10-05T05:00:00.000Z', opId: 'op_stale' })
        expect(res.status).toBe(422)
        expect(readFileSync(storePath, 'utf8')).toBe(before)
      }))
  it('перенос с устаревшим day в фактическое прошлое → 422', () =>
    withApp(fixture(), async (base) => {
      const res = await post(base, { type: 'moveDueDate', questId: 'q1', to: '2026-09-25', day: DAY, ts: '2026-10-05T05:00:00.000Z' })
      expect(res.status).toBe(422)
    }))
  // payload без ts: гейт не имеет права падать 500 — отказ должен приехать от
  // validateStore внятным списком (ledger[].ts и dueDateHistory[].ts — не строки)
  it('payload без ts → 422 от валидации, а не 500', () =>
    withApp({ ...fixture(), ledger: [{ id: 'l1', ts: TS, day: DAY, kind: 'adjust', amount: 500, note: 'сид' }] },
      async (base, storePath) => {
        const before = readFileSync(storePath, 'utf8')
        for (const action of [
          { type: 'purchaseItem', itemId: 'w1', day: DAY },
          { type: 'spendSparks', amount: 10, note: 'кофе', day: DAY },
          { type: 'moveDueDate', questId: 'q1', to: '2026-09-25', day: DAY },
          { type: 'completeQuest', questId: 'q1', day: DAY, result: { summary: 'итог' } },
        ]) {
          const res = await post(base, action)
          expect(res.status, action.type).toBe(422)
        }
        expect(readFileSync(storePath, 'utf8')).toBe(before)
      }))
  // ts:'' проходит typeof-проверку, но дня из него нет: баланс невычислим. Гейт
  // обязан отказать (иначе покупка при нулевом балансе уезжала бы в store с 200)
  it('покупка с мусорным ts → 422, store не изменён', () =>
    withApp({ ...fixture(), ledger: [] }, async (base, storePath) => {
      const before = readFileSync(storePath, 'utf8')
      const res = await post(base, { type: 'purchaseItem', itemId: 'w1', day: DAY, ts: '', opId: 'op_junk' })
      expect(res.status).toBe(422)
      expect(readFileSync(storePath, 'utf8')).toBe(before)
    }))
  it('перенос в прошлое → 422', () =>
    withApp(fixture(), async (base) => {
      const res = await post(base, { type: 'moveDueDate', questId: 'q1', to: '2026-09-01', day: DAY, ts: TS })
      expect(res.status).toBe(422)
    }))
  it('archiveSkill с активным контрактом → 422 со списком', () =>
    withApp(fixture(), async (base) => {
      const res = await post(base, { type: 'archiveSkill', skillId: 's1' })
      expect(res.status).toBe(422)
      const body = (await res.json()) as { contracts: { id: string }[] }
      expect(body.contracts).toEqual([{ id: 'q1', title: 'Контракт' }])
    }))
  it('покупка при достатке → 200; повтор opId → 200 no-op', () =>
    withApp({ ...fixture(), ledger: [{ id: 'l1', ts: TS, day: DAY, kind: 'adjust', amount: 200, note: 'сид' }] }, async (base) => {
      const first = await post(base, { type: 'purchaseItem', itemId: 'w1', day: DAY, ts: TS, opId: 'op1' })
      expect(first.status).toBe(200)
      const replay = await post(base, { type: 'purchaseItem', itemId: 'w1', day: DAY, ts: TS, opId: 'op1' })
      expect(replay.status).toBe(200)
      const store = (await replay.json()) as Store
      expect(store.ledger!.filter((e) => e.opId === 'op1')).toHaveLength(1)
    }))
})
