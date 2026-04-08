import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs'
import { dirname } from 'path'

// ─── Types ────────────────────────────────────────────────────────────────────
export interface JobConfig {
  remoteDB: string
  remoteGD: string
  carpOrig: string
  carpDest: string
  driveId: string
  driveName: string
  dryRun: boolean
  createSubfolder: boolean
  bandwidth: string
  transfers: number
  dbNamespace: 'private' | 'team_space'
  dbNamespaceId: string
}

export type JobStatus =
  | 'pending'
  | 'running'
  | 'verifying'
  | 'done'
  | 'error'
  | 'stopped'
  | 'interrupted'
  | 'verify-failed'

export interface JobStats {
  files: string
  speed: string
  eta: string
  progress: string
  errors: string
}

export interface JobVerification {
  status: 'ok' | 'fail' | 'skip'
  missing: number
  differ: number
  checked: number
  error?: string
  checkedAt: string
}

export interface Job {
  id: string
  name: string
  status: JobStatus
  config: JobConfig
  createdAt: string
  startedAt?: string
  finishedAt?: string
  exitCode?: number
  logPath?: string
  logDir?: string
  errorMsg?: string
  stats?: JobStats
  verification?: JobVerification
}

interface DBShape {
  jobs: Job[]
  queueAutorun: boolean
  recentLogs: { ts: string; jobId?: string; line: string }[]
}

// ─── Implementation ──────────────────────────────────────────────────────────
const MAX_RECENT_LOGS = 2000

let dbPath = ''
let cache: DBShape = { jobs: [], queueAutorun: true, recentLogs: [] }
let writeTimer: ReturnType<typeof setTimeout> | null = null

function defaultDB(): DBShape {
  return { jobs: [], queueAutorun: true, recentLogs: [] }
}

function load(): void {
  if (!existsSync(dbPath)) {
    cache = defaultDB()
    return
  }
  try {
    const raw = readFileSync(dbPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<DBShape>
    cache = {
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      queueAutorun: parsed.queueAutorun ?? true,
      recentLogs: Array.isArray(parsed.recentLogs) ? parsed.recentLogs : []
    }
  } catch {
    cache = defaultDB()
  }
}

function flush(): void {
  try {
    const dir = dirname(dbPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = dbPath + '.tmp'
    writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8')
    renameSync(tmp, dbPath)
  } catch {
    /* ignore */
  }
}

function scheduleFlush(): void {
  if (writeTimer) return
  writeTimer = setTimeout(() => {
    writeTimer = null
    flush()
  }, 250)
}

export function initDB(filePath: string): void {
  dbPath = filePath
  load()
  // Recover orphaned 'running' / 'verifying' jobs from a previous crash
  let dirty = false
  for (const j of cache.jobs) {
    if (j.status === 'running' || j.status === 'verifying') {
      j.status = 'interrupted'
      j.finishedAt = new Date().toISOString()
      j.errorMsg = 'La aplicación se cerró antes de terminar este trabajo.'
      dirty = true
    }
  }
  if (dirty) flush()
}

export function getJobs(): Job[] {
  return cache.jobs
}

export function getJob(id: string): Job | undefined {
  return cache.jobs.find(j => j.id === id)
}

export function addJob(job: Omit<Job, 'id' | 'createdAt' | 'status'>): Job {
  const id =
    (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase()
  const full: Job = {
    ...job,
    id,
    status: 'pending',
    createdAt: new Date().toISOString()
  }
  cache.jobs.push(full)
  flush()
  return full
}

export function updateJob(id: string, patch: Partial<Job>): Job | undefined {
  const j = cache.jobs.find(x => x.id === id)
  if (!j) return undefined
  Object.assign(j, patch)
  scheduleFlush()
  return j
}

export function removeJob(id: string): boolean {
  const idx = cache.jobs.findIndex(j => j.id === id)
  if (idx < 0) return false
  cache.jobs.splice(idx, 1)
  flush()
  return true
}

export function clearFinishedJobs(): number {
  const before = cache.jobs.length
  cache.jobs = cache.jobs.filter(
    j => j.status === 'pending' || j.status === 'running' || j.status === 'verifying'
  )
  flush()
  return before - cache.jobs.length
}

export function reorderJob(id: string, direction: -1 | 1): void {
  const idx = cache.jobs.findIndex(j => j.id === id)
  if (idx < 0) return
  const target = idx + direction
  if (target < 0 || target >= cache.jobs.length) return
  const [j] = cache.jobs.splice(idx, 1)
  cache.jobs.splice(target, 0, j)
  flush()
}

export function getQueueAutorun(): boolean {
  return cache.queueAutorun
}

export function setQueueAutorun(v: boolean): void {
  cache.queueAutorun = v
  flush()
}

export function appendLog(line: string, jobId?: string): void {
  cache.recentLogs.push({ ts: new Date().toISOString(), jobId, line })
  if (cache.recentLogs.length > MAX_RECENT_LOGS) {
    cache.recentLogs.splice(0, cache.recentLogs.length - MAX_RECENT_LOGS)
  }
  scheduleFlush()
}

export function getRecentLogs(jobId?: string): { ts: string; jobId?: string; line: string }[] {
  if (!jobId) return cache.recentLogs
  return cache.recentLogs.filter(l => l.jobId === jobId)
}

export function flushNow(): void {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  flush()
}

export function nextPendingJob(): Job | undefined {
  return cache.jobs.find(j => j.status === 'pending')
}

export function hasActiveJob(): boolean {
  return cache.jobs.some(j => j.status === 'running' || j.status === 'verifying')
}
