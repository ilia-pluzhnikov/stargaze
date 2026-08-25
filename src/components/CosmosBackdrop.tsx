import { useEffect, useRef } from 'react'
import { hashStr, mulberry32 } from '../logic/layout'

interface Props {
  /** Основной оттенок небулы; у открытой галактики это Skill.hue. */
  hue: number
  seed: string
}

const TAU = Math.PI * 2

function blob(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  hue: number,
  alpha: number,
) {
  g.save()
  g.translate(x, y)
  g.scale(rx, ry)
  const fill = g.createRadialGradient(0, 0, 0, 0, 0, 1)
  fill.addColorStop(0, `hsla(${hue}, 62%, 58%, ${alpha})`)
  fill.addColorStop(0.42, `hsla(${hue}, 58%, 48%, ${alpha * 0.48})`)
  fill.addColorStop(1, `hsla(${hue}, 52%, 35%, 0)`)
  g.fillStyle = fill
  g.beginPath()
  g.arc(0, 0, 1, 0, TAU)
  g.fill()
  g.restore()
}

function drawBackdrop(canvas: HTMLCanvasElement, hue: number, seed: string) {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width < 1 || height < 1) return

  // Ограничиваем растр примерно четырьмя мегапикселями: фон статичный и не
  // нуждается в полном DPR на 4K-экране.
  const pixelBudget = Math.sqrt(4_000_000 / (width * height))
  const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.max(0.75, pixelBudget))
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)

  const g = canvas.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.fillStyle = '#04050a'
  g.fillRect(0, 0, width, height)

  const rng = mulberry32(hashStr(`${seed}:cosmos`))

  // Мягкие небулы рисуются один раз прямо в bitmap. Полноэкранного CSS blur
  // нет, поэтому пан/зум SVG не заставляет браузер пересчитывать фильтр.
  blob(g, width * 0.52, height * 0.43, width * 0.42, height * 0.62, hue, 0.10)
  blob(g, width * 0.28, height * 0.30, width * 0.30, height * 0.38, (hue - 18 + 360) % 360, 0.035)
  blob(g, width * 0.79, height * 0.57, width * 0.28, height * 0.42, (hue + 24) % 360, 0.045)
  blob(g, width * 0.18, height * 0.74, width * 0.24, height * 0.30, (hue + 125) % 360, 0.02)

  const areaScale = Math.max(0.65, Math.min(1.45, (width * height) / (1920 * 1080)))
  // альфы приглушены (21.07): растровый фон — подложка, не соперник контента
  const layers = [
    { count: Math.round(420 * areaScale), maxRadius: 0.9, maxAlpha: 0.26 },
    { count: Math.round(260 * areaScale), maxRadius: 1.3, maxAlpha: 0.4 },
    { count: Math.round(90 * areaScale), maxRadius: 1.9, maxAlpha: 0.55 },
  ]

  for (const layer of layers) {
    for (let i = 0; i < layer.count; i++) {
      const x = rng() * width
      const y = rng() * height
      const radius = 0.3 + rng() * layer.maxRadius
      const alpha = 0.08 + rng() * layer.maxAlpha
      g.fillStyle = rng() < 0.18
        ? `rgba(255, 232, 200, ${alpha})`
        : `rgba(205, 222, 255, ${alpha})`
      g.beginPath()
      g.arc(x, y, radius, 0, TAU)
      g.fill()
    }
  }

  // Редкие яркие звёзды первой величины с крестами-флерами.
  const brightCount = Math.round(16 * areaScale)
  for (let i = 0; i < brightCount; i++) {
    const x = rng() * width
    const y = rng() * height
    const radius = 1 + rng() * 1.4
    const halo = g.createRadialGradient(x, y, 0, x, y, 11)
    halo.addColorStop(0, 'rgba(225, 236, 255, 0.28)')
    halo.addColorStop(1, 'rgba(225, 236, 255, 0)')
    g.fillStyle = halo
    g.beginPath()
    g.arc(x, y, 11, 0, TAU)
    g.fill()
    g.fillStyle = 'rgba(235, 243, 255, 0.9)'
    g.beginPath()
    g.arc(x, y, radius, 0, TAU)
    g.fill()
    g.strokeStyle = 'rgba(235, 243, 255, 0.34)'
    g.lineWidth = 0.7
    const flare = 5 + rng() * 7
    g.beginPath()
    g.moveTo(x - flare, y)
    g.lineTo(x + flare, y)
    g.moveTo(x, y - flare)
    g.lineTo(x, y + flare)
    g.stroke()
  }

  // Холодный горизонт внизу.
  const horizon = g.createLinearGradient(0, height * 0.64, 0, height)
  horizon.addColorStop(0, 'rgba(96, 126, 178, 0)')
  horizon.addColorStop(1, 'rgba(96, 126, 178, 0.07)')
  g.fillStyle = horizon
  g.fillRect(0, height * 0.64, width, height * 0.36)

  // Виньетка — тоже часть готового bitmap, без фильтров в runtime.
  const vignette = g.createRadialGradient(width * 0.5, height * 0.44, Math.min(width, height) * 0.18, width * 0.5, height * 0.44, Math.max(width, height) * 0.72)
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(0.62, 'rgba(2, 3, 7, 0.12)')
  vignette.addColorStop(1, 'rgba(1, 2, 5, 0.88)')
  g.fillStyle = vignette
  g.fillRect(0, 0, width, height)

  // Плёночная фактура только внутри неба и под UI. Это не прежний глобальный
  // оверлей: текст, HUD, модалки и остальное приложение остаются чистыми.
  const tile = document.createElement('canvas')
  tile.width = tile.height = 128
  const tg = tile.getContext('2d')
  if (tg) {
    const image = tg.createImageData(tile.width, tile.height)
    for (let i = 0; i < image.data.length; i += 4) {
      const value = (rng() * 255) | 0
      image.data[i] = image.data[i + 1] = image.data[i + 2] = value
      image.data[i + 3] = 255
    }
    tg.putImageData(image, 0, 0)
    const pattern = g.createPattern(tile, 'repeat')
    if (pattern) {
      g.globalAlpha = 0.035
      g.fillStyle = pattern
      g.fillRect(0, 0, width, height)
      g.globalAlpha = 1
    }
  }
}

/** Статичный космический фон лаборатории: один canvas, перерисовка только при
 * смене hue или размера контейнера, никаких вечных rAF/анимаций/blur. */
export function CosmosBackdrop({ hue, seed }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let frame = 0
    const draw = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => drawBackdrop(canvas, hue, seed))
    }
    draw()
    const resize = new ResizeObserver(draw)
    resize.observe(canvas)
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
    }
  }, [hue, seed])

  return <canvas ref={ref} className="cosmos-backdrop" aria-hidden="true" />
}
