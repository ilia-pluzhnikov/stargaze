// Мини-API поверх того же ядра: load → reducer → save под локом.
// Голый node:http, bind предполагается только на 127.0.0.1 (см. main.ts).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { ACTION_TYPES, reducer, type Action } from '../src/logic/store'
import { loadStore, StoreValidationError, withStore } from '../src/logic/storage'
import { settlementDay, sparksBalance } from '../src/logic/sparks'

/** Отклонение от no-op-канона (спека 2026-07-27): этим путём ходит
 * агент-гейм-мастер, тихий 200 означал бы «эпик закрыт», хотя он жив. */
class ChildrenGateError extends Error {
  constructor(
    public questTitle: string,
    public children: { id: string; title: string }[],
  ) {
    super(`эпик «${questTitle}» не завершён: активные подквесты`)
  }
}

/** То же отклонение от no-op-канона, что и ChildrenGateError: этим путём ходит
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

  const isAction = (x: unknown): x is Action =>
    typeof x === 'object' && x !== null &&
    (ACTION_TYPES as readonly string[]).includes((x as { type?: unknown }).type as string)

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

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
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
      let action: unknown
      try {
        action = JSON.parse(body)
      } catch {
        return json(res, 400, { error: 'битый JSON' })
      }
      if (!isAction(action)) return json(res, 400, { error: 'неизвестное действие' })
      // sync-ядро withStore сериализует конкурентные запросы внутри процесса,
      // mkdir-лок — между процессами (CLI пишет в тот же файл)
      try {
        return json(res, 200, withStore(storePath, (s) => {
          if (action.type === 'completeQuest' && !action.force) {
            const q = s.quests.find((x) => x.id === action.questId)
            if (q && q.type !== 'repeating' && q.status === 'active') {
              const open = s.quests.filter((c) => c.parentQuestId === q.id && c.status === 'active')
              if (open.length > 0) throw new ChildrenGateError(q.title, open.map((c) => ({ id: c.id, title: c.title })))
            }
          }
          if (action.type === 'purchaseItem') {
            const item = (s.wishlist ?? []).find((w) => w.id === action.itemId)
            const replay = Boolean(action.opId && (s.ledger ?? []).some((e) => e.opId === action.opId))
            if (item?.kind === 'small' && !item.archived && item.price !== undefined && !replay) {
              // день расчёта — как в редьюсере: иначе устаревший day дал бы 200 поверх тихого no-op
              const balance = sparksBalance(s, settlementDay(action.day, action.ts))
              if (!Number.isFinite(balance))
                throw new EconomyGateError('баланс не вычислим — проверь day/ts в payload')
              if (balance < item.price)
                throw new EconomyGateError(`не хватает искр: баланс ${balance}, цена ${item.price}`)
            }
          }
          if (action.type === 'spendSparks') {
            const replay = Boolean(action.opId && (s.ledger ?? []).some((e) => e.opId === action.opId))
            if (!replay && Number.isInteger(action.amount) && action.amount > 0) {
              const balance = sparksBalance(s, settlementDay(action.day, action.ts))
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
          if (action.type === 'moveDueDate' && action.to < settlementDay(action.day, action.ts))
            throw new EconomyGateError('перенос дедлайна в прошлое запрещён')
          if (action.type === 'archiveSkill') {
            const contracts = s.quests
              .filter((q) => q.skillId === action.skillId && q.status === 'active' && q.type !== 'repeating')
              .map((q) => ({ id: q.id, title: q.title }))
            if (contracts.length > 0)
              throw new EconomyGateError('у навыка активные контракты — сначала заверши или отмени каждый', contracts)
          }
          return reducer(s, action)
        }))
      } catch (e) {
        if (e instanceof ChildrenGateError)
          return json(res, 422, { error: e.message, children: e.children })
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
