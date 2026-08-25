import { useEffect } from 'react'

interface Props {
  kind: 'skill' | 'char'
  name: string
  level: number
  onDone: () => void
}

export function LevelUpOverlay({ kind, name, level, onDone }: Props) {
  useEffect(() => {
    const t = setTimeout(onDone, 2600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="lvlup" onClick={onDone}>
      <div className="lvlup-inner">
        <div className="lvlup-line" />
        <div className="lvlup-title">{kind === 'skill' ? 'Навык повышен' : 'Уровень повышен'}</div>
        <div className="lvlup-sub">{`${name} · уровень ${level}`}</div>
        <div className="lvlup-line" />
      </div>
    </div>
  )
}
