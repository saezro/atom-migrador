import { useState, useEffect } from 'react'

interface Props {
  onReady: () => void
}

type RCStatus = 'unchecked' | 'found' | 'not-found' | 'installing' | 'error'

export default function RequirementsPage({ onReady }: Props) {
  const [status, setStatus] = useState<RCStatus>('unchecked')
  const [version, setVersion] = useState('')
  const [installMsg, setInstallMsg] = useState('')

  async function checkRC() {
    setStatus('unchecked')
    const result = await window.api.rclone.check()
    if (result.found) {
      setVersion(result.version)
      setStatus('found')
    } else {
      setStatus('not-found')
    }
  }

  useEffect(() => { checkRC() }, [])

  async function install() {
    setStatus('installing')
    setInstallMsg('Instalando…')

    const listener = (msg: unknown) => setInstallMsg(String(msg))
    window.api.on('rclone:install-progress', listener)

    const result = await window.api.rclone.install()

    window.api.off('rclone:install-progress', listener)

    if (result === 'error') {
      setStatus('error')
      setInstallMsg('Error. Descarga rclone.exe manualmente de rclone.org y ponlo en la carpeta del script.')
    } else {
      setInstallMsg(`Instalado (${result})`)
      await checkRC()
    }
  }

  const ready = status === 'found'

  return (
    <div className="flex-col gap-16" style={{ maxWidth: 860 }}>
      {/* Header card */}
      <div className="card">
        <div className="card-header">
          <div className="card-strip" />
          <span className="card-title">Requisitos del sistema</span>
        </div>

        <p className="text-muted" style={{ fontSize: 13, marginBottom: 6 }}>
          Este programa necesita <strong className="text-orange">rclone</strong> instalado para funcionar.
          Es el motor de transferencia en la nube — se instala automáticamente si no está disponible.
        </p>

        <div className="divider" />

        {/* rclone status row */}
        <div className="flex items-center gap-16" style={{ flexWrap: 'wrap' }}>
          <div className="flex items-center gap-8">
            <span className="bold">rclone</span>
            {status === 'found' && (
              <span className="badge badge-ok">✓ {version}</span>
            )}
            {status === 'not-found' && (
              <span className="badge badge-err">✗ No encontrado</span>
            )}
            {status === 'unchecked' && (
              <span className="badge badge-info">Comprobando…</span>
            )}
            {status === 'installing' && (
              <span className="badge badge-warn">⟳ Instalando…</span>
            )}
            {status === 'error' && (
              <span className="badge badge-err">Error de instalación</span>
            )}
          </div>

          <div className="flex gap-8">
            <button className="btn btn-sm" onClick={checkRC} disabled={status === 'installing'}>
              Comprobar
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={install}
              disabled={status === 'found' || status === 'installing'}
            >
              Instalar rclone
            </button>
          </div>
        </div>

        {(status === 'installing' || installMsg) && (
          <>
            {status === 'installing' && (
              <div className="progress-track progress-indeterminate" style={{ marginTop: 12 }}>
                <div className="progress-fill" />
              </div>
            )}
            <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>{installMsg}</p>
          </>
        )}
      </div>

      {/* Methods info */}
      <div className="card">
        <div className="card-header">
          <div className="card-strip" />
          <span className="card-title">Métodos de instalación</span>
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.9 }}>
          <div><span className="text-orange">Método 1 — winget (automático):</span></div>
          <div style={{ paddingLeft: 16 }}>winget install Rclone.Rclone</div>
          <br />
          <div><span className="text-orange">Método 2 — descarga directa (automático si winget falla):</span></div>
          <div style={{ paddingLeft: 16 }}>Descarga rclone.exe de rclone.org y lo copia junto al script</div>
          <br />
          <div><span className="text-orange">Método 3 — manual:</span></div>
          <div style={{ paddingLeft: 16 }}>Descarga el ZIP de rclone.org/downloads y pon rclone.exe en la carpeta del script</div>
        </div>
      </div>

      {/* Continue */}
      <div>
        <button
          className="btn btn-primary btn-lg"
          disabled={!ready}
          onClick={onReady}
        >
          Continuar → Configurar cuentas
        </button>
        {!ready && (
          <span className="text-muted" style={{ fontSize: 12, marginLeft: 12 }}>
            Instala o detecta rclone para continuar
          </span>
        )}
      </div>
    </div>
  )
}
