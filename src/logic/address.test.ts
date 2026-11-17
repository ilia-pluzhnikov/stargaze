import { describe, expect, it } from 'vitest'
import type { Skill, StarComponent } from '../types'
import { formatAddress, parseAddress, resolveAddress, starAddress } from './address'

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
})
