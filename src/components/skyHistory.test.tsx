import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Skill, SkyStore, StarComponent } from '../types'
import { skyAsOf } from '../logic/timeline'
import { GalaxyView } from './GalaxyView'
import type { GalaxyActions } from './GalaxyView'
import { Sky } from './Sky'

// Страж веб-слоя истории неба. Компоненты рендерятся в статическую разметку (node-окружение
// vitest, DOM не нужен); проверки структурные, не байтовый снимок — косметика их не ломает.

// Полдень UTC = 19:00 игрового пояса (UTC+7): тот же календарный день
const at = (day: string) => `${day}T12:00:00.000Z`

const skill = (id: string, createdDay: string, hue: number): Skill =>
  ({ id, emoji: '✦', name: id, wantStatement: '', hue, archived: false, createdAt: at(createdDay) })

const star = (id: string, skillId: string, createdDay: string, over: Partial<StarComponent> = {}): StarComponent =>
  ({ id, skillId, parentStarId: null, tier: 'D', title: id, createdAt: at(createdDay), ...over })

// «eng» старше «run»; «call» перевешена под более новую «club» — в прошлом она висит на «a1».
// Проверка «позиции — сегодняшние» обязана отличать layoutFrom от его отсутствия, поэтому
// раскладка прошлого набора сама по себе должна быть другой: hue подобраны так, что «eng»
// в одиночку встаёт в другой слот неба, чем рядом с «run», а поздняя корневая «b1» сужает клин «a1»
const fx: SkyStore = {
  skills: [skill('eng', '2026-03-01', 20), skill('run', '2026-06-01', 200)],
  stars: [
    star('a1', 'eng', '2026-03-02', { litAt: at('2026-03-20') }),
    star('a2', 'eng', '2026-03-05', { parentStarId: 'a1' }),
    star('club', 'eng', '2026-07-01', { parentStarId: 'a1', tier: 'C' }),
    star('call', 'eng', '2026-03-10', { parentStarId: 'club', tier: 'C' }),
    star('b1', 'eng', '2026-07-05', { tier: 'C' }),
    star('5k', 'run', '2026-06-02'),
  ],
  quests: [],
  xpLog: [],
}
const PAST = '2026-04-01' // на небе только «eng»: a1 (горит), a2 и call
const RUN_EMPTY = '2026-06-01' // «run» уже создан, звёзд в нём ещё нет

const noop = () => {}
const actions: GalaxyActions = { onAddStar: noop, onLightStar: noop, onUnlightStar: noop, onEditStar: noop }

const renderSky = (store: SkyStore, layoutFrom?: SkyStore) =>
  renderToStaticMarkup(<Sky store={store} layoutFrom={layoutFrom} onOpenGalaxy={noop} />)

interface GalaxyOpts {
  layoutFrom?: SkyStore
  selectedStarId?: string
  actions?: GalaxyActions
}
const renderGalaxy = (store: SkyStore, skillId: string, opts: GalaxyOpts = {}) => {
  const skills = store.skills.filter((s) => !s.archived)
  const current = skills.find((s) => s.id === skillId)
  if (!current) throw new Error(`в fixture нет навыка ${skillId}`)
  return renderToStaticMarkup(
    <GalaxyView store={store} layoutFrom={opts.layoutFrom} skill={current} skills={skills}
      selectedStarId={opts.selectedStarId ?? null} onSelectStar={noop} onSwitch={noop} onBack={noop}
      actions={opts.actions} />,
  )
}

/** transform каждого открывающего `<g>` с классом `className`. Тег разбирается целиком:
 * порядок атрибутов и соседние атрибуты (opacity у приглушённой звезды) на извлечение не влияют. */
const transformsOf = (markup: string, className: string): string[] =>
  [...markup.matchAll(/<g\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes(`class="${className}"`))
    .map((tag) => {
      const transform = /\btransform="([^"]*)"/.exec(tag)?.[1]
      if (!transform) throw new Error(`<g class="${className}"> без transform`)
      return transform
    })

describe('GalaxyView: правка — только с actions', () => {
  it('карточка выбранной звезды: без actions нет hud-actions, с actions — есть', () => {
    const past = skyAsOf(fx, PAST)
    const view = renderGalaxy(past, 'eng', { layoutFrom: fx, selectedStarId: 'a1' })
    expect(view).toContain('hud-title') // карточка отрисована — отсутствие кнопок не пустое
    expect(view).not.toContain('hud-actions')
    expect(renderGalaxy(past, 'eng', { layoutFrom: fx, selectedStarId: 'a1', actions })).toContain('hud-actions')
  })

  it('пустая на дату галактика: без actions нет «+ звезда», с actions — есть', () => {
    const past = skyAsOf(fx, RUN_EMPTY)
    const view = renderGalaxy(past, 'run', { layoutFrom: fx })
    expect(view).toContain('На эту дату звёзд ещё не было.')
    expect(view).not.toContain('+ звезда')
    const edit = renderGalaxy(past, 'run', { layoutFrom: fx, actions })
    expect(edit).toContain('+ звезда')
    expect(edit).not.toContain('На эту дату звёзд ещё не было.')
  })
})

describe('layoutFrom не задан — то же, что layoutFrom={store}', () => {
  it('Sky', () => expect(renderSky(fx)).toBe(renderSky(fx, fx)))

  it('GalaxyView — каждая галактика, без выбора и с выбранной звездой', () => {
    for (const s of fx.skills) {
      const own = fx.stars.filter((x) => x.skillId === s.id)
      for (const selectedStarId of [undefined, ...own.map((x) => x.id)]) {
        expect(renderGalaxy(fx, s.id, { selectedStarId, actions }))
          .toBe(renderGalaxy(fx, s.id, { layoutFrom: fx, selectedStarId, actions }))
      }
    }
  })
})

describe('прошлое рисуется в сегодняшней раскладке', () => {
  const past = skyAsOf(fx, PAST)

  it('небо: галактики прошлого стоят на сегодняшних местах, и их меньше', () => {
    const today = transformsOf(renderSky(fx), 'galaxy-g')
    const then = transformsOf(renderSky(past, fx), 'galaxy-g')
    expect(today).toHaveLength(2)
    expect(then).toHaveLength(1)
    for (const t of then) expect(today).toContain(t)
  })

  it('галактика: звёзды прошлого стоят на сегодняшних местах, и их меньше', () => {
    const today = transformsOf(renderGalaxy(fx, 'eng'), 'star-g')
    const then = transformsOf(renderGalaxy(past, 'eng', { layoutFrom: fx }), 'star-g')
    expect(today).toHaveLength(5)
    expect(then).toHaveLength(3)
    expect(new Set(today).size).toBe(today.length) // позиции различимы — включение не случайно
    for (const t of then) expect(today).toContain(t)
  })

  it('контроль чувствительности: без layoutFrom то же прошлое раскладывается иначе', () => {
    const skyToday = transformsOf(renderSky(fx), 'galaxy-g')
    expect(transformsOf(renderSky(past), 'galaxy-g').every((t) => skyToday.includes(t))).toBe(false)
    const engToday = transformsOf(renderGalaxy(fx, 'eng'), 'star-g')
    expect(transformsOf(renderGalaxy(past, 'eng'), 'star-g').every((t) => engToday.includes(t))).toBe(false)
  })
})
