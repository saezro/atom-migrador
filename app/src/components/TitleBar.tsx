import { useState, useEffect, useRef } from 'react'
import AtomIcon from './AtomIcon'

type CheckState = 'idle' | 'checking' | 'up-to-date' | 'error'

export default function TitleBar() {
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState('')
  const [checkState, setCheckState] = useState<CheckState>('idle')
  const logoRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.getVersion().then(v => setVersion(v))

    const onNotAvailable = () => {
      setCheckState('up-to-date')
      setTimeout(() => setCheckState('idle'), 4000)
    }
    const onAvailable = () => {
      setOpen(false)
      setCheckState('idle')
    }
    window.api.on('update:not-available', onNotAvailable)
    window.api.on('update:available', onAvailable)
    return () => {
      window.api.off('update:not-available', onNotAvailable)
      window.api.off('update:available', onAvailable)
    }
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (logoRef.current && !logoRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function checkUpdates() {
    setCheckState('checking')
    try {
      await window.api.updates.check()
      // Give it 8s; if neither event fires treat as up-to-date
      setTimeout(() => {
        setCheckState(s => s === 'checking' ? 'up-to-date' : s)
        setTimeout(() => setCheckState(s => s === 'up-to-date' ? 'idle' : s), 4000)
      }, 8000)
    } catch {
      setCheckState('error')
      setTimeout(() => setCheckState('idle'), 4000)
    }
  }

  return (
    <div className="title-bar">
      {/* Logo + dropdown trigger */}
      <div
        ref={logoRef}
        className="title-bar-logo"
        style={{ cursor: 'pointer', userSelect: 'none', position: 'relative' }}
        onClick={() => setOpen(o => !o)}
      >
        <AtomIcon size={20} />
        <span className="title-bar-title">ATOM MIGRADOR</span>

        {open && (
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 9999,
              background: 'var(--panel)', border: '1px solid var(--border)',
              borderRadius: 8, minWidth: 230,
              boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
              overflow: 'hidden'
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Acerca de */}
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 10
            }}>
              <AtomIcon size={28} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--orange)' }}>
                  Atom Migrador
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  versión {version || '…'}
                </div>
              </div>
            </div>

            {/* Buscar actualizaciones */}
            <div style={{ padding: '8px' }}>
              <button
                className="btn btn-sm"
                style={{ width: '100%', justifyContent: 'flex-start', gap: 8 }}
                onClick={checkUpdates}
                disabled={checkState === 'checking'}
              >
                {checkState === 'idle'       && <><span>↺</span> Buscar actualizaciones</>}
                {checkState === 'checking'   && <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span> Buscando…</>}
                {checkState === 'up-to-date' && <><span style={{ color: 'var(--green)' }}>✓</span> Estás al día</>}
                {checkState === 'error'      && <><span style={{ color: 'var(--red)' }}>✗</span> Error al comprobar</>}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="title-bar-spacer" />

      <div className="title-bar-controls">
        <button className="wc-btn" onClick={() => window.api.window.minimize()} title="Minimizar">─</button>
        <button className="wc-btn" onClick={() => window.api.window.maximize()} title="Maximizar">□</button>
        <button className="wc-btn close" onClick={() => window.api.window.close()} title="Cerrar">✕</button>
      </div>
    </div>
  )
}

