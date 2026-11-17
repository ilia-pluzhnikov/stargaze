import { describe, expect, it } from 'vitest'
import type { Skill, StarComponent } from '../types'
import { formatAddress, parseAddress, resolveAddress, starAddress, withSky3d } from './address'

const skill = (id: string, over: Partial<Skill> = {}): Skill =>
  ({ id, emoji: '✦', name: id, wantStatement: '', hue: 200, archived: false, createdAt: '2026-06-01T12:00:00.000Z', ...over })

const star = (id: string, skillId: string, over: Partial<StarComponent> = {}): StarComponent =>
  ({ id, skillId, parentStarId: null, tier: 'D', title: id, createdAt: '2026-06-02T12:00:00.000Z', ...over })

describe('parseAddress', () => {
  it('пустой хэш и голая решётка — общее небо', () => {
    expect(parseAddress('')).toEqual({})
    expect(parseAddress('#')).toEqual({})
  })

  it('галактика и звезда; решётка необязательна', () => {
    expect(parseAddress('#skill=sk_health')).toEqual({ skill: 'sk_health' })
    expect(parseAddress('#star=st_a1')).toEqual({ star: 'st_a1' })
    expect(parseAddress('star=st_a1')).toEqual({ star: 'st_a1' })
  })

  it('оба ключа читаются в любом порядке', () => {
    expect(parseAddress('#star=st_a1&skill=sk_health')).toEqual({ star: 'st_a1', skill: 'sk_health' })
    expect(parseAddress('#skill=sk_health&star=st_a1')).toEqual({ star: 'st_a1', skill: 'sk_health' })
  })

  it('незнакомые ключи пропускаются, знакомые рядом с ними живут', () => {
    expect(parseAddress('#day=2026-06-01&skill=sk_health&view=journal')).toEqual({ skill: 'sk_health' })
    expect(parseAddress('#__proto__=x&constructor=y')).toEqual({})
  })

  it('ключи чувствительны к регистру', () => {
    expect(parseAddress('#Star=st_a1&SKILL=sk_health')).toEqual({})
  })

  it('пустое значение и ключ без «=» — как отсутствие ключа', () => {
    expect(parseAddress('#star=')).toEqual({})
    expect(parseAddress('#star')).toEqual({})
    expect(parseAddress('#star=&skill=sk_health')).toEqual({ skill: 'sk_health' })
    expect(parseAddress('#&&skill=sk_health&')).toEqual({ skill: 'sk_health' })
  })

  it('повтор ключа: берётся первое годное значение', () => {
    expect(parseAddress('#star=a&star=b')).toEqual({ star: 'a' })
    expect(parseAddress('#star=&star=b')).toEqual({ star: 'b' })
  })

  it('%-коды раскрываются, сырая кириллица проходит как есть', () => {
    expect(parseAddress('#skill=%D0%B1%D0%B5%D0%B3')).toEqual({ skill: 'бег' })
    expect(parseAddress('#skill=бег')).toEqual({ skill: 'бег' })
  })

  it('оборванный %-код гасит только свой ключ', () => {
    expect(parseAddress('#star=%E0%A4%A&skill=sk_health')).toEqual({ skill: 'sk_health' })
    expect(parseAddress('#star=100%')).toEqual({})
  })

  it('значение режется по первому «=», плюс остаётся плюсом', () => {
    expect(parseAddress('#star=a=b')).toEqual({ star: 'a=b' })
    expect(parseAddress('#star=a+b')).toEqual({ star: 'a+b' })
  })

  it('sky=3d — 3D-облёт: один и рядом с местом, в любом порядке', () => {
    expect(parseAddress('#sky=3d')).toEqual({ sky: '3d' })
    expect(parseAddress('#skill=sk_health&sky=3d')).toEqual({ skill: 'sk_health', sky: '3d' })
    expect(parseAddress('#sky=3d&star=st_a1')).toEqual({ star: 'st_a1', sky: '3d' })
    expect(parseAddress('#sky=%33d')).toEqual({ sky: '3d' })
  })

  it('sky с любым другим значением — как отсутствие ключа, место рядом живёт', () => {
    for (const raw of ['#sky=2d', '#sky=3D', '#sky=', '#sky', '#sky=3d3d', '#sky=%E0%A4%A', '#SKY=3d'])
      expect(parseAddress(raw), raw).toEqual({})
    expect(parseAddress('#sky=vr&skill=sk_health')).toEqual({ skill: 'sk_health' })
  })

  it('повтор sky: берётся первое годное значение', () => {
    expect(parseAddress('#sky=vr&sky=3d')).toEqual({ sky: '3d' })
    expect(parseAddress('#sky=3d&sky=vr')).toEqual({ sky: '3d' })
  })
})

describe('formatAddress', () => {
  it('общее небо — пустая строка, без решётки', () => {
    expect(formatAddress({})).toBe('')
    expect(formatAddress({ star: '', skill: '' })).toBe('')
  })

  it('галактика, звезда и оба ключа — звезда первой', () => {
    expect(formatAddress({ skill: 'sk_health' })).toBe('#skill=sk_health')
    expect(formatAddress({ star: 'st_a1' })).toBe('#star=st_a1')
    expect(formatAddress({ skill: 'sk_health', star: 'st_a1' })).toBe('#star=st_a1&skill=sk_health')
  })

  it('id с разделителями и не-ASCII переживает круг format → parse', () => {
    for (const id of ['a&skill=b', 'a=b', 'a#b', 'a b', 'a+b', '100%', 'бег', '🌌', 'a/b?c']) {
      expect(parseAddress(formatAddress({ star: id }))).toEqual({ star: id })
      expect(parseAddress(formatAddress({ skill: id }))).toEqual({ skill: id })
    }
  })

  it('3D-облёт — ключ sky в конце: прежние адреса места не меняются', () => {
    expect(formatAddress({ sky: '3d' })).toBe('#sky=3d')
    expect(formatAddress({ skill: 'sk_health', sky: '3d' })).toBe('#skill=sk_health&sky=3d')
    expect(formatAddress({ sky: '3d', skill: 'sk_health', star: 'st_a1' })).toBe('#star=st_a1&skill=sk_health&sky=3d')
  })

  it('адрес с sky переживает круг format → parse; id, похожий на ключ sky, облёт не включает', () => {
    for (const address of [{ sky: '3d' }, { skill: 'бег', sky: '3d' }, { star: 'a&sky=3d' }, { skill: 'sky=3d' }] as const)
      expect(parseAddress(formatAddress(address))).toEqual(address)
  })
})

describe('withSky3d', () => {
  it('включает облёт, не трогая место', () => {
    expect(withSky3d({}, true)).toEqual({ sky: '3d' })
    expect(withSky3d({ skill: 'run' }, true)).toEqual({ skill: 'run', sky: '3d' })
    expect(withSky3d({ star: 'a1', skill: 'run' }, true)).toEqual({ star: 'a1', skill: 'run', sky: '3d' })
  })

  it('выключает облёт: остаётся место, общее небо — пустой адрес', () => {
    expect(withSky3d({ skill: 'run', sky: '3d' }, false)).toEqual({ skill: 'run' })
    expect(withSky3d({ sky: '3d' }, false)).toEqual({})
    expect(formatAddress(withSky3d({ sky: '3d' }, false))).toBe('')
  })

  it('повторное включение и выключение ничего не меняют; исходный адрес не мутируется', () => {
    const address = { skill: 'run', sky: '3d' } as const
    expect(withSky3d(address, true)).toEqual(address)
    expect(withSky3d({ skill: 'run' }, false)).toEqual({ skill: 'run' })
    expect(address).toEqual({ skill: 'run', sky: '3d' })
  })
})

describe('resolveAddress', () => {
  const store = {
    skills: [skill('eng'), skill('run'), skill('old', { archived: true })],
    stars: [star('a1', 'eng'), star('5k', 'run'), star('relic', 'old')],
  }
  const sky = { skill: null, star: null }

  it('пустой адрес — общее небо', () => {
    expect(resolveAddress(store, {})).toEqual(sky)
  })

  it('skill открывает галактику без выбранной звезды', () => {
    expect(resolveAddress(store, { skill: 'run' })).toEqual({ skill: store.skills[1], star: null })
  })

  it('star открывает свою галактику и саму звезду', () => {
    expect(resolveAddress(store, { star: 'a1' })).toEqual({ skill: store.skills[0], star: store.stars[0] })
  })

  it('id нет в store — общее небо', () => {
    expect(resolveAddress(store, { skill: 'nope' })).toEqual(sky)
    expect(resolveAddress(store, { star: 'nope' })).toEqual(sky)
  })

  it('id точный: префикс не разбирается', () => {
    expect(resolveAddress(store, { skill: 'ru' })).toEqual(sky)
    expect(resolveAddress(store, { star: 'a' })).toEqual(sky)
  })

  it('архивный навык и звезда архивного навыка — общее небо', () => {
    expect(resolveAddress(store, { skill: 'old' })).toEqual(sky)
    expect(resolveAddress(store, { star: 'relic' })).toEqual(sky)
  })

  it('оба ключа: звезда выигрывает, даже если skill называет другую галактику', () => {
    expect(resolveAddress(store, { star: 'a1', skill: 'run' })).toEqual({ skill: store.skills[0], star: store.stars[0] })
  })

  it('оба ключа: звезды нет или она в архивном навыке — запасной skill', () => {
    expect(resolveAddress(store, { star: 'nope', skill: 'run' })).toEqual({ skill: store.skills[1], star: null })
    expect(resolveAddress(store, { star: 'relic', skill: 'run' })).toEqual({ skill: store.skills[1], star: null })
  })

  it('оба ключа: не открылись ни звезда, ни запасной skill — общее небо', () => {
    expect(resolveAddress(store, { star: 'nope', skill: 'old' })).toEqual(sky)
    expect(resolveAddress(store, { star: 'nope', skill: 'nope' })).toEqual(sky)
  })

  it('звезда с навыком, которого нет в store, — общее небо, не падение', () => {
    const broken = { skills: [skill('eng')], stars: [star('lost', 'ghost')] }
    expect(resolveAddress(broken, { star: 'lost' })).toEqual(sky)
  })

  it('адрес — намерение: цели нет в первом store, она открывается, когда приезжает канон', () => {
    const address = parseAddress('#star=fresh')
    const localCopy = { skills: [skill('eng')], stars: [star('a1', 'eng')] }
    const canon = { skills: [skill('eng'), skill('run')], stars: [star('a1', 'eng'), star('fresh', 'run')] }
    expect(resolveAddress(localCopy, address)).toEqual(sky)
    expect(resolveAddress(canon, address)).toEqual({ skill: canon.skills[1], star: canon.stars[1] })
  })

  it('ключ sky на место не влияет: с облётом адрес ведёт туда же', () => {
    expect(resolveAddress(store, { sky: '3d' })).toEqual(sky)
    expect(resolveAddress(store, { skill: 'run', sky: '3d' })).toEqual(resolveAddress(store, { skill: 'run' }))
    expect(resolveAddress(store, { star: 'a1', sky: '3d' })).toEqual(resolveAddress(store, { star: 'a1' }))
  })

  it('цель исчезла (навык ушёл в архив) — тот же адрес снова ведёт на общее небо', () => {
    const archived = { ...store, skills: store.skills.map((s) => (s.id === 'run' ? { ...s, archived: true } : s)) }
    expect(resolveAddress(store, { star: '5k' }).skill?.id).toBe('run')
    expect(resolveAddress(archived, { star: '5k' })).toEqual(sky)
  })
})

describe('starAddress — адрес звезды, каким его пишет веб', () => {
  const store = {
    skills: [skill('eng'), skill('run')],
    stars: [star('a1', 'eng'), star('5k', 'run')],
  }
  const address = starAddress(store.stars[1])

  it('несёт и звезду, и её галактику', () => {
    expect(address).toEqual({ star: '5k', skill: 'run' })
    expect(formatAddress(address)).toBe('#star=5k&skill=run')
    expect(resolveAddress(store, address)).toEqual({ skill: store.skills[1], star: store.stars[1] })
  })

  it('звезду удалил другой клиент — тот же адрес оставляет в её галактике', () => {
    const without = { ...store, stars: store.stars.filter((s) => s.id !== '5k') }
    expect(resolveAddress(without, address)).toEqual({ skill: store.skills[1], star: null })
    // без запасного skill тот же случай уводит на общее небо
    expect(resolveAddress(without, { star: '5k' })).toEqual({ skill: null, star: null })
  })

  it('звезду перенесли в другой навык — адрес ведёт за звездой, а не в прежнюю галактику', () => {
    const moved = { ...store, stars: store.stars.map((s) => (s.id === '5k' ? { ...s, skillId: 'eng' } : s)) }
    const place = resolveAddress(moved, address)
    expect(place.skill?.id).toBe('eng')
    expect(place.star?.id).toBe('5k')
    expect(starAddress(place.star!)).toEqual({ star: '5k', skill: 'eng' })
  })

  it('галактика звезды ушла в архив — общее небо', () => {
    const archived = { ...store, skills: store.skills.map((s) => (s.id === 'run' ? { ...s, archived: true } : s)) }
    expect(resolveAddress(archived, address)).toEqual({ skill: null, star: null })
  })

  it('под открытым облётом адрес звезды держит и галактику, и облёт', () => {
    // веб дописывает skill к ссылке #star=<id>&sky=3d — облёт от этого не закрывается
    const flying = withSky3d(address, true)
    expect(flying).toEqual({ star: '5k', skill: 'run', sky: '3d' })
    expect(formatAddress(flying)).toBe('#star=5k&skill=run&sky=3d')
    expect(resolveAddress(store, flying)).toEqual(resolveAddress(store, address))
    expect(withSky3d(flying, false)).toEqual(address)
  })
})
