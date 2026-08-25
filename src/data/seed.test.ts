import { describe, expect, it } from 'vitest'
import { seedStore } from './seed'
import { validateStore } from '../logic/validate'
import { dayInGameTz } from '../logic/sparks'

describe('демо-сид', () => {
  it('версия 3 и валиден по validateStore', () => {
    const s = seedStore()
    expect(s.version).toBe(3)
    expect(validateStore(s)).toEqual([])
  })

  it('живое небо: 2–3 галактики с деревьями по 8–15 звёзд, есть зажжённые', () => {
    const s = seedStore()
    const bySkill = new Map<string, number>()
    for (const st of s.stars) bySkill.set(st.skillId, (bySkill.get(st.skillId) ?? 0) + 1)
    expect(bySkill.size).toBeGreaterThanOrEqual(2)
    expect(bySkill.size).toBeLessThanOrEqual(3)
    for (const n of bySkill.values()) {
      expect(n).toBeGreaterThanOrEqual(8)
      expect(n).toBeLessThanOrEqual(15)
    }
    expect(s.stars.filter((st) => st.litAt).length).toBeGreaterThanOrEqual(3)
  })

  it('hue навыков вне бренд-зоны 15–35', () => {
    for (const sk of seedStore().skills) expect(sk.hue < 15 || sk.hue > 35).toBe(true)
  })

  it('витрина механик: все типы квестов, карточка с DoD, вишлист трёх состояний', () => {
    const s = seedStore()
    expect(new Set(s.quests.map((q) => q.type))).toEqual(new Set(['repeating', 'short', 'mid', 'long']))
    expect(s.quests.some((q) => (q.definitionOfDone?.length ?? 0) > 0 && q.description && q.why)).toBe(true)
    const wl = s.wishlist ?? []
    expect(wl.some((w) => w.kind === 'small' && w.price !== undefined)).toBe(true)
    expect(wl.some((w) => w.kind === 'small' && w.price === undefined)).toBe(true)
    const big = wl.find((w) => w.kind === 'big')
    expect(big?.starId).toBeDefined()
    expect(s.stars.find((st) => st.id === big?.starId)?.litAt).toBeDefined()
  })

  it('дедлайны не в прошлом — демо не встречает пользователя просрочкой', () => {
    const s = seedStore()
    const today = dayInGameTz(new Date().toISOString())
    for (const q of s.quests) if (q.dueDate) expect(q.dueDate >= today).toBe(true)
  })
})
