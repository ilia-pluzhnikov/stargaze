import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedStore } from '../src/data/seed'
import { addDays } from '../src/logic/dates'
import { dayInGameTz } from '../src/logic/sparks'
import { saveStore, loadStore } from '../src/logic/storage'
import type { Store, Tier } from '../src/types'
import { runCli } from './app'

export function run(args: string[], storePath?: string) {
  const out: string[] = []
  const err: string[] = []
  const code = runCli(storePath ? [...args, '--store', storePath] : args, {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

export const tmpStore = (): string => {
  const p = join(mkdtempSync(join(tmpdir(), 'ql-cli-')), 'store.json')
  saveStore(p, seedStore())
  return p
}

describe('cli каркас', () => {
  it('без команды — usage, код 2', () => {
    const r = run([])
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/stargaze/)
  })
  it('неизвестная команда — код 2', () => expect(run(['фигня']).code).toBe(2))

  /** Прогнать fn с точно заданными env-ключами store (и вернуть как было). */
  const withEnv = (env: Record<string, string>, fn: () => void) => {
    const keys = ['STARGAZE_STORE', 'QUESTLOG_STORE'] as const
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
    for (const k of keys) delete process.env[k]
    Object.assign(process.env, env)
    try {
      fn()
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
      }
    }
  }

  it('без --store и без env — код 2 с подсказкой про STARGAZE_STORE', () => {
    withEnv({}, () => {
      const r = run(['status'])
      expect(r.code).toBe(2)
      expect(r.err).toMatch(/STARGAZE_STORE/)
    })
  })
  it('env STARGAZE_STORE указывает store', () => {
    withEnv({ STARGAZE_STORE: tmpStore() }, () => {
      expect(run(['status']).code).toBe(0)
    })
  })
  it('только env QUESTLOG_STORE — работает (вечный фолбэк)', () => {
    withEnv({ QUESTLOG_STORE: tmpStore() }, () => {
      expect(run(['status']).code).toBe(0)
    })
  })
  it('оба env — выигрывает STARGAZE_STORE', () => {
    const bogus = join(tmpdir(), 'нет-такого-каталога', 'store.json')
    withEnv({ STARGAZE_STORE: tmpStore(), QUESTLOG_STORE: bogus }, () => {
      expect(run(['status']).code).toBe(0) // выиграй QUESTLOG-путь — был бы ENOENT
    })
  })
  it('status показывает персонажа и навыки', () => {
    const r = run(['status'], tmpStore())
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/ур\./)
  })
  it('status --json отдаёт машинный объект', () => {
    const r = run(['status', '--json'], tmpStore())
    const parsed = JSON.parse(r.out)
    expect(parsed.character.level).toBeGreaterThanOrEqual(1)
  })
  it('validate: валидный store — код 0', () => expect(run(['validate'], tmpStore()).code).toBe(0))
  it('validate: битый store — код 1 и ошибки', () => {
    const p = tmpStore()
    writeFileSync(p, JSON.stringify({ version: 99 }), 'utf8')
    const r = run(['validate'], p)
    expect(r.code).toBe(1)
    expect(r.out + r.err).toMatch(/version/)
  })
  it('export → import: круговорот', () => {
    const p = tmpStore()
    const exported = run(['export'], p)
    expect(exported.code).toBe(0)
    const p2 = join(mkdtempSync(join(tmpdir(), 'ql-cli-')), 'store.json')
    const dump = join(mkdtempSync(join(tmpdir(), 'ql-cli-')), 'dump.json')
    writeFileSync(dump, exported.out, 'utf8')
    expect(run(['import', dump], p2).code).toBe(0)
    expect(loadStore(p2)).toEqual(loadStore(p))
  })
  it('import поверх существующего делает бэкап-копию', () => {
    const p = tmpStore()
    const dump = join(mkdtempSync(join(tmpdir(), 'ql-cli-')), 'dump.json')
    writeFileSync(dump, JSON.stringify(seedStore()), 'utf8')
    expect(run(['import', dump], p).code).toBe(0)
    expect(readdirSync(join(p, '..')).some((f) => f.includes('bak'))).toBe(true)
  })
  it('import невалидного — код 1, файл не тронут', () => {
    const p = tmpStore()
    const before = loadStore(p)
    const dump = join(mkdtempSync(join(tmpdir(), 'ql-cli-')), 'dump.json')
    writeFileSync(dump, JSON.stringify({ version: 99 }), 'utf8')
    expect(run(['import', dump], p).code).toBe(1)
    expect(loadStore(p)).toEqual(before)
  })
  it('validate --json на битом store — код 1 и JSON { ok: false, errors: [...] }', () => {
    const p = tmpStore()
    writeFileSync(p, 'invalid json{]', 'utf8')
    const r = run(['validate', '--json'], p)
    expect(r.code).toBe(1)
    const parsed = JSON.parse(r.out)
    expect(parsed.ok).toBe(false)
    expect(Array.isArray(parsed.errors)).toBe(true)
    expect(parsed.errors.length).toBeGreaterThan(0)
  })
  it('import с нечитаемым файлом — код 1, русское сообщение, без raw Node ошибок', () => {
    const p = tmpStore()
    const nonExistent = join(tmpdir(), 'non-existent-import-file-xyz.json')
    const r = run(['import', nonExistent], p)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/не удалось.*файл импорта/)
    expect(r.err).not.toMatch(/ENOENT/)
  })
})

describe('cli чтение', () => {
  it('quests по умолчанию — активные', () => {
    const r = run(['quests'], tmpStore())
    expect(r.code).toBe(0)
    expect(r.out.length).toBeGreaterThan(0)
  })
  it('quests --json — массив с полями id/title/status', () => {
    const r = run(['quests', '--json'], tmpStore())
    const list = JSON.parse(r.out) as { id: string; title: string; status: string }[]
    expect(list.every((q) => q.status === 'active')).toBe(true)
  })
  it('quests --proposed пуст на сиде', () => {
    const r = run(['quests', '--proposed', '--json'], tmpStore())
    expect(JSON.parse(r.out)).toEqual([])
  })
  it('skills --json отдаёт уровни', () => {
    const r = run(['skills', '--json'], tmpStore())
    const list = JSON.parse(r.out) as { level: number }[]
    expect(list.length).toBeGreaterThan(0)
  })
  it('ranks требует --skill', () => expect(run(['ranks'], tmpStore()).code).toBe(2))
  it('ranks выводит буквы рангов с прогрессом', () => {
    const p = tmpStore()
    const s = loadStore(p)
    const skillId = s.skills[0].id
    const mk = (id: string, tier: Tier, parentStarId: string | null, litAt?: string) => ({
      id, skillId, parentStarId, tier, title: id, createdAt: '2026-07-01T00:00:00.000Z',
      ...(litAt ? { litAt } : {}),
    })
    saveStore(p, {
      ...s,
      stars: [
        mk('d1', 'D', null, '2026-07-10T00:00:00.000Z'),
        mk('d2', 'D', 'd1', '2026-07-11T00:00:00.000Z'),
        mk('c1', 'C', 'd2', '2026-07-12T00:00:00.000Z'),
        mk('c2', 'C', 'd2'),
      ],
      quests: s.quests.map(q => ({ ...q, starId: null })),
      wishlist: (s.wishlist ?? []).filter(w => w.kind === 'small'),
    })
    const r = run(['ranks', '--skill', skillId], p)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/D/)
    expect(r.out).toMatch(/C/)
    expect(r.out).toMatch(/2\/2/)
    expect(r.out).toMatch(/1\/2/)
  })
  it('stats --weeks 2 --json — две недели', () => {
    const r = run(['stats', '--weeks', '2', '--json'], tmpStore())
    expect(JSON.parse(r.out)).toHaveLength(2)
  })
  it('stars --tier C фильтрует', () => {
    const p = tmpStore()
    const s = loadStore(p)
    const skillId = s.skills[0].id
    saveStore(p, {
      ...s,
      stars: [
        { id: 'd1', skillId, parentStarId: null, tier: 'D', title: 'Дэ', createdAt: '2026-07-01T00:00:00.000Z' },
        { id: 'c1', skillId, parentStarId: null, tier: 'C', title: 'Цэ', createdAt: '2026-07-01T00:00:00.000Z' },
        { id: 'b1', skillId, parentStarId: null, tier: 'B', title: 'Бэ', createdAt: '2026-07-01T00:00:00.000Z' },
      ],
      quests: s.quests.map(q => ({ ...q, starId: null })),
      wishlist: (s.wishlist ?? []).filter(w => w.kind === 'small'),
    })
    const r = run(['stars', '--tier', 'C', '--json'], p)
    expect(r.code).toBe(0)
    const list = JSON.parse(r.out) as { id: string; tier: string }[]
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('c1')
  })
})

describe('cli запись', () => {
  it('complete отмечает repeating и пишет событие', () => {
    const p = tmpStore()
    const q = loadStore(p).quests.find((x) => x.type === 'repeating' && x.status === 'active')!
    const r = run(['complete', q.id], p)
    expect(r.code).toBe(0)
    expect(loadStore(p).xpLog.some((e) => e.questId === q.id)).toBe(true)
  })
  it('повторный complete в тот же день — код 1, второго события нет', () => {
    const p = tmpStore()
    const q = loadStore(p).quests.find((x) => x.type === 'repeating' && x.status === 'active')!
    run(['complete', q.id], p)
    const r = run(['complete', q.id], p)
    expect(r.code).toBe(1)
    expect(loadStore(p).xpLog.filter((e) => e.questId === q.id)).toHaveLength(1)
  })
  it('uncomplete пишет компенсацию, не удаляет', () => {
    const p = tmpStore()
    const q = loadStore(p).quests.find((x) => x.type === 'repeating' && x.status === 'active')!
    run(['complete', q.id], p)
    expect(run(['uncomplete', q.id], p).code).toBe(0)
    const events = loadStore(p).xpLog.filter((e) => e.questId === q.id)
    expect(events).toHaveLength(2)
    expect(events[0].amount + events[1].amount).toBe(0)
  })
  it('add-quest создаёт активный квест', () => {
    const p = tmpStore()
    const r = run(['add-quest', '--title', 'Новый', '--type', 'repeating', '--xp', '10'], p)
    expect(r.code).toBe(0)
    expect(loadStore(p).quests.some((q) => q.title === 'Новый' && q.status === 'active')).toBe(true)
  })
  it('propose-quest требует --note и создаёт proposed', () => {
    const p = tmpStore()
    expect(run(['propose-quest', '--title', 'Идея', '--type', 'short', '--xp', '20'], p).code).toBe(2)
    const r = run(['propose-quest', '--title', 'Идея', '--type', 'short', '--xp', '20', '--note', 'зачем-то'], p)
    expect(r.code).toBe(0)
    const q = loadStore(p).quests.find((x) => x.title === 'Идея')!
    expect(q.status).toBe('proposed')
    expect(q.proposalNote).toBe('зачем-то')
  })
  it('accept и reject работают только на proposed', () => {
    const p = tmpStore()
    run(['propose-quest', '--title', 'Идея', '--type', 'short', '--xp', '20', '--note', 'н'], p)
    const q = loadStore(p).quests.find((x) => x.title === 'Идея')!
    expect(run(['accept', q.id], p).code).toBe(0)
    expect(loadStore(p).quests.find((x) => x.id === q.id)!.status).toBe('active')
    expect(run(['reject', q.id], p).code).toBe(1) // уже active
  })
  it('light-star зажигает и пишет evidence', () => {
    const p = tmpStore()
    // подготовить звезду напрямую через storage
    const s = loadStore(p)
    const skillId = s.skills[0].id
    saveStore(p, {
      ...s,
      stars: [{ id: 'c1', skillId, parentStarId: null, tier: 'D', title: 'Алфавит', createdAt: '2026-07-01T00:00:00.000Z' }],
      quests: s.quests.map(q => ({ ...q, starId: null })),
      wishlist: (s.wishlist ?? []).filter(w => w.kind === 'small'),
    })
    const r = run(['light-star', 'c1', '--evidence', 'прочитал вывеску'], p)
    expect(r.code).toBe(0)
    const star = loadStore(p).stars[0]
    expect(star.litAt).toBeTruthy()
    expect(star.evidence).toBe('прочитал вывеску')
  })
  it('light-star уже зажжённой звезды — код 1', () => {
    const p = tmpStore()
    const s = loadStore(p)
    const skillId = s.skills[0].id
    saveStore(p, {
      ...s,
      stars: [{ id: 'c1', skillId, parentStarId: null, tier: 'D', title: 'Алфавит', createdAt: '2026-07-01T00:00:00.000Z' }],
      quests: s.quests.map(q => ({ ...q, starId: null })),
      wishlist: (s.wishlist ?? []).filter(w => w.kind === 'small'),
    })
    expect(run(['light-star', 'c1'], p).code).toBe(0)
    expect(run(['light-star', 'c1'], p).code).toBe(1)
  })
  it('add-star создаёт корневую звезду дерева', () => {
    const p = tmpStore()
    const skillId = loadStore(p).skills[0].id
    const r = run(['add-star', '--skill', skillId, '--title', 'Основы', '--tier', 'D', '--criteria', 'прочитал урок'], p)
    expect(r.code).toBe(0)
    const star = loadStore(p).stars.find((c) => c.title === 'Основы')!
    expect(star).toBeTruthy()
    expect(star.skillId).toBe(skillId)
    expect(star.parentStarId).toBeNull()
    expect(star.tier).toBe('D')
    expect(star.criteria).toBe('прочитал урок')
  })
  it('add-star --parent чужого навыка — код 2, звезда не добавлена', () => {
    const p = tmpStore()
    const s = loadStore(p)
    const skillA = s.skills[0].id
    const skillB = s.skills[1].id
    run(['add-star', '--skill', skillA, '--title', 'Корень А', '--tier', 'D'], p)
    const rootA = loadStore(p).stars.find((c) => c.title === 'Корень А')!
    const before = loadStore(p).stars.length
    const r = run(['add-star', '--skill', skillB, '--title', 'Чужак', '--tier', 'D', '--parent', rootA.id], p)
    expect(r.code).toBe(2)
    expect(loadStore(p).stars).toHaveLength(before)
  })
})

describe('cli карточка квеста', () => {
  const addShort = (p: string, extra: string[] = []) => {
    const r = run(['add-quest', '--title', 'Карта набора', '--type', 'short', '--xp', '50', ...extra], p)
    expect(r.code).toBe(0)
    const id = r.out.match(/\((q_[a-z0-9]+)\)/)?.[1]
    expect(id).toBeTruthy()
    return id as string
  }

  it('complete short без --result — код 2, подсказка, store не тронут', () => {
    const p = tmpStore()
    const id = addShort(p)
    const before = loadStore(p)
    const r = run(['complete', id], p)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/--result/)
    expect(loadStore(p)).toEqual(before)
  })

  it('complete short с --result завершает и пишет result целиком', () => {
    const p = tmpStore()
    const id = addShort(p)
    const r = run(['complete', id, '--result', 'Выбран сегмент', '--artifact', 'https://x', '--evidence', '7 ответов'], p)
    expect(r.code).toBe(0)
    const q = loadStore(p).quests.find((x) => x.id === id)!
    expect(q.status).toBe('done')
    expect(q.result).toEqual({ summary: 'Выбран сегмент', artifactUrl: 'https://x', evidence: '7 ответов' })
  })

  it('complete repeating с --result — код 2 (итог некуда писать)', () => {
    const p = tmpStore()
    const r0 = run(['add-quest', '--title', 'Зарядка', '--type', 'repeating', '--xp', '10'], p)
    const id = r0.out.match(/\((q_[a-z0-9]+)\)/)?.[1] as string
    const r = run(['complete', id, '--result', 'x'], p)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/repeating/)
  })

  it('add-quest с карточкой; quest <id> печатает её; --json отдаёт поля', () => {
    const p = tmpStore()
    const id = addShort(p, [
      '--desc', 'Разобрать путь клиента', '--why', 'Выбрать канал на своих данных',
      '--dod', 'Выписаны точки касания', '--dod', 'Выбран сегмент',
      '--resource', 'Pipeline лидов=https://notion.so/x', '--resource', 'База учеников',
    ])
    const q = loadStore(p).quests.find((x) => x.id === id)!
    expect(q.definitionOfDone).toEqual([{ text: 'Выписаны точки касания' }, { text: 'Выбран сегмент' }])
    expect(q.resources).toEqual([{ title: 'Pipeline лидов', url: 'https://notion.so/x' }, { title: 'База учеников' }])
    const card = run(['quest', id], p)
    expect(card.code).toBe(0)
    expect(card.out).toMatch(/Зачем/)
    expect(card.out).toMatch(/\[ \] 2\. Выбран сегмент/)
    expect(card.out).toMatch(/Pipeline лидов/)
    const js = run(['quest', id, '--json'], p)
    expect(JSON.parse(js.out).why).toBe('Выбрать канал на своих данных')
  })

  it('quest <id> у done-квеста показывает итог', () => {
    const p = tmpStore()
    const id = addShort(p)
    expect(run(['complete', id, '--result', 'Готово'], p).code).toBe(0)
    const card = run(['quest', id], p)
    expect(card.out).toMatch(/Итог/)
    expect(card.out).toMatch(/Готово/)
  })
})

describe('cli DoD-гейт, тики и история', () => {
  const addWithDod = (p: string) => {
    const r = run(['add-quest', '--title', 'Гейт', '--type', 'short', '--xp', '10',
      '--dod', 'Пункт А', '--dod', 'Пункт Б'], p)
    expect(r.code).toBe(0)
    return r.out.match(/\((q_[a-z0-9]+)\)/)?.[1] as string
  }

  it('check/uncheck тикают пункт; quest показывает нумерацию', () => {
    const p = tmpStore()
    const id = addWithDod(p)
    expect(run(['check', id, '1'], p).code).toBe(0)
    let q = loadStore(p).quests.find((x) => x.id === id)!
    expect(q.definitionOfDone![0].done).toBe(true)
    expect(q.definitionOfDone![1].done).toBeUndefined()
    const card = run(['quest', id], p)
    expect(card.out).toMatch(/\[x\] 1\. Пункт А/)
    expect(card.out).toMatch(/\[ \] 2\. Пункт Б/)
    expect(run(['uncheck', id, '1'], p).code).toBe(0)
    q = loadStore(p).quests.find((x) => x.id === id)!
    expect(q.definitionOfDone![0].done).toBe(false)
  })

  it('check у done-квеста — код 2 с внятным статусом, а не «не найден»', () => {
    const p = tmpStore()
    const id = addWithDod(p)
    expect(run(['check', id, '1'], p).code).toBe(0)
    expect(run(['check', id, '2'], p).code).toBe(0)
    expect(run(['complete', id, '--result', 'Готово'], p).code).toBe(0)
    const r = run(['check', id, '1'], p)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/статус done/)
    expect(r.err).not.toMatch(/не найден/)
  })

  it('check: индекс вне диапазона и квест без DoD — код 2', () => {
    const p = tmpStore()
    const id = addWithDod(p)
    expect(run(['check', id, '3'], p).code).toBe(2)
    const r0 = run(['add-quest', '--title', 'Пустой', '--type', 'short', '--xp', '5'], p)
    const bare = r0.out.match(/\((q_[a-z0-9]+)\)/)?.[1] as string
    const r = run(['check', bare, '1'], p)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/DoD/)
  })

  it('complete с незакрытым DoD — код 2 с перечнем; --force завершает и пишет skippedDod', () => {
    const p = tmpStore()
    const id = addWithDod(p)
    expect(run(['check', id, '1'], p).code).toBe(0)
    const blocked = run(['complete', id, '--result', 'Итог'], p)
    expect(blocked.code).toBe(2)
    expect(blocked.err).toMatch(/Пункт Б/)
    expect(blocked.err).toMatch(/--force/)
    const forced = run(['complete', id, '--result', 'Итог', '--force'], p)
    expect(forced.code).toBe(0)
    const q = loadStore(p).quests.find((x) => x.id === id)!
    expect(q.status).toBe('done')
    expect(q.result?.skippedDod).toEqual(['Пункт Б'])
  })

  it('uncomplete уводит итог в историю; quest показывает прошлые итоги', () => {
    const p = tmpStore()
    const id = addWithDod(p)
    expect(run(['complete', id, '--result', 'Первая попытка', '--force'], p).code).toBe(0)
    expect(run(['uncomplete', id], p).code).toBe(0)
    const q = loadStore(p).quests.find((x) => x.id === id)!
    expect(q.result).toBeUndefined()
    expect(q.resultHistory).toHaveLength(1)
    const card = run(['quest', id], p)
    expect(card.out).toMatch(/Прошлые итоги/)
    expect(card.out).toMatch(/Первая попытка/)
  })
})

describe('подквесты: --parent', () => {
  const addEpic = (p: string, skillArgs: string[] = []): string => {
    const r = run(['add-quest', '--title', 'Эпик', '--type', 'mid', '--xp', '50', ...skillArgs], p)
    return r.out.match(/\((q_[a-z0-9]+)\)/)?.[1] as string
  }

  it('add-quest --parent: ребёнок наследует skillId родителя без --skill', () => {
    const p = tmpStore()
    const sid = (JSON.parse(run(['skills', '--json'], p).out) as { id: string }[])[0].id
    const epicId = addEpic(p, ['--skill', sid])
    const r = run(['add-quest', '--title', 'Шаг', '--type', 'short', '--xp', '10', '--parent', epicId], p)
    expect(r.code).toBe(0)
    const childId = r.out.match(/\((q_[a-z0-9]+)\)/)?.[1] as string
    const child = JSON.parse(run(['quest', childId, '--json'], p).out)
    expect(child.parentQuestId).toBe(epicId)
    expect(child.skillId).toBe(sid)
  })

  it('propose-quest --parent работает (с обязательным --note)', () => {
    const p = tmpStore()
    const epicId = addEpic(p)
    const r = run(['propose-quest', '--title', 'Шаг', '--type', 'short', '--xp', '10', '--parent', epicId, '--note', 'зачем'], p)
    expect(r.code).toBe(0)
    const childId = r.out.match(/\((q_[a-z0-9]+)\)/)?.[1] as string
    const child = JSON.parse(run(['quest', childId, '--json'], p).out)
    expect(child.parentQuestId).toBe(epicId)
    expect(child.status).toBe('proposed')
  })

  it('--parent на repeating-родителя — CliError', () => {
    const p = tmpStore()
    const r0 = run(['add-quest', '--title', 'Вечный', '--type', 'repeating', '--xp', '5'], p)
    const repId = r0.out.match(/\((q_[a-z0-9]+)\)/)?.[1] as string
    const r = run(['add-quest', '--title', 'Шаг', '--type', 'short', '--xp', '10', '--parent', repId], p)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/repeating/)
  })

  it('repeating-ребёнок с --parent — CliError', () => {
    const p = tmpStore()
    const epicId = addEpic(p)
    const r = run(['add-quest', '--title', 'Шаг', '--type', 'repeating', '--xp', '10', '--parent', epicId], p)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/repeating/)
  })

  it('--parent на ребёнка (внук) — CliError', () => {
    const p = tmpStore()
    const epicId = addEpic(p)
    const rc = run(['add-quest', '--title', 'Шаг', '--type', 'short', '--xp', '10', '--parent', epicId], p)
    const childId = rc.out.match(/\((q_[a-z0-9]+)\)/)?.[1] as string
    const r = run(['add-quest', '--title', 'Внук', '--type', 'short', '--xp', '5', '--parent', childId], p)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/второй уровень|сам подквест/)
  })

  it('--parent на done-родителя — CliError', () => {
    const p = tmpStore()
    const epicId = addEpic(p)
    expect(run(['complete', epicId, '--result', 'итог'], p).code).toBe(0)
    const r = run(['add-quest', '--title', 'Шаг', '--type', 'short', '--xp', '10', '--parent', epicId], p)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/done/)
  })

  it('--parent с битым префиксом — ошибка резолва', () => {
    const p = tmpStore()
    const r = run(['add-quest', '--title', 'Шаг', '--type', 'short', '--xp', '10', '--parent', 'q_нету'], p)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/не найден/)
  })
})

describe('подквесты: complete-гейт и archive', () => {
  const mkEpicWithChild = (p: string): { epicId: string; childId: string } => {
    const r0 = run(['add-quest', '--title', 'Эпик', '--type', 'mid', '--xp', '50'], p)
    const epicId = r0.out.match(/\((q_[a-z0-9]+)\)/)?.[1] as string
    const r1 = run(['add-quest', '--title', 'Шаг 1', '--type', 'short', '--xp', '10', '--parent', epicId], p)
    const childId = r1.out.match(/\((q_[a-z0-9]+)\)/)?.[1] as string
    return { epicId, childId }
  }

  it('complete эпика с active-ребёнком — CliError с перечнем (id + title)', () => {
    const p = tmpStore()
    const { epicId, childId } = mkEpicWithChild(p)
    const r = run(['complete', epicId, '--result', 'итог'], p)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(new RegExp(childId))
    expect(r.err).toMatch(/Шаг 1/)
    expect(r.err).toMatch(/--force/)
  })

  it('complete эпика --force: done, skippedQuestIds в --json, ребёнок active', () => {
    const p = tmpStore()
    const { epicId, childId } = mkEpicWithChild(p)
    expect(run(['complete', epicId, '--result', 'итог', '--force'], p).code).toBe(0)
    const epic = JSON.parse(run(['quest', epicId, '--json'], p).out)
    expect(epic.result.skippedQuestIds).toEqual([childId])
    const child = JSON.parse(run(['quest', childId, '--json'], p).out)
    expect(child.status).toBe('active')
  })

  it('proposed-дети не блокируют, но дают предупреждение', () => {
    const p = tmpStore()
    const r0 = run(['add-quest', '--title', 'Эпик', '--type', 'mid', '--xp', '50'], p)
    const epicId = r0.out.match(/\((q_[a-z0-9]+)\)/)?.[1] as string
    run(['propose-quest', '--title', 'Идея', '--type', 'short', '--xp', '5', '--parent', epicId, '--note', 'n'], p)
    const r = run(['complete', epicId, '--result', 'итог'], p)
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/предложени/)
  })

  it('завершение ребёнка идёт как обычно', () => {
    const p = tmpStore()
    const { epicId, childId } = mkEpicWithChild(p)
    expect(run(['complete', childId, '--result', 'сделан шаг'], p).code).toBe(0)
    expect(run(['complete', epicId, '--result', 'итог'], p).code).toBe(0)
  })

  it('archive эпика с active-детьми — CliError; ребёнка — ок; потом эпика — ок', () => {
    const p = tmpStore()
    const { epicId, childId } = mkEpicWithChild(p)
    const r = run(['archive', epicId], p)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/подквест/)
    expect(r.err).toMatch(new RegExp(childId))
    // --yes: с экономикой искр архив активного контракта платный (см. «CLI: экономика искр»)
    expect(run(['archive', childId, '--yes'], p).code).toBe(0)
    expect(run(['archive', epicId, '--yes'], p).code).toBe(0)
  })

  it('reject эпика-предложения с ребёнком — CliError с перечнем; после ребёнка — ок', () => {
    const p = tmpStore()
    const r0 = run(['propose-quest', '--title', 'Эпик-идея', '--type', 'mid', '--xp', '50', '--note', 'зачем'], p)
    const epicId = r0.out.match(/\((q_[a-z0-9]+)\)/)?.[1] as string
    const r1 = run(['propose-quest', '--title', 'Шаг', '--type', 'short', '--xp', '10', '--parent', epicId, '--note', 'n'], p)
    const childId = r1.out.match(/\((q_[a-z0-9]+)\)/)?.[1] as string
    const r = run(['reject', epicId], p)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(new RegExp(childId))
    expect(run(['reject', childId], p).code).toBe(0)
    expect(run(['reject', epicId], p).code).toBe(0)
    expect(run(['validate'], p).code).toBe(0)
  })

  it('archive без аргумента — usage, код 2', () => {
    expect(run(['archive'], tmpStore()).code).toBe(2)
  })
})

describe('подквесты: отображение', () => {
  const mkTree = (p: string): { epicId: string; childId: string } => {
    const r0 = run(['add-quest', '--title', 'Карта набора', '--type', 'mid', '--xp', '50'], p)
    const epicId = r0.out.match(/\((q_[a-z0-9]+)\)/)?.[1] as string
    const r1 = run(['add-quest', '--title', 'Выбрать сегмент', '--type', 'short', '--xp', '10', '--parent', epicId], p)
    const childId = r1.out.match(/\((q_[a-z0-9]+)\)/)?.[1] as string
    return { epicId, childId }
  }

  it('quests: ребёнок с отступом ↳ под родителем, у эпика бейдж [0/1]', () => {
    const p = tmpStore()
    mkTree(p)
    const r = run(['quests'], p)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/Карта набора \[0\/1\]/)
    expect(r.out).toMatch(/↳ Выбрать сегмент/)
  })

  it('quest <эпик>: блок «Подквесты» с нумерацией и статусами', () => {
    const p = tmpStore()
    const { epicId } = mkTree(p)
    const r = run(['quest', epicId], p)
    expect(r.out).toMatch(/Подквесты 0\/1:/)
    expect(r.out).toMatch(/\[ \] 1\. Выбрать сегмент/)
  })

  it('quest <ребёнок>: строка «часть эпика»', () => {
    const p = tmpStore()
    const { childId } = mkTree(p)
    const r = run(['quest', childId], p)
    expect(r.out).toMatch(/часть эпика: Карта набора/)
  })

  it('quest <эпик> --json: children (id) и progress', () => {
    const p = tmpStore()
    const { epicId, childId } = mkTree(p)
    const epic = JSON.parse(run(['quest', epicId, '--json'], p).out)
    expect(epic.children).toEqual([childId])
    expect(epic.progress).toEqual({ done: 0, total: 1 })
  })

  it('quest <эпик>: done/active/proposed — маркеры [x]/[ ]/[?], proposed вне знаменателя', () => {
    const p = tmpStore()
    const { epicId } = mkTree(p)
    const r2 = run(['add-quest', '--title', 'Собрать интервью', '--type', 'short', '--xp', '10', '--parent', epicId], p)
    const doneId = r2.out.match(/\((q_[a-z0-9]+)\)/)?.[1] as string
    expect(run(['complete', doneId, '--result', 'ок'], p).code).toBe(0)
    run(['propose-quest', '--title', 'Гипотеза цены', '--type', 'short', '--xp', '10', '--parent', epicId, '--note', 'идея'], p)
    const r = run(['quest', epicId], p)
    expect(r.out).toMatch(/Подквесты 1\/2:/)
    expect(r.out).toMatch(/\[ \] 1\. Выбрать сегмент/)
    expect(r.out).toMatch(/\[x\] 2\. Собрать интервью/)
    expect(r.out).toMatch(/\[\?\] 3\. Гипотеза цены/)
    // в таблице proposed тоже помечен «?»: без этого «1/2» над списком из 3 читается как ошибка
    expect(run(['quests', '--all'], p).out).toMatch(/\?\s+↳ Гипотеза цены/)
  })
})

describe('CLI: экономика искр', () => {
  const mkIo = () => {
    const out: string[] = []
    const err: string[] = []
    return {
      io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) },
      outStr: () => out.join('\n'),
      errStr: () => err.join('\n'),
    }
  }
  // Тот же день, что берёт CLI (ctx.today) — игровой пояс, а не пояс машины:
  // с todayKey() фикстуры разъезжались бы с CLI везде, кроме UTC+7.
  const gameToday = () => dayInGameTz(new Date().toISOString())
  // Фикстура пишется напрямую (не через seedStore): дедлайн в будущем ⇒ провизия 0
  // на любой машине, поэтому тесты не зависят ни от пояса, ни от текущей даты.
  const fixture = (): Store => ({
    version: 3,
    character: { name: 'И', avatar: '🧙' },
    skills: [],
    stars: [],
    xpLog: [],
    quests: [{
      id: 'q_c1', title: 'Контракт', type: 'short', skillId: null, xpReward: 100,
      dueDate: addDays(gameToday(), 5), status: 'active', createdAt: new Date().toISOString(),
    }],
    ledger: [{ id: 'l1', ts: new Date().toISOString(), day: gameToday(), kind: 'adjust', amount: 100, note: 'сид' }],
    wishlist: [
      // repeatable: тест «покупка дважды» цикла 12 живёт про многоразовую радость (с цикла 16 дефолт — разовая)
      { id: 'w_m1', title: 'Массаж', kind: 'small', price: 80, repeatable: true, createdAt: new Date().toISOString() },
      { id: 'w_d1', title: 'Дорогое', kind: 'small', price: 500, createdAt: new Date().toISOString() },
    ],
  })
  const writeFixture = (s: Store = fixture()): string => {
    const p = join(mkdtempSync(join(tmpdir(), 'sparks-cli-')), 'store.json')
    writeFileSync(p, JSON.stringify(s), 'utf8')
    return p
  }
  const readBack = (p: string): Store => JSON.parse(readFileSync(p, 'utf8')) as Store

  it('wallet печатает баланс и выписку', () => {
    const p = writeFixture()
    const { io, outStr } = mkIo()
    expect(runCli(['wallet', '--store', p], io)).toBe(0)
    expect(outStr()).toContain('✨ 100')
    expect(outStr()).toContain('корректировка')
  })

  it('status показывает баланс', () => {
    const p = writeFixture()
    const { io, outStr } = mkIo()
    expect(runCli(['status', '--store', p], io)).toBe(0)
    expect(outStr()).toContain('✨ 100')
  })

  it('cancel без --yes — отказ с ценой неустойки, store не тронут', () => {
    const p = writeFixture()
    const { io, errStr } = mkIo()
    expect(runCli(['cancel', 'q_c1', '--store', p], io)).toBe(2)
    expect(errStr()).toContain('−50')
    expect(readBack(p).quests[0].status).toBe('active')
  })

  it('cancel --yes архивирует и списывает неустойку', () => {
    const p = writeFixture()
    const { io, outStr } = mkIo()
    expect(runCli(['cancel', 'q_c1', '--yes', '--store', p], io)).toBe(0)
    expect(outStr()).toContain('неустойка −50')
    const s = readBack(p)
    expect(s.quests[0].status).toBe('archived')
    expect(s.ledger!.at(-1)).toMatchObject({ kind: 'cancelFee', amount: -50, questId: 'q_c1' })
  })

  it('move переносит и печатает остаток бесплатных', () => {
    const p = writeFixture()
    const { io, outStr } = mkIo()
    expect(runCli(['move', 'q_c1', addDays(gameToday(), 9), '--store', p], io)).toBe(0)
    expect(outStr()).toContain('бесплатных осталось 2')
    expect(readBack(p).quests[0].dueDate).toBe(addDays(gameToday(), 9))
  })

  it('move в прошлое и на ту же дату — отказ, store не тронут', () => {
    const p = writeFixture()
    const past = mkIo()
    expect(runCli(['move', 'q_c1', addDays(gameToday(), -1), '--store', p], past.io)).toBe(2)
    expect(past.errStr()).toContain('прошлое')
    const same = mkIo()
    expect(runCli(['move', 'q_c1', addDays(gameToday(), 5), '--store', p], same.io)).toBe(2)
    expect(readBack(p).quests[0].dueDateHistory).toBeUndefined()
  })

  it('buy: нехватка — ошибка с балансом; покупка списывает', () => {
    const p = writeFixture()
    const bad = mkIo()
    expect(runCli(['buy', 'w_d1', '--store', p], bad.io)).toBe(2)
    expect(bad.errStr()).toContain('не хватает')
    const ok = mkIo()
    expect(runCli(['buy', 'w_m1', '--store', p], ok.io)).toBe(0)
    expect(ok.outStr()).toContain('остаток 20')
    expect(readBack(p).ledger!.at(-1)).toMatchObject({ kind: 'spend', amount: -80, itemId: 'w_m1' })
  })

  it('покупка дважды — два списания (opId свежий на каждый вызов)', () => {
    const p = writeFixture()
    const { io } = mkIo()
    expect(runCli(['buy', 'w_m1', '--store', p], io)).toBe(0)
    expect(runCli(['buy', 'w_m1', '--store', p], io)).toBe(2) // 20 ✨ на второй массаж не хватает
    expect(runCli(['adjust', '--store', p, '--', '200', 'пополнение'], io)).toBe(0)
    expect(runCli(['buy', 'w_m1', '--store', p], io)).toBe(0)
    const spends = readBack(p).ledger!.filter((e) => e.itemId === 'w_m1')
    expect(spends).toHaveLength(2)
    expect(new Set(spends.map((e) => e.opId)).size).toBe(2)
  })

  it('spend, adjust, wishlist-add, wishlist работают', () => {
    const p = writeFixture()
    const { io, outStr } = mkIo()
    expect(runCli(['spend', '20', 'кофе с другом', '--store', p], io)).toBe(0)
    expect(runCli(['adjust', '--store', p, '--', '-30', 'реструктуризация'], io)).toBe(0)
    expect(runCli(['wishlist-add', '--title', 'Кино', '--price', '40', '--store', p], io)).toBe(0)
    expect(runCli(['wishlist', '--store', p], io)).toBe(0)
    expect(outStr()).toContain('Кино')
    const s = readBack(p)
    expect(s.wishlist!.some((w) => w.title === 'Кино' && w.price === 40)).toBe(true)
    expect(s.ledger!.map((e) => e.amount)).toEqual([100, -20, -30])
    expect(s.ledger!.at(-1)).toMatchObject({ kind: 'adjust', note: 'реструктуризация' })
  })

  it('4-й перенос за 7 дней — платный: предупреждение в wallet/status, комиссия в леджере', () => {
    const today = gameToday()
    const base = fixture()
    // цепочка переносов должна быть непрерывной и заканчиваться на dueDate квеста
    const p = writeFixture({
      ...base,
      quests: [{
        ...base.quests[0],
        dueDateHistory: [1, 2, 3].map((n) => ({
          from: addDays(today, n + 1), to: addDays(today, n + 2), day: addDays(today, n - 4),
          ts: `${addDays(today, n - 4)}T10:00:00.000Z`,
        })),
      }],
    })

    const w = mkIo()
    expect(runCli(['wallet', '--store', p], w.io)).toBe(0)
    expect(w.outStr()).toContain('переносов за 7 дней: 3/3 — следующий платный (−10% награды)')
    const st = mkIo()
    expect(runCli(['status', '--store', p], st.io)).toBe(0)
    expect(st.outStr()).toContain('переносов за 7 дней: 3/3')

    const mv = mkIo()
    expect(runCli(['move', 'q_c1', addDays(today, 9), '--store', p], mv.io)).toBe(0)
    expect(mv.outStr()).toContain('платный перенос: −10 ✨') // 10% от награды 100
    expect(mv.outStr()).not.toContain('бесплатных осталось')
    const s = readBack(p)
    expect(s.ledger!.at(-1)).toMatchObject({ kind: 'moveFee', amount: -10, questId: 'q_c1' })
    expect(s.quests[0].dueDateHistory!.at(-1)).toMatchObject({ to: addDays(today, 9), fee: 10 })

    // за порогом — счётчик, а не дробь «4/3»
    const after = mkIo()
    expect(runCli(['wallet', '--store', p], after.io)).toBe(0)
    expect(after.outStr()).toContain('переносов за 7 дней: 4, бесплатные (3) исчерпаны — следующий платный')
    expect(after.outStr()).not.toContain('4/3')
  })

  it('нетронутая квота переносов не шумит в status', () => {
    const p = writeFixture()
    const { io, outStr } = mkIo()
    expect(runCli(['status', '--store', p], io)).toBe(0)
    expect(outStr()).not.toContain('переносов за 7 дней')
  })

  // Просрочка не видна до SPARKS_EPOCH (амнистия), поэтому часы фиксируем.
  // Все даты выводятся из gameToday() внутри фикции — значение пояса роли не играет.
  const withClock = (fn: () => void) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'))
    try {
      fn()
    } finally {
      vi.useRealTimers()
    }
  }

  it('капание видно в status и wallet, перенос фиксирует долг строкой с квестом', () => {
    withClock(() => {
      const today = gameToday()
      const late = (id: string, title: string, xpReward: number, overdue: number) => ({
        id, title, type: 'short' as const, skillId: null, xpReward,
        dueDate: addDays(today, -overdue), status: 'active' as const, createdAt: '2026-07-20T00:00:00.000Z',
      })
      const p = writeFixture({
        ...fixture(),
        // 3 дня × 10% от 200 = 60; 15 дней от 100 упирается в потолок 1×R = 100
        quests: [late('q_a', 'Лендинг', 200, 3), late('q_b', 'Прогрев', 100, 15)],
        ledger: [{ id: 'l1', ts: '2026-09-01T10:00:00.000Z', day: '2026-09-01', kind: 'adjust', amount: 300, note: 'капитал' }],
      })

      const st = mkIo()
      expect(runCli(['status', '--store', p], st.io)).toBe(0)
      expect(st.outStr()).toContain('✨ 140 (капает −160)')

      const w = mkIo()
      expect(runCli(['wallet', '--store', p], w.io)).toBe(0)
      expect(w.outStr()).toContain('✨ 140 (чистыми 300, провизия −160)')
      expect(w.outStr()).toContain('капает: Лендинг · −60 ✨ (потолок 200)')
      expect(w.outStr()).toContain('капает: Прогрев · −100 ✨ (потолок)')

      const mv = mkIo()
      expect(runCli(['move', 'q_a', addDays(today, 5), '--store', p], mv.io)).toBe(0)
      expect(mv.outStr()).toContain('долг −60 ✨ зафиксирован')

      // выписка должна назвать квест: у drain нет note, подпись берётся из questId
      const after = mkIo()
      expect(runCli(['wallet', '--store', p], after.io)).toBe(0)
      expect(after.outStr()).toMatch(/капание\s+-60\s+Лендинг/)
      expect(readBack(p).ledger!.at(-1)).toMatchObject({ kind: 'drain', amount: -60, questId: 'q_a' })
    })
  })

  it('wishlist-add: и --price, и --star — отказ; неизвестная звезда — отказ', () => {
    const p = writeFixture()
    const both = mkIo()
    expect(runCli(['wishlist-add', '--title', 'Смесь', '--price', '10', '--star', 'c1', '--store', p], both.io)).toBe(2)
    expect(both.errStr()).toContain('либо')
    const unknown = mkIo()
    expect(runCli(['wishlist-add', '--title', 'Ноутбук', '--star', 'нет-такой', '--store', p], unknown.io)).toBe(1)
    expect(readBack(p).wishlist!.some((w) => w.kind === 'big')).toBe(false)
  })

  it('claim: звезда не зажжена — отказ; после зажигания — получено', () => {
    const base = fixture()
    const p = writeFixture({
      ...base,
      skills: [{
        id: 's1', emoji: '🛠', name: 'Ремесло', wantStatement: 'уметь',
        hue: 200, archived: false, createdAt: '2026-07-01T00:00:00.000Z',
      }],
      stars: [{
        id: 'c1', skillId: 's1', parentStarId: null, tier: 'D', title: 'Первый шаг',
        createdAt: '2026-07-01T00:00:00.000Z',
      }],
    })
    const add = mkIo()
    expect(runCli(['wishlist-add', '--title', 'Ноутбук', '--star', 'c1', '--store', p], add.io)).toBe(0)
    const itemId = readBack(p).wishlist!.find((w) => w.kind === 'big')!.id

    const early = mkIo()
    expect(runCli(['claim', itemId, '--store', p], early.io)).toBe(2)
    expect(early.errStr()).toContain('не зажжена')
    expect(readBack(p).wishlist!.find((w) => w.id === itemId)!.claimedAt).toBeUndefined()

    // витрина показывает якорь звездой, а не парой навык+ранг
    const list = mkIo()
    expect(runCli(['wishlist', '--store', p], list.io)).toBe(0)
    expect(list.outStr()).toContain('Первый шаг')

    expect(runCli(['light-star', 'c1', '--store', p], mkIo().io)).toBe(0)
    const ok = mkIo()
    expect(runCli(['claim', itemId, '--store', p], ok.io)).toBe(0)
    expect(ok.outStr()).toContain('Ноутбук')
    expect(readBack(p).wishlist!.find((w) => w.id === itemId)!.claimedAt).toBeTruthy()

    // повторный claim — отказ, а не второй «подарок»
    expect(runCli(['claim', itemId, '--store', p], mkIo().io)).toBe(2)

    // вторая награда на ту же звезду не заводится — якорь занят
    const dup = mkIo()
    expect(runCli(['wishlist-add', '--title', 'Ещё ноутбук', '--star', 'c1', '--store', p], dup.io)).toBe(2)
    expect(dup.errStr()).toContain('звезду')
  })
})

describe('вишлист без цены (CLI)', () => {
  it('смоук спеки: add без цены → buy-ошибка → wishlist-edit --price → buy', () => {
    // Используем fixture без провизий (дата в будущем)
    const p = join(mkdtempSync(join(tmpdir(), 'sparks-cli-')), 'store.json')
    const gameToday = () => dayInGameTz(new Date().toISOString())
    writeFileSync(p, JSON.stringify({
      version: 3,
      character: { name: 'И', avatar: '🧙' },
      skills: [],
      stars: [],
      xpLog: [],
      quests: [{
        id: 'q_c1', title: 'Контракт', type: 'short', skillId: null, xpReward: 100,
        dueDate: addDays(gameToday(), 5), status: 'active', createdAt: new Date().toISOString(),
      }],
      ledger: [],
      wishlist: [],
    }), 'utf8')

    const add = run(['wishlist-add', '--title', 'Лампа', '--url', 'https://x.example', '--orig', '2800 ฿'], p)
    expect(add.code).toBe(0)
    expect(add.out).toMatch(/без цены/)
    const id = add.out.match(/\((w_[a-z0-9]+)\)/)![1]
    const saved = JSON.parse(run(['wishlist', '--json'], p).out)[0]
    expect(saved).toMatchObject({ title: 'Лампа', kind: 'small', sourceUrl: 'https://x.example', originalPrice: '2800 ฿' })
    expect(saved.price).toBeUndefined()
    const list = run(['wishlist'], p)
    expect(list.out).toMatch(/без цены/)
    expect(list.out).toMatch(/2800 ฿/)
    const buy = run(['buy', id], p)
    expect(buy.code).toBe(2)
    expect(buy.err).toMatch(/wishlist-edit/)
    // Рулинг контролёра: хвост с wishlist-edit --price → buy
    const edited = run(['wishlist-edit', id, '--price', '120'], p)
    expect(edited.code).toBe(0)
    const wishAfterEdit = JSON.parse(run(['wishlist', '--json'], p).out)[0]
    expect(wishAfterEdit.price).toBe(120)
    expect(run(['adjust', '200', 'сид'], p).code).toBe(0)
    const bought = run(['buy', id], p)
    expect(bought.code).toBe(0)
    expect(bought.out).toMatch(/−120 ✨/)
  })
  it('wishlist-edit: правка полей, пустое значение стирает поле', () => {
    const p = tmpStore()
    const add = run(['wishlist-add', '--title', 'Лампа', '--note', 'старая', '--orig', '2800 ฿'], p)
    const id = add.out.match(/\((w_[a-z0-9]+)\)/)![1]
    expect(run(['wishlist-edit', id, '--title', 'Торшер', '--note', '', '--url', 'https://y.example'], p).code).toBe(0)
    const w = JSON.parse(run(['wishlist', '--json'], p).out).find((item: any) => item.id === id)
    expect(w).toMatchObject({ title: 'Торшер', sourceUrl: 'https://y.example', originalPrice: '2800 ฿' })
    expect(w.note).toBeUndefined()
  })
  it('лицо награды: add --emoji/--image → эмодзи в таблице → edit пустым значением стирает', () => {
    const p = tmpStore()
    const add = run(['wishlist-add', '--title', 'Кресло', '--emoji', '🛋️', '--image', 'https://x.example/sofa.jpg'], p)
    expect(add.code).toBe(0)
    const id = add.out.match(/\((w_[a-z0-9]+)\)/)![1]
    const saved = JSON.parse(run(['wishlist', '--json'], p).out).find((item: any) => item.id === id)
    expect(saved).toMatchObject({ emoji: '🛋️', imageUrl: 'https://x.example/sofa.jpg' })
    const list = run(['wishlist'], p)
    expect(list.out).toMatch(/🛋️ Кресло/) // эмодзи перед названием, URL в таблицу не лезет
    expect(list.out).not.toMatch(/sofa\.jpg/)
    expect(run(['wishlist-edit', id, '--emoji', '', '--image', ''], p).code).toBe(0)
    const cleared = JSON.parse(run(['wishlist', '--json'], p).out).find((item: any) => item.id === id)
    expect(cleared.emoji).toBeUndefined()
    expect(cleared.imageUrl).toBeUndefined()
  })
  it('wishlist-edit: без флагов — код 2; кривая цена — код 2; нет позиции — не 0', () => {
    const p = tmpStore()
    const id = run(['wishlist-add', '--title', 'Лампа'], p).out.match(/\((w_[a-z0-9]+)\)/)![1]
    expect(run(['wishlist-edit', id], p).code).toBe(2)
    expect(run(['wishlist-edit', id, '--price', '0'], p).code).toBe(2)
    expect(run(['wishlist-edit', id, '--price', '1.5'], p).code).toBe(2)
    expect(run(['wishlist-edit', 'w_нет_такого', '--price', '5'], p).code).not.toBe(0)
  })
  it('разовая: buy второй раз — код 2; --repeat покупается дважды; edit --once/--repeat', () => {
    const p = tmpStore()
    expect(run(['adjust', '500', 'сид'], p).code).toBe(0)
    const one = run(['wishlist-add', '--title', 'Кресло', '--price', '50'], p)
    const oneId = one.out.match(/\((w_[a-z0-9]+)\)/)![1]
    expect(run(['buy', oneId], p).code).toBe(0)
    const again = run(['buy', oneId], p)
    expect(again.code).toBe(2)
    expect(again.err).toMatch(/уже куплена/)
    expect(run(['wishlist'], p).out).toMatch(/✔ куплено/)
    const rep = run(['wishlist-add', '--title', 'Кофе', '--price', '10', '--repeat'], p)
    const repId = rep.out.match(/\((w_[a-z0-9]+)\)/)![1]
    expect(run(['buy', repId], p).code).toBe(0)
    expect(run(['buy', repId], p).code).toBe(0)
    expect(run(['wishlist'], p).out).toMatch(/↻/)
    expect(run(['wishlist-edit', repId, '--once'], p).code).toBe(0)
    expect(run(['wishlist-edit', repId, '--once', '--repeat'], p).code).toBe(2)
    // --repeat вместе со звездой — ошибка: big разовая по механике
    expect(run(['wishlist-add', '--title', 'X', '--star', 'нет', '--repeat'], p).code).toBe(2)
  })
  it('wishlist-add: --price и --star одновременно — код 2', () => {
    const r = run(['wishlist-add', '--title', 'Смесь', '--price', '5', '--star', 'x'], tmpStore())
    expect(r.code).toBe(2)
  })
  it('wallet отдаёт эмиссию 7/30 в json и печатает строку', () => {
    const p = tmpStore()
    expect(JSON.parse(run(['wallet', '--json'], p).out).emission).toEqual({ d7: 0, d30: 0 })
    expect(run(['wallet'], p).out).toMatch(/эмиссия: \+0 ✨ за 7 дней/)
  })
})

describe('quests --today и status уважают dueDate', () => {
  const gameToday = () => dayInGameTz(new Date().toISOString())

  it('--today: будущий short скрыт, просроченный mid виден', () => {
    const p = tmpStore()
    run(['add-quest', '--title', 'Будущий шорт', '--type', 'short', '--xp', '5', '--due', addDays(gameToday(), 5)], p)
    run(['add-quest', '--title', 'Горящий мид', '--type', 'mid', '--xp', '50', '--due', addDays(gameToday(), -3)], p)
    const r = run(['quests', '--today'], p)
    expect(r.out).not.toMatch(/Будущий шорт/)
    expect(r.out).toMatch(/Горящий мид/)
  })

  it('status: будущий short не в положенных, просроченный контракт — в положенных', () => {
    const p = tmpStore()
    const y = () => Number(run(['status'], p).out.match(/Сегодня: \d+ \/ (\d+)/)![1])
    const base = y()
    run(['add-quest', '--title', 'Будущий', '--type', 'short', '--xp', '5', '--due', addDays(gameToday(), 5)], p)
    expect(y()).toBe(base)
    run(['add-quest', '--title', 'Горящий', '--type', 'long', '--xp', '50', '--due', addDays(gameToday(), -3)], p)
    expect(y()).toBe(base + 1)
  })
})
