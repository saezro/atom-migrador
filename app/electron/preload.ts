import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
  },
  rclone: {
    check: () => ipcRenderer.invoke('rclone:check'),
    install: () => ipcRenderer.invoke('rclone:install'),
    authorize: (backend: string, name: string) => ipcRenderer.invoke('rclone:authorize', backend, name),
    listRemotes: () => ipcRenderer.invoke('rclone:list-remotes'),
    listFolders: (remote: string, path: string, nsMode?: string, nsId?: string, driveId?: string) =>
      ipcRenderer.invoke('rclone:list-folders', remote, path, nsMode, nsId, driveId),
    listDrives: (remote: string) => ipcRenderer.invoke('rclone:list-drives', remote)
  },
  jobs: {
    list: () => ipcRenderer.invoke('jobs:list'),
    get: (id: string) => ipcRenderer.invoke('jobs:get', id),
    add: (payload: { name: string; config: unknown }) => ipcRenderer.invoke('jobs:add', payload),
    remove: (id: string) => ipcRenderer.invoke('jobs:remove', id),
    reorder: (id: string, dir: -1 | 1) => ipcRenderer.invoke('jobs:reorder', id, dir),
    clearFinished: () => ipcRenderer.invoke('jobs:clear-finished'),
    runNow: (id: string) => ipcRenderer.invoke('jobs:run-now', id),
    stop: () => ipcRenderer.invoke('jobs:stop'),
    recentLogs: (jobId?: string) => ipcRenderer.invoke('jobs:recent-logs', jobId)
  },
  queue: {
    state: () => ipcRenderer.invoke('queue:state'),
    setPaused: (paused: boolean) => ipcRenderer.invoke('queue:set-paused', paused),
    setAutorun: (autorun: boolean) => ipcRenderer.invoke('queue:set-autorun', autorun),
    processNext: () => ipcRenderer.invoke('queue:process-next')
  },
  dropbox: {
    getTeamNs: (remote: string) => ipcRenderer.invoke('dropbox:team-ns', remote)
  },
  env: {
    load: () => ipcRenderer.invoke('env:load'),
    save: (data: unknown) => ipcRenderer.invoke('env:save', data)
  },
  shell: {
    openLogs: () => ipcRenderer.invoke('shell:open-logs'),
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url)
  },
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install')
  },
  getVersion: () => ipcRenderer.invoke('app:version'),
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => listener(...args))
  },
  off: (channel: string, listener: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, listener as Parameters<typeof ipcRenderer.removeListener>[1])
  }
})
