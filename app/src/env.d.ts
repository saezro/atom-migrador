export interface SyncConfig {
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

export interface DriveItem {
  id: string
  name: string
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
  config: SyncConfig
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

export interface QueueState {
  paused: boolean
  autorun: boolean
  currentJobId: string | null
  hasRunning: boolean
}

export interface RecentLogEntry {
  ts: string
  jobId?: string
  line: string
}

export interface ElectronAPI {
  window: {
    minimize: () => void
    maximize: () => void
    close: () => void
  }
  rclone: {
    check: () => Promise<{ found: boolean; path: string; version: string }>
    install: () => Promise<'winget' | 'download' | 'error'>
    authorize: (backend: string, name: string) => Promise<{ ok: boolean; remote?: string; error?: string }>
    listRemotes: () => Promise<string[]>
    listFolders: (remote: string, path: string, nsMode?: string, nsId?: string, driveId?: string) => Promise<{ folders: string[]; truncated: boolean; total: number } | { error: string }>
    listDrives: (remote: string) => Promise<DriveItem[]>
  }
  jobs: {
    list: () => Promise<Job[]>
    get: (id: string) => Promise<Job | undefined>
    add: (payload: { name: string; config: SyncConfig }) => Promise<Job>
    remove: (id: string) => Promise<{ ok: boolean; error?: string }>
    reorder: (id: string, dir: -1 | 1) => Promise<{ ok: boolean }>
    clearFinished: () => Promise<{ removed: number }>
    runNow: (id: string) => Promise<{ ok: boolean; error?: string }>
    stop: () => Promise<{ ok: boolean }>
    recentLogs: (jobId?: string) => Promise<RecentLogEntry[]>
  }
  queue: {
    state: () => Promise<QueueState>
    setPaused: (paused: boolean) => Promise<{ ok: boolean }>
    setAutorun: (autorun: boolean) => Promise<{ ok: boolean }>
    processNext: () => Promise<{ ok: boolean }>
  }
  dropbox: {
    getTeamNs: (remote: string) => Promise<{ id: string; name: string } | { error: string } | null>
    checkConnection: (remote: string) => Promise<{ ok: boolean }>
  }
  env: {
    load: () => Promise<{ RemoteDB: string; RemoteGD: string }>
    save: (data: { RemoteDB: string; RemoteGD: string }) => Promise<{ ok: boolean }>
  }
  shell: {
    openLogs: () => Promise<void>
    openExternal: (url: string) => Promise<void>
  }
  updates: {
    check: () => Promise<{ ok: boolean }>
    download: () => Promise<{ ok: boolean }>
    install: () => Promise<void>
  }
  getVersion: () => Promise<string>
  on: (channel: string, listener: (...args: unknown[]) => void) => void
  off: (channel: string, listener: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
