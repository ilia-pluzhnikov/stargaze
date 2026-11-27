// Навигация по плоскому небу: что происходит с viewBox под колесом, драгом и щипком.
// Чистая геометрия без DOM — хук usePanZoom только переводит события указателей в эти вызовы.

export interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

/** Экранный прямоугольник, в который вписан viewBox. От зума и пана не зависит:
 *  пропорции viewBox постоянны, меняется только то, какой кусок мира в нём виден. */
export interface Frame {
  left: number
  top: number
  width: number
  height: number
}

/** Мир, по которому ходит кадр: его полный вид. Начало — (x, y), по умолчанию (0, 0). */
export interface World {
  w: number
  h: number
  x?: number
  y?: number
  /** Ширина кадра натурального масштаба. Предел приближения считается от неё,
   * если мир шире: выросшее небо можно приблизить так же близко, как маленькое.
   * По умолчанию — ширина мира. */
  base?: number
}

export const MAX_ZOOM_IN = 5 // во сколько раз можно приблизить относительно полного вида
export const MAX_ZOOM_OUT = 0.55 // насколько можно отдалить (мир занимает 55% ширины кадра)
const MIN_PINCH_SPAN_PX = 1 // пальцы в одной точке масштаба не задают

/** Центр кадра не выпускаем за границы мира — небо нельзя утащить в пустоту насовсем. */
export function clampView(v: ViewBox, world: World): ViewBox {
  const x0 = world.x ?? 0
  const y0 = world.y ?? 0
  return {
    x: Math.min(Math.max(v.x, x0 - v.w / 2), x0 + world.w - v.w / 2),
    y: Math.min(Math.max(v.y, y0 - v.h / 2), y0 + world.h - v.h / 2),
    w: v.w,
    h: v.h,
  }
}

/** Точка мира под точкой экрана. */
export function toWorld(v: ViewBox, frame: Frame, p: Point): Point {
  return {
    x: v.x + ((p.x - frame.left) / frame.width) * v.w,
    y: v.y + ((p.y - frame.top) / frame.height) * v.h,
  }
}

/** Единственное движение камеры: точка мира, что была под `from`, оказывается под `to`,
 *  а ширина кадра умножается на `factor` (< 1 — приближение) в пределах допустимого зума.
 *  Колесо — `from === to`, драг — `factor = 1`, щипок — и то и другое разом. */
export function moveView(v: ViewBox, frame: Frame, world: World, from: Point, to: Point, factor = 1): ViewBox {
  const scale = Number.isFinite(factor) && factor > 0 ? factor : 1
  const closest = Math.min(world.w, world.base ?? world.w) / MAX_ZOOM_IN
  const w = Math.min(Math.max(v.w * scale, closest), world.w / MAX_ZOOM_OUT)
  const k = w / v.w
  if (k === 1 && from.x === to.x && from.y === to.y) return v
  const held = toWorld(v, frame, from)
  const h = v.h * k
  return clampView(
    {
      x: held.x - ((to.x - frame.left) / frame.width) * w,
      y: held.y - ((to.y - frame.top) / frame.height) * h,
      w,
      h,
    },
    world,
  )
}

function centroid(points: Point[]): Point {
  let x = 0
  let y = 0
  for (const p of points) {
    x += p.x
    y += p.y
  }
  return { x: x / points.length, y: y / points.length }
}

function span(points: Point[]): number {
  return points.length < 2 ? 0 : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
}

/** Шаг жеста: те же указатели до и после движения. Один — небо едет за пальцем;
 *  два — небо держится за середину между пальцами и масштабируется вместе с их разводом. */
export function gestureView(v: ViewBox, frame: Frame, world: World, before: Point[], after: Point[]): ViewBox {
  if (before.length === 0 || before.length !== after.length) return v
  const was = span(before)
  const now = span(after)
  const factor = was >= MIN_PINCH_SPAN_PX && now >= MIN_PINCH_SPAN_PX ? was / now : 1
  return moveView(v, frame, world, centroid(before), centroid(after), factor)
}
