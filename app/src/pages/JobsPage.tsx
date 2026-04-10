import { useState, useEffect, useCallback, useRef } from 'react'
import LogViewer from '../components/LogViewer'
import type { LogLine } from '../components/LogViewer'
import type { Job, JobStatus, QueueState } from '../env.d'

const STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'En cola',
  running: 'Ejecutando',
  verifying: 'Verificando',
  done: '✓ OK',
  error: '✗ Error',
  stopped: '■ Detenido',
  interrupted: '⚠ Interrumpido',
  'verify-failed': '✗ Verif. fallida'
}

const STATUS_COLOR: Record<JobStatus, string> = {
  pending: 'var(--text-muted)',
  running: 'var(--orange)',
  verifying: 'var(--amber)',
  done: 'var(--green)',
  error: 'var(--red)',
  stopped: 'var(--text-muted)',
  interrupted: 'var(--red)',
  'verify-failed': 'var(--red)'
}

function fmtDate(iso?: string): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString()
  } catch {
    return iso
  }
}

function describeJob(j: Job): string {
  const o = j.config.carpOrig ? `/${j.config.carpOrig}` : `(raíz ${j.config.remoteDB})`
  let dest = j.config.driveName + (j.config.carpDest ? `/${j.config.carpDest}` : '/')
  if (j.config.createSubfolder) {
    const srcName = j.config.carpOrig ? j.config.carpOrig.split('/').pop() : j.config.remoteDB
    dest += `${srcName}/`
  }
  return `${j.config.remoteDB}:${o}  →  ${dest}`
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [queue, setQueue] = useState<QueueState>({
    paused: false, autorun: true, currentJobId: null, hasRunning: false
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [logLines, setLogLines] = useState<LogLine[]>([])
  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selectedId

  const refresh = useCallback(async () => {
    const [list, st] = await Promise.all([
      window.api.jobs.list(),
      window.api.queue.state()
    ])
    setJobs(list)
    setQueue(st)
    // Always follow the running job in the log panel
    if (st.currentJobId) {
      setSelectedId(st.currentJobId)
    } else if (!selectedRef.current) {
      // No job running and nothing selected: pick first
    }
  }, [])

  // Initial + on jobs:update events
  useEffect(() => {
    refresh()
    const onUpdate = () => refresh()
    const onLog = (text: unknown) => {
      setLogLines(prev => {
        const next = [...prev, { text: String(text) }]
        if (next.length > 1500) next.splice(0, next.length - 1500)
        return next
      })
    }
    window.api.on('jobs:update', onUpdate)
    window.api.on('migration:log', onLog)
    const interval = setInterval(refresh, 2000)
    return () => {
      window.api.off('jobs:update', onUpdate)
      window.api.off('migration:log', onLog)
      clearInterval(interval)
    }
  }, [refresh])

  // Load recent log when switching selection
  useEffect(() => {
    setLogLines([])
    if (!selectedId) return
    window.api.jobs.recentLogs(selectedId).then((entries) => {
      setLogLines(entries.map(e => ({ text: e.line })))
    }).catch(() => {})
  }, [selectedId])

  const selected = jobs.find(j => j.id === selectedId) ?? null

  async function togglePause() {
    await window.api.queue.setPaused(!queue.paused)
    refresh()
  }

  async function toggleAutorun() {
    await window.api.queue.setAutorun(!queue.autorun)
    refresh()
  }

  async function removeJob(id: string) {
    if (!confirm('¿Eliminar este job de la cola?')) return
    const r = await window.api.jobs.remove(id)
    if (!r.ok && r.error) alert(r.error)
    if (selectedId === id) setSelectedId(null)
    refresh()
  }

  async function runNow(id: string) {
    const r = await window.api.jobs.runNow(id)
    if (!r.ok && r.error) alert(r.error)
    refresh()
  }

  async function stopCurrent() {
    if (!confirm('¿Detener la migración en curso?\n\nLos archivos a medio transferir podrían quedar incompletos.')) return
    await window.api.jobs.stop()
    refresh()
  }

  async function reorder(id: string, dir: -1 | 1) {
    await window.api.jobs.reorder(id, dir)
    refresh()
  }

  async function clearFinished() {
    const r = await window.api.jobs.clearFinished()
    if (r.removed > 0 && selectedId) {
      const stillExists = (await window.api.jobs.list()).some(j => j.id === selectedId)
      if (!stillExists) setSelectedId(null)
    }
    refresh()
  }

  async function openLogFolder() {
    if (selected?.logDir) {
      // reuse openLogs but it opens main logs dir; we need a new IPC. Fallback:
      window.api.shell.openLogs()
    } else {
      window.api.shell.openLogs()
    }
  }

  return (
    <div className="flex-col gap-16" style={{ height: '100%' }}>
      {/* ── Queue controls ── */}
      <div className="card flex items-center gap-12" style={{ flexWrap: 'wrap' }}>
        <span className="card-title" style={{ marginRight: 8 }}>COLA</span>
        <button
          className={`btn btn-sm ${queue.paused ? 'btn-primary' : ''}`}
          onClick={togglePause}
        >
          {queue.paused ? '▶ Reanudar cola' : '⏸ Pausar cola'}
        </button>
        <label className="checkbox-label">
          <input type="checkbox" checked={queue.autorun} onChange={toggleAutorun} />
          <span>Ejecutar automáticamente</span>
        </label>
        <button
          className="btn btn-danger btn-sm"
          disabled={!queue.hasRunning}
          onClick={stopCurrent}
        >
          ■ Detener actual
        </button>
        <button className="btn btn-sm" onClick={clearFinished}>
          🧹 Limpiar terminados
        </button>
        <button className="btn btn-sm" onClick={() => window.api.shell.openLogs()}>
          📂 Carpeta de logs
        </button>
        <span style={{ flex: 1 }} />
        <span className="text-muted" style={{ fontSize: 12 }}>
          {jobs.filter(j => j.status === 'pending').length} pendientes ·{' '}
          {jobs.filter(j => j.status === 'done').length} ok ·{' '}
          {jobs.filter(j => j.status === 'error' || j.status === 'verify-failed' || j.status === 'interrupted').length} con problemas
        </span>
      </div>

      {/* ── Job list + detail ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16, flex: 1, minHeight: 0 }}>
        {/* List */}
        <div className="card flex-col" style={{ minHeight: 0, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <span className="card-title">Trabajos ({jobs.length})</span>
          </div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            {jobs.length === 0 && (
              <div className="text-muted" style={{ padding: 16, fontSize: 13 }}>
                No hay trabajos en la cola. Ve a <b>Migrar</b> para crear uno.
              </div>
            )}
            {jobs.map((j, idx) => {
              const active = j.id === selectedId
              const isCurrent = j.id === queue.currentJobId
              return (
                <div
                  key={j.id}
                  onClick={() => setSelectedId(j.id)}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    background: active ? 'rgba(255,140,0,0.08)' : 'transparent',
                    borderLeft: isCurrent
                      ? '3px solid var(--orange)'
                      : active ? '3px solid var(--text-muted)' : '3px solid transparent'
                  }}
                >
                  <div className="flex items-center gap-8" style={{ marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{j.name || `Job ${j.id}`}</span>
                    <span
                      className="badge"
                      style={{
                        background: 'transparent',
                        color: STATUS_COLOR[j.status],
                        border: `1px solid ${STATUS_COLOR[j.status]}`,
                        fontSize: 10
                      }}
                    >
                      {STATUS_LABEL[j.status]}
                    </span>
                    {j.config.dryRun && (
                      <span className="badge badge-warn" style={{ fontSize: 10 }}>DRY-RUN</span>
                    )}
                    {j.verification?.status === 'ok' && (
                      <span className="badge badge-ok" style={{ fontSize: 10 }}>
                        ✓ {j.verification.checked} archivos verificados
                      </span>
                    )}
                    {j.verification?.status === 'fail' && (
                      <span className="badge badge-err" style={{ fontSize: 10 }}>
                        ✗ {j.verification.missing} faltan / {j.verification.differ} difieren
                      </span>
                    )}
                  </div>
                  <div className="text-muted" style={{ fontSize: 11, marginBottom: 6 }}>
                    {describeJob(j)}
                  </div>
                  {j.status === 'running' && j.stats && (
                    <div className="text-muted" style={{ fontSize: 11 }}>
                      {j.stats.progress || '...'} · {j.stats.speed || ''} · ETA {j.stats.eta || '...'}
                    </div>
                  )}
                  <div className="flex gap-8" style={{ marginTop: 6 }}>
                    {j.status === 'pending' && (
                      <>
                        <button
                          className="btn btn-sm"
                          onClick={(e) => { e.stopPropagation(); reorder(j.id, -1) }}
                          disabled={idx === 0}
                          title="Subir"
                        >↑</button>
                        <button
                          className="btn btn-sm"
                          onClick={(e) => { e.stopPropagation(); reorder(j.id, 1) }}
                          disabled={idx === jobs.length - 1}
                          title="Bajar"
                        >↓</button>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={(e) => { e.stopPropagation(); runNow(j.id) }}
                          disabled={queue.hasRunning}
                        >▶ Ejecutar ya</button>
                      </>
                    )}
                    {(j.status === 'error' || j.status === 'interrupted' || j.status === 'verify-failed' || j.status === 'stopped') && (
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={(e) => { e.stopPropagation(); runNow(j.id) }}
                        disabled={queue.hasRunning}
                      >↻ Reintentar</button>
                    )}
                    {j.id !== queue.currentJobId && (
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={(e) => { e.stopPropagation(); removeJob(j.id) }}
                      >✕</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Detail / log */}
        <div className="card flex-col gap-12" style={{ minHeight: 0, overflow: 'hidden' }}>
          <div className="card-header">
            <div className="card-strip" />
            <span className="card-title">{selected ? selected.name : 'Detalle'}</span>
          </div>
          {!selected && (
            <div className="text-muted" style={{ fontSize: 12 }}>
              Selecciona un job para ver detalles y log.
            </div>
          )}
          {selected && (
            <>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                <div><b>Estado:</b> <span style={{ color: STATUS_COLOR[selected.status] }}>{STATUS_LABEL[selected.status]}</span></div>
                <div><b>Creado:</b> {fmtDate(selected.createdAt)}</div>
                <div><b>Iniciado:</b> {fmtDate(selected.startedAt)}</div>
                <div><b>Terminado:</b> {fmtDate(selected.finishedAt)}</div>
                <div><b>Origen:</b> {selected.config.remoteDB}:/{selected.config.carpOrig}</div>
                <div><b>Destino:</b> {selected.config.driveName}/{selected.config.carpDest}</div>
                <div><b>Modo:</b> {selected.config.dryRun ? 'Simulación' : 'Real'} · transfers={selected.config.transfers} · banda={selected.config.bandwidth}</div>
                {selected.errorMsg && (
                  <div style={{ color: 'var(--red)', marginTop: 6 }}><b>Error:</b> {selected.errorMsg}</div>
                )}
                {selected.verification && (
                  <div style={{ marginTop: 6 }}>
                    <b>Verificación:</b>{' '}
                    {selected.verification.status === 'ok' && (
                      <span style={{ color: 'var(--green)' }}>
                        ✓ OK — {selected.verification.checked} archivos coinciden (size-only)
                      </span>
                    )}
                    {selected.verification.status === 'fail' && (
                      <span style={{ color: 'var(--red)' }}>
                        ✗ FALLÓ — {selected.verification.missing} faltan, {selected.verification.differ} difieren
                      </span>
                    )}
                    {selected.verification.status === 'skip' && (
                      <span className="text-muted">— (saltada por dry-run)</span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-8">
                <button className="btn btn-sm" onClick={openLogFolder}>📂 Abrir log</button>
              </div>

              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <span className="section-label">LOG (en vivo + reciente)</span>
                <LogViewer lines={logLines} height="100%" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
