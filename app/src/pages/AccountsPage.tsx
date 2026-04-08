import { useState, useEffect } from 'react'

interface Props {
  remoteDB: string
  remoteGD: string
  onRemoteDBChange: (v: string) => void
  onRemoteGDChange: (v: string) => void
  onReady: () => void
}

type ConnStatus = 'idle' | 'connecting' | 'ok' | 'error'

function AccountCard({
  title,
  backend,
  remote,
  onRemoteChange,
  status,
  statusMsg,
  onConnect,
  hint,
}: {
  title: string
  backend: string
  remote: string
  onRemoteChange: (v: string) => void
  status: ConnStatus
  statusMsg: string
  onConnect: () => void
  hint?: string
}) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-strip" />
        <span className="card-title">{title}</span>
      </div>

      <div className="flex items-center gap-12" style={{ marginBottom: 10 }}>
        <span className="section-label" style={{ margin: 0, minWidth: 130 }}>Nombre del remote:</span>
        <input
          className="input"
          value={remote}
          onChange={e => onRemoteChange(e.target.value)}
          placeholder={backend}
          style={{ maxWidth: 180 }}
        />
        <span className="text-muted" style={{ fontSize: 12 }}>(sin espacios, como quieras llamarlo)</span>
      </div>

      <p className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>
        Pulsa el botón para abrir el navegador. Inicia sesión y acepta los permisos.
      </p>
      <p className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        El token se guardará automáticamente sin que tengas que copiar nada.
      </p>
      {hint && (
        <p className="text-amber" style={{ fontSize: 12, marginBottom: 12 }}>{hint}</p>
      )}

      {status === 'connecting' && (
        <div className="progress-track progress-indeterminate" style={{ marginBottom: 10 }}>
          <div className="progress-fill" />
        </div>
      )}

      <div className="flex items-center gap-12">
        <button
          className="btn btn-primary"
          onClick={onConnect}
          disabled={status === 'connecting'}
        >
          {status === 'connecting' ? '⟳ Conectando…' : `Conectar ${title}`}
        </button>

        {status === 'ok' && <span className="badge badge-ok">✓ Conectado</span>}
        {status === 'error' && <span className="badge badge-err">✗ {statusMsg}</span>}
        {status === 'connecting' && (
          <span className="text-muted" style={{ fontSize: 12 }}>
            Inicia sesión en el navegador y acepta los permisos…
          </span>
        )}
      </div>
    </div>
  )
}

export default function AccountsPage({
  remoteDB, remoteGD, onRemoteDBChange, onRemoteGDChange, onReady
}: Props) {
  const [dbStatus, setDbStatus] = useState<ConnStatus>('idle')
  const [dbMsg, setDbMsg] = useState('')
  const [gdStatus, setGdStatus] = useState<ConnStatus>('idle')
  const [gdMsg, setGdMsg] = useState('')
  const [verifyMsg, setVerifyMsg] = useState('')
  const [verifyOk, setVerifyOk] = useState(false)

  // Load saved remote names
  useEffect(() => {
    window.api.env.load().then(data => {
      if (data.RemoteDB) onRemoteDBChange(data.RemoteDB)
      if (data.RemoteGD) onRemoteGDChange(data.RemoteGD)
    })
  }, [])

  async function connectDropbox() {
    setDbStatus('connecting')
    setDbMsg('')
    const name = remoteDB.trim() || 'dropbox'
    onRemoteDBChange(name)
    const result = await window.api.rclone.authorize('dropbox', name)
    if (result.ok) {
      setDbStatus('ok')
      window.api.env.save({ RemoteDB: name, RemoteGD: remoteGD })
    } else {
      setDbStatus('error')
      setDbMsg(result.error ?? 'Error desconocido')
    }
  }

  async function connectGDrive() {
    setGdStatus('connecting')
    setGdMsg('')
    const name = remoteGD.trim() || 'gdrive'
    onRemoteGDChange(name)
    const result = await window.api.rclone.authorize('drive', name)
    if (result.ok) {
      setGdStatus('ok')
      window.api.env.save({ RemoteDB: remoteDB, RemoteGD: name })
    } else {
      setGdStatus('error')
      setGdMsg(result.error ?? 'Error desconocido')
    }
  }

  async function verify() {
    const remotes = await window.api.rclone.listRemotes()
    const hasDB = remotes.includes(remoteDB.trim())
    const hasGD = remotes.includes(remoteGD.trim())
    if (hasDB && hasGD) {
      setVerifyOk(true)
      setVerifyMsg('Ambas cuentas conectadas correctamente.')
      setDbStatus('ok')
      setGdStatus('ok')
    } else if (!hasDB && !hasGD) {
      setVerifyOk(false)
      setVerifyMsg('Ninguna cuenta conectada todavía.')
    } else if (!hasDB) {
      setVerifyOk(false)
      setVerifyMsg(`Dropbox (${remoteDB}) no encontrado. Conecta primero.`)
    } else {
      setVerifyOk(false)
      setVerifyMsg(`Google Drive (${remoteGD}) no encontrado. Conecta primero.`)
    }
  }

  const canContinue = dbStatus === 'ok' && gdStatus === 'ok'

  return (
    <div className="flex-col gap-16" style={{ maxWidth: 860 }}>
      <AccountCard
        title="Dropbox"
        backend="dropbox"
        remote={remoteDB}
        onRemoteChange={onRemoteDBChange}
        status={dbStatus}
        statusMsg={dbMsg}
        onConnect={connectDropbox}
      />

      <AccountCard
        title="Google Drive"
        backend="drive"
        remote={remoteGD}
        onRemoteChange={onRemoteGDChange}
        status={gdStatus}
        statusMsg={gdMsg}
        onConnect={connectGDrive}
        hint="Usa la cuenta que tenga acceso a las Shared Drives de tu empresa."
      />

      {/* Verify */}
      <div className="card">
        <div className="flex items-center gap-12" style={{ flexWrap: 'wrap' }}>
          <button className="btn" onClick={verify}>
            Verificar conexiones
          </button>
          {verifyMsg && (
            <span className={`badge ${verifyOk ? 'badge-ok' : 'badge-err'}`}>
              {verifyOk ? '✓' : '✗'} {verifyMsg}
            </span>
          )}
        </div>
      </div>

      <div>
        <button
          className="btn btn-primary btn-lg"
          disabled={!canContinue}
          onClick={onReady}
        >
          Cuentas listas → Ir a Migrar
        </button>
        {!canContinue && (
          <span className="text-muted" style={{ fontSize: 12, marginLeft: 12 }}>
            Conecta ambas cuentas para continuar
          </span>
        )}
      </div>
    </div>
  )
}
