import type { FieldStar } from './skyField'

/** Рендер фоновых звёзд: яркие получают ореол, мерцающие — свой ритм. */
export function BgStars({ stars }: { stars: FieldStar[] }) {
  return (
    <>
      {stars.map((s, i) =>
        s.bright ? (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r={s.r * 3} fill={s.fill} opacity={0.09} />
            <circle className={s.tw ? 'bg-star tw' : 'bg-star'} cx={s.x} cy={s.y} r={s.r} fill={s.fill} opacity={s.o}
              style={s.tw ? { animationDuration: `${s.twDur}s`, animationDelay: `${s.twDelay}s` } : undefined} />
          </g>
        ) : (
          <circle key={i} className={s.tw ? 'bg-star tw' : 'bg-star'} cx={s.x} cy={s.y} r={s.r} fill={s.fill} opacity={s.o}
            style={s.tw ? { animationDuration: `${s.twDur}s`, animationDelay: `${s.twDelay}s` } : undefined} />
        ),
      )}
    </>
  )
}
