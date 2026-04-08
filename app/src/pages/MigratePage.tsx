import { useState, useEffect, useCallback, useRef } from 'react'
import FolderBrowser from '../components/FolderBrowser'
import StatCard from '../components/StatCard'
import LogViewer from '../components/LogViewer'
import type { LogLine } from '../components/LogViewer'
import type { DriveItem, SyncConfig } from '../env.d'

interface Props {
  remoteDB: string
  remoteGD: string
}

type MigStatus = 'idle' | 'running' | 'done' | 'error'
type DBNamespace = 'private' | 'team_space'

interface Stats {
  files: string
  speed: string
  eta: string
  progress: string
  errors: string
}

export default function MigratePage({ remoteDB, remoteGD }: Props) {
  // ── Dropbox state
  const [dbNS, setDbNS] = useState<DBNamespace>('private')
  const [dbNSId, setDbNSId] = useState('')
  const [dbTeamName, setDbTeamName] = useState('')
  const [loadingTeam, setLoadingTeam] = useState(false)
  const [carpOrig, setCarpOrig] = useState<string | null>(null)
  const [origKey, setOrigKey] = useState(0) // force remount FolderBrowser

  // ── Google Drive state
  const [drives, setDrives] = useState<DriveItem[]>([])
  const [selectedDrive, setSelectedDrive] = useState<DriveItem | null>(null)
  const [loadingDrives, setLoadingDrives] = useState(false)
  const [driveError, setDriveError] = useState('')
  const [carpDest, setCarpDest] = useState<string | null>(null)
  const [destKey, setDestKey] = useState(0)

  // ── Options
  const [dryRun, setDryRun] = useState(true)
  const [createSubfolder, setCreateSubfolder] = useState(true)
  const [bandwidth, setBandwidth] = useState('0')
  const [transfers, setTransfers] = useState(32)

  // ── Migration state
  const [migStatus, setMigStatus] = useState<MigStatus>('idle')
  const [logLines, setLogLines] = useState<LogLine[]>([])
  const [stats, setStats] = useState<Stats>({ files: '', speed: '', eta: '', progress: '', errors: '0' })
  const [logDir, setLogDir] = useState('')

  // Keep latest stats ref for listener closure
  const statsRef = useRef(stats)

  const appendLog = useCallback((text: string) => {
    setLogLines(prev => [...prev, { text }])
  }, [])

  // Listen for IPC events from main
  useEffect(() => {
    const onLog = (text: unknown) => appendLog(String(text))
    const onStats = (incoming: unknown) => {
      setStats(prev => ({ ...prev, ...(incoming as Partial<Stats>) }))
    }
    const onDone = (data: unknown) => {
      const d = data as { code: number; logDir: string }
      setMigStatus(d.code === 0 ? 'done' : 'error')
      if (d.logDir) setLogDir(d.logDir)
      appendLog(d.code === 0 ? '✓ Migración completada.' : `✗ Proceso terminado con código ${d.code}`)
    }
    const onInstallProgress = (msg: unknown) => appendLog(String(msg))

    window.api.on('migration:log', onLog)
    window.api.on('migration:stats', onStats)
    window.api.on('migration:done', onDone)
    window.api.on('rclone:install-progress', onInstallProgress)

    return () => {
      window.api.off('migration:log', onLog)
      window.api.off('migration:stats', onStats)
      window.api.off('migration:done', onDone)
      window.api.off('rclone:install-progress', onInstallProgress)
    }
  }, [appendLog])

  // ── Load drives
  async function loadDrives() {
    if (!remoteGD) return
    setLoadingDrives(true)
    setDriveError('')
    setDrives([])
    setSelectedDrive(null)
    const result = await window.api.rclone.listDrives(remoteGD)
    setLoadingDrives(false)
    if (result && result.length > 0) {
      setDrives(result)
    } else {
      setDriveError('Sin Shared Drives disponibles. Comprueba permisos.')
    }
  }

  // ── Dropbox namespace toggle
  async function switchToTeam() {
    if (!dbNSId) {
      setLoadingTeam(true)
      const ns = await window.api.dropbox.getTeamNs(remoteDB)
      setLoadingTeam(false)
      if (!ns || !ns.id) {
        alert('No se pudo obtener el namespace del equipo.\n\nPosibles causas:\n• La cuenta no es Dropbox Business\n• El token ha caducado (reconecta Dropbox)\n• Sin conexión a internet')
        return
      }
      setDbNSId(ns.id)
      setDbTeamName(ns.name || 'Equipo')
    }
    setDbNS('team_space')
    setOrigKey(k => k + 1)
  }

  function switchToPersonal() {
    setDbNS('private')
    setOrigKey(k => k + 1)
  }

  // ── Start migration
  async function startMigration() {
    if (!selectedDrive) return
    if (carpOrig === null || carpDest === null) return

    const config: SyncConfig = {
      remoteDB,
      remoteGD,
      carpOrig: carpOrig ?? '',
      carpDest: carpDest ?? '',
      driveId: selectedDrive.id,
      driveName: selectedDrive.name,
      dryRun,
      createSubfolder,
      bandwidth,
      transfers,
      dbNamespace: dbNS,
      dbNamespaceId: dbNSId
    }

    const origVis = carpOrig ? `/${carpOrig}` : `(raíz de ${remoteDB})`
    let destVis = selectedDrive.name + (carpDest ? `/${carpDest}` : '/')
    if (createSubfolder) {
      const srcName = carpOrig ? carpOrig.split('/').pop() : remoteDB
      destVis += `${srcName}/`
    }

    const msg = [
      `Se va a ${dryRun ? 'SIMULAR' : 'EJECUTAR'} la siguiente migración:`,
      '',
      `ORIGEN  (Dropbox):  ${origVis}`,
      `DESTINO (Drive):    ${destVis}`,
      '',
      createSubfolder
        ? 'MODO: se creará la carpeta del origen dentro del destino.'
        : 'MODO: el contenido del origen se vuelca DIRECTAMENTE en el destino.',
      '',
      `Transferencias: ${transfers}   |   Banda: ${bandwidth === '0' ? 'libre' : bandwidth}`,
      dryRun ? '\n⚠ SIMULACIÓN: no se moverá nada.' : '',
    ].join('\n')

    if (!confirm(msg + '\n\n¿Continuar?')) return

    setMigStatus('running')
    setLogLines([])
    setStats({ files: '', speed: '', eta: '', progress: '', errors: '0' })

    const result = await window.api.rclone.startSync(config)
    if (result?.error) {
      setMigStatus('error')
      appendLog(`✗ Error: ${result.error}`)
    }
  }

  async function stopMigration() {
    await window.api.rclone.stopSync()
    appendLog('— Detención solicitada…')
  }

  const canMigrate = !!selectedDrive && carpOrig !== null && carpDest !== null && migStatus !== 'running'

  return (
    <div className="flex-col gap-16" style={{ height: '100%' }}>
      {/* ── Two-panel selector ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Dropbox origin */}
        <div className="card flex-col gap-12" style={{ minHeight: 460 }}>
          <div className="card-header">
            <div className="card-strip" />
            <span className="card-title">Origen (Dropbox)</span>
          </div>

          {/* Namespace toggle */}
          <div className="flex gap-8">
            <button
              className={`btn btn-sm${dbNS === 'private' ? ' btn-primary' : ''}`}
              onClick={switchToPersonal}
            >
              Personal
            </button>
            <button
              className={`btn btn-sm${dbNS === 'team_space' ? ' btn-primary' : ''}`}
              onClick={switchToTeam}
              disabled={loadingTeam}
            >
              {loadingTeam ? '⟳ Cargando…' : dbTeamName || 'Equipo'}
            </button>
          </div>

          <div style={{ flex: 1, minHeight: 0 }}>
            <FolderBrowser
              key={`db-${origKey}-${dbNS}`}
              remote={remoteDB}
              label="Usar esta carpeta"
              nsMode={dbNS}
              nsId={dbNSId || undefined}
              onSelect={(p) => setCarpOrig(p)}
            />
          </div>

          {carpOrig !== null && (
            <div className="badge badge-ok" style={{ alignSelf: 'flex-start' }}>
              ✓ Origen: {carpOrig ? `/${carpOrig}` : `(raíz de ${remoteDB})`}
            </div>
          )}
        </div>

        {/* Google Drive destination */}
        <div className="card flex-col gap-12" style={{ minHeight: 460 }}>
          <div className="card-header">
            <div className="card-strip" />
            <span className="card-title">Destino (Shared Drive)</span>
          </div>

          {/* Drive selector */}
          <div>
            <div className="section-label">Unidad compartida</div>
            <div className="flex gap-8" style={{ marginBottom: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={loadDrives} disabled={loadingDrives}>
                {loadingDrives ? '⟳ Cargando…' : 'Cargar unidades'}
              </button>
              {driveError && <span className="badge badge-err">{driveError}</span>}
            </div>

            {drives.length > 0 && (
              <ul className="folder-list" style={{ maxHeight: 100 }}>
                {drives.map(d => (
                  <li
                    key={d.id}
                    className={`folder-item${selectedDrive?.id === d.id ? ' active' : ''}`}
                    onClick={() => {
                      setSelectedDrive(d)
                      setCarpDest(null)
                      setDestKey(k => k + 1)
                    }}
                  >
                    <span style={{ color: 'var(--orange)' }}>🗂</span>
                    {d.name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="divider" />

          {/* Folder browser inside selected drive */}
          <div className="section-label">Carpeta destino</div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {selectedDrive ? (
              <FolderBrowser
                key={`gd-${destKey}-${selectedDrive.id}`}
                remote={remoteGD}
                label="Destino aquí"
                driveId={selectedDrive.id}
                onSelect={(p) => setCarpDest(p)}
              />
            ) : (
              <div className="text-muted" style={{ fontSize: 12, padding: '8px 0' }}>
                Selecciona una unidad compartida primero.
              </div>
            )}
          </div>

          {carpDest !== null && selectedDrive && (
            <div className="badge badge-ok" style={{ alignSelf: 'flex-start' }}>
              ✓ {selectedDrive.name}{carpDest ? `/${carpDest}` : '/'}
            </div>
          )}
        </div>
      </div>

      {/* ── Options ── */}
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 16, alignItems: 'center' }}>
          <label className="checkbox-label">
            <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
            <span className="text-amber">Simulación (dry-run) — no mueve nada</span>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={createSubfolder} onChange={e => setCreateSubfolder(e.target.checked)} />
            <span>Crear subcarpeta con el nombre del origen</span>
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
        <button
          className="btn btn-primary btn-lg"
          disabled={!canMigrate}
          onClick={startMigration}
        >
          {dryRun ? '▶ Simular migración' : '▶ Iniciar migración'}
        </button>
        <button
          className="btn btn-danger"
          disabled={migStatus !== 'running'}
          onClick={stopMigration}
        >
          ■ Detener
        </button>
        <button className="btn" onClick={() => window.api.shell.openLogs()}>
          📂 Ver logs
        </button>

        {migStatus === 'done' && <span className="badge badge-ok">✓ Completado</span>}
        {migStatus === 'error' && <span className="badge badge-err">✗ Error / detenido</span>}
        {migStatus === 'running' && (
          <span className="badge badge-warn">
            <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
            &nbsp;Migrando…
          </span>
        )}
      </div>

      {/* ── Stats ── */}
      <div className="stat-cards">
        <StatCard title="Archivos" value={stats.files} />
        <StatCard title="Velocidad" value={stats.speed} color="var(--orange)" />
        <StatCard title="ETA" value={stats.eta} />
        <StatCard title="Progreso" value={stats.progress} color="var(--green)" />
        <StatCard title="Errores" value={stats.errors} color={parseInt(stats.errors || '0') > 0 ? 'var(--red)' : 'var(--green)'} />
      </div>

      {/* ── Log ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="flex items-center gap-8">
          <span className="card-title" style={{ textTransform: 'uppercase' }}>Log</span>
          {logLines.length > 0 && (
            <button className="btn btn-sm" onClick={() => setLogLines([])}>Limpiar</button>
          )}
        </div>
        <LogViewer lines={logLines} height="160px" />
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
