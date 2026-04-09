import { useState, useEffect, useCallback } from 'react'

interface Props {
  remote: string
  label: string
  nsMode?: 'private' | 'team_space'
  nsId?: string
  driveId?: string
  onSelect: (path: string) => void
}

export default function FolderBrowser({ remote, label, nsMode, nsId, driveId, onSelect }: Props) {
  const [path, setPath] = useState('')
  const [stack, setStack] = useState<string[]>([])
  const [items, setItems] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const load = useCallback(async (newPath: string) => {
    if (!remote) return
    setLoading(true)
    setError('')
    setItems([])
    setSelected('')
    const result = await window.api.rclone.listFolders(remote, newPath, nsMode, nsId, driveId)
    setLoading(false)
    if ('error' in result) {
      setError(result.error || 'Error al cargar carpetas')
    } else {
      setItems(result.folders)
    }
  }, [remote, nsMode, nsId, driveId])

  useEffect(() => {
    if (remote) {
      setPath('')
      setStack([])
      setConfirmed(null)
      load('')
    }
  }, [remote, nsMode, nsId, driveId, load])

  function enter() {
    if (!selected) return
    const newPath = path ? `${path}/${selected}` : selected
    setStack(s => [...s, path])
    setPath(newPath)
    load(newPath)
  }

  function goUp() {
    if (stack.length === 0) return
    const prev = stack[stack.length - 1]
    setStack(s => s.slice(0, -1))
    setPath(prev)
    load(prev)
  }

  function confirmSelection() {
    const display = path ? `/${path}` : '/'
    setConfirmed(display)
    onSelect(path)
  }

  const breadcrumb = `/${path}`

  return (
    <div className="flex-col gap-8" style={{ height: '100%' }}>
      {/* Breadcrumb */}
      <div className="mono text-muted" style={{ fontSize: 12, padding: '0 2px' }}>
        {remote ? breadcrumb : '—'}
      </div>

      {/* List */}
      <ul className="folder-list" style={{ flex: 1, minHeight: 0 }}>
        {loading && (
          <li className="folder-item text-muted" style={{ justifyContent: 'center', padding: '12px 0' }}>
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
            &nbsp;Cargando…
          </li>
        )}
        {!loading && error && (
          <li className="folder-item text-red">{error}</li>
        )}
        {!loading && !error && items.length === 0 && (
          <li className="folder-item text-muted" style={{ padding: '12px 0', justifyContent: 'center' }}>
            (sin subcarpetas)
          </li>
        )}
        {!loading && items.map(item => (
          <li
            key={item}
            className={`folder-item${selected === item ? ' active' : ''}`}
            onClick={() => setSelected(item)}
            onDoubleClick={() => { setSelected(item); enter() }}
          >
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>📁</span>
            {item}
          </li>
        ))}
      </ul>

      {/* Controls */}
      <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={goUp} disabled={stack.length === 0 || loading}>
          ↑ Subir
        </button>
        <button className="btn btn-sm" onClick={enter} disabled={!selected || loading}>
          Entrar →
        </button>
        <button className="btn btn-primary btn-sm" onClick={confirmSelection} disabled={loading}>
          {label}
        </button>
        <button className="btn btn-sm" onClick={() => load(path)} disabled={loading}>
          ↺ Recargar
        </button>
      </div>

      {/* Selected indicator */}
      {confirmed && (
        <div className="badge badge-ok" style={{ alignSelf: 'flex-start' }}>
          ✓ {confirmed}
        </div>
      )}
    </div>
  )
}
