import { useState, useEffect } from 'react'

type Phase = 'available' | 'downloading' | 'ready' | 'error'

interface Props {
  version: string
  currentVersion: string
  onDismiss: () => void
}

export default function UpdateModal({ version, currentVersion, onDismiss }: Props) {
  const [phase, setPhase] = useState<Phase>('available')
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const onProgress = (pct: unknown) => setProgress(Number(pct))
    const onReady = () => setPhase('ready')
    const onError = (msg: unknown) => {
      setErrorMsg(String(msg))
      setPhase('error')
    }
    window.api.on('update:progress', onProgress)
    window.api.on('update:ready', onReady)
    window.api.on('update:error', onError)
    return () => {
      window.api.off('update:progress', onProgress)
      window.api.off('update:ready', onReady)
      window.api.off('update:error', onError)
    }
  }, [])

  async function install() {
    if (phase === 'available' || phase === 'error') {
      setPhase('downloading')
      setProgress(0)
      setErrorMsg('')
      await window.api.updates.download()
    } else if (phase === 'ready') {
      window.api.updates.install()
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div className="card flex-col gap-16" style={{
        width: 420, padding: 28,
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
        border: '1px solid var(--border)'
      }}>
        <div className="card-header" style={{ marginBottom: 0 }}>
          <div className="card-strip" />
          <span className="card-title">Nueva versión disponible</span>
        </div>

        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <div className="text-muted">Versión actual: <span style={{ color: 'var(--text)' }}>{currentVersion}</span></div>
          <div className="text-muted">Nueva versión: <span style={{ color: 'var(--green)', fontWeight: 600 }}>{version}</span></div>
        </div>

        {phase === 'downloading' && (
          <div className="flex-col gap-6">
            <div className="text-muted" style={{ fontSize: 12 }}>Descargando… {progress}%</div>
            <div style={{ height: 6, background: 'var(--surface)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${progress}%`,
                background: 'var(--orange)', borderRadius: 3,
                transition: 'width 0.3s'
              }} />
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="flex-col gap-4">
            <div className="badge badge-err" style={{ alignSelf: 'flex-start' }}>
              ✗ Error al descargar
            </div>
            {errorMsg && (
              <div className="mono text-muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                {errorMsg}
              </div>
            )}
          </div>
        )}

        {phase === 'ready' && (
          <div className="badge badge-ok" style={{ alignSelf: 'flex-start' }}>
            ✓ Descarga completada — lista para instalar
          </div>
        )}

        <div className="flex gap-12">
          <button
            className="btn btn-primary"
            onClick={install}
            disabled={phase === 'downloading'}
          >
            {phase === 'available'   && 'Instalar'}
            {phase === 'downloading' && '⟳ Descargando…'}
            {phase === 'ready'       && '↻ Reiniciar e instalar'}
            {phase === 'error'       && '↺ Reintentar'}
          </button>
          {phase !== 'downloading' && (
            <button className="btn" onClick={onDismiss}>
              Más tarde
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
