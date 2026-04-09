import { spawn, ChildProcess } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import {
  Job,
  JobStats,
  appendLog,
  getQueueAutorun,
  hasActiveJob,
  nextPendingJob,
  updateJob
} from './db'

interface RunnerCtx {
  rcPath: () => string
  logsDir: string
  send: (channel: string, ...args: unknown[]) => void
}

let ctx: RunnerCtx | null = null
let currentJobId: string | null = null
let currentProc: ChildProcess | null = null
let currentVerifyProc: ChildProcess | null = null
let queuePaused = false

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_')
}

function buildSyncArgs(j: Job): { args: string[]; orig: string; destFull: string } {
  const cfg = j.config
  const orig = `${cfg.remoteDB}:${cfg.carpOrig}`
  let dest = cfg.carpDest
  if (cfg.createSubfolder) {
    const srcName = cfg.carpOrig ? cfg.carpOrig.split('/').pop()! : cfg.remoteDB
    dest = dest ? `${dest}/${srcName}` : srcName
  }
  const destFull = `${cfg.remoteGD}:${dest}`

  const transfers = cfg.transfers
  const checkers = transfers * 3

  const args = [
    'sync', orig, destFull,
    '--drive-team-drive', cfg.driveId,
    '--transfers', String(transfers),
    '--checkers', String(checkers),
    '--fast-list',
    '--retries', '10', '--low-level-retries', '20', '--retries-sleep', '5s',
    '--ignore-errors',
    '--size-only', '--no-traverse', '--no-update-modtime',
    '--drive-chunk-size', '64M', '--drive-upload-cutoff', '64M',
    '--drive-pacer-min-sleep', '10ms', '--drive-pacer-burst', '100',
    '--drive-acknowledge-abuse',
    '--buffer-size', '32M',
    '--tpslimit', '30', '--tpslimit-burst', '60',
    '--stats', '3s', '--stats-one-line', '--use-mmap',
    '--log-level', 'INFO'
  ]
  if (cfg.bandwidth && cfg.bandwidth !== '0') {
    args.push('--bwlimit', cfg.bandwidth)
  }
  if (cfg.dryRun) args.push('--dry-run')

  return { args, orig, destFull }
}

function buildCheckArgs(j: Job, orig: string, destFull: string): string[] {
  const cfg = j.config
  // Verify: every source file exists at destination with same size.
  // --one-way means we only flag MISSING/DIFFERENT in dest, not extras.
  const args = [
    'check', orig, destFull,
    '--drive-team-drive', cfg.driveId,
    '--size-only',
    '--one-way',
    '--fast-list',
    '--checkers', String(cfg.transfers * 3)
  ]
  return args
}

function parseStats(line: string): Partial<JobStats> {
  const stats: Partial<JobStats> = {}
  const etaM = line.match(/ETA\s+(\S+?)(?:\s*\(|$)/)
  if (etaM) stats.eta = etaM[1] === '-' ? '...' : etaM[1]
  const spdM = line.match(/([\d.]+\s*[KMGT]?i?B\/s)/)
  if (spdM) stats.speed = spdM[1]
  const xfrM = line.match(/xfr#(\d+)\/(\d+)/)
  if (xfrM) stats.files = `${xfrM[1]} / ${xfrM[2]}`
  const pctM = line.match(/([\d.]+\s*[KMGT]?i?B)\s*\/\s*([\d.]+\s*[KMGT]?i?B),\s*(\d+)%/)
  if (pctM) stats.progress = `${pctM[3]}%  (${pctM[1]})`
  const errM = line.match(/,\s*(\d+)\s+error/)
  if (errM) stats.errors = errM[1]
  return stats
}

function parseCheckSummary(text: string): { missing: number; differ: number; checked: number } {
  // rclone check writes summary lines like:
  //   "0 differences found"
  //   "12 matching files"
  //   "3 hashes could not be checked"
  //   "2 missing on destination"
  //   "1 differences found"
  let missing = 0
  let differ = 0
  let checked = 0
  const mMissing = text.match(/(\d+)\s+(?:missing on (?:destination|dst)|missing files)/i)
  if (mMissing) missing = parseInt(mMissing[1], 10)
  const mDiff = text.match(/(\d+)\s+differences? found/i)
  if (mDiff) differ = parseInt(mDiff[1], 10)
  const mMatch = text.match(/(\d+)\s+matching files/i)
  if (mMatch) checked = parseInt(mMatch[1], 10)
  return { missing, differ, checked }
}

export function initQueue(c: RunnerCtx): void {
  ctx = c
}

export function isQueuePaused(): boolean {
  return queuePaused
}

export function setQueuePaused(v: boolean): void {
  queuePaused = v
  if (!v) processNext()
}

export function getCurrentJobId(): string | null {
  return currentJobId
}

export function hasRunningJob(): boolean {
  return currentProc !== null || currentVerifyProc !== null || hasActiveJob()
}

function emitJobsUpdate(): void {
  ctx?.send('jobs:update')
}

export function processNext(): void {
  if (!ctx) return
  if (queuePaused) return
  if (currentProc || currentVerifyProc) return
  if (!getQueueAutorun()) return
  const next = nextPendingJob()
  if (!next) return
  runJob(next.id)
}

export function runJob(jobId: string): { ok: boolean; error?: string } {
  if (!ctx) return { ok: false, error: 'queue not initialized' }
  if (currentProc || currentVerifyProc) return { ok: false, error: 'Ya hay un trabajo en curso' }
  const rc = ctx.rcPath()
  if (!rc) return { ok: false, error: 'rclone no encontrado' }

  const job = updateJob(jobId, {
    status: 'running',
    startedAt: new Date().toISOString(),
    errorMsg: undefined,
    exitCode: undefined,
    verification: undefined
  })
  if (!job) return { ok: false, error: 'Job no encontrado' }

  currentJobId = jobId

  const logDir = join(ctx.logsDir, `${ts()}_${jobId}`)
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
  const logPath = join(logDir, 'migration.log')
  try { writeFileSync(logPath, '', 'utf8') } catch { /* ignore */ }
  updateJob(jobId, { logDir, logPath })

  const { args, orig, destFull } = buildSyncArgs(job)

  const header = [
    '='.repeat(50),
    `  JOB ${jobId} — ${job.name}${job.config.dryRun ? ' [SIMULACIÓN]' : ''}`,
    `  Origen:  ${orig}`,
    `  Destino: ${destFull}  (${job.config.driveName})`,
    `  Transfers: ${job.config.transfers}`,
    '='.repeat(50)
  ]
  for (const line of header) {
    ctx.send('migration:log', line)
    appendLog(line, jobId)
    try { appendFileSync(logPath, line + '\n') } catch { /* ignore */ }
  }

  emitJobsUpdate()

  currentProc = spawn(rc, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const handleOutput = (data: Buffer): void => {
    const lines = data.toString('utf8').split(/\r?\n/).filter(l => l.trim())
    for (const line of lines) {
      ctx?.send('migration:log', line)
      appendLog(line, jobId)
      try { appendFileSync(logPath, line + '\n') } catch { /* ignore */ }
      const s = parseStats(line)
      if (Object.keys(s).length > 0) {
        const cur = (updateJob(jobId, {})?.stats) ?? { files: '', speed: '', eta: '', progress: '', errors: '0' }
        const merged = { ...cur, ...s } as JobStats
        updateJob(jobId, { stats: merged })
        ctx?.send('migration:stats', { jobId, stats: merged })
      }
    }
  }

  currentProc.stdout?.on('data', handleOutput)
  currentProc.stderr?.on('data', handleOutput)

  currentProc.on('close', (code) => {
    const exitCode = code ?? -1
    currentProc = null
    if (exitCode !== 0) {
      updateJob(jobId, {
        status: 'error',
        finishedAt: new Date().toISOString(),
        exitCode,
        errorMsg: `Sync terminó con código ${exitCode}`
      })
      ctx?.send('migration:done', { jobId, code: exitCode, logPath, logDir })
      currentJobId = null
      emitJobsUpdate()
      processNext()
      return
    }

    // Sync OK → verify (skip for dry-run)
    if (job.config.dryRun) {
      updateJob(jobId, {
        status: 'done',
        finishedAt: new Date().toISOString(),
        exitCode: 0,
        verification: { status: 'skip', missing: 0, differ: 0, checked: 0, checkedAt: new Date().toISOString() }
      })
      ctx?.send('migration:done', { jobId, code: 0, logPath, logDir })
      currentJobId = null
      emitJobsUpdate()
      processNext()
      return
    }

    runVerification(jobId, orig, destFull, logPath, logDir)
  })

  currentProc.on('error', (e) => {
    currentProc = null
    updateJob(jobId, {
      status: 'error',
      finishedAt: new Date().toISOString(),
      errorMsg: e.message
    })
    ctx?.send('migration:done', { jobId, code: -1, logPath, logDir })
    currentJobId = null
    emitJobsUpdate()
    processNext()
  })

  return { ok: true }
}

function runVerification(
  jobId: string,
  orig: string,
  destFull: string,
  logPath: string,
  logDir: string
): void {
  if (!ctx) return
  const rc = ctx.rcPath()
  const job = updateJob(jobId, { status: 'verifying' })
  if (!job) return
  emitJobsUpdate()

  const args = buildCheckArgs(job, orig, destFull)
  const header = `--- VERIFICACIÓN: rclone check (--size-only --one-way) ---`
  ctx.send('migration:log', header)
  appendLog(header, jobId)
  try { appendFileSync(logPath, header + '\n') } catch { /* ignore */ }

  let output = ''
  currentVerifyProc = spawn(rc, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const handle = (data: Buffer): void => {
    const text = data.toString('utf8')
    output += text
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    for (const line of lines) {
      ctx?.send('migration:log', line)
      appendLog(line, jobId)
      try { appendFileSync(logPath, line + '\n') } catch { /* ignore */ }
    }
  }
  currentVerifyProc.stdout?.on('data', handle)
  currentVerifyProc.stderr?.on('data', handle)

  currentVerifyProc.on('close', (code) => {
    currentVerifyProc = null
    const summary = parseCheckSummary(output)
    const ok = code === 0 && summary.missing === 0 && summary.differ === 0
    const verification = {
      status: (ok ? 'ok' : 'fail') as 'ok' | 'fail',
      missing: summary.missing,
      differ: summary.differ,
      checked: summary.checked,
      checkedAt: new Date().toISOString()
    }
    updateJob(jobId, {
      status: ok ? 'done' : 'verify-failed',
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      verification,
      errorMsg: ok ? undefined : `Verificación falló: ${summary.missing} faltan, ${summary.differ} difieren`
    })
    const msg = ok
      ? `✓ Verificación OK (${summary.checked} archivos coinciden)`
      : `✗ Verificación FALLÓ — faltan ${summary.missing}, difieren ${summary.differ}`
    ctx?.send('migration:log', msg)
    appendLog(msg, jobId)
    try { appendFileSync(logPath, msg + '\n') } catch { /* ignore */ }
    ctx?.send('migration:done', { jobId, code: 0, logPath, logDir, verification })
    currentJobId = null
    emitJobsUpdate()
    processNext()
  })

  currentVerifyProc.on('error', (e) => {
    currentVerifyProc = null
    updateJob(jobId, {
      status: 'verify-failed',
      finishedAt: new Date().toISOString(),
      errorMsg: `Error verificación: ${e.message}`,
      verification: { status: 'fail', missing: -1, differ: -1, checked: 0, error: e.message, checkedAt: new Date().toISOString() }
    })
    ctx?.send('migration:done', { jobId, code: -1, logPath, logDir })
    currentJobId = null
    emitJobsUpdate()
    processNext()
  })
}

export function stopCurrent(): void {
  const id = currentJobId
  if (currentProc && !currentProc.killed) {
    try { currentProc.kill('SIGTERM') } catch { /* ignore */ }
    setTimeout(() => {
      try { if (currentProc && !currentProc.killed) currentProc.kill('SIGKILL') } catch { /* ignore */ }
    }, 3000)
  }
  if (currentVerifyProc && !currentVerifyProc.killed) {
    try { currentVerifyProc.kill('SIGTERM') } catch { /* ignore */ }
  }
  if (id) {
    updateJob(id, {
      status: 'stopped',
      finishedAt: new Date().toISOString(),
      errorMsg: 'Detenido manualmente'
    })
    emitJobsUpdate()
  }
}

export function killAllSync(): void {
  if (currentProc && !currentProc.killed) {
    try { currentProc.kill('SIGKILL') } catch { /* ignore */ }
  }
  if (currentVerifyProc && !currentVerifyProc.killed) {
    try { currentVerifyProc.kill('SIGKILL') } catch { /* ignore */ }
  }
}
