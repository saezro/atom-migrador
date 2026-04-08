import { useRef, useEffect } from 'react'

export interface LogLine {
  text: string
  color?: string
}

function lineColor(text: string): string {
  if (/error|ERROR/i.test(text)) return 'var(--red)'
  if (/Transferred/i.test(text)) return 'var(--green)'
  if (/ETA|Checks:|transferred/i.test(text)) return 'var(--orange)'
  if (/NOTICE|WARN/i.test(text)) return 'var(--amber)'
  return 'var(--text)'
}

interface Props {
  lines: LogLine[]
  height?: number | string
}

export default function LogViewer({ lines, height = 200 }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="log-viewer" style={{ height }}>
      {lines.map((l, i) => (
        <div key={i} style={{ color: l.color ?? lineColor(l.text) }}>
          {l.text}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}
