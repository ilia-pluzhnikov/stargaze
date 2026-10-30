// Мини-API поверх того же ядра: load → reducer → save под локом.
// Голый node:http, bind предполагается только на 127.0.0.1 (см. main.ts).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { reducer, type Action } from '../src/logic/store'
import { actionShapeError, completeQuestRefusal, dropNullOptionals, storeChanged, type CompleteRefusal } from '../src/logic/gates'
import { loadStore, StoreValidationError, withStore } from '../src/logic/storage'
import { gameTzOffset, settlementDay, sparksBalance, todayInGameTz } from '../src/logic/sparks'
import {
  QUEST_FILTERS, ViewError, parseWeeks, questView, questsView, ranksView, skillsView, starsView, statsView, statusView,
  walletView, wishlistView, type QuestFilter,
} from '../src/logic/views'
import type { Store } from '../src/types'

/** Отклонение от no-op-канона (спека 2026-07-27): этим путём ходит
 * агент-гейм-мастер, тихий 200 означал бы «квест сдан», хотя он жив. Причину
 * (итог, DoD, подквесты, отметка наперёд) считает ядро — голова только отвечает 422. */
class CompleteGateError extends Error {
  constructor(public refusal: CompleteRefusal) {
    super(refusal.error)
  }
}

/** То же отклонение от no-op-канона, что и CompleteGateError: этим путём ходит
 * агент, тихий 200 маскировал бы отказ экономики (спека 2026-08-05 §9). */
class EconomyGateError extends Error {
  constructor(message: string, public contracts?: { id: string; title: string }[]) {
    super(message)
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
}
const BODY_LIMIT = 1_000_000

/** «Сегодня» маршрутов чтения — одна точка на весь сервер. Игровой день в поясе мира,
 * как ctx.today у CLI: иначе GET /api/<команда> разошёлся бы с `cli.js <команда> --json`. */
function serverToday(store: Store): string {
  return todayInGameTz(gameTzOffset(store))
}

/** Маршрут чтения: store, «сегодня» и query → срез ядра (logic/views). */
type ReadRoute = (store: Store, today: string, query: URLSearchParams) => unknown

/** Выборка `?filter=` — как флаги `quests`; нет или пусто — active. */
function questFilter(raw: string | null): QuestFilter {
  if (!raw) return 'active'
  if (!(QUEST_FILTERS as readonly string[]).includes(raw))
    throw new ViewError('bad-param', `filter: ${QUEST_FILTERS.join('|')}`)
  return raw as QuestFilter
}

/** GET-маршруты чтения: ответ — тот же JSON, что `cli.js <команда> --json`,
 * query повторяет флаги команды. Map, а не объект: путь /api/constructor не
 * должен найти Object.prototype. */
const READ_ROUTES = new Map<string, ReadRoute>([
  ['/api/status', (s, today) => statusView(s, today)],
  ['/api/wallet', (s, today) => walletView(s, today)],
  ['/api/quests', (s, today, q) => questsView(s, today, questFilter(q.get('filter')))],
  ['/api/skills', (s) => skillsView(s)],
  ['/api/ranks', (s, _today, q) => {
    const skill = q.get('skill')
    if (!skill) throw new ViewError('bad-param', 'нужен параметр skill: /api/ranks?skill=<id>')
    return ranksView(s, skill)
  }],
  ['/api/stars', (s, _today, q) => starsView(s, { skill: q.get('skill') ?? undefined, tier: q.get('tier') ?? undefined })],
  ['/api/stats', (s, today, q) => statsView(s, today, parseWeeks(q.get('weeks')))],
  ['/api/wishlist', (s) => wishlistView(s)],
])

/** Маршрут по пути; /api/quests/<id> — карточка квеста (id или уникальный префикс). */
function readRoute(pathname: string): ReadRoute | undefined {
  const m = /^\/api\/quests\/([^/]+)$/.exec(pathname)
  if (!m) return READ_ROUTES.get(pathname)
  return (s) => {
    let id: string
    try {
      id = decodeURIComponent(m[1])
    } catch {
      throw new ViewError('bad-param', `битый id в пути: ${m[1]}`)
    }
    return questView(s, id)
  }
}

const VIEW_ERROR_STATUS: Record<ViewError['kind'], number> = { 'bad-param': 400, 'not-found': 404, ambiguous: 409 }

export interface AppOptions {
  storePath: string
  publicDir: string
  /** Зеркало Caddy-гейта для локального serve: POST /api/action с посторонним
   * Origin — 403. Запросы без Origin (CLI, агенты) проходят: браузер чужому
   * сайту не даст отправить POST без Origin, а не-браузеру гейт не нужен. */
  allowedOrigins?: string[]
}

export function createApp({ storePath, publicDir, allowedOrigins }: AppOptions): Server {
  const pubRoot = resolve(publicDir)

  const json = (res: ServerResponse, status: number, body: unknown) => {
    const data = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(data)
  }

  const readBody = (req: IncomingMessage): Promise<string | null> =>
    new Promise((resolveBody) => {
      let size = 0
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > BODY_LIMIT) {
          resolveBody(null)
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
      req.on('error', () => resolveBody(null))
    })

  const serveStatic = (res: ServerResponse, pathname: string) => {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1))
    const full = resolve(pubRoot, rel)
    if (full !== pubRoot && !full.startsWith(pubRoot + sep)) return json(res, 404, { error: 'не найдено' })
    try {
      const body = readFileSync(full)
      res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      json(res, 404, { error: 'не найдено' })
    }
  }

  /** Store читается как в /api/store (503 — ещё не создан); отказ среза —
   * 400 / 404 / 409 с причиной, у неоднозначного префикса — с кандидатами. */
  const serveRead = (res: ServerResponse, route: ReadRoute, query: URLSearchParams) => {
    let store: Store
    try {
      store = loadStore(storePath)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 503 : 500
      return json(res, code, { error: code === 503 ? 'store не инициализирован: stargaze import <file>' : String(e) })
    }
    try {
      return json(res, 200, route(store, serverToday(store), query))
    } catch (e) {
      if (!(e instanceof ViewError)) throw e
      return json(res, VIEW_ERROR_STATUS[e.kind], { error: e.message, ...(e.matches ? { matches: e.matches } : {}) })
    }
  }

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const read = req.method === 'GET' ? readRoute(url.pathname) : undefined
    if (read) return serveRead(res, read, url.searchParams)
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true })
    if (req.method === 'GET' && url.pathname === '/api/store') {
      try {
        return json(res, 200, loadStore(storePath))
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 503 : 500
        return json(res, code, { error: code === 503 ? 'store не инициализирован: stargaze import <file>' : String(e) })
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/action') {
      if (allowedOrigins && req.headers.origin && !allowedOrigins.includes(req.headers.origin))
        return json(res, 403, { error: 'origin не допущен' })
      const body = await readBody(req)
      if (body === null) return json(res, 413, { error: 'слишком большое тело' })
      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch {
        return json(res, 400, { error: 'битый JSON' })
      }
      const shapeError = actionShapeError(parsed)
      if (shapeError) return json(res, 400, { error: shapeError })
      const action = dropNullOptionals(parsed as Action)
      // применилось ли — заголовком, тело остаётся каноном (на него опирается веб):
      // агенту не нужно перечитывать store, чтобы отличить запись от тихого no-op
      let applied = false
      // sync-ядро withStore сериализует конкурентные запросы внутри процесса,
      // mkdir-лок — между процессами (CLI пишет в тот же файл)
      try {
        const out = withStore(storePath, (s) => {
          if (action.type === 'completeQuest') {
            const refusal = completeQuestRefusal(s, action)
            if (refusal) throw new CompleteGateError(refusal)
          }
          if (action.type === 'purchaseItem') {
            const item = (s.wishlist ?? []).find((w) => w.id === action.itemId)
            const replay = Boolean(action.opId && (s.ledger ?? []).some((e) => e.opId === action.opId))
            if (item?.kind === 'small' && !item.archived && item.price !== undefined && !replay) {
              // день расчёта — как в редьюсере: иначе устаревший day дал бы 200 поверх тихого no-op
              const balance = sparksBalance(s, settlementDay(action.day, action.ts, gameTzOffset(s)))
              if (!Number.isFinite(balance))
                throw new EconomyGateError('баланс не вычислим — проверь day/ts в payload')
              if (balance < item.price)
                throw new EconomyGateError(`не хватает искр: баланс ${balance}, цена ${item.price}`)
            }
          }
          if (action.type === 'spendSparks') {
            const replay = Boolean(action.opId && (s.ledger ?? []).some((e) => e.opId === action.opId))
            if (!replay && Number.isInteger(action.amount) && action.amount > 0) {
              const balance = sparksBalance(s, settlementDay(action.day, action.ts, gameTzOffset(s)))
              if (!Number.isFinite(balance))
                throw new EconomyGateError('баланс не вычислим — проверь day/ts в payload')
              if (balance < action.amount)
                throw new EconomyGateError(`не хватает искр: баланс ${balance}, трата ${action.amount}`)
            }
          }
          if (action.type === 'claimReward') {
            const item = (s.wishlist ?? []).find((w) => w.id === action.itemId)
            const star = item?.starId ? s.stars.find((x) => x.id === item.starId) : undefined
            if (item?.kind === 'big' && !item.claimedAt && star && !star.litAt)
              throw new EconomyGateError(`звезда «${star.title}» (${star.id}) ещё не зажжена`)
          }
          if (action.type === 'moveDueDate' && action.to < settlementDay(action.day, action.ts, gameTzOffset(s)))
            throw new EconomyGateError('перенос дедлайна в прошлое запрещён')
          if (action.type === 'archiveSkill') {
            const contracts = s.quests
              .filter((q) => q.skillId === action.skillId && q.status === 'active' && q.type !== 'repeating')
              .map((q) => ({ id: q.id, title: q.title }))
            if (contracts.length > 0)
              throw new EconomyGateError('у навыка активные контракты — сначала заверши или отмени каждый', contracts)
          }
          const next = reducer(s, action)
          applied = storeChanged(s, next)
          return applied ? next : s // пересобранный, но тот же store не переписывает файл
        })
        res.setHeader('Stargaze-Applied', applied ? '1' : '0')
        return json(res, 200, out)
      } catch (e) {
        if (e instanceof CompleteGateError) return json(res, 422, e.refusal)
        if (e instanceof EconomyGateError)
          return json(res, 422, { error: e.message, ...(e.contracts ? { contracts: e.contracts } : {}) })
        if (e instanceof StoreValidationError) return json(res, 422, { error: e.message, errors: e.errors })
        throw e
      }
    }
    if (req.method === 'GET') return serveStatic(res, url.pathname)
    return json(res, 405, { error: 'метод не поддерживается' })
  }

  return createServer((req, res) => {
    handle(req, res).catch((e) => json(res, 500, { error: e instanceof Error ? e.message : String(e) }))
  })
}
