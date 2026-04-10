import { useState, useEffect } from 'react'

type Phase = 'available' | 'downloading' | 'ready' | 'installing' | 'installed' | 'error'

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
    const onInstalled = () => setPhase('installed')
    window.api.on('update:progress', onProgress)
    window.api.on('update:ready', onReady)
    window.api.on('update:error', onError)
    window.api.on('update:installed', onInstalled)
    return () => {
      window.api.off('update:progress', onProgress)
      window.api.off('update:ready', onReady)
      window.api.off('update:error', onError)
      window.api.off('update:installed', onInstalled)
    }
  }, [])

  async function install() {
    if (phase === 'available' || phase === 'error') {
      setPhase('downloading')
      setProgress(0)
      setErrorMsg('')
      await window.api.updates.download()
    } else if (phase === 'ready') {
      setPhase('installing')
      window.api.updates.install()
    }
  }

  // ─── Full-screen installing overlay ───────────────────────────────────────
  if (phase === 'installing' || phase === 'installed') {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'var(--bg)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 32
      }}>
        {/* Logo / título */}
        <div className="flex-col items-center" style={{ gap: 8 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--orange)', letterSpacing: '-0.5px' }}>
            Atom Migrador
          </span>
          <span className="text-muted" style={{ fontSize: 13 }}>
            {phase === 'installing' ? `Actualizando a v${version}…` : `v${version} instalada`}
          </span>
        </div>

        {/* Card de estado */}
        <div className="card flex-col gap-20" style={{
          width: 420, padding: 32,
          boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
          border: '1px solid var(--border)'
        }}>
          <div className="card-header" style={{ marginBottom: 0 }}>
            <div className="card-strip" />
            <span className="card-title">
              {phase === 'installing' ? 'Instalando actualización' : 'Actualización completada'}
            </span>
          </div>

          {phase === 'installing' && (
            <div className="flex-col gap-12">
              <div className="text-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
                El instalador está aplicando la nueva versión.<br />
                <span style={{ color: 'var(--amber)' }}>No cierres la aplicación.</span>
              </div>
              <div className="progress-track progress-indeterminate">
                <div className="progress-fill" />
              </div>
            </div>
          )}

          {phase === 'installed' && (
            <div className="flex-col gap-12">
              <div className="badge badge-ok" style={{ alignSelf: 'flex-start' }}>
                ✓ Instalación completada
              </div>
              <div className="text-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
                La aplicación se cerrará en unos segundos.<br />
                Ábrela manualmente para usar la nueva versión.
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ─── Normal update modal ───────────────────────────────────────────────────
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
            {phase === 'ready'       && '↻ Instalar ahora'}
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
