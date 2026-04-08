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
    listFolders: (remote: string, path: string, nsMode?: string, nsId?: string, driveId?: string) => Promise<string[] | { error: string }>
    listDrives: (remote: string) => Promise<DriveItem[]>
    startSync: (config: SyncConfig) => Promise<{ ok?: boolean; logDir?: string; error?: string }>
    stopSync: () => Promise<{ ok: boolean }>
  }
  dropbox: {
    getTeamNs: (remote: string) => Promise<{ id: string; name: string } | null>
  }
  env: {
    load: () => Promise<{ RemoteDB: string; RemoteGD: string }>
    save: (data: { RemoteDB: string; RemoteGD: string }) => Promise<{ ok: boolean }>
  }
  shell: {
    openLogs: () => Promise<void>
  }
  on: (channel: string, listener: (...args: unknown[]) => void) => void
  off: (channel: string, listener: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
