import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, readSync, closeSync } from 'fs'
import { spawn, spawnSync } from 'child_process'
import * as https from 'https'
import * as http from 'http'

// ─── Types ────────────────────────────────────────────────────────────────────
interface SyncConfig {
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

// ─── State ────────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let rcPath = ''
let migrationProc: ReturnType<typeof spawn> | null = null
let authorizeProc: ReturnType<typeof spawn> | null = null
let tailInterval: ReturnType<typeof setInterval> | null = null

// Paths
// Writable user data (persists across updates)
const USER_DATA = app.getPath('userData')
const ENV_FILE = join(USER_DATA, 'envMigracion.json')
const LOGS_DIR = join(USER_DATA, 'logs')
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

function parseStats(line: string) {
  const stats: Record<string, string> = {}
  // ETA
  const etaM = line.match(/ETA\s+(\S+?)(?:\s*\(|$)/)
  if (etaM) stats.eta = etaM[1] === '-' ? '...' : etaM[1]
  // Speed
  const spdM = line.match(/([\d.]+\s*[KMGT]?i?B\/s)/)
  if (spdM) stats.speed = spdM[1]
  // Files transferred
  const xfrM = line.match(/xfr#(\d+)\/(\d+)/)
  if (xfrM) stats.files = `${xfrM[1]} / ${xfrM[2]}`
  // Percentage/progress
  const pctM = line.match(/([\d.]+\s*[KMGT]?i?B)\s*\/\s*([\d.]+\s*[KMGT]?i?B),\s*(\d+)%/)
  if (pctM) stats.progress = `${pctM[3]}%  (${pctM[1]})`
  // Errors
  const errM = line.match(/,\s*(\d+)\s+error/)
  if (errM) stats.errors = errM[1]

  if (Object.keys(stats).length > 0) send('migration:stats', stats)
}

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
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ─── IPC: Window controls ────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())

// ─── IPC: rclone ─────────────────────────────────────────────────────────────
ipcMain.handle('rclone:check', () => findRclone())

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

ipcMain.handle('rclone:list-folders', async (_, remote: string, path: string, nsMode?: string, nsId?: string, driveId?: string) => {
  if (!rcPath) return { error: 'rclone no encontrado' }
  const args = ['lsd', `${remote}:${path}`, '--max-depth', '1']
  if (nsMode === 'team_space' && nsId) {
    args.push('--dropbox-root-namespace', nsId)
  }
  if (driveId) {
    args.push('--drive-team-drive', driveId)
  }
  try {
    const r = spawnSync(rcPath, args, { encoding: 'utf8', timeout: 30000 })
    const lines = (r.stdout ?? '').split('\n')
    const folders = lines
      .filter(l => /^\s*-?\d/.test(l))
      .map(l => {
        const parts = l.trim().split(/\s+/, 6)
        return parts[5] ?? ''
      })
      .filter(Boolean)
      .sort()
    if (r.stderr && r.stderr.includes('ERROR')) return { error: r.stderr }
    return folders
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

ipcMain.handle('rclone:start-sync', async (_, config: SyncConfig) => {
  if (!rcPath) return { error: 'rclone no encontrado' }
  if (migrationProc && !migrationProc.killed) return { error: 'Ya hay una migración en curso' }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const logDir = join(LOGS_DIR, ts.replace('T', '_'))
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
  const logPath = join(logDir, 'migration.log')
  const logLines: string[] = []

  let orig = `${config.remoteDB}:${config.carpOrig}`
  let dest = config.carpDest
  if (config.createSubfolder) {
    const srcName = config.carpOrig ? config.carpOrig.split('/').pop()! : config.remoteDB
    dest = dest ? `${dest}/${srcName}` : srcName
  }
  const destFull = `${config.remoteGD}:${dest}`

  const transfers = config.transfers
  const checkers = transfers * 3

  const args = [
    'sync', orig, destFull,
    '--drive-team-drive', config.driveId,
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
  if (config.dbNamespace === 'team_space' && config.dbNamespaceId) {
    args.push('--dropbox-root-namespace', config.dbNamespaceId)
  }
  if (config.bandwidth && config.bandwidth !== '0') {
    args.push('--bwlimit', config.bandwidth)
  }
  if (config.dryRun) args.push('--dry-run')

  send('migration:log', '='.repeat(50))
  send('migration:log', `  MIGRACIÓN${config.dryRun ? ' [SIMULACIÓN]' : ''}`)
  send('migration:log', `  Origen:  ${orig}`)
  send('migration:log', `  Destino: ${destFull}  (${config.driveName})`)
  send('migration:log', `  Transfers: ${transfers} | Checkers: ${checkers}`)
  send('migration:log', '='.repeat(50))

  migrationProc = spawn(rcPath, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  function handleOutput(data: Buffer) {
    const lines = data.toString('utf8').split(/\r?\n/).filter(l => l.trim())
    for (const line of lines) {
      send('migration:log', line)
      parseStats(line)
      logLines.push(line)
    }
  }

  migrationProc.stdout?.on('data', handleOutput)
  migrationProc.stderr?.on('data', handleOutput)

  migrationProc.on('close', (code) => {
    try { writeFileSync(logPath, logLines.join('\n'), 'utf8') } catch { /* ignore */ }
    send('migration:done', { code, logPath, logDir })
    migrationProc = null
  })

  return { ok: true, logDir }
})

ipcMain.handle('rclone:stop-sync', () => {
  if (migrationProc && !migrationProc.killed) {
    migrationProc.kill('SIGTERM')
    setTimeout(() => {
      try { if (!migrationProc?.killed) migrationProc?.kill('SIGKILL') } catch { /* ignore */ }
    }, 3000)
  }
  return { ok: true }
})

// ─── IPC: Dropbox team namespace ─────────────────────────────────────────────
ipcMain.handle('dropbox:team-ns', async (_, remoteName: string) => {
  if (!rcPath) return null
  try {
    // Force token refresh
    spawnSync(rcPath, ['lsd', `${remoteName}:`, '--max-depth', '1'], {
      encoding: 'utf8', timeout: 10000
    })
    // Read config to get token
    const cfg = spawnSync(rcPath, ['config', 'show', remoteName], {
      encoding: 'utf8', timeout: 5000
    }).stdout ?? ''

    const tokenMatch = cfg.match(/token\s*=\s*(\{[^\r\n]+\})/)
    if (!tokenMatch) return null
    const tok = JSON.parse(tokenMatch[1])
    const access = tok.access_token
    if (!access) return null

    // Call Dropbox API
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
            resolve({
              id: String(parsed.root_info?.root_namespace_id ?? ''),
              name: parsed.team?.name ?? ''
            })
          } catch {
            resolve(null)
          }
        })
      })
      req.on('error', () => resolve(null))
      req.write(body)
      req.end()
    })
  } catch {
    return null
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

ipcMain.handle('updates:check', () => checkGitHubRelease())

// ─── Update check ─────────────────────────────────────────────────────────────
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function checkGitHubRelease(): Promise<{
  hasUpdate: boolean
  version: string
  currentVersion: string
  url: string
} | null> {
  return new Promise((resolve) => {
    const currentVersion = app.getVersion()
    const headers: Record<string, string> = {
      'User-Agent': `atom-migrador/${currentVersion}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
    const token = process.env.GH_TOKEN
    if (token) headers['Authorization'] = `Bearer ${token}`

    const req = https.request({
      hostname: 'api.github.com',
      path: '/repos/Aerotools-UAV/atom-migrador/releases/latest',
      method: 'GET',
      headers,
      timeout: 8000
    }, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        try {
          if ((res.statusCode ?? 0) !== 200) { resolve(null); return }
          const release = JSON.parse(data)
          const latestVersion = (release.tag_name ?? '').replace(/^v/, '')
          const hasUpdate = latestVersion.length > 0 && compareVersions(latestVersion, currentVersion) > 0
          const asset = (release.assets ?? []).find((a: { name: string }) =>
            a.name.endsWith('.exe') && a.name.toLowerCase().includes('setup')
          )
          resolve({
            hasUpdate,
            version: latestVersion,
            currentVersion,
            url: (asset as { browser_download_url?: string })?.browser_download_url ?? release.html_url ?? ''
          })
        } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.end()
  })
}
