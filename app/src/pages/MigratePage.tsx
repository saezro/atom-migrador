import { useState, useEffect } from 'react'
import FolderBrowser from '../components/FolderBrowser'
import DriveBrowser from '../components/DriveBrowser'
import type { DriveItem, SyncConfig } from '../env.d'

interface Props {
  remoteDB: string
  remoteGD: string
  rcloneReady?: boolean
  onJobQueued?: () => void
}

export default function MigratePage({ remoteDB, remoteGD, rcloneReady, onJobQueued }: Props) {
  const [jobName, setJobName] = useState('')

  // ── Dropbox — always team_space, load NS on mount
  const [dbNSId, setDbNSId] = useState('')
  const [dbTeamName, setDbTeamName] = useState('')
  const [dbNSError, setDbNSError] = useState('')
  const [dbNSReady, setDbNSReady] = useState(false)
  const [carpOrig, setCarpOrig] = useState<string | null>(null)
  const [origKey, setOrigKey] = useState(0)

  // ── Drive state (lifted from DriveBrowser for the queue payload)
  const [selectedDrive, setSelectedDrive] = useState<DriveItem | null>(null)
  const [carpDest, setCarpDest] = useState<string | null>(null)
  const [driveKey, setDriveKey] = useState(0)

  // ── Options
  const [createSubfolder, setCreateSubfolder] = useState(false)
  const [bandwidth, setBandwidth] = useState('0')
  const [transfers, setTransfers] = useState(32)

  const [lastQueued, setLastQueued] = useState<string>('')

  // Auto-load team namespace — wait for rclone to be detected first
  useEffect(() => {
    if (!remoteDB || !rcloneReady) return
    window.api.dropbox.getTeamNs(remoteDB).then(ns => {
      if (ns && 'id' in ns) {
        setDbNSId(ns.id)
        setDbTeamName(ns.name || '')
        setDbNSReady(true)
        setOrigKey(k => k + 1)
      } else {
        const msg = ns && 'error' in ns ? ns.error : 'No se pudo obtener el espacio de equipo.'
        setDbNSError(msg)
        setDbNSReady(true)
      }
    }).catch((e: unknown) => { setDbNSError(`Error: ${(e as Error)?.message ?? 'desconocido'}`); setDbNSReady(true) })
  }, [remoteDB, rcloneReady])

  // ── Add to queue
  async function queueJob() {
    if (!selectedDrive) return
    if (carpOrig === null || carpDest === null) return

    const config: SyncConfig = {
      remoteDB,
      remoteGD,
      carpOrig: carpOrig ?? '',
      carpDest: carpDest ?? '',
      driveId: selectedDrive.id,
      driveName: selectedDrive.name,
      dryRun: false,
      createSubfolder,
      bandwidth,
      transfers,
      dbNamespace: 'team_space',
      dbNamespaceId: dbNSId
    }

    const origVis = carpOrig ? `/${carpOrig}` : `(raíz de ${remoteDB})`
    let destVis = selectedDrive.name + (carpDest ? `/${carpDest}` : '/')
    if (createSubfolder) {
      const srcName = carpOrig ? carpOrig.split('/').pop() : remoteDB
      destVis += `${srcName}/`
    }

    const autoName =
      jobName.trim() ||
      `${(carpOrig || remoteDB).split('/').pop()} → ${selectedDrive.name}`

    const msg = [
      `Se añadirá a la cola este trabajo:`,
      '',
      `NOMBRE:             ${autoName}`,
      `ORIGEN  (Dropbox):  ${origVis}`,
      `DESTINO (Drive):    ${destVis}`,
      '',
      createSubfolder
        ? 'MODO: se creará la carpeta del origen dentro del destino.'
        : 'MODO: el contenido del origen se vuelca DIRECTAMENTE en el destino.',
      '',
      `Transferencias: ${transfers}   |   Banda: ${bandwidth === '0' ? 'libre' : bandwidth}`,
      '\n✔ Tras copiar, se ejecutará rclone check (--size-only) para verificar.',
      '',
      'El trabajo se ejecutará automáticamente cuando le toque el turno.'
    ].join('\n')

    if (!confirm(msg + '\n\n¿Añadir a la cola?')) return

    const job = await window.api.jobs.add({ name: autoName, config })
    setLastQueued(`✔ Añadido: ${job.name}`)
    setJobName('')
    onJobQueued?.()
  }

  const canQueue = !!selectedDrive && carpOrig !== null && carpDest !== null

  return (
    <div className="flex-col gap-16" style={{ height: '100%' }}>
      {/* ── Two-panel selector ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Dropbox origin */}
        <div className="card flex-col gap-12" style={{ height: 460 }}>
          <div className="card-header">
            <div className="card-strip" />
            <span className="card-title">Origen (Dropbox)</span>
            {dbTeamName && (
              <span className="badge badge-ok" style={{ marginLeft: 8 }}>{dbTeamName}</span>
            )}
            {dbNSError && (
              <span className="badge badge-err" style={{ marginLeft: 8 }}>{dbNSError}</span>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0 }}>
            {dbNSReady ? (
              <FolderBrowser
                key={`db-${origKey}`}
                remote={remoteDB}
                label="Usar esta carpeta"
                nsMode={dbNSId ? 'team_space' : undefined}
                nsId={dbNSId || undefined}
                rootPath={dbTeamName || undefined}
                onSelect={(p) => setCarpOrig(p)}
              />
            ) : (
              <div className="flex items-center gap-8 text-muted" style={{ fontSize: 12, padding: '12px 0' }}>
                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
                Cargando espacio de equipo…
              </div>
            )}
          </div>

          {carpOrig !== null && (
            <div className="badge badge-ok" style={{ alignSelf: 'flex-start' }}>
              ✓ Origen: {carpOrig ? `/${carpOrig}` : `(raíz)`}
            </div>
          )}
        </div>

        {/* Google Drive destination */}
        <div className="card flex-col gap-12" style={{ height: 460 }}>
          <div className="card-header">
            <div className="card-strip" />
            <span className="card-title">Destino (Shared Drive)</span>
          </div>

          <div style={{ flex: 1, minHeight: 0 }}>
            <DriveBrowser
              key={`gd-${driveKey}`}
              remote={remoteGD}
              onSelect={(drive, path) => {
                setSelectedDrive(drive)
                setCarpDest(path)
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Options ── */}
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 16, alignItems: 'center' }}>
          <label className="checkbox-label">
            <input type="checkbox" checked={createSubfolder} onChange={e => setCreateSubfolder(e.target.checked)} />
            <span>{createSubfolder
              ? 'Crear subcarpeta automática en el destino (destino/NombreOrigen/)'
              : 'Volcar directamente en el destino (sin crear subcarpeta)'
            }</span>
          </label>
          <div className="flex items-center gap-8">
            <span className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>Banda:</span>
            <input
              className="input"
              value={bandwidth}
              onChange={e => setBandwidth(e.target.value)}
              placeholder="0"
              style={{ width: 80 }}
            />
            <span className="text-muted" style={{ fontSize: 11 }}>0=libre</span>
          </div>
          <div className="flex items-center gap-8">
            <span className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>Transfers:</span>
            <input
              className="input"
              type="number"
              min={1} max={64}
              value={transfers}
              onChange={e => setTransfers(Number(e.target.value))}
              style={{ width: 70 }}
            />
          </div>
        </div>
      </div>

      {/* ── Action bar ── */}
      <div className="flex items-center gap-12" style={{ flexWrap: 'wrap' }}>
        <input
          className="input"
          placeholder="Nombre del trabajo (opcional)"
          value={jobName}
          onChange={e => setJobName(e.target.value)}
          style={{ minWidth: 260, flex: '0 1 320px' }}
        />
        <button
          className="btn btn-primary btn-lg"
          disabled={!canQueue}
          onClick={queueJob}
        >
          ＋ Añadir a la cola
        </button>
        <button className="btn" onClick={() => window.api.shell.openLogs()}>
          📂 Ver logs
        </button>
        {lastQueued && <span className="badge badge-ok">{lastQueued}</span>}
      </div>

      <div className="text-muted" style={{ fontSize: 12 }}>
        Los trabajos se ejecutan en orden en la pestaña <b>Cola</b>. Tras cada copia,
        se verifica con <code>rclone check (--size-only)</code> que todos los archivos
        existen en el destino con el tamaño correcto.
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
