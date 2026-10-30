import { describe, expect, it } from 'vitest'
import type { Quest, Skill, StarComponent, Store, WishlistItem } from '../types'
import { pickQuest, pickSkill, pickStar, pickWishlistItem } from './entityKeys'
import { reducer } from './store'
import { validateStore } from './validate'

const T0 = '2026-10-01T00:00:00.000Z'

/** Объект с лишними ключами — как его присылает агент (типом это не выразить). */
const withExtra = <T>(x: T, extra: Record<string, unknown>): T => ({ ...x, ...extra }) as T
/** Ровно то, что печатает `stargaze quest <эпик> --json`: квест + вычисляемые поля. */
const questJson = (q: Quest, children: string[]): Quest =>
  withExtra(q, { children, progress: { done: 0, total: children.length } })

const skill: Skill = { id: 's1', emoji: '🎯', name: 'Тайский', wantStatement: 'говорить', hue: 200, archived: false, createdAt: T0 }
const star: StarComponent = { id: 'c1', skillId: 's1', parentStarId: null, tier: 'D', title: 'Алфавит', createdAt: T0 }
const epic: Quest = {
  id: 'q_epic', title: 'Карта набора', type: 'mid', skillId: 's1', starId: null, parentQuestId: null,
  xpReward: 50, dueDate: '2026-11-10', status: 'active', createdAt: T0,
}
const child: Quest = {
  id: 'q_child', title: 'Выбрать сегмент', type: 'short', skillId: 's1', parentQuestId: 'q_epic',
  xpReward: 10, dueDate: '2026-11-05', status: 'active', createdAt: T0,
}
const base = (over: Partial<Store> = {}): Store => ({
  version: 4, character: { name: 'И', avatar: '🧙' },
  skills: [skill], stars: [star], quests: [epic, child], xpLog: [], ...over,
})

// Required<…> — компайл-проверка и в тесте: новое поле типа без строки здесь не соберётся
const fullQuest: Required<Quest> = {
  id: 'q_full', title: 'Всё сразу', type: 'long', skillId: 's1', starId: 'c1', parentQuestId: 'q_epic',
  xpReward: 80, dueDate: '2026-12-01', status: 'proposed', proposalNote: 'под звезду',
  description: 'подробно', why: 'зачем', definitionOfDone: [{ text: 'А', done: true }, { text: 'Б' }],
  resources: [{ title: 'Док', url: 'https://doc' }, { title: 'Без ссылки' }],
  result: { summary: 'итог', artifactUrl: 'https://a', evidence: '7 ответов' },
  resultHistory: [{ summary: 'раньше', cancelledAt: 'T1' }],
  dueDateHistory: [{ from: '2026-11-20', to: '2026-12-01', day: '2026-10-20', ts: 'T2', fee: 5 }],
  acceptedAt: 'T3', archivedAt: 'T4', createdAt: T0,
}
const fullSkill: Required<Skill> = { ...skill, id: 's_full', lore: 'школа', glyphId: 'g1' }
const fullStar: Required<StarComponent> = {
  ...star, id: 'c_full', parentStarId: 'c1', tier: 'C', criteria: 'прочитать вывеску', xpTarget: 100,
  litAt: 'T5', evidence: 'прочитал',
}
const fullItem: Required<WishlistItem> = {
  id: 'w_full', title: 'Кофе', kind: 'small', price: 30, repeatable: true, starId: 'c1',
  sourceUrl: 'https://shop', originalPrice: '2800 ฿', emoji: '☕', imageUrl: 'https://img', note: 'заметка',
  claimedAt: 'T6', archived: false, createdAt: T0,
}

describe('белый список ключей: pick*', () => {
  it('все известные поля, включая редкие необязательные, сохраняются', () => {
    expect(pickQuest(fullQuest)).toEqual(fullQuest)
    expect(pickSkill(fullSkill)).toEqual(fullSkill)
    expect(pickStar(fullStar)).toEqual(fullStar)
    expect(pickWishlistItem(fullItem)).toEqual(fullItem)
  })

  it('лишние ключи отбрасываются, null сохраняется, ключей со значением undefined нет', () => {
    const q = pickQuest(withExtra({ ...epic, description: undefined }, { children: ['x'], progress: {}, junk: 1 }))
    expect(q).toEqual(epic)
    expect(Object.keys(q)).toEqual(Object.keys(epic)) // порядок — как в payload
    expect(q.parentQuestId).toBeNull()
    expect('description' in q).toBe(false)
  })

  it('daysOfWeek проходит насквозь — 422 от валидатора, а не молчаливая потеря расписания', () => {
    const q = pickQuest(withExtra(epic, { daysOfWeek: [2, 4] }))
    expect((q as unknown as Record<string, unknown>).daysOfWeek).toEqual([2, 4])
  })

  it('__proto__ из JSON payload не переносится и прототип не подменяет', () => {
    const q = pickQuest(JSON.parse(`{"id":"q1","title":"К","__proto__":{"status":"done"}}`) as Quest)
    expect(Object.keys(q)).toEqual(['id', 'title'])
    expect(Object.getPrototypeOf(q)).toBe(Object.prototype)
    expect(q.status).toBeUndefined()
  })

  it('не объект возвращается как есть — форму отсекает граница API или validateStore', () => {
    expect(pickQuest(undefined as unknown as Quest)).toBeUndefined()
    expect(pickQuest(null as unknown as Quest)).toBeNull()
  })
})

describe('редьюсер: лишние поля payload не оседают в store', () => {
  const find = (s: Store, id: string) => s.quests.find((q) => q.id === id)!

  it('updateQuest объектом из `quest --json` эпика: children/progress в store нет', () => {
    const s = reducer(base(), { type: 'updateQuest', quest: { ...questJson(epic, ['q_child']), title: 'Карта v2' } })
    expect(find(s, 'q_epic')).toEqual({ ...epic, title: 'Карта v2' })
    expect(validateStore(s)).toEqual([])
  })

  it('addQuest и proposeQuest с лишними полями кладут только поля Quest', () => {
    const added = reducer(base(), { type: 'addQuest', quest: questJson({ ...epic, id: 'q_new' }, []) })
    expect(find(added, 'q_new')).toEqual({ ...epic, id: 'q_new' })
    const prop = { ...epic, id: 'q_prop', status: 'proposed' as const, proposalNote: 'идея' }
    const proposed = reducer(base(), { type: 'proposeQuest', quest: questJson(prop, ['q_child']) })
    expect(find(proposed, 'q_prop')).toEqual(prop)
  })

  it('addQuest и updateQuest сохраняют все известные поля', () => {
    const added = reducer(base(), { type: 'addQuest', quest: questJson(fullQuest, []) })
    expect(find(added, 'q_full')).toEqual(fullQuest)
    // proposed не заморожен: из prev берутся только поля, которые пишет редьюсер
    const updated = reducer(added, { type: 'updateQuest', quest: { ...questJson(fullQuest, []), title: 'Новое' } })
    expect(find(updated, 'q_full')).toEqual({ ...fullQuest, title: 'Новое' })
  })

  it('updateQuest: заморозка полей не сломана, лишнее отброшено', () => {
    const prev: Quest = {
      ...epic, acceptedAt: 'T1',
      resultHistory: [{ summary: 'раньше', cancelledAt: 'T2' }],
      dueDateHistory: [{ from: '2026-11-01', to: '2026-11-10', day: '2026-10-20', ts: 'T3' }],
    }
    const s = reducer(base({ quests: [prev, child] }), {
      type: 'updateQuest',
      quest: questJson({
        ...prev, title: 'Новое', description: 'текст',
        status: 'done', xpReward: 999, type: 'short', createdAt: 'T9', dueDate: '2027-01-01',
        resultHistory: [], dueDateHistory: [], acceptedAt: 'подделка', archivedAt: 'подделка',
      }, ['q_child']),
    })
    expect(find(s, 'q_epic')).toEqual({ ...prev, title: 'Новое', description: 'текст' })
  })

  it('updateQuest: поля редьюсера, которых нет у prev, не появляются и не висят undefined-ключами', () => {
    const s = reducer(base(), {
      type: 'updateQuest',
      quest: { ...epic, resultHistory: [{ summary: 'x', cancelledAt: 'T' }], acceptedAt: 'T', archivedAt: 'T' },
    })
    const q = find(s, 'q_epic')
    for (const k of ['resultHistory', 'dueDateHistory', 'acceptedAt', 'archivedAt']) expect(k in q).toBe(false)
  })

  it('старый мусор в store вычищается следующим updateQuest', () => {
    const polluted = questJson(epic, ['q_child'])
    const s0 = base({ quests: [polluted, child] })
    expect(validateStore(s0)).toEqual([]) // валидатор не ужесточён: чужой store с мусором читается
    // правка чистым объектом
    expect(find(reducer(s0, { type: 'updateQuest', quest: { ...epic, title: 'А' } }), 'q_epic'))
      .toEqual({ ...epic, title: 'А' })
    // и тем же грязным объектом назад (`quests --json` печатает store как есть)
    expect(find(reducer(s0, { type: 'updateQuest', quest: { ...polluted, title: 'Б' } }), 'q_epic'))
      .toEqual({ ...epic, title: 'Б' })
  })

  it('addQuest с daysOfWeek по-прежнему не проходит validateStore', () => {
    const s = reducer(base(), { type: 'addQuest', quest: withExtra({ ...epic, id: 'q_old' }, { daysOfWeek: [1] }) })
    expect(validateStore(s).join()).toMatch(/daysOfWeek — поле удалено в v4/)
  })

  it('addSkill/updateSkill: вычисляемые поля из `skills --json` отбрасываются, lore/glyphId живут', () => {
    const computed = { level: 3, into: 10, toNext: 200, ranks: { total: 2, achieved: 1 } }
    const added = reducer(base(), { type: 'addSkill', skill: withExtra(fullSkill, computed) })
    expect(added.skills.find((x) => x.id === 's_full')).toEqual(fullSkill)
    const polluted = base({ skills: [withExtra(skill, computed)] })
    const updated = reducer(polluted, { type: 'updateSkill', skill: { ...skill, name: 'Тайский язык' } })
    expect(updated.skills[0]).toEqual({ ...skill, name: 'Тайский язык' })
  })

  it('updateSkill: archived/createdAt из payload не берутся — архив только через archiveSkill', () => {
    const s = base()
    const hidden = reducer(s, { type: 'updateSkill', skill: { ...skill, name: 'Новое', archived: true, createdAt: 'T9' } })
    expect(hidden.skills[0]).toEqual({ ...skill, name: 'Новое' })
    const archived = base({ skills: [{ ...skill, archived: true }] })
    expect(reducer(archived, { type: 'updateSkill', skill: { ...skill, archived: false } }).skills[0].archived).toBe(true)
  })

  it('updateSkill чужого id — тот же store', () => {
    const s = base()
    expect(reducer(s, { type: 'updateSkill', skill: { ...skill, id: 'нет-такого' } })).toBe(s)
  })

  it('addStar/updateStar: лишнее отбрасывается, все поля и заморозка skillId/litAt/evidence на месте', () => {
    const added = reducer(base(), { type: 'addStar', star: withExtra(fullStar, { lit: true }) })
    expect(added.stars.find((c) => c.id === 'c_full')).toEqual(fullStar)
    const updated = reducer(added, {
      type: 'updateStar',
      star: withExtra({ ...fullStar, title: 'Новое', skillId: 'чужой', litAt: undefined, evidence: undefined }, { lit: false }),
    })
    expect(updated.stars.find((c) => c.id === 'c_full')).toEqual({ ...fullStar, title: 'Новое' })
    // у незажжённой звезды litAt/evidence не появляются undefined-ключами; старый мусор уходит
    const polluted = base({ stars: [withExtra(star, { lit: false })] })
    const clean = reducer(polluted, { type: 'updateStar', star: { ...star, criteria: 'к' } }).stars[0]
    expect(clean).toEqual({ ...star, criteria: 'к' })
    expect('litAt' in clean || 'evidence' in clean).toBe(false)
  })

  it('addWishlistItem/updateWishlistItem: лишнее отбрасывается, все поля и заморозка на месте', () => {
    const { starId: _s, claimedAt: _c, archived: _a, ...small } = fullItem
    const big: WishlistItem = { id: 'w_big', title: 'Курс', kind: 'big', starId: 'c1', emoji: '🎓', note: 'n', createdAt: T0 }
    let s = reducer(base(), { type: 'addWishlistItem', item: withExtra(small, { bought: '2026-10-01' }) })
    s = reducer(s, { type: 'addWishlistItem', item: withExtra(big, { lit: false }) })
    expect(s.wishlist).toEqual([small, big])
    // claimedAt — поле типа: отбор его не снимает, гейт формы по-прежнему отвергает подделку
    const forged = base()
    expect(reducer(forged, { type: 'addWishlistItem', item: { ...big, claimedAt: 'T' } })).toBe(forged)
    // kind/createdAt/archived — из prev; старый мусор уходит той же правкой
    const prev = withExtra({ ...small, archived: true }, { bought: '2026-10-01' })
    const updated = reducer(base({ wishlist: [prev] }), {
      type: 'updateWishlistItem',
      item: withExtra({ ...small, title: 'Чай', kind: 'big', createdAt: 'T9', archived: false }, { bought: 'x' }),
    })
    expect(updated.wishlist).toEqual([{ ...small, title: 'Чай', archived: true }])
  })
})
