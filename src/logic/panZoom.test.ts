import { describe, expect, it } from 'vitest'
import { MAX_ZOOM_IN, MAX_ZOOM_OUT, clampView, gestureView, moveView, toWorld } from './panZoom'
import type { Frame, Point, ViewBox } from './panZoom'

const world = { w: 1000, h: 600 }
const full: ViewBox = { x: 0, y: 0, w: 1000, h: 600 }
// телефон в портрете: небо вписано по ширине, сверху и снизу поля
const frame: Frame = { left: 0, top: 200, width: 400, height: 240 }
const at = (x: number, y: number): Point => ({ x, y })

const expectPoint = (got: Point, want: Point) => {
  expect(got.x).toBeCloseTo(want.x, 6)
  expect(got.y).toBeCloseTo(want.y, 6)
}

describe('toWorld', () => {
  it('углы рамки — углы viewBox, поля экрана учитываются', () => {
    expectPoint(toWorld(full, frame, at(0, 200)), at(0, 0))
    expectPoint(toWorld(full, frame, at(400, 440)), at(1000, 600))
    expectPoint(toWorld({ x: 100, y: 50, w: 500, h: 300 }, frame, at(200, 320)), at(350, 200))
  })
})

describe('moveView', () => {
  it('колесо: точка под курсором остаётся на месте', () => {
    const cursor = at(260, 300)
    const held = toWorld(full, frame, cursor)
    const v = moveView(full, frame, world, cursor, cursor, 0.5)
    expect(v.w).toBe(500)
    expect(v.h).toBe(300)
    expectPoint(toWorld(v, frame, cursor), held)
  })

  it('драг: небо едет за пальцем, масштаб не меняется', () => {
    const start: ViewBox = { x: 300, y: 200, w: 400, h: 240 }
    const held = toWorld(start, frame, at(100, 300))
    const v = moveView(start, frame, world, at(100, 300), at(160, 270))
    expect(v.w).toBe(400)
    expect(v.h).toBe(240)
    expectPoint(toWorld(v, frame, at(160, 270)), held)
  })

  it('зум упирается в пределы с обеих сторон', () => {
    const c = at(200, 320)
    expect(moveView(full, frame, world, c, c, 0.001).w).toBeCloseTo(world.w / MAX_ZOOM_IN, 9)
    expect(moveView(full, frame, world, c, c, 1000).w).toBeCloseTo(world.w / MAX_ZOOM_OUT, 9)
  })

  it('на пределе зума без сдвига возвращает тот же объект — лишней перерисовки нет', () => {
    const c = at(200, 320)
    const closest = moveView(full, frame, world, c, c, 0.001)
    expect(moveView(closest, frame, world, c, c, 0.5)).toBe(closest)
    expect(moveView(full, frame, world, c, c, 1)).toBe(full)
  })

  it('пропорции кадра сохраняются при любом зуме', () => {
    const v = moveView(full, frame, world, at(50, 210), at(90, 260), 0.37)
    expect(v.w / v.h).toBeCloseTo(world.w / world.h, 9)
  })

  it('мусорный множитель масштаб не трогает', () => {
    const c = at(200, 320)
    for (const bad of [0, -2, NaN, Infinity]) expect(moveView(full, frame, world, c, c, bad)).toBe(full)
  })

  it('небо нельзя утащить в пустоту: центр кадра остаётся в мире', () => {
    const far = moveView(full, frame, world, at(0, 200), at(4000, 4000))
    expect(far.x).toBe(-world.w / 2)
    expect(far.y).toBe(-world.h / 2)
    const back = moveView(full, frame, world, at(400, 440), at(-4000, -4000))
    expect(back.x).toBe(world.w / 2)
    expect(back.y).toBe(world.h / 2)
  })
})

describe('clampView', () => {
  it('кадр в пределах мира не трогает', () => {
    const v: ViewBox = { x: 120, y: 80, w: 400, h: 240 }
    expect(clampView(v, world)).toEqual(v)
  })
})

describe('gestureView', () => {
  it('один палец — чистый пан', () => {
    const start: ViewBox = { x: 300, y: 200, w: 400, h: 240 }
    const v = gestureView(start, frame, world, [at(100, 300)], [at(140, 310)])
    expect(v).toEqual(moveView(start, frame, world, at(100, 300), at(140, 310)))
    expect(v.w).toBe(400)
  })

  it('развели пальцы вдвое — приблизили вдвое, точка между пальцами осталась под ними', () => {
    const before = [at(150, 320), at(250, 320)]
    const after = [at(100, 320), at(300, 320)]
    const held = toWorld(full, frame, at(200, 320))
    const v = gestureView(full, frame, world, before, after)
    expect(v.w).toBeCloseTo(500, 9)
    expectPoint(toWorld(v, frame, at(200, 320)), held)
  })

  it('свели пальцы — отдалили', () => {
    const start: ViewBox = { x: 300, y: 200, w: 400, h: 240 }
    const v = gestureView(start, frame, world, [at(100, 320), at(300, 320)], [at(150, 320), at(250, 320)])
    expect(v.w).toBeCloseTo(800, 9)
  })

  it('щипок со сдвигом: небо держится за середину между пальцами', () => {
    const start: ViewBox = { x: 300, y: 200, w: 400, h: 240 }
    const before = [at(120, 300), at(220, 300)]
    const after = [at(130, 330), at(290, 350)]
    const held = toWorld(start, frame, at(170, 300))
    const v = gestureView(start, frame, world, before, after)
    expect(v.w).toBeLessThan(start.w)
    expectPoint(toWorld(v, frame, at(210, 340)), held)
  })

  it('шаги жеста складываются: два полушага дают то же, что один целый', () => {
    const a = [at(150, 320), at(250, 320)]
    const b = [at(130, 310), at(270, 330)]
    const c = [at(100, 300), at(300, 340)]
    const whole = gestureView(full, frame, world, a, c)
    const stepped = gestureView(gestureView(full, frame, world, a, b), frame, world, b, c)
    expect(stepped.w).toBeCloseTo(whole.w, 6)
    expect(stepped.x).toBeCloseTo(whole.x, 6)
    expect(stepped.y).toBeCloseTo(whole.y, 6)
  })

  it('пальцы в одной точке: масштаб не меняется, NaN не появляется', () => {
    const v = gestureView(full, frame, world, [at(200, 320), at(200, 320)], [at(210, 320), at(210, 320)])
    expect(v.w).toBe(full.w)
    expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true)
  })

  it('пустой или несогласованный набор указателей — кадр прежний', () => {
    expect(gestureView(full, frame, world, [], [])).toBe(full)
    expect(gestureView(full, frame, world, [at(1, 1)], [at(1, 1), at(2, 2)])).toBe(full)
  })
})
