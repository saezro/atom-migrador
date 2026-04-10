import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { spawn, spawnSync } from 'child_process'
import * as https from 'https'
import { autoUpdater } from 'electron-updater'
import {
  initDB,
  flushNow,
  getJobs,
  getJob,
  addJob,
  removeJob,
  reorderJob,
  clearFinishedJobs,
  getQueueAutorun,
  setQueueAutorun,
  getRecentLogs,
  JobConfig
} from './db'
import {
  initQueue,
  processNext,
  runJob,
  stopCurrent,
  setQueuePaused,
  isQueuePaused,
  hasRunningJob,
  getCurrentJobId,
  killAllSync
} from './queue'

// ─── State ────────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let rcPath = ''
let authorizeProc: ReturnType<typeof spawn> | null = null
let allowClose = false

// Paths
// Writable user data (persists across updates)
const USER_DATA = app.getPath('userData')
const ENV_FILE = join(USER_DATA, 'envMigracion.json')
const LOGS_DIR = join(USER_DATA, 'logs')
const DB_FILE = join(USER_DATA, 'migrador.db.json')
// rclone bundled with installer (read-only resources)
const BUNDLED_RCLONE = app.isPackaged
  ? join(process.resourcesPath, 'extra', 'rclone.exe')
  : join(__dirname, '..', '..', 'resources', 'extra', 'rclone.exe')
// rclone downloaded/installed by the user (writable userData)
const USER_RCLONE = join(USER_DATA, 'rclone.exe')

// ─── Helpers ──────────────────────────────────────────────────────────────────
function send(channel: string, ...args: unknown[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function findRclone(): { found: boolean; path: string; version: string } {
  const candidates = [
    BUNDLED_RCLONE,   // bundled inside installer (extraResources)
    USER_RCLONE,      // previously downloaded to userData
    'rclone',
    'C:\\rclone\\rclone.exe',
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'rclone', 'rclone.exe'),
  ]

  // Also search in WinGet packages
  const wingetBase = join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages')
  if (existsSync(wingetBase)) {
    try {
      const result = spawnSync('cmd', ['/c', `dir /s /b "${wingetBase}\\rclone.exe" 2>nul`], {
        encoding: 'utf8', timeout: 3000
      })
      const found = result.stdout.trim().split('\n').find(l => l.includes('rclone.exe'))
      if (found) candidates.push(found.trim())
    } catch { /* ignore */ }
  }

  for (const candidate of candidates) {
    try {
      const r = spawnSync(candidate, ['version'], { encoding: 'utf8', timeout: 5000 })
      if (r.stdout && r.stdout.includes('rclone')) {
        const version = r.stdout.split('\n')[0].trim()
        rcPath = candidate
        return { found: true, path: candidate, version }
      }
    } catch { /* try next */ }
  }
  return { found: false, path: '', version: '' }
}

function getRemotes(): string[] {
  if (!rcPath) return []
  try {
    const r = spawnSync(rcPath, ['listremotes'], { encoding: 'utf8', timeout: 8000 })
    return (r.stdout ?? '')
      .split('\n')
      .map(l => l.trim().replace(/:$/, ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

// ─── Window ───────────────────────────────────────────────────────────────────

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 1020,
    minWidth: 1100,
    minHeight: 750,
    frame: false,
    backgroundColor: '#0c0c10',
    icon: join(__dirname, '../../resources/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // ─── Close confirmation while a job is running ───────────────────────────
  mainWindow.on('close', (e) => {
    if (allowClose) return
    if (!hasRunningJob()) return
    e.preventDefault()
    if (!mainWindow) return
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancelar', 'Detener migración y salir'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Migración en curso',
      message: '⚠ Hay una migración en curso',
      detail:
        'Si cierras la aplicación ahora la migración se interrumpirá y los archivos ' +
        'que estuvieran transfiriéndose podrían quedar a medio copiar (corruptos).\n\n' +
        'Para una salida segura: detén la migración primero, espera a que termine y ' +
        'vuelve a cerrar.\n\n' +
        '¿Quieres detener la migración y salir igualmente?'
    }).then((res) => {
      if (res.response === 1) {
        allowClose = true
        try { stopCurrent() } catch { /* ignore */ }
        // Give the process a moment to die before quitting
        setTimeout(() => {
          try { killAllSync() } catch { /* ignore */ }
          flushNow()
          mainWindow?.destroy()
        }, 600)
      }
    }).catch(() => { /* ignore */ })
  })
}

app.whenReady().then(() => {
  initDB(DB_FILE)
  initQueue({
    rcPath: () => rcPath,
    logsDir: LOGS_DIR,
    send
  })
  createWindow()
  setupAutoUpdater()
  // Try to resume any pending jobs from a previous run, after rclone is detected
  setTimeout(() => {
    if (rcPath) processNext()
  }, 2500)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  flushNow()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  flushNow()
})

// ─── IPC: Window controls ────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())

// ─── IPC: rclone ─────────────────────────────────────────────────────────────
ipcMain.handle('rclone:check', () => {
  const r = findRclone()
  if (r.found) processNext()
  return r
})

ipcMain.handle('rclone:install', async () => {
  return new Promise<string>((resolve) => {
    send('rclone:install-progress', 'Intentando instalar con winget...')

    // Try winget first
    const winget = spawn('winget', [
      'install', 'Rclone.Rclone',
      '--silent', '--accept-package-agreements', '--accept-source-agreements'
    ], { windowsHide: true })

    winget.on('close', (code) => {
      if (code === 0 && findRclone().found) {
        resolve('winget')
        return
      }
      // Fallback: direct download
      send('rclone:install-progress', 'Descargando rclone directamente...')
      const tmpZip = join(app.getPath('temp'), 'rclone.zip')
      const tmpDir = join(app.getPath('temp'), 'rclone_extract')
      const file = require('fs').createWriteStream(tmpZip)
      const url = 'https://downloads.rclone.org/rclone-current-windows-amd64.zip'

      https.get(url, (res) => {
        res.pipe(file)
        file.on('finish', () => {
          file.close()
          try {
            spawnSync('powershell', [
              '-NoProfile', '-Command',
              `Expand-Archive -LiteralPath '${tmpZip}' -DestinationPath '${tmpDir}' -Force`
            ], { timeout: 30000 })
            // Find rclone.exe
            const findResult = spawnSync('cmd', [
              '/c', `dir /s /b "${tmpDir}\\rclone.exe"`
            ], { encoding: 'utf8', timeout: 5000 })
            const exePath = findResult.stdout.trim().split('\n')[0].trim()
            if (exePath && existsSync(exePath)) {
              const dest = USER_RCLONE
              require('fs').copyFileSync(exePath, dest)
              if (findRclone().found) { resolve('download'); return }
            }
          } catch { /* fall through */ }
          resolve('error')
        })
      }).on('error', () => resolve('error'))
    })
  })
})

ipcMain.handle('rclone:authorize', async (_, backend: string, remoteName: string) => {
  if (!rcPath) return { ok: false, error: 'rclone no encontrado' }

  // Kill existing authorize process
  if (authorizeProc && !authorizeProc.killed) {
    try { authorizeProc.kill() } catch { /* ignore */ }
  }

  return new Promise((resolve) => {
    let output = ''
    authorizeProc = spawn(rcPath, ['authorize', backend], { windowsHide: true })

    authorizeProc.stdout?.on('data', (d: Buffer) => { output += d.toString() })
    authorizeProc.stderr?.on('data', (d: Buffer) => { output += d.toString() })

    authorizeProc.on('close', () => {
      // Extract token JSON
      const tokenMatch = output.match(/\{[\s\S]*?"access_token"[\s\S]*?"expiry"\s*:\s*"[^"]*"[\s\S]*?\}/)
      const token = tokenMatch?.[0]
      if (token) {
        try {
          spawnSync(rcPath, ['config', 'create', remoteName, backend, 'token', token], {
            encoding: 'utf8', timeout: 10000
          })
        } catch { /* ignore */ }
      }
      const remotes = getRemotes()
      if (remotes.includes(remoteName)) {
        // For Dropbox: configure root_namespace=team_space so rclone resolves
        // the team namespace automatically (avoids invalid numeric-ID issues)
        if (backend === 'dropbox') {
          try {
            spawnSync(rcPath, ['config', 'update', remoteName, 'root_namespace', 'team_space'], {
              encoding: 'utf8', timeout: 8000
            })
          } catch { /* ignore */ }
        }
        resolve({ ok: true, remote: remoteName })
      } else {
        resolve({ ok: false, error: 'No se guardó el remote. Intenta de nuevo.' })
      }
    })

    authorizeProc.on('error', (e: Error) => {
      resolve({ ok: false, error: e.message })
    })
  })
})

ipcMain.handle('rclone:list-remotes', () => getRemotes())

const FOLDER_LIMIT = 300

ipcMain.handle('rclone:list-folders', async (_, remote: string, path: string, nsMode?: string, nsId?: string, driveId?: string) => {
  if (!rcPath) return { error: 'rclone no encontrado' }
  // For Dropbox Business, use a leading / so rclone shows the team root instead of personal folder
  // See: https://rclone.org/dropbox/#dropbox-for-business
  const remotePath = nsMode === 'team_space' ? `${remote}:/${path}` : `${remote}:${path}`
  const args = ['lsd', remotePath, '--max-depth', '1']
  if (driveId) {
    args.push('--drive-team-drive', driveId)
  }
  try {
    const r = spawnSync(rcPath, args, { encoding: 'utf8', timeout: 30000 })
    const lines = (r.stdout ?? '').split('\n')
    const all = lines
      .filter(l => /^\s*-?\d/.test(l))
      .map(l => {
        // Format: "  -1 2000-01-01 01:00:00  -1 Folder Name With Spaces"
        // Capture everything after the 4th whitespace-separated field as the name
        const m = l.trim().match(/^-?\d+\s+\S+\s+\S+\s+-?\d+\s+(.+)$/)
        return m ? m[1].trim() : ''
      })
      .filter(Boolean)
      .sort()
    const truncated = all.length > FOLDER_LIMIT
    const folders = truncated ? all.slice(0, FOLDER_LIMIT) : all
    if (r.stderr && r.stderr.includes('ERROR')) return { error: r.stderr }
    return { folders, truncated, total: all.length }
  } catch (e: unknown) {
    return { error: String(e) }
  }
})

ipcMain.handle('rclone:list-drives', async (_, remote: string) => {
  if (!rcPath) return []
  try {
    const r = spawnSync(rcPath, ['backend', 'drives', `${remote}:`], {
      encoding: 'utf8', timeout: 20000
    })
    const json = (r.stdout ?? '').trim()
    if (json.startsWith('[')) {
      const parsed = JSON.parse(json)
      return parsed.map((d: { id: string; name: string }) => ({ id: d.id, name: d.name || '(sin nombre)' }))
    }
    return []
  } catch {
    return []
  }
})

// ─── IPC: Jobs / Queue ───────────────────────────────────────────────────────
ipcMain.handle('jobs:list', () => getJobs())
ipcMain.handle('jobs:get', (_, id: string) => getJob(id))
ipcMain.handle('jobs:add', (_, payload: { name: string; config: JobConfig }) => {
  const job = addJob({ name: payload.name, config: payload.config })
  // Try to start it immediately if queue is idle
  processNext()
  return job
})
ipcMain.handle('jobs:remove', (_, id: string) => {
  // Don't allow removing the currently-running job
  if (getCurrentJobId() === id) return { ok: false, error: 'Este job está corriendo' }
  return { ok: removeJob(id) }
})
ipcMain.handle('jobs:reorder', (_, id: string, dir: -1 | 1) => {
  reorderJob(id, dir)
  return { ok: true }
})
ipcMain.handle('jobs:clear-finished', () => ({ removed: clearFinishedJobs() }))
ipcMain.handle('jobs:run-now', (_, id: string) => runJob(id))
ipcMain.handle('jobs:stop', () => {
  stopCurrent()
  return { ok: true }
})
ipcMain.handle('queue:state', () => ({
  paused: isQueuePaused(),
  autorun: getQueueAutorun(),
  currentJobId: getCurrentJobId(),
  hasRunning: hasRunningJob()
}))
ipcMain.handle('queue:set-paused', (_, paused: boolean) => {
  setQueuePaused(paused)
  return { ok: true }
})
ipcMain.handle('queue:set-autorun', (_, autorun: boolean) => {
  setQueueAutorun(autorun)
  if (autorun) processNext()
  return { ok: true }
})
ipcMain.handle('queue:process-next', () => {
  processNext()
  return { ok: true }
})
ipcMain.handle('jobs:recent-logs', (_, jobId?: string) => getRecentLogs(jobId))

// ─── IPC: Dropbox team namespace ─────────────────────────────────────────────
ipcMain.handle('dropbox:team-ns', async (_, remoteName: string) => {
  if (!rcPath) return { error: 'rclone no disponible' }
  try {
    // Clear any previously invalid root_namespace value in rclone config
    spawnSync(rcPath, ['config', 'update', remoteName, 'root_namespace', ''], {
      encoding: 'utf8', timeout: 5000
    })

    // Read token from rclone config (do NOT call rclone lsf — it may open browser for reauth)
    const cfg = spawnSync(rcPath, ['config', 'show', remoteName], {
      encoding: 'utf8', timeout: 5000
    }).stdout ?? ''
    const tokenMatch = cfg.match(/token\s*=\s*(\{[^\r\n]+\})/)
    if (!tokenMatch) return { error: 'Token no encontrado en config de rclone' }
    const tok = JSON.parse(tokenMatch[1])
    const access = tok.access_token
    if (!access) return { error: 'access_token vacío en config de rclone' }

    // Call Dropbox API: /users/get_current_account to detect if this is a business account
    return new Promise((resolve) => {
      const body = Buffer.from('null')
      const options: https.RequestOptions = {
        hostname: 'api.dropboxapi.com',
        path: '/2/users/get_current_account',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access}`,
          'Content-Type': 'application/json',
          'Content-Length': body.length
        }
      }
      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (parsed?.error_summary) {
              resolve({ error: `Dropbox API: ${parsed.error_summary}` })
              return
            }
            const teamName = parsed?.team?.name
            if (!teamName) {
              // Personal Dropbox — browse without namespace flag
              resolve({ id: '', name: parsed?.name?.display_name ?? 'Personal' })
              return
            }
            // For Business accounts: return team name so the badge shows.
            // The id is passed back as a non-empty marker so FolderBrowser uses the
            // leading-/ path (rclone docs: remote:/ shows all Team Folders).
            const nsId = parsed?.root_info?.root_namespace_id
            resolve({ id: nsId ? String(nsId) : '1', name: teamName })
          } catch {
            resolve({ error: `Respuesta inválida: ${data.slice(0, 120)}` })
          }
        })
      })
      req.on('error', (e: Error) => resolve({ error: `Red: ${e.message}` }))
      req.write(body)
      req.end()
    })
  } catch (e: unknown) {
    return { error: (e as Error)?.message ?? 'Error desconocido' }
  }
})

// ─── IPC: Env file ────────────────────────────────────────────────────────────
ipcMain.handle('env:load', () => {
  try {
    if (existsSync(ENV_FILE)) {
      const data = JSON.parse(readFileSync(ENV_FILE, 'utf8'))
      return { RemoteDB: data.RemoteDB ?? 'dropbox', RemoteGD: data.RemoteGD ?? 'gdrive' }
    }
  } catch { /* ignore */ }
  return { RemoteDB: 'dropbox', RemoteGD: 'gdrive' }
})

ipcMain.handle('env:save', (_, data: { RemoteDB: string; RemoteGD: string }) => {
  try {
    writeFileSync(ENV_FILE, JSON.stringify(data, null, 2), 'utf8')
    return { ok: true }
  } catch {
    return { ok: false }
  }
})

ipcMain.handle('shell:open-logs', () => {
  if (existsSync(LOGS_DIR)) shell.openPath(LOGS_DIR)
  else shell.showItemInFolder(ENV_FILE)
})

ipcMain.handle('shell:open-external', (_, url: string) => {
  if (typeof url === 'string' && url.startsWith('https://')) {
    shell.openExternal(url)
  }
})

ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('updates:install', () => {
  autoUpdater.quitAndInstall(true, true)
})

// ─── Auto-updater ─────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    send('update:available', { version: info.version, currentVersion: app.getVersion() })
  })

  autoUpdater.on('download-progress', (progress) => {
    send('update:progress', Math.round(progress.percent))
  })

  autoUpdater.on('update-downloaded', () => {
    send('update:ready')
  })

  autoUpdater.on('update-not-available', () => {
    send('update:not-available')
  })

  autoUpdater.on('error', (err) => {
    send('update:error', err?.message ?? 'Error desconocido')
  })

  // Check after 3s so the window is ready
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => { /* ignore */ })
  }, 3000)
}

ipcMain.handle('updates:download', () => {
  autoUpdater.downloadUpdate().catch((err) => {
    send('update:error', err?.message ?? 'Error al descargar')
  })
  return { ok: true }
})

ipcMain.handle('updates:check', () => {
  autoUpdater.checkForUpdates().catch(() => { /* ignore */ })
  return { ok: true }
})
