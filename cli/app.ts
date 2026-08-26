import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { acquireLock, loadStore, releaseLock, saveStore, withStore } from '../src/logic/storage'
import { validateStore } from '../src/logic/validate'
import { charXpTotal, completedDaysForQuest, epicProgress, isDueToday, questChildren, questDoneOnDay, skillXpTotal } from '../src/logic/selectors'
import { charLevel, skillLevel } from '../src/logic/xp'
import { computeStreak } from '../src/logic/streak'
import { currentRank, galaxySummary, isRankAchieved, rankStars, rankTitle, skillTiers } from '../src/logic/stars'
import { isCalendarDay } from '../src/logic/dates'
import {
  FREE_MOVES_PER_7D, MOVE_FEE_RATE, cancelFeeFor, dayInGameTz, emissionInDays, ledgerTotal, moveFeeFor,
  movesUsedIn7d, provisionForQuest, provisionTotal, purchasedDays, sparksBalance,
} from '../src/logic/sparks'
import { weeklyXp } from '../src/logic/stats'
import { genId, reducer, type Action } from '../src/logic/store'
import { LEDGER_KIND_LABEL, TIERS } from '../src/types'
import type { Quest, QuestResult, StarComponent, Store, Tier, WishlistItem } from '../src/types'
import { createApp } from '../server/app'
import { seedStore } from '../src/data/seed'
import { CliError, resolveId, table } from './helpers'

export interface Io {
  out(s: string): void
  err(s: string): void
}

const USAGE = `stargaze — RPG-интерфейс над реальной жизнью. Команды:
  status | quests | quest <id> | skills | ranks | stars | stats
  complete | uncomplete | check | uncheck | add-quest | propose-quest | accept | reject | archive
  light-star | add-star | validate | export | import
  wallet | wishlist | wishlist-add | wishlist-edit <item> | buy <item> | spend <✨> <на что> | claim <item>
  move <id> <дата> | cancel <id> --yes | adjust -- <±✨> <причина>
  serve [--port 8643] [--host 127.0.0.1] [--public <dir>] — веб и API на локальном store (первый запуск создаёт демо-мир)
Глобальные флаги: --store <path> (или env STARGAZE_STORE), --json
Кошелёк: cancel показывает неустойку и требует --yes; adjust — break-glass-корректировка с причиной.
  Награды: без --repeat позиция разовая (купится один раз); --repeat — многоразовая, wishlist-edit --once возвращает разовость.
Карточка квеста: add-quest/propose-quest --desc --why --dod "пункт" (повторяемый)
  --resource "Имя=URL" (повторяемый); check/uncheck <id> <n> — тик пункта DoD;
  complete <short|mid|long> --result "итог" [--artifact <url>] [--evidence "сигнал"]
  (--force — завершить с незакрытым DoD или активными подквестами; пропущенное ляжет в итог)
  подквесты: add-quest/propose-quest --parent <эпик> (без --skill наследует навык)`

interface Ctx {
  storePath: string
  json: boolean
  io: Io
  today: string
}

export function runCli(argv: string[], io: Io): number {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        store: { type: 'string' },
        json: { type: 'boolean', default: false },
        day: { type: 'string' },
        today: { type: 'boolean', default: false },
        proposed: { type: 'boolean', default: false },
        all: { type: 'boolean', default: false },
        skill: { type: 'string' },
        star: { type: 'string' },
        title: { type: 'string' },
        type: { type: 'string' },
        tier: { type: 'string' },
        parent: { type: 'string' },
        criteria: { type: 'string' },
        xp: { type: 'string' },
        days: { type: 'string' },
        due: { type: 'string' },
        note: { type: 'string' },
        evidence: { type: 'string' },
        weeks: { type: 'string' },
        result: { type: 'string' },
        artifact: { type: 'string' },
        desc: { type: 'string' },
        why: { type: 'string' },
        dod: { type: 'string', multiple: true },
        resource: { type: 'string', multiple: true },
        force: { type: 'boolean', default: false },
        yes: { type: 'boolean', default: false },
        price: { type: 'string' },
        url: { type: 'string' },
        orig: { type: 'string' },
        emoji: { type: 'string' },
        image: { type: 'string' },
        repeat: { type: 'boolean', default: false },
        once: { type: 'boolean', default: false },
        port: { type: 'string' },
        host: { type: 'string' },
        public: { type: 'string' },
      },
      allowPositionals: true,
    })
    const [command, ...rest] = positionals
    if (!command) throw new CliError(USAGE, 2)
    if (command === 'serve') return cmdServe(values, io)
    // Primary — STARGAZE_STORE; QUESTLOG_STORE читается вечно (фолбэк после ренейма 2026-07).
    const storePath = values.store ?? process.env.STARGAZE_STORE ?? process.env.QUESTLOG_STORE
    if (!storePath) throw new CliError('не задан путь к store: укажи --store <path> или env STARGAZE_STORE', 2)
    // Игровой пояс, а не todayKey(): CLI живёт на дроплете в UTC, и локальный день
    // машины с 00:00 до 07:00 по Бангкоку отстаёт на сутки. Отсюда идёт day и в
    // ledger (провизия, неустойка, квота переносов), и в xpLog — с todayKey()
    // консоль писала бы вчерашний день, расходясь с вебом и с фактическим игровым днём.
    const ctx: Ctx = { storePath, json: values.json, io, today: dayInGameTz(new Date().toISOString()) }

    switch (command) {
      case 'status':
        return cmdStatus(ctx)
      case 'quests':
        return cmdQuests(ctx, values)
      case 'quest':
        return cmdQuest(ctx, rest[0])
      case 'skills':
        return cmdSkills(ctx)
      case 'ranks':
        return cmdRanks(ctx, values.skill)
      case 'stars':
        return cmdStars(ctx, values)
      case 'stats':
        return cmdStats(ctx, values.weeks)
      case 'validate':
        return cmdValidate(ctx)
      case 'export':
        return cmdExport(ctx, rest[0])
      case 'import':
        return cmdImport(ctx, rest[0])
      case 'complete':
        return cmdComplete(ctx, rest[0], values, false)
      case 'uncomplete':
        return cmdComplete(ctx, rest[0], values, true)
      case 'check':
        return cmdCheckDod(ctx, rest[0], rest[1], true)
      case 'uncheck':
        return cmdCheckDod(ctx, rest[0], rest[1], false)
      case 'add-quest':
        return cmdAddQuest(ctx, values, false)
      case 'propose-quest':
        return cmdAddQuest(ctx, values, true)
      case 'accept':
        return cmdAcceptReject(ctx, rest[0], true)
      case 'reject':
        return cmdAcceptReject(ctx, rest[0], false)
      case 'archive':
      case 'cancel':
        return cmdArchive(ctx, rest[0], values.yes)
      case 'wallet':
        return cmdWallet(ctx)
      case 'move':
        return cmdMove(ctx, rest[0], rest[1])
      case 'buy':
        return cmdBuy(ctx, rest[0])
      case 'spend':
        return cmdSpend(ctx, rest[0], rest.slice(1).join(' '))
      case 'adjust':
        return cmdAdjust(ctx, rest[0], rest.slice(1).join(' '))
      case 'wishlist':
        return cmdWishlist(ctx)
      case 'wishlist-add':
        return cmdWishlistAdd(ctx, values)
      case 'wishlist-edit':
        return cmdWishlistEdit(ctx, rest[0], values)
      case 'claim':
        return cmdClaim(ctx, rest[0])
      case 'light-star':
        return cmdLightStar(ctx, rest[0], values.evidence)
      case 'add-star':
        return cmdAddStar(ctx, values)
      default:
        throw new CliError(`неизвестная команда «${command}»\n${USAGE}`, 2)
    }
  } catch (e) {
    if (e instanceof CliError) {
      io.err(e.message)
      return e.exitCode
    }
    io.err(e instanceof Error ? e.message : String(e))
    return 1
  }
}

function cmdServe(
  values: { store?: string; port?: string; host?: string; public?: string },
  io: Io,
): number {
  const storePath = values.store ?? process.env.STARGAZE_STORE ?? process.env.QUESTLOG_STORE
    ?? join(homedir(), '.stargaze', 'store.json')
  if (!existsSync(storePath)) {
    mkdirSync(dirname(storePath), { recursive: true })
    saveStore(storePath, seedStore())
    io.out(`store не найден — создан демо-мир: ${storePath}`)
  }
  // __dirname есть только в CJS-бандле (dist-node); под vitest (ESM) — cwd
  const bundleDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd()
  const publicDir = values.public ?? process.env.STARGAZE_PUBLIC ?? process.env.QUESTLOG_PUBLIC
    ?? [join(bundleDir, 'public'), join(bundleDir, '..', 'dist')].find((d) => existsSync(join(d, 'index.html')))
  if (!publicDir || !existsSync(join(publicDir, 'index.html')))
    throw new CliError('веб-статика не найдена: собери её (npm run build) или укажи --public <dir>', 2)
  const port = Number(values.port ?? process.env.STARGAZE_PORT ?? process.env.QUESTLOG_PORT ?? 8643)
  if (!Number.isInteger(port) || port <= 0 || port > 65535)
    throw new CliError(`некорректный порт ${JSON.stringify(values.port)}`, 2)
  const host = values.host ?? '127.0.0.1'
  const loopback = host === '127.0.0.1' || host === 'localhost'
  // На loopback включаем Origin-гейт; при явном --host (Docker, LAN) хост
  // страницы непредсказуем — защиту даёт reverse proxy (см. DEPLOY.md)
  createApp({
    storePath,
    publicDir,
    ...(loopback ? { allowedOrigins: [`http://localhost:${port}`, `http://127.0.0.1:${port}`] } : {}),
  }).listen(port, host, () => {
    io.out(`stargaze: http://${loopback ? 'localhost' : host}:${port} · store: ${storePath}`)
  })
  return 0 // процесс живёт, пока слушает сервер
}

function cmdStatus(ctx: Ctx): number {
  const s = loadStore(ctx.storePath)
  const char = charLevel(charXpTotal(s.xpLog))
  const activeQuests = s.quests.filter((q) => q.status === 'active')
  const dueToday = activeQuests.filter((q) => isDueToday(q, ctx.today))
  const doneToday = dueToday.filter((q) =>
    q.type === 'repeating' ? questDoneOnDay(s.xpLog, q.id, ctx.today) : false,
  )
  const skills = s.skills.filter((sk) => !sk.archived).map((sk) => {
    const info = skillLevel(skillXpTotal(s.xpLog, sk.id))
    const streak = Math.max(
      0,
      ...s.quests
        .filter((q) => q.skillId === sk.id && q.type === 'repeating' && q.status === 'active')
        .map((q) => computeStreak(q, completedDaysForQuest(s.xpLog, q.id), ctx.today)),
    )
    const ladder = galaxySummary(s.stars, sk.id)
    const cur = currentRank(s.stars, sk.id)
    return { skill: sk, info, streak, ladder, cur }
  })
  const provision = provisionTotal(s, ctx.today)
  const movesUsed = movesUsedIn7d(s, ctx.today)
  if (ctx.json) {
    ctx.io.out(JSON.stringify({
      character: { name: s.character.name, level: char.level, into: char.into, toNext: char.toNext, totalXp: charXpTotal(s.xpLog) },
      today: { due: dueToday.length, done: doneToday.length },
      skills: skills.map(({ skill, info, streak, ladder, cur }) => ({
        id: skill.id, name: skill.name, level: info.level, into: info.into, toNext: info.toNext,
        streak, ranksTotal: ladder.total, ranksAchieved: ladder.achieved, currentRank: cur,
      })),
      sparks: { balance: sparksBalance(s, ctx.today), provision, moves: { used: movesUsed, free: FREE_MOVES_PER_7D } },
    }, null, 2))
    return 0
  }
  ctx.io.out(`${s.character.avatar} ${s.character.name} — ур. ${char.level} · ${char.into} / ${char.toNext} XP (всего ${charXpTotal(s.xpLog)})`)
  ctx.io.out(`✨ ${sparksBalance(s, ctx.today)}${provision > 0 ? ` (капает −${provision})` : ''}`)
  const quota = movesQuotaLine(movesUsed)
  if (quota) ctx.io.out(quota)
  ctx.io.out(`Сегодня: ${doneToday.length} / ${dueToday.length} положенных отметок`)
  ctx.io.out('')
  ctx.io.out(table([
    ['навык', 'ур.', 'XP', 'стрик', 'ранги'],
    ...skills.map(({ skill, info, streak, ladder, cur }) => [
      `${skill.emoji} ${skill.name}`,
      String(info.level),
      `${info.into}/${info.toNext}`,
      streak > 0 ? `${streak}🔥` : '—',
      ladder.total === 0 ? 'без дерева' : `${ladder.achieved}/${ladder.total}${cur ? ` · ранг ${cur} · ${rankTitle(skill, cur)}` : ' · ✦ всё взято'}`,
    ]),
  ]))
  return 0
}

function cmdQuests(ctx: Ctx, flags: { today?: boolean; proposed?: boolean; all?: boolean }): number {
  const s = loadStore(ctx.storePath)
  let list = s.quests.filter((q) => q.status === 'active')
  if (flags.proposed) list = s.quests.filter((q) => q.status === 'proposed')
  else if (flags.all) list = s.quests.filter((q) => q.status !== 'archived')
  else if (flags.today)
    list = s.quests.filter(
      (q) => q.status === 'active' && isDueToday(q, ctx.today),
    )
  const skillName = (id: string | null) => (id ? (s.skills.find((x) => x.id === id)?.name ?? '?') : '—')
  const starTitle = (id?: string | null) => (id ? (s.stars.find((x) => x.id === id)?.title ?? '?') : '')
  if (ctx.json) {
    ctx.io.out(JSON.stringify(list, null, 2))
    return 0
  }
  if (list.length === 0) {
    ctx.io.out('пусто')
    return 0
  }
  // дети рендерятся под родителем; ребёнок «сироты» (родитель вне выборки) — верхним уровнем
  const inList = new Set(list.map((q) => q.id))
  const byCreated = (a: Quest, b: Quest) => a.createdAt.localeCompare(b.createdAt)
  const ordered: { q: Quest; child: boolean }[] = []
  for (const q of list) {
    if (q.parentQuestId && inList.has(q.parentQuestId)) continue // отрисуется под родителем
    ordered.push({ q, child: false })
    for (const c of list.filter((x) => x.parentQuestId === q.id).sort(byCreated)) ordered.push({ q: c, child: true })
  }
  ctx.io.out(table([
    ['id', '✓', 'квест', 'тип', 'навык', 'звезда', 'XP'],
    ...ordered.map(({ q, child }) => {
      const progress = epicProgress(s.quests, q.id)
      return [
        q.id,
        q.status === 'proposed' ? '?' : (q.type === 'repeating' ? questDoneOnDay(s.xpLog, q.id, ctx.today) : q.status === 'done') ? '✓' : '·',
        (child ? '↳ ' : '') + q.title + (progress ? ` [${progress.done}/${progress.total}]` : '') + (q.proposalNote ? ` («${q.proposalNote}»)` : ''),
        q.type,
        skillName(q.skillId),
        starTitle(q.starId),
        String(q.xpReward),
      ]
    }),
  ]))
  return 0
}

function cmdSkills(ctx: Ctx): number {
  const s = loadStore(ctx.storePath)
  const rows = s.skills.filter((sk) => !sk.archived).map((sk) => {
    const info = skillLevel(skillXpTotal(s.xpLog, sk.id))
    const ladder = galaxySummary(s.stars, sk.id)
    return { id: sk.id, name: `${sk.emoji} ${sk.name}`, level: info.level, into: info.into, toNext: info.toNext, ranks: ladder }
  })
  if (ctx.json) {
    ctx.io.out(JSON.stringify(rows, null, 2))
    return 0
  }
  ctx.io.out(table([
    ['id', 'навык', 'ур.', 'XP', 'ранги'],
    ...rows.map((r) => [r.id, r.name, String(r.level), `${r.into}/${r.toNext}`, r.ranks.total ? `${r.ranks.achieved}/${r.ranks.total}` : '—']),
  ]))
  return 0
}

function cmdRanks(ctx: Ctx, skillPrefix?: string): number {
  if (!skillPrefix) throw new CliError('использование: stargaze ranks --skill <id>', 2)
  const s = loadStore(ctx.storePath)
  const skillId = resolveId(s.skills, skillPrefix, 'навык')
  const skill = s.skills.find((sk) => sk.id === skillId)!
  const list = skillTiers(s.stars, skillId).map((tier) => {
    const own = rankStars(s.stars, skillId, tier)
    return {
      tier,
      title: rankTitle(skill, tier),
      achieved: isRankAchieved(s.stars, skillId, tier),
      lit: own.filter((c) => !!c.litAt).length,
      total: own.length,
    }
  })
  if (ctx.json) {
    ctx.io.out(JSON.stringify(list, null, 2))
    return 0
  }
  ctx.io.out(table([
    ['ранг', 'название', ' ', 'звёзды'],
    ...list.map((r) => [r.tier, r.title, r.achieved ? '✦' : '○', `${r.lit}/${r.total}`]),
  ]))
  return 0
}

function cmdStars(ctx: Ctx, flags: { skill?: string; tier?: string }): number {
  const s = loadStore(ctx.storePath)
  let list = s.stars
  if (flags.skill) {
    const skillId = resolveId(s.skills, flags.skill, 'навык')
    list = list.filter((c) => c.skillId === skillId)
  }
  if (flags.tier) {
    if (!TIERS.includes(flags.tier as Tier)) throw new CliError('--tier: D|C|B|A|S', 2)
    list = list.filter((c) => c.tier === flags.tier)
  }
  if (ctx.json) {
    ctx.io.out(JSON.stringify(list, null, 2))
    return 0
  }
  const parentTitle = (id: string | null) => (id ? (s.stars.find((c) => c.id === id)?.title ?? '?') : '—')
  ctx.io.out(table([
    ['id', 'звезда', 'ранг', 'после', ' '],
    ...list.map((c) => [
      c.id,
      c.title,
      c.tier,
      parentTitle(c.parentStarId),
      c.litAt ? '✦' : '○',
    ]),
  ]))
  return 0
}

function cmdStats(ctx: Ctx, weeksFlag?: string): number {
  const weeks = weeksFlag ? Number(weeksFlag) : 4
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) throw new CliError('--weeks: целое 1..52', 2)
  const s = loadStore(ctx.storePath)
  const stats = weeklyXp(s.xpLog, weeks, ctx.today)
  if (ctx.json) {
    ctx.io.out(JSON.stringify(stats.map((w) => ({ ...w, bySkill: Object.fromEntries(w.bySkill) })), null, 2))
    return 0
  }
  const skillName = (id: string | null) => (id === null ? 'персонаж' : (s.skills.find((x) => x.id === id)?.name ?? id))
  for (const w of stats) {
    ctx.io.out(`неделя с ${w.weekStart}: ${w.total} XP`)
    for (const [skillId, xp] of w.bySkill) if (xp !== 0) ctx.io.out(`  ${skillName(skillId)}: ${xp}`)
  }
  return 0
}

function cmdValidate(ctx: Ctx): number {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(ctx.storePath, 'utf8'))
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e)
    if (ctx.json) {
      ctx.io.out(JSON.stringify({ ok: false, errors: [errorMsg] }, null, 2))
    } else {
      ctx.io.err(`не читается: ${errorMsg}`)
    }
    return 1
  }
  const errors = validateStore(parsed)
  if (ctx.json) {
    ctx.io.out(JSON.stringify({ ok: errors.length === 0, errors }, null, 2))
  } else if (errors.length === 0) {
    ctx.io.out('store валиден ✓')
  } else {
    ctx.io.err(`найдено проблем: ${errors.length}`)
    for (const e of errors) ctx.io.err(`  · ${e}`)
  }
  return errors.length === 0 ? 0 : 1
}

function cmdExport(ctx: Ctx, file?: string): number {
  const s = loadStore(ctx.storePath)
  const json = JSON.stringify(s, null, 2)
  if (file) {
    writeFileSync(file, json + '\n', 'utf8')
    ctx.io.out(`экспортировано в ${file}`)
  } else {
    ctx.io.out(json)
  }
  return 0
}

function cmdImport(ctx: Ctx, file?: string): number {
  if (!file) throw new CliError('использование: stargaze import <file>', 2)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    let reason = 'синтаксическая ошибка'
    if (e instanceof Error) {
      if (e.message.includes('ENOENT')) reason = 'файл не найден'
      else if (e.message.includes('EACCES')) reason = 'нет доступа к файлу'
      else if (e.message.includes('JSON')) reason = 'невалидный JSON'
    }
    throw new CliError(`не удалось прочитать файл импорта: ${file} (${reason})`, 1)
  }
  // только валидный v3 JSON — без автомиграции, как веб (resolveStoredStore)
  const errors = validateStore(parsed)
  if (errors.length) throw new CliError(`импортируемый store невалиден:\n  ${errors.join('\n  ')}`)
  const store = parsed as Store
  acquireLock(ctx.storePath)
  try {
    if (existsSync(ctx.storePath)) {
      const bak = `${ctx.storePath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
      copyFileSync(ctx.storePath, bak)
      ctx.io.out(`бэкап: ${bak}`)
    }
    saveStore(ctx.storePath, store)
  } finally {
    releaseLock(ctx.storePath)
  }
  ctx.io.out('импорт завершён ✓')
  return 0
}

function cmdQuest(ctx: Ctx, prefix: string | undefined): number {
  if (!prefix) throw new CliError('использование: stargaze quest <questId> [--json]', 2)
  const s = loadStore(ctx.storePath)
  const questId = resolveId(s.quests, prefix, 'квест')
  const q = s.quests.find((x) => x.id === questId)!
  const children = questChildren(s.quests, q.id)
  const progress = epicProgress(s.quests, q.id)
  if (ctx.json) {
    ctx.io.out(JSON.stringify(children.length > 0 ? { ...q, children: children.map((c) => c.id), progress } : q, null, 2))
    return 0
  }
  const skill = q.skillId ? s.skills.find((x) => x.id === q.skillId) : undefined
  const star = q.starId ? s.stars.find((x) => x.id === q.starId) : undefined
  const lines: string[] = [
    `${q.title} · +${q.xpReward} XP`,
    `id: ${q.id} · тип: ${q.type} · статус: ${q.status}`,
  ]
  if (skill) lines.push(`навык: ${skill.emoji} ${skill.name}`)
  if (star) lines.push(`звезда: ${star.litAt ? '✦' : '☆'} ${star.tier} · ${star.title}`)
  if (q.dueDate) lines.push(`дедлайн: ${q.dueDate}`)
  if (q.proposalNote) lines.push(`предложен: ${q.proposalNote}`)
  if (q.parentQuestId) {
    const p = s.quests.find((x) => x.id === q.parentQuestId)
    lines.push(`⤴ часть эпика: ${p ? p.title : '?'} (${q.parentQuestId})`)
  }
  if (q.why) lines.push('', `Зачем: ${q.why}`)
  if (q.description) lines.push('', q.description)
  if (q.definitionOfDone?.length) {
    lines.push('', 'Definition of Done:')
    q.definitionOfDone.forEach((d, j) => lines.push(`  [${d.done ? 'x' : ' '}] ${j + 1}. ${d.text}`))
  }
  if (q.resources?.length) {
    lines.push('', 'Материалы:')
    for (const r of q.resources) lines.push(`  · ${r.title}${r.url ? ` — ${r.url}` : ' (без ссылки)'}`)
  }
  if (children.length > 0) {
    lines.push('', `Подквесты${progress ? ` ${progress.done}/${progress.total}` : ''}:`)
    children.forEach((c, j) => {
      const mark = c.status === 'done' ? 'x' : c.status === 'proposed' ? '?' : ' '
      lines.push(`  [${mark}] ${j + 1}. ${c.title} (${c.id})`)
    })
  }
  if (q.result) {
    lines.push('', `Итог: ${q.result.summary}`)
    if (q.result.artifactUrl) lines.push(`  артефакт: ${q.result.artifactUrl}`)
    if (q.result.evidence) lines.push(`  evidence: ${q.result.evidence}`)
    if (q.result.skippedDod?.length) lines.push(`  пропущено при force: ${q.result.skippedDod.join(' · ')}`)
  }
  if (q.resultHistory?.length) {
    lines.push('', 'Прошлые итоги (отменены):')
    for (const r of q.resultHistory) lines.push(`  · ${r.summary} (откат ${r.cancelledAt})`)
  }
  ctx.io.out(lines.join('\n'))
  return 0
}

/** Строка о квоте переносов; null при нетронутой квоте — следующий перенос заведомо
 * бесплатен, и печатать «0/3» в ежедневном status значило бы шуметь. Точную комиссию
 * не называем: она считается от награды конкретного квеста, а строка общая. */
function movesQuotaLine(used: number): string | null {
  if (used === 0) return null
  if (used < FREE_MOVES_PER_7D) return `переносов за 7 дней: ${used}/${FREE_MOVES_PER_7D}`
  const paid = ` — следующий платный (−${Math.round(MOVE_FEE_RATE * 100)}% награды)`
  // за порогом дробь «4/3» читалась бы как ошибка счёта — там просто счётчик
  return used === FREE_MOVES_PER_7D
    ? `переносов за 7 дней: ${used}/${FREE_MOVES_PER_7D}${paid}`
    : `переносов за 7 дней: ${used}, бесплатные (${FREE_MOVES_PER_7D}) исчерпаны${paid}`
}

function applyOrFail(ctx: Ctx, action: Action, failText: string, exitCode: 1 | 2 = 1): Store {
  let changed = true
  const next = withStore(ctx.storePath, (s) => {
    const out = reducer(s, action)
    changed = out !== s
    return out
  })
  if (!changed) throw new CliError(failText, exitCode)
  return next
}

function cmdComplete(
  ctx: Ctx,
  prefix: string | undefined,
  flags: { day?: string; result?: string; artifact?: string; evidence?: string; force?: boolean },
  un: boolean,
): number {
  if (!prefix) throw new CliError(`использование: stargaze ${un ? 'uncomplete' : 'complete'} <questId> [--day YYYY-MM-DD]`, 2)
  const day = flags.day
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new CliError('--day: формат YYYY-MM-DD', 2)
  const s = loadStore(ctx.storePath)
  const candidates = s.quests.filter((q) => q.status === 'active' || q.status === 'done')
  const questId = resolveId(candidates, prefix, 'квест')
  const quest = s.quests.find((q) => q.id === questId)!
  const d = day ?? ctx.today
  const hasResultFlags = flags.result !== undefined || flags.artifact !== undefined || flags.evidence !== undefined
  if (quest.type === 'repeating' && hasResultFlags)
    throw new CliError(`«${quest.title}» — repeating-квест: итог некуда писать, --result/--artifact/--evidence не поддерживаются`, 2)
  let result: QuestResult | undefined
  if (!un && quest.type !== 'repeating') {
    const summary = flags.result?.trim()
    if (!summary)
      throw new CliError(
        `завершение short/mid/long требует итог: stargaze complete ${questId} --result "что получилось" [--artifact <url>] [--evidence "сигнал"]`,
        2,
      )
    // DoD-гейт дублируем на границе CLI, чтобы дать перечень пунктов (ядро молча делает no-op)
    const open = (quest.definitionOfDone ?? []).filter((x) => !x.done).map((x) => x.text)
    if (open.length > 0 && !flags.force)
      throw new CliError(
        `незакрытый Definition of Done:\n${open.map((t) => `  [ ] ${t}`).join('\n')}\n` +
          `закрой пункты (stargaze check ${questId} <n>) или заверши явно с --force — пропущенные лягут в итог`,
        2,
      )
    // гейт по детям дублируем на границе CLI ради поимённого перечня (ядро молча делает no-op)
    const openChildren = s.quests.filter((c) => c.parentQuestId === quest.id && c.status === 'active')
    if (openChildren.length > 0 && !flags.force)
      throw new CliError(
        `эпик «${quest.title}» не завершён — активные подквесты:\n` +
          `${openChildren.map((c) => `  · ${c.id}  ${c.title}`).join('\n')}\n` +
          `заверши их или явно --force — пропущенные лягут в итог`,
        2,
      )
    const pendingChildren = s.quests.filter((c) => c.parentQuestId === quest.id && c.status === 'proposed')
    if (pendingChildren.length > 0)
      ctx.io.err(`внимание: у эпика висят ${pendingChildren.length} предложения(й) — proposed не блокируют завершение`)
    result = { summary }
    if (flags.artifact) result.artifactUrl = flags.artifact
    if (flags.evidence) result.evidence = flags.evidence
  }
  applyOrFail(
    ctx,
    {
      type: un ? 'uncompleteQuest' : 'completeQuest', questId, day: d, ts: new Date().toISOString(),
      ...(result ? { result } : {}), ...(flags.force ? { force: true } : {}),
    },
    un ? `откатывать нечего: «${quest.title}» не отмечен за ${d}` : `«${quest.title}» уже отмечен за ${d}`,
  )
  ctx.io.out(un ? `откат · ${quest.title} (${d})` : `+${quest.xpReward} XP · ${quest.title} (${d})`)
  return 0
}

function cmdCheckDod(ctx: Ctx, prefix: string | undefined, num: string | undefined, on: boolean): number {
  const cmd = on ? 'check' : 'uncheck'
  if (!prefix || !num) throw new CliError(`использование: stargaze ${cmd} <questId> <номер пункта>`, 2)
  const n = Number(num)
  if (!Number.isInteger(n) || n < 1) throw new CliError(`номер пункта — целое ≥ 1 (нумерацию печатает stargaze quest <id>)`, 2)
  const s = loadStore(ctx.storePath)
  // резолвим по всем квестам, чтобы не-active получал внятный отказ по статусу, а не «не найден»
  const questId = resolveId(s.quests, prefix, 'квест')
  const quest = s.quests.find((q) => q.id === questId)!
  if (quest.status !== 'active')
    throw new CliError(`«${quest.title}» имеет статус ${quest.status}: check/uncheck доступны только для active-квестов`, 2)
  const dod = quest.definitionOfDone
  if (!dod || dod.length === 0) throw new CliError(`у «${quest.title}» нет DoD-чеклиста`, 2)
  if (n > dod.length) throw new CliError(`пункт ${n} вне диапазона: в DoD ${dod.length} пункт(ов)`, 2)
  applyOrFail(
    ctx,
    {
      type: 'updateQuest',
      quest: { ...quest, definitionOfDone: dod.map((d, j) => (j === n - 1 ? { ...d, done: on } : d)) },
    },
    'тик не записан',
  )
  ctx.io.out(`[${on ? 'x' : ' '}] ${n}. ${dod[n - 1].text} · ${quest.title}`)
  return 0
}

type CliFlags = Record<string, string | boolean | string[] | undefined>

function buildQuest(s: Store, flags: CliFlags, status: 'active' | 'proposed'): Quest {
  const title = typeof flags.title === 'string' ? flags.title : undefined
  const type = typeof flags.type === 'string' ? flags.type : undefined
  const xp = typeof flags.xp === 'string' ? flags.xp : undefined
  if (!title || !type || !xp) throw new CliError('обязательные флаги: --title, --type, --xp', 2)
  if (!['repeating', 'short', 'mid', 'long'].includes(type)) throw new CliError(`--type: repeating|short|mid|long`, 2)
  const xpReward = Number(xp)
  if (!Number.isInteger(xpReward) || xpReward <= 0) throw new CliError('--xp: целое > 0', 2)
  const skill = typeof flags.skill === 'string' ? flags.skill : undefined
  const star = typeof flags.star === 'string' ? flags.star : undefined
  const days = typeof flags.days === 'string' ? flags.days : undefined
  const due = typeof flags.due === 'string' ? flags.due : undefined
  const note = typeof flags.note === 'string' ? flags.note : undefined
  let skillId: string | null = skill ? resolveId(s.skills.filter((k) => !k.archived), skill, 'навык') : null
  let starId: string | undefined
  if (star) {
    starId = resolveId(s.stars, star, 'звезда')
    const starSkillId = s.stars.find((c) => c.id === starId)!.skillId
    if (skillId && skillId !== starSkillId) throw new CliError('--star принадлежит другому навыку, чем --skill', 2)
    skillId = starSkillId // звезда задаёт навык автоматически
  }
  const parent = typeof flags.parent === 'string' ? flags.parent : undefined
  let parentQuestId: string | undefined
  if (parent) {
    if (type === 'repeating') throw new CliError('--parent: repeating-квест не может быть подквестом', 2)
    const pid = resolveId(s.quests, parent, 'квест')
    const p = s.quests.find((q) => q.id === pid)!
    if (p.type === 'repeating') throw new CliError(`«${p.title}» — repeating и не может быть эпиком`, 2)
    if (p.parentQuestId != null) throw new CliError(`«${p.title}» сам подквест — второй уровень запрещён`, 2)
    if (p.status === 'archived' || p.status === 'done')
      throw new CliError(`«${p.title}» в статусе ${p.status} — детей не добавить`, 2)
    parentQuestId = pid
    // сахар CLI: без --skill/--star ребёнок наследует навык родителя
    if (!skill && !star) skillId = p.skillId
  }
  const daysOfWeek = days
    ? days.split(',').map((x) => Number(x.trim()))
    : undefined
  if (daysOfWeek && daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
    throw new CliError('--days: числа 0..6 через запятую (0=вс)', 2)
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new CliError('--due: формат YYYY-MM-DD', 2)
  const desc = typeof flags.desc === 'string' ? flags.desc : undefined
  const why = typeof flags.why === 'string' ? flags.why : undefined
  const dod = Array.isArray(flags.dod) ? flags.dod : undefined
  if (dod?.some((t) => t.trim() === '')) throw new CliError('--dod: пункт не может быть пустым', 2)
  const resource = Array.isArray(flags.resource) ? flags.resource : undefined
  const resources = resource?.map((r) => {
    const eq = r.indexOf('=') // формат «Имя=URL»; без «=» (или с пустым URL) — материал без ссылки
    const title = (eq >= 0 ? r.slice(0, eq) : r).trim()
    const url = eq >= 0 ? r.slice(eq + 1).trim() : ''
    if (!title) throw new CliError('--resource: нужен непустой заголовок («Имя=URL» или просто «Имя»)', 2)
    return url ? { title, url } : { title }
  })
  return {
    id: genId('q'), title, type: type as Quest['type'], skillId, starId, xpReward,
    daysOfWeek, dueDate: due, status, createdAt: new Date().toISOString(),
    ...(parentQuestId ? { parentQuestId } : {}),
    ...(status === 'proposed' ? { proposalNote: note } : {}),
    ...(desc ? { description: desc } : {}),
    ...(why ? { why } : {}),
    ...(dod && dod.length > 0 ? { definitionOfDone: dod.map((text) => ({ text: text.trim() })) } : {}),
    ...(resources && resources.length > 0 ? { resources } : {}),
  }
}

function cmdAddQuest(ctx: Ctx, flags: CliFlags, propose: boolean): number {
  const note = typeof flags.note === 'string' ? flags.note : undefined
  if (propose && !note) throw new CliError('propose-quest: обязателен --note «зачем»', 2)
  const s = loadStore(ctx.storePath)
  const quest = buildQuest(s, flags, propose ? 'proposed' : 'active')
  applyOrFail(ctx, propose ? { type: 'proposeQuest', quest } : { type: 'addQuest', quest }, 'квест не добавлен')
  ctx.io.out(`${propose ? 'предложен' : 'добавлен'}: ${quest.title} (${quest.id})`)
  return 0
}

function cmdAcceptReject(ctx: Ctx, prefix: string | undefined, accept: boolean): number {
  if (!prefix) throw new CliError(`использование: stargaze ${accept ? 'accept' : 'reject'} <questId>`, 2)
  const s = loadStore(ctx.storePath)
  const proposed = s.quests.filter((q) => q.status === 'proposed')
  const questId = resolveId(proposed.length ? proposed : s.quests, prefix, 'квест')
  const quest = s.quests.find((q) => q.id === questId)!
  // гейт дублируем ради перечня — ядро на reject эпика с детьми молча делает no-op,
  // а без явной ошибки applyOrFail соврал бы «не в статусе proposed (proposed)»
  const children = accept ? [] : s.quests.filter((c) => c.parentQuestId === questId)
  if (children.length > 0)
    throw new CliError(
      `«${quest.title}» — эпик с подквестами:\n` +
        `${children.map((c) => `  · ${c.id}  ${c.title}`).join('\n')}\n` +
        `сначала отклони или заархивируй их — иначе они остались бы без родителя`,
      2,
    )
  applyOrFail(
    ctx,
    accept
      ? { type: 'acceptQuest', questId, ts: new Date().toISOString() }
      : { type: 'rejectQuest', questId },
    `«${quest.title}» не в статусе proposed (${quest.status})`,
  )
  ctx.io.out(accept ? `принят: ${quest.title}` : `отклонён: ${quest.title}`)
  return 0
}

function cmdArchive(ctx: Ctx, prefix: string | undefined, yes: boolean): number {
  if (!prefix) throw new CliError('использование: stargaze archive <questId> (алиас cancel; активный контракт — с --yes)', 2)
  const s = loadStore(ctx.storePath)
  const questId = resolveId(s.quests.filter((q) => q.status !== 'archived'), prefix, 'квест')
  const quest = s.quests.find((q) => q.id === questId)!
  // гейт дублируем ради перечня — ядро на архив эпика с детьми молча делает no-op
  const openChildren = s.quests.filter((c) => c.parentQuestId === questId && c.status === 'active')
  if (openChildren.length > 0)
    throw new CliError(
      `«${quest.title}» — эпик с активными подквестами:\n` +
        `${openChildren.map((c) => `  · ${c.id}  ${c.title}`).join('\n')}\n` +
        `сначала заверши или заархивируй их (force-варианта нет)`,
      2,
    )
  // цену показываем до согласия: списание необратимо (ledger append-only)
  const fee = quest.status === 'active' && quest.type !== 'repeating' ? cancelFeeFor(quest, ctx.today) : 0
  if (fee > 0 && !yes)
    throw new CliError(
      `отмена контракта «${quest.title}» спишет неустойку −${fee} ✨\n` +
        `подтверди: stargaze cancel ${questId} --yes (или перенеси дедлайн: stargaze move ${questId} <дата>)`,
      2,
    )
  applyOrFail(
    ctx,
    { type: 'archiveQuest', questId, day: ctx.today, ts: new Date().toISOString() },
    `«${quest.title}» не заархивирован`,
  )
  ctx.io.out(`в архив: ${quest.title}` + (fee > 0 ? ` · неустойка −${fee} ✨` : ''))
  return 0
}

function cmdWallet(ctx: Ctx): number {
  const s = loadStore(ctx.storePath)
  const balance = sparksBalance(s, ctx.today)
  const provisions = s.quests
    .map((q) => ({ q, p: provisionForQuest(q, ctx.today) }))
    .filter((x) => x.p > 0)
  const movesUsed = movesUsedIn7d(s, ctx.today)
  const events = [...(s.ledger ?? [])].reverse() // свежее сверху
  // undefined, а не '': иначе `??`-цепочка ниже остановилась бы на пустой строке
  const questTitle = (id?: string) => (id ? (s.quests.find((q) => q.id === id)?.title ?? id) : undefined)
  const itemTitle = (id?: string) => (id ? ((s.wishlist ?? []).find((w) => w.id === id)?.title ?? id) : undefined)
  const emission = { d7: emissionInDays(s, ctx.today, 7), d30: emissionInDays(s, ctx.today, 30) }
  if (ctx.json) {
    ctx.io.out(JSON.stringify({
      balance, ledgerTotal: ledgerTotal(s), provisionTotal: provisionTotal(s, ctx.today),
      provisions: provisions.map(({ q, p }) => ({ questId: q.id, title: q.title, provision: p, cap: q.xpReward })),
      moves: { used: movesUsed, free: FREE_MOVES_PER_7D },
      emission,
      ledger: events,
    }, null, 2))
    return 0
  }
  ctx.io.out(`✨ ${balance}` + (provisions.length ? ` (чистыми ${ledgerTotal(s)}, провизия −${provisionTotal(s, ctx.today)})` : ''))
  for (const { q, p } of provisions)
    ctx.io.out(`  капает: ${q.title} · −${p} ✨${p >= q.xpReward ? ' (потолок)' : ` (потолок ${q.xpReward})`}`)
  const quota = movesQuotaLine(movesUsed)
  if (quota) ctx.io.out(quota)
  ctx.io.out(`эмиссия: +${emission.d7} ✨ за 7 дней · +${emission.d30} ✨ за 30`)
  if (events.length > 0) {
    ctx.io.out('')
    ctx.io.out(table([
      ['день', 'тип', '✨', 'что'],
      ...events.map((e) => [
        e.day, LEDGER_KIND_LABEL[e.kind],
        (e.amount > 0 ? '+' : '') + String(e.amount),
        e.note ?? itemTitle(e.itemId) ?? questTitle(e.questId) ?? '',
      ]),
    ]))
  }
  return 0
}

function cmdMove(ctx: Ctx, prefix?: string, to?: string): number {
  if (!prefix || !to) throw new CliError('использование: stargaze move <questId> <YYYY-MM-DD>', 2)
  if (!isCalendarDay(to)) throw new CliError('дата: формат YYYY-MM-DD (календарная)', 2)
  const s = loadStore(ctx.storePath)
  const contracts = s.quests.filter((q) => q.status === 'active' && q.type !== 'repeating')
  const questId = resolveId(contracts, prefix, 'квест')
  const quest = s.quests.find((q) => q.id === questId)!
  if (!quest.dueDate) throw new CliError(`у «${quest.title}» нет дедлайна — переносить нечего`, 2)
  if (to < ctx.today) throw new CliError('перенос в прошлое запрещён', 2)
  if (to === quest.dueDate) throw new CliError(`дедлайн уже ${to}`, 2)
  const used = movesUsedIn7d(s, ctx.today)
  const fee = used >= FREE_MOVES_PER_7D ? moveFeeFor(quest) : 0
  const provision = provisionForQuest(quest, ctx.today)
  applyOrFail(ctx, { type: 'moveDueDate', questId, to, day: ctx.today, ts: new Date().toISOString() }, 'перенос не выполнен')
  const lines = [`дедлайн ${quest.dueDate} → ${to} · ${quest.title}`]
  if (provision > 0) lines.push(`долг −${provision} ✨ зафиксирован (переехал с датой)`)
  lines.push(fee > 0
    ? `платный перенос: −${fee} ✨`
    : `бесплатных осталось ${FREE_MOVES_PER_7D - used - 1} из ${FREE_MOVES_PER_7D} за 7 дней`)
  ctx.io.out(lines.join('\n'))
  return 0
}

function cmdBuy(ctx: Ctx, prefix?: string): number {
  if (!prefix) throw new CliError('использование: stargaze buy <itemId>', 2)
  const s = loadStore(ctx.storePath)
  const smalls = (s.wishlist ?? []).filter((w) => w.kind === 'small' && !w.archived)
  const itemId = resolveId(smalls, prefix, 'позиция')
  const item = smalls.find((w) => w.id === itemId)!
  if (item.price === undefined)
    throw new CliError(`у «${item.title}» нет цены — назначь: stargaze wishlist-edit ${item.id} --price <✨>`, 2)
  if (!item.repeatable) {
    const boughtDay = purchasedDays(s).get(itemId)
    if (boughtDay !== undefined)
      throw new CliError(`«${item.title}» уже куплена (${boughtDay}) — разовая награда; многоразовость: stargaze wishlist-edit ${item.id} --repeat`, 2)
  }
  const price = item.price
  const balance = sparksBalance(s, ctx.today)
  if (balance < price)
    throw new CliError(`не хватает искр: баланс ${balance}, цена ${price}`, 2)
  // opId свежий на каждый вызов: он гасит ретрай одной операции, а не повторную покупку
  applyOrFail(ctx, { type: 'purchaseItem', itemId, day: ctx.today, ts: new Date().toISOString(), opId: genId('op') }, 'покупка не прошла')
  ctx.io.out(`−${price} ✨ · ${item.title} · остаток ${balance - price}`)
  return 0
}

function cmdSpend(ctx: Ctx, amountArg: string | undefined, note: string): number {
  const amount = Number(amountArg)
  if (!amountArg || !Number.isInteger(amount) || amount <= 0)
    throw new CliError('использование: stargaze spend <искры> <на что>', 2)
  if (!note.trim()) throw new CliError('spend: нужна пометка «на что»', 2)
  const s = loadStore(ctx.storePath)
  const balance = sparksBalance(s, ctx.today)
  if (balance < amount) throw new CliError(`не хватает искр: баланс ${balance}`, 2)
  applyOrFail(ctx, { type: 'spendSparks', amount, note: note.trim(), day: ctx.today, ts: new Date().toISOString(), opId: genId('op') }, 'трата не прошла')
  ctx.io.out(`−${amount} ✨ · ${note.trim()} · остаток ${balance - amount}`)
  return 0
}

function cmdAdjust(ctx: Ctx, amountArg: string | undefined, note: string): number {
  const amount = Number(amountArg)
  if (!amountArg || !Number.isInteger(amount) || amount === 0)
    throw new CliError('использование: stargaze adjust -- <±искры> <причина> (отрицательное — после «--»)', 2)
  if (!note.trim()) throw new CliError('adjust: причина обязательна', 2)
  const s = applyOrFail(ctx, { type: 'adjustSparks', amount, note: note.trim(), day: ctx.today, ts: new Date().toISOString() }, 'корректировка не записана')
  ctx.io.out(`${amount > 0 ? '+' : ''}${amount} ✨ · ${note.trim()} · баланс ${sparksBalance(s, ctx.today)}`)
  return 0
}

function cmdWishlist(ctx: Ctx): number {
  const s = loadStore(ctx.storePath)
  const items = (s.wishlist ?? []).filter((w) => !w.archived)
  if (ctx.json) {
    ctx.io.out(JSON.stringify(items, null, 2))
    return 0
  }
  if (items.length === 0) {
    ctx.io.out('витрина пуста: stargaze wishlist-add --title … [--price …] (или --star <звезда>)')
    return 0
  }
  const skillName = (id?: string) => (id ? (s.skills.find((x) => x.id === id)?.name ?? '?') : '')
  const bought = purchasedDays(s)
  ctx.io.out(table([
    ['id', 'позиция', 'цена/якорь', 'статус'],
    ...items.map((w) => {
      const face = w.emoji ? `${w.emoji} ` : '' // картинка в таблицу не лезет — есть в --json
      if (w.kind === 'small') {
        const status = !w.repeatable && bought.has(w.id)
          ? `✔ куплено ${bought.get(w.id)}`
          : w.repeatable ? '↻' : ''
        return [w.id, face + w.title + (w.originalPrice ? ` · ${w.originalPrice}` : ''),
          w.price !== undefined ? `${w.price} ✨` : 'без цены', status]
      }
      const star = s.stars.find((c) => c.id === w.starId)
      return [
        w.id, face + w.title,
        star ? `${skillName(star.skillId)} · ${star.title} (${star.tier})` : `звезда ${w.starId} не найдена`,
        w.claimedAt ? `✦ получено ${w.claimedAt.slice(0, 10)}` : star?.litAt ? 'звезда зажжена — забирай (claim)' : 'звезда не зажжена',
      ]
    }),
  ]))
  return 0
}

function cmdWishlistAdd(ctx: Ctx, flags: CliFlags): number {
  const title = typeof flags.title === 'string' ? flags.title.trim() : ''
  const price = typeof flags.price === 'string' ? flags.price : undefined
  const star = typeof flags.star === 'string' ? flags.star : undefined
  const note = typeof flags.note === 'string' ? flags.note.trim() : undefined
  const url = typeof flags.url === 'string' ? flags.url.trim() : undefined
  const orig = typeof flags.orig === 'string' ? flags.orig.trim() : undefined
  const emoji = typeof flags.emoji === 'string' ? flags.emoji.trim() : undefined
  const image = typeof flags.image === 'string' ? flags.image.trim() : undefined
  if (!title) throw new CliError('wishlist-add: нужен --title', 2)
  if (price && star)
    throw new CliError('wishlist-add: либо --price <искры> (small), либо --star <звезда> (big) — не оба сразу', 2)
  if (star && flags.repeat)
    throw new CliError('--repeat только у small: big разовая по механике (claim по звезде)', 2)
  const s = loadStore(ctx.storePath)
  const extra = { ...(note ? { note } : {}), ...(url ? { sourceUrl: url } : {}), ...(orig ? { originalPrice: orig } : {}),
    ...(emoji ? { emoji } : {}), ...(image ? { imageUrl: image } : {}) }
  let item: WishlistItem
  if (star) {
    const starId = resolveId(s.stars, star, 'звезда')
    item = { id: genId('w'), title, kind: 'big', starId, ...extra, createdAt: new Date().toISOString() }
  } else {
    // без --price — small «без цены»: легальное «хочу», купить нельзя до wishlist-edit --price
    let p: number | undefined
    if (price) {
      p = Number(price)
      if (!Number.isInteger(p) || p <= 0) throw new CliError('--price: целое > 0', 2)
    }
    // без --repeat — разовая: купится один раз и отметится в «Наградах для себя»
    item = { id: genId('w'), title, kind: 'small', ...(p !== undefined ? { price: p } : {}),
      ...(flags.repeat ? { repeatable: true } : {}), ...extra, createdAt: new Date().toISOString() }
  }
  applyOrFail(ctx, { type: 'addWishlistItem', item }, 'позиция не добавлена: на эту звезду уже есть живая big-награда', 2)
  ctx.io.out(`в витрину: ${item.title} (${item.id})${item.kind === 'small' && item.price === undefined ? ' — без цены' : ''}`)
  return 0
}

function cmdWishlistEdit(ctx: Ctx, prefix: string | undefined, flags: CliFlags): number {
  if (!prefix)
    throw new CliError('использование: stargaze wishlist-edit <itemId> [--price N] [--title …] [--url …] [--orig …] [--emoji …] [--image …] [--note …] [--repeat|--once]', 2)
  const s = loadStore(ctx.storePath)
  const itemId = resolveId(s.wishlist ?? [], prefix, 'позиция')
  const prev = (s.wishlist ?? []).find((w) => w.id === itemId)!
  const next: WishlistItem = { ...prev }
  let touched = false
  if (typeof flags.title === 'string') {
    if (!flags.title.trim()) throw new CliError('--title: непустой', 2)
    next.title = flags.title.trim()
    touched = true
  }
  if (typeof flags.price === 'string') {
    if (prev.kind !== 'small') throw new CliError('--price только у small-позиции', 2)
    const p = Number(flags.price)
    if (!Number.isInteger(p) || p <= 0) throw new CliError('--price: целое > 0', 2)
    next.price = p
    touched = true
  }
  // пустое значение стирает поле: --url "" убирает ссылку
  const setOrClear = (key: 'note' | 'sourceUrl' | 'originalPrice' | 'emoji' | 'imageUrl', v: unknown) => {
    if (typeof v !== 'string') return
    if (v.trim()) next[key] = v.trim()
    else delete next[key]
    touched = true
  }
  setOrClear('note', flags.note)
  setOrClear('sourceUrl', flags.url)
  setOrClear('originalPrice', flags.orig)
  setOrClear('emoji', flags.emoji)
  setOrClear('imageUrl', flags.image)
  if (flags.repeat && flags.once) throw new CliError('--repeat и --once взаимоисключающие', 2)
  if (flags.repeat) {
    if (prev.kind !== 'small') throw new CliError('--repeat только у small: big разовая по механике', 2)
    next.repeatable = true
    touched = true
  }
  if (flags.once) {
    delete next.repeatable
    touched = true
  }
  if (!touched) throw new CliError('wishlist-edit: нечего менять — дай хотя бы один флаг', 2)
  applyOrFail(ctx, { type: 'updateWishlistItem', item: next }, 'позиция не обновлена (уже получена или битая форма)', 2)
  ctx.io.out(`обновлено: ${next.title} (${next.id})${next.kind === 'small' ? (next.price !== undefined ? ` · ${next.price} ✨` : ' · без цены') : ''}`)
  return 0
}

function cmdClaim(ctx: Ctx, prefix?: string): number {
  if (!prefix) throw new CliError('использование: stargaze claim <itemId>', 2)
  const s = loadStore(ctx.storePath)
  const bigs = (s.wishlist ?? []).filter((w) => w.kind === 'big')
  const itemId = resolveId(bigs, prefix, 'награда')
  const item = bigs.find((w) => w.id === itemId)!
  if (item.claimedAt) throw new CliError(`«${item.title}» уже получена (${item.claimedAt.slice(0, 10)})`, 2)
  // гейт дублируем ради внятного отказа — ядро на незажжённой звезде молча делает no-op
  const star = s.stars.find((c) => c.id === item.starId)
  if (!star) throw new CliError(`якорь-звезда ${item.starId} не найдена`, 2)
  if (!star.litAt) throw new CliError(`звезда «${star.title}» (${star.tier}) ещё не зажжена`, 2)
  applyOrFail(ctx, { type: 'claimReward', itemId, ts: new Date().toISOString() }, 'награда не получена')
  ctx.io.out(`✦ получено: ${item.title}`)
  return 0
}

function cmdLightStar(ctx: Ctx, prefix: string | undefined, evidence?: string): number {
  if (!prefix) throw new CliError('использование: stargaze light-star <starId> [--evidence "..."]', 2)
  const s = loadStore(ctx.storePath)
  const starId = resolveId(s.stars, prefix, 'звезда')
  const star = s.stars.find((c) => c.id === starId)!
  applyOrFail(
    ctx,
    { type: 'lightStar', starId, ts: new Date().toISOString(), evidence: evidence || undefined },
    `звезда «${star.title}» не зажжена: уже горит`,
  )
  ctx.io.out(`✦ ${star.title}`)
  return 0
}

function cmdAddStar(ctx: Ctx, flags: CliFlags): number {
  const skillPrefix = typeof flags.skill === 'string' ? flags.skill : undefined
  const title = typeof flags.title === 'string' ? flags.title : undefined
  const tier = typeof flags.tier === 'string' ? flags.tier : undefined
  const parentPrefix = typeof flags.parent === 'string' ? flags.parent : undefined
  const criteria = typeof flags.criteria === 'string' ? flags.criteria : undefined
  if (!skillPrefix || !title || !tier)
    throw new CliError(
      'использование: stargaze add-star --skill <id> --title <t> --tier <D|C|B|A|S> [--parent <starId>] [--criteria <c>]',
      2,
    )
  if (!TIERS.includes(tier as Tier)) throw new CliError('--tier: D|C|B|A|S', 2)
  const s = loadStore(ctx.storePath)
  const skillId = resolveId(s.skills, skillPrefix, 'навык')
  const parentStarId = parentPrefix ? resolveId(s.stars, parentPrefix, 'звезда') : null
  const star: StarComponent = {
    id: genId('c'),
    skillId,
    parentStarId,
    tier: tier as Tier,
    title,
    ...(criteria ? { criteria } : {}),
    createdAt: new Date().toISOString(),
  }
  applyOrFail(
    ctx,
    { type: 'addStar', star },
    'звезда не добавлена: проверь --skill и --parent (родитель должен принадлежать тому же навыку)',
    2,
  )
  ctx.io.out(`добавлена: ${star.title} (${star.id})`)
  return 0
}

export type { Ctx }
