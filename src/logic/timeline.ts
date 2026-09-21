import type { Skill, SkyStore, StarComponent } from '../types'
import type { Constellation, ConstellationNode } from './layout'
import { addDays } from './dates'
import { dayInGameTz } from './sparks'
import { isRankAchieved, skillTiers } from './stars'

// История неба выводится из нынешнего store: createdAt/litAt звёзд, createdAt навыков и
// day событий xpLog. Это приближение («сегодняшняя структура, отфильтрованная по времени»),
// не снимок: погашенные и удалённые звёзды, прежние названия и родители невосстановимы.
// Единица времени — игровой день 'YYYY-MM-DD' (UTC+7).

/** Навыки и звёзды, существовавшие на конец игрового дня `day`. */
function starsAsOf(skillsIn: Skill[], starsIn: StarComponent[], day: string): { skills: Skill[]; stars: StarComponent[] } {
  const skills = skillsIn.filter((s) => dayInGameTz(s.createdAt) <= day)
  const skillIds = new Set(skills.map((s) => s.id))
  const alive = starsIn.filter((s) => skillIds.has(s.skillId) && dayInGameTz(s.createdAt) <= day)
  const aliveIds = new Set(alive.map((s) => s.id))
  const byId = new Map(starsIn.map((s) => [s.id, s]))

  // Звезду могли перенести под более новую: в прошлом её держит ближайший существовавший
  // предок, иначе — ядро галактики. Дерево проекции всегда связное; цикл в данных обрывается.
  const survivingParent = (star: StarComponent): string | null => {
    const seen = new Set<string>([star.id])
    let parentId = star.parentStarId
    while (parentId !== null && !seen.has(parentId)) {
      if (aliveIds.has(parentId)) return parentId
      seen.add(parentId)
      parentId = byId.get(parentId)?.parentStarId ?? null
    }
    return null
  }

  const stars = alive.map((s): StarComponent => {
    const { litAt, evidence, ...rest } = s
    const base = { ...rest, parentStarId: survivingParent(s) }
    if (litAt === undefined || dayInGameTz(litAt) > day) return base
    return evidence === undefined ? { ...base, litAt } : { ...base, litAt, evidence }
  })
  return { skills, stars }
}

/** Небо на конец игрового дня `day`. Вход не мутируется; к результату применимы все обычные
 * селекторы (`isRankAchieved`, `galaxyStats`, `starProgress`, `skillXpTotal`, `charXpTotal`). */
export function skyAsOf(store: SkyStore, day: string): SkyStore {
  return {
    ...starsAsOf(store.skills, store.stars, day),
    // истории статусов квестов нет — «сделанность» на дату потребитель выводит из xpLog
    quests: store.quests.filter((q) => dayInGameTz(q.createdAt) <= day),
    // именно day, не ts: отметка привычки задним числом и её откат несут один day —
    // пара всегда по одну сторону среза
    xpLog: store.xpLog.filter((e) => e.day <= day),
  }
}

/** Созвездие прошлого в сегодняшних координатах. `full` — `layoutConstellation` по полному
 * сегодняшнему набору звёзд навыка, `pastStars` — звёзды навыка из `skyAsOf`. Позиции и depth
 * берутся из `full` (раскладка от времени не зависит), объекты `star` — из прошлого, рёбра — по
 * уже перепривязанному `parentStarId`. Форма результата та же: код отрисовки не меняется. */
export function constellationAsOf(full: Constellation, pastStars: StarComponent[]): Constellation {
  const pastById = new Map(pastStars.map((s) => [s.id, s]))
  const nodes: ConstellationNode[] = []
  const indexById = new Map<string, number>()
  for (const n of full.nodes) {
    const star = pastById.get(n.star.id)
    if (!star) continue
    indexById.set(star.id, nodes.length)
    nodes.push({ star, depth: n.depth, x: n.x, y: n.y })
  }
  // как в layoutConstellation: i-е ребро ведёт в i-й узел; -1 — от корня
  const edges = nodes.map((n, i): [number, number] => [
    n.star.parentStarId === null ? -1 : indexById.get(n.star.parentStarId) ?? -1,
    i,
  ])
  return { root: full.root, nodes, edges }
}

/** Первый день истории — нижняя граница ползунка. Без skillId: самый ранний из дней создания
 * неархивных навыков и их звёзд и дней событий xpLog. Со skillId: день создания этого навыка
 * (раньше галактики не существовало). null — истории нет или навыка нет. */
export function timelineBounds(store: SkyStore, skillId?: string): { first: string } | null {
  if (skillId !== undefined) {
    const skill = store.skills.find((s) => s.id === skillId)
    return skill ? { first: dayInGameTz(skill.createdAt) } : null
  }
  const live = store.skills.filter((s) => !s.archived)
  const liveIds = new Set(live.map((s) => s.id))
  const days = [
    ...live.map((s) => dayInGameTz(s.createdAt)),
    ...store.stars.filter((s) => liveIds.has(s.skillId)).map((s) => dayInGameTz(s.createdAt)),
    ...store.xpLog.map((e) => e.day),
  ]
  return days.length ? { first: days.reduce((a, b) => (a < b ? a : b)) } : null
}

/** Засечка полосы времени: зажжённая звезда или взятый ранг. */
export interface TimelineMark {
  day: string
  kind: 'star' | 'rank'
  skillId: string
  label: string
}

const laterDay = (a: string, b: string) => (a > b ? a : b)

/** Засечки неархивных навыков (или одного навыка), по возрастанию дня. День засечки — день,
 * когда событие становится видно в проекции `skyAsOf`. Ранг отмечается в день перехода
 * «не взят → взят»; кандидаты — только дни зажиганий: порог растёт лишь с добавлением звёзд,
 * стать взятым в другой день ранг не может. Брался, терялся и брался снова — засечек две. */
export function timelineMarks(store: SkyStore, skillId?: string): TimelineMark[] {
  const starMarks: TimelineMark[] = []
  const rankMarks: TimelineMark[] = []
  for (const skill of store.skills) {
    if (skill.archived || (skillId !== undefined && skill.id !== skillId)) continue
    const own = store.stars.filter((s) => s.skillId === skill.id)
    const skillDay = dayInGameTz(skill.createdAt)
    const litDays = new Set<string>()
    for (const s of own) {
      if (!s.litAt) continue
      const day = laterDay(laterDay(dayInGameTz(s.litAt), dayInGameTz(s.createdAt)), skillDay)
      litDays.add(day)
      starMarks.push({ day, kind: 'star', skillId: skill.id, label: s.title })
    }
    for (const day of [...litDays].sort()) {
      const now = starsAsOf([skill], own, day).stars
      const before = starsAsOf([skill], own, addDays(day, -1)).stars
      for (const tier of skillTiers(now, skill.id)) {
        if (isRankAchieved(now, skill.id, tier) && !isRankAchieved(before, skill.id, tier))
          rankMarks.push({ day, kind: 'rank', skillId: skill.id, label: `ранг ${tier} · ${skill.name}` })
      }
    }
  }
  // sort устойчив: в одном дне сначала звёзды, потом ранги
  return [...starMarks, ...rankMarks].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
}

/** Сводка полосы: звёзды неархивных навыков (на проекции — существовавшие на дату). */
export function skyTotals(sky: SkyStore): { starsLit: number; starsTotal: number } {
  const liveIds = new Set(sky.skills.filter((s) => !s.archived).map((s) => s.id))
  const stars = sky.stars.filter((s) => liveIds.has(s.skillId))
  return { starsLit: stars.filter((s) => !!s.litAt).length, starsTotal: stars.length }
}

const MONTH_NOM_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/** Подписи под дорожкой: первая — в день `first`, дальше — первые числа месяцев до `last`
 * включительно. Январь подписан годом. */
export function timelineMonths(first: string, last: string): { day: string; label: string }[] {
  if (first > last) return []
  const label = (key: string) => {
    const [y, m] = key.split('-').map(Number)
    return m === 1 ? String(y) : MONTH_NOM_SHORT[m - 1]
  }
  const out = [{ day: first, label: label(first) }]
  let [y, m] = first.split('-').map(Number)
  for (;;) {
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
    const day = `${y}-${String(m).padStart(2, '0')}-01`
    if (day > last) break
    out.push({ day, label: label(day) })
  }
  return out
}
