import { describe, expect, it } from 'vitest'
import type { Quest, QuestResult, Skill, StarComponent, Store, Tier } from '../types'
import { reducer, type Action } from './store'

const base = (): Store => ({
  version: 3,
  character: { name: 'И', avatar: 'X' },
  skills: [{ id: 's1', emoji: '✨', name: 'Тайский', wantStatement: '', hue: 200, archived: false, createdAt: 'T0' }],
  stars: [],
  quests: [],
  xpLog: [],
})
const skill = (id: string): Skill => ({
  id, emoji: '🎯', name: `Навык ${id}`, wantStatement: '', hue: 200, archived: false, createdAt: 'T0',
})
const star = (id: string, tier: Tier, parentStarId: string | null = null): StarComponent =>
  ({ id, skillId: 's1', parentStarId, tier, title: 'Звезда', createdAt: 'T0' })
const quest = (id: string, starId: string | null): Quest => ({
  id, title: 'К', type: 'repeating', skillId: 's1', starId, xpReward: 10, status: 'active', createdAt: 'T0',
})

const withStars = (...stars: StarComponent[]): Store => ({ ...base(), stars })

describe('звёзды', () => {
  it('addStar добавляет корневую звезду существующего навыка', () => {
    const s = reducer(base(), { type: 'addStar', star: star('a', 'D') })
    expect(s.stars).toHaveLength(1)
  })

  it('addStar добавляет дочернюю звезду с совпадающим skillId родителя', () => {
    let s = reducer(base(), { type: 'addStar', star: star('a', 'D') })
    s = reducer(s, { type: 'addStar', star: star('b', 'C', 'a') })
    expect(s.stars).toHaveLength(2)
  })

  it('addStar: несуществующий skillId — no-op', () => {
    const s = base()
    expect(reducer(s, { type: 'addStar', star: { ...star('a', 'D'), skillId: 'нет' } })).toBe(s)
  })

  it('addStar: родитель другого навыка — no-op', () => {
    const s = { ...withStars(star('a', 'D')), skills: [skill('s1'), skill('s2')] }
    const next = reducer(s, { type: 'addStar', star: { ...star('b', 'C', 'a'), skillId: 's2' } })
    expect(next).toBe(s)
  })

  it('addStar: битый parentStarId — no-op', () => {
    const s = withStars()
    expect(reducer(s, { type: 'addStar', star: star('b', 'C', 'нет') })).toBe(s)
  })

  it('lightStar ставит litAt/evidence', () => {
    const s = withStars(star('a', 'D'))
    const next = reducer(s, { type: 'lightStar', starId: 'a', ts: 'T1', evidence: 'сдал' })
    expect(next.stars[0].litAt).toBe('T1')
    expect(next.stars[0].evidence).toBe('сдал')
  })

  it('lightStar: гейта больше нет — зажигается при незажжённом родителе', () => {
    const s = withStars(star('a', 'D'), star('b', 'C', 'a'))
    const next = reducer(s, { type: 'lightStar', starId: 'b', ts: '2026-07-16T00:00:00.000Z', evidence: 'пробежал' })
    expect(next.stars.find((c) => c.id === 'b')?.litAt).toBe('2026-07-16T00:00:00.000Z')
  })

  it('lightStar: повторное зажигание — no-op (как раньше)', () => {
    const lit = { ...star('a', 'D'), litAt: '2026-07-01T00:00:00.000Z' }
    const s = withStars(lit)
    expect(reducer(s, { type: 'lightStar', starId: 'a', ts: '2026-07-16T00:00:00.000Z' })).toBe(s)
  })

  it('unlightStar гасит (компенсация ошибки)', () => {
    let s = reducer(withStars(star('a', 'D')), { type: 'lightStar', starId: 'a', ts: 'T1', evidence: 'e' })
    s = reducer(s, { type: 'unlightStar', starId: 'a' })
    expect(s.stars[0].litAt).toBeUndefined()
    expect(s.stars[0].evidence).toBeUndefined()
  })

  it('updateStar не может менять skillId/litAt/evidence (только lightStar/unlightStar)', () => {
    let s = reducer(withStars(star('a', 'D')), { type: 'lightStar', starId: 'a', ts: 'T1', evidence: 'e' })
    s = reducer(s, {
      type: 'updateStar',
      star: { ...s.stars[0], title: 'Новое имя', skillId: 'чужой', litAt: undefined, evidence: undefined },
    })
    expect(s.stars[0].title).toBe('Новое имя')
    expect(s.stars[0].skillId).toBe('s1')
    expect(s.stars[0].litAt).toBe('T1')
    expect(s.stars[0].evidence).toBe('e')
  })

  it('updateStar: перенос под собственного потомка (цикл) — no-op', () => {
    const s = withStars(star('a', 'D'), star('b', 'C', 'a'))
    expect(reducer(s, { type: 'updateStar', star: { ...star('a', 'D', 'b') } })).toBe(s)
  })

  it('updateStar: перенос под самого себя — no-op', () => {
    const s = withStars(star('a', 'D'))
    expect(reducer(s, { type: 'updateStar', star: { ...star('a', 'D', 'a') } })).toBe(s)
  })

  it('updateStar: новый родитель из другого навыка — no-op', () => {
    const s = { ...withStars(star('a', 'D'), { ...star('x', 'D'), skillId: 's2' }), skills: [skill('s1'), skill('s2')] }
    expect(reducer(s, { type: 'updateStar', star: { ...star('a', 'D', 'x') } })).toBe(s)
  })

  it('updateStar: несуществующая звезда — no-op', () => {
    const s = withStars(star('a', 'D'))
    expect(reducer(s, { type: 'updateStar', star: star('нет', 'D') })).toBe(s)
  })

  it('removeStar: у звезды есть дети — no-op', () => {
    const s = withStars(star('a', 'D'), star('b', 'C', 'a'))
    expect(reducer(s, { type: 'removeStar', starId: 'a' })).toBe(s)
  })

  it('removeStar: нельзя зажжённую или с привязанным квестом', () => {
    let s = { ...withStars(star('a', 'D')), quests: [quest('q1', 'a')] }
    expect(reducer(s, { type: 'removeStar', starId: 'a' }).stars).toHaveLength(1)
    s = { ...s, quests: [] }
    s = reducer(s, { type: 'lightStar', starId: 'a', ts: 'T1' })
    expect(reducer(s, { type: 'removeStar', starId: 'a' }).stars).toHaveLength(1)
    s = reducer(s, { type: 'unlightStar', starId: 'a' })
    expect(reducer(s, { type: 'removeStar', starId: 'a' }).stars).toHaveLength(0)
  })
})

describe('proposed-квесты', () => {
  const base = (): Store => ({
    version: 3,
    character: { name: 'Тест', avatar: '🧙' },
    skills: [{ id: 'sk1', emoji: '🇹🇭', name: 'Тайский', wantStatement: '', hue: 30, archived: false, createdAt: '2026-07-01T00:00:00.000Z' }],
    stars: [],
    quests: [],
    xpLog: [],
  })
  const prop = (over: Partial<Quest> = {}): Quest => ({
    id: 'qp1', title: 'Предложение', type: 'repeating', skillId: 'sk1', xpReward: 10,
    status: 'proposed', proposalNote: 'под текущую звезду-цель', createdAt: '2026-07-07T00:00:00.000Z', ...over,
  })

  it('proposeQuest добавляет квест со статусом proposed', () => {
    const s = reducer(base(), { type: 'proposeQuest', quest: prop() })
    expect(s.quests).toHaveLength(1)
    expect(s.quests[0].status).toBe('proposed')
  })
  it('proposeQuest игнорирует квест с не-proposed статусом', () => {
    const s = reducer(base(), { type: 'proposeQuest', quest: prop({ status: 'active' }) })
    expect(s.quests).toHaveLength(0)
  })
  it('proposeQuest игнорирует несуществующий skillId', () => {
    const s = reducer(base(), { type: 'proposeQuest', quest: prop({ skillId: 'нет-такого' }) })
    expect(s.quests).toHaveLength(0)
  })
  it('proposeQuest игнорирует несуществующий starId', () => {
    const s = reducer(base(), { type: 'proposeQuest', quest: prop({ starId: 'нет-такой' }) })
    expect(s.quests).toHaveLength(0)
  })
  it('acceptQuest: proposed → active', () => {
    const s0 = reducer(base(), { type: 'proposeQuest', quest: prop() })
    const s = reducer(s0, { type: 'acceptQuest', questId: 'qp1', ts: 'T1' })
    expect(s.quests[0].status).toBe('active')
  })
  it('acceptQuest снимает proposalNote при принятии', () => {
    const s0 = reducer(base(), { type: 'proposeQuest', quest: prop() })
    const s = reducer(s0, { type: 'acceptQuest', questId: 'qp1', ts: 'T1' })
    const q = s.quests[0]
    expect(q.proposalNote).toBeUndefined()
    expect('proposalNote' in q).toBe(false)
  })
  it('acceptQuest на активном квесте — no-op', () => {
    const s0 = { ...base(), quests: [prop({ status: 'active', proposalNote: undefined })] }
    expect(reducer(s0, { type: 'acceptQuest', questId: 'qp1', ts: 'T1' })).toBe(s0)
  })
  it('rejectQuest удаляет proposed', () => {
    const s0 = reducer(base(), { type: 'proposeQuest', quest: prop() })
    const s = reducer(s0, { type: 'rejectQuest', questId: 'qp1' })
    expect(s.quests).toHaveLength(0)
  })
  it('rejectQuest на done — no-op', () => {
    const s0 = { ...base(), quests: [prop({ status: 'done', proposalNote: undefined })] }
    expect(reducer(s0, { type: 'rejectQuest', questId: 'qp1' })).toBe(s0)
  })
  it('rejectQuest эпика-предложения с ребёнком — no-op', () => {
    // reject физически удаляет квест: у ребёнка остался бы висячий parentQuestId,
    // и validateStore развалил бы стор на следующей загрузке
    const s0 = {
      ...base(),
      quests: [
        prop({ id: 'qp_epic', type: 'mid' }),
        prop({ id: 'qp_child', type: 'short', parentQuestId: 'qp_epic' }),
      ],
    }
    expect(reducer(s0, { type: 'rejectQuest', questId: 'qp_epic' })).toBe(s0)
  })
  it('rejectQuest ребёнка-предложения — работает, родитель остаётся', () => {
    const s0 = {
      ...base(),
      quests: [
        prop({ id: 'qp_epic', type: 'mid' }),
        prop({ id: 'qp_child', type: 'short', parentQuestId: 'qp_epic' }),
      ],
    }
    const s = reducer(s0, { type: 'rejectQuest', questId: 'qp_child' })
    expect(s.quests.map((q) => q.id)).toEqual(['qp_epic'])
  })
  it('completeQuest на proposed — no-op, событий нет', () => {
    const s0 = reducer(base(), { type: 'proposeQuest', quest: prop() })
    const s = reducer(s0, { type: 'completeQuest', questId: 'qp1', day: '2026-07-07', ts: '2026-07-07T10:00:00.000Z' })
    expect(s).toBe(s0)
    expect(s.xpLog).toHaveLength(0)
  })
  it('archiveQuest снимает proposalNote при архивировании proposed-квеста', () => {
    const s0 = reducer(base(), { type: 'proposeQuest', quest: prop() })
    const s = reducer(s0, { type: 'archiveQuest', questId: 'qp1', day: '2026-07-07', ts: 'T1' })
    const q = s.quests[0]
    expect(q.status).toBe('archived')
    expect('proposalNote' in q).toBe(false)
  })
  it('archiveSkill снимает proposalNote у proposed-квестов архивируемого навыка', () => {
    const s0 = reducer(base(), { type: 'proposeQuest', quest: prop() })
    const s = reducer(s0, { type: 'archiveSkill', skillId: 'sk1' })
    const q = s.quests[0]
    expect(q.status).toBe('archived')
    expect('proposalNote' in q).toBe(false)
  })
})

describe('карточка квеста: завершение с result', () => {
  const short = (): Quest => ({
    id: 'q1', title: 'Карта набора', type: 'short', skillId: null,
    xpReward: 50, status: 'active', createdAt: '2026-07-22T00:00:00.000Z',
  })
  const base = (): Store => ({
    version: 3,
    character: { name: 'И', avatar: 'X' },
    skills: [],
    stars: [],
    quests: [short()],
    xpLog: [],
  })
  const complete = (s: Store, result?: QuestResult) =>
    reducer(s, { type: 'completeQuest', questId: 'q1', day: '2026-07-22', ts: 'T', result })

  it('short без result — no-op', () => {
    const s = base()
    expect(complete(s)).toBe(s)
  })

  it('short с пустым summary — no-op', () => {
    const s = base()
    expect(complete(s, { summary: '   ' })).toBe(s)
  })

  it('short с result — done, result нормализован и записан, XP-событие есть', () => {
    const next = complete(base(), { summary: ' Выбран сегмент ', artifactUrl: 'https://x', evidence: '7 ответов' })
    const q = next.quests[0]
    expect(q.status).toBe('done')
    expect(q.result).toEqual({ summary: 'Выбран сегмент', artifactUrl: 'https://x', evidence: '7 ответов' })
    expect(next.xpLog).toHaveLength(1)
    expect(next.xpLog[0].amount).toBe(50)
  })

  it('short с result без artifactUrl/evidence — эти ключи не записываются', () => {
    const next = complete(base(), { summary: 'Итог' })
    const q = next.quests[0]
    expect(q.result).toEqual({ summary: 'Итог' })
    expect(q.result && 'artifactUrl' in q.result).toBe(false)
  })

  it('repeating завершается без result, payload игнорируется', () => {
    const s: Store = { ...base(), quests: [{ ...short(), type: 'repeating' }] }
    const next = reducer(s, {
      type: 'completeQuest', questId: 'q1', day: '2026-07-22', ts: 'T', result: { summary: 'x' },
    })
    expect(next.xpLog).toHaveLength(1)
    expect(next.quests[0].result).toBeUndefined()
    expect(next.quests[0].status).toBe('active')
  })

  it('uncomplete возвращает active и очищает result', () => {
    const withDone = complete(base(), { summary: 'Итог' })
    const back = reducer(withDone, { type: 'uncompleteQuest', questId: 'q1', day: '2026-07-22', ts: 'T2' })
    expect(back.quests[0].status).toBe('active')
    expect(back.quests[0].result).toBeUndefined()
    expect('result' in back.quests[0]).toBe(false)
  })

  it('updateQuest может дополнить result у done-квеста', () => {
    const withDone = complete(base(), { summary: 'Итог' })
    const edited = reducer(withDone, {
      type: 'updateQuest',
      quest: { ...withDone.quests[0], result: { summary: 'Итог', artifactUrl: 'https://a' } },
    })
    expect(edited.quests[0].result?.artifactUrl).toBe('https://a')
  })
})

describe('карточка квеста: DoD-гейт и история итогов', () => {
  const dodQuest = (): Quest => ({
    id: 'q1', title: 'Карта', type: 'short', skillId: null, xpReward: 50,
    status: 'active', createdAt: 'T0',
    definitionOfDone: [{ text: 'Пункт А', done: true }, { text: 'Пункт Б' }, { text: 'Пункт В' }],
  })
  const base = (q: Quest = dodQuest()): Store => ({
    version: 3, character: { name: 'И', avatar: 'X' }, skills: [], stars: [], quests: [q], xpLog: [],
  })
  const complete = (s: Store, result?: QuestResult, force?: boolean) =>
    reducer(s, { type: 'completeQuest', questId: 'q1', day: '2026-07-22', ts: 'T1', result, force })

  it('незакрытый DoD блокирует завершение даже с валидным result', () => {
    const s = base()
    expect(complete(s, { summary: 'Итог' })).toBe(s)
  })

  it('force завершает и записывает пропущенные пункты в result.skippedDod', () => {
    const next = complete(base(), { summary: 'Итог' }, true)
    const q = next.quests[0]
    expect(q.status).toBe('done')
    expect(q.result?.skippedDod).toEqual(['Пункт Б', 'Пункт В'])
    expect(next.xpLog).toHaveLength(1)
  })

  it('полностью закрытый DoD завершается без force, skippedDod нет', () => {
    const q = { ...dodQuest(), definitionOfDone: [{ text: 'А', done: true }, { text: 'Б', done: true }] }
    const next = complete(base(q), { summary: 'Итог' })
    expect(next.quests[0].status).toBe('done')
    expect(next.quests[0].result?.skippedDod).toBeUndefined()
  })

  it('skippedDod из payload игнорируется — авторитет у редьюсера', () => {
    const q = { ...dodQuest(), definitionOfDone: [{ text: 'А', done: true }] }
    const next = complete(base(q), { summary: 'Итог', skippedDod: ['выдумка'] })
    expect(next.quests[0].result?.skippedDod).toBeUndefined()
  })

  it('квест без DoD завершается без force как раньше', () => {
    const q: Quest = { ...dodQuest(), definitionOfDone: undefined }
    const next = complete(base(q), { summary: 'Итог' })
    expect(next.quests[0].status).toBe('done')
  })

  it('uncomplete переносит result в resultHistory с cancelledAt', () => {
    const done1 = complete(base(), { summary: 'Первая попытка' }, true)
    const back = reducer(done1, { type: 'uncompleteQuest', questId: 'q1', day: '2026-07-22', ts: 'T2' })
    const q = back.quests[0]
    expect(q.status).toBe('active')
    expect(q.result).toBeUndefined()
    expect(q.resultHistory).toHaveLength(1)
    expect(q.resultHistory![0].summary).toBe('Первая попытка')
    expect(q.resultHistory![0].cancelledAt).toBe('T2')
  })

  it('повторный цикл наращивает историю, текущий result отдельно', () => {
    let s = complete(base(), { summary: 'Первая' }, true)
    s = reducer(s, { type: 'uncompleteQuest', questId: 'q1', day: '2026-07-22', ts: 'T2' })
    s = reducer(s, { type: 'completeQuest', questId: 'q1', day: '2026-07-23', ts: 'T3', result: { summary: 'Вторая' }, force: true })
    s = reducer(s, { type: 'uncompleteQuest', questId: 'q1', day: '2026-07-23', ts: 'T4' })
    const q = s.quests[0]
    expect(q.resultHistory?.map((r) => r.summary)).toEqual(['Первая', 'Вторая'])
    expect(q.result).toBeUndefined()
  })
})

describe('подквесты (эпик с детьми)', () => {
  const mq = (id: string, over: Partial<Quest> = {}): Quest => ({
    id, title: `Квест ${id}`, type: 'mid', skillId: 's1', starId: null, xpReward: 10,
    status: 'active', createdAt: `T-${id}`, ...over,
  })
  const withQuests = (...quests: Quest[]): Store => ({ ...base(), quests })
  const doneAction = (questId: string, force?: boolean): Action => ({
    type: 'completeQuest', questId, day: '2026-07-29', ts: 'T1', result: { summary: 'итог' }, ...(force ? { force: true } : {}),
  })

  it('completeQuest эпика с active-ребёнком — no-op даже с валидным result', () => {
    const s = withQuests(mq('p'), mq('c', { parentQuestId: 'p' }))
    expect(reducer(s, doneAction('p'))).toBe(s)
  })

  it('proposed-дети не блокируют завершение', () => {
    const s = withQuests(mq('p'), mq('c', { parentQuestId: 'p', status: 'proposed', proposalNote: 'n' }))
    const next = reducer(s, doneAction('p'))
    expect(next.quests.find((q) => q.id === 'p')?.status).toBe('done')
    expect(next.quests.find((q) => q.id === 'p')?.result?.skippedQuestIds).toBeUndefined()
  })

  it('archived-дети выпадают из гейта', () => {
    const s = withQuests(mq('p'), mq('c', { parentQuestId: 'p', status: 'archived' }))
    expect(reducer(s, doneAction('p')).quests.find((q) => q.id === 'p')?.status).toBe('done')
  })

  it('force: эпик done, skippedQuestIds записаны редьюсером, дети остались active', () => {
    const s = withQuests(mq('p'), mq('c1', { parentQuestId: 'p' }), mq('c2', { parentQuestId: 'p' }))
    const next = reducer(s, doneAction('p', true))
    const p = next.quests.find((q) => q.id === 'p')!
    expect(p.status).toBe('done')
    expect(p.result?.skippedQuestIds).toEqual(['c1', 'c2'])
    expect(next.quests.find((q) => q.id === 'c1')?.status).toBe('active')
    expect(next.quests.find((q) => q.id === 'c2')?.status).toBe('active')
  })

  it('force снимает оба гейта разом: skippedDod и skippedQuestIds в одном итоге', () => {
    const s = withQuests(
      mq('p', { definitionOfDone: [{ text: 'Пункт А', done: true }, { text: 'Пункт Б' }] }),
      mq('c', { parentQuestId: 'p' }),
    )
    const next = reducer(s, doneAction('p', true))
    const p = next.quests.find((q) => q.id === 'p')!
    expect(p.status).toBe('done')
    expect(p.result?.skippedDod).toEqual(['Пункт Б'])
    expect(p.result?.skippedQuestIds).toEqual(['c'])
    expect(next.quests.find((q) => q.id === 'c')?.status).toBe('active')
  })

  it('skippedQuestIds из payload игнорируется — авторитет ядро', () => {
    const s = withQuests(mq('p'))
    const next = reducer(s, {
      type: 'completeQuest', questId: 'p', day: '2026-07-29', ts: 'T1',
      result: { summary: 'итог', skippedQuestIds: ['мусор'] },
    })
    expect(next.quests.find((q) => q.id === 'p')?.result?.skippedQuestIds).toBeUndefined()
  })

  it('завершение ребёнка — обычное: свой XP-event, эпик не тронут', () => {
    const s = withQuests(mq('p'), mq('c', { parentQuestId: 'p' }))
    const next = reducer(s, doneAction('c'))
    expect(next.quests.find((q) => q.id === 'c')?.status).toBe('done')
    expect(next.quests.find((q) => q.id === 'p')?.status).toBe('active')
    expect(next.xpLog).toHaveLength(1)
    expect(next.xpLog[0].questId).toBe('c')
  })

  it('uncompleteQuest эпика: result уезжает в resultHistory, дети не тронуты', () => {
    let s = withQuests(mq('p'), mq('c', { parentQuestId: 'p' }))
    s = reducer(s, doneAction('p', true))
    const next = reducer(s, { type: 'uncompleteQuest', questId: 'p', day: '2026-07-29', ts: 'T2' })
    const p = next.quests.find((q) => q.id === 'p')!
    expect(p.status).toBe('active')
    expect(p.result).toBeUndefined()
    expect(p.resultHistory?.[0]?.skippedQuestIds).toEqual(['c'])
    expect(next.quests.find((q) => q.id === 'c')?.status).toBe('active')
  })

  it('archiveQuest эпика с active-детьми — no-op; после архива ребёнка — работает', () => {
    const s = withQuests(mq('p'), mq('c', { parentQuestId: 'p' }))
    expect(reducer(s, { type: 'archiveQuest', questId: 'p', day: '2026-07-29', ts: 'T1' })).toBe(s)
    const s2 = reducer(s, { type: 'archiveQuest', questId: 'c', day: '2026-07-29', ts: 'T1' })
    expect(reducer(s2, { type: 'archiveQuest', questId: 'p', day: '2026-07-29', ts: 'T1' }).quests.find((q) => q.id === 'p')?.status).toBe('archived')
  })
})
