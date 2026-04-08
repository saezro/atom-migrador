interface Props {
  title: string
  value: string
  color?: string
}

export default function StatCard({ title, value, color }: Props) {
  return (
    <div className="card" style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {title}
      </span>
      <span style={{ fontSize: 18, fontWeight: 700, color: color ?? 'var(--text)', fontFamily: 'var(--mono)' }}>
        {value || '—'}
      </span>
    </div>
  )
}
