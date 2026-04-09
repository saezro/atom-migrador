import { useState, useEffect, useCallback } from 'react'
import type { DriveItem } from '../env.d'

interface Props {
  remote: string
  onSelect: (drive: DriveItem, path: string) => void
}

type Level = 'drives' | 'folders'

interface DriveGroup {
  prefix: string
  items: DriveItem[]
}

function computeGroups(drives: DriveItem[]): DriveGroup[] {
  const map = new Map<string, DriveItem[]>()
  for (const d of drives) {
    // Extract prefix: remove trailing _N or _NN suffix
    const m = d.name.match(/^(.+?)_\d+$/)
    const prefix = m ? m[1] : d.name
    if (!map.has(prefix)) map.set(prefix, [])
    map.get(prefix)!.push(d)
  }
  return Array.from(map.entries()).map(([prefix, items]) => ({ prefix, items }))
}

export default function DriveBrowser({ remote, onSelect }: Props) {
  // ── Level: drives ──
  const [drives, setDrives] = useState<DriveItem[]>([])
  const [loadingDrives, setLoadingDrives] = useState(false)
  const [drivesError, setDrivesError] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // ── Level: folders ──
  const [level, setLevel] = useState<Level>('drives')
  const [activeDrive, setActiveDrive] = useState<DriveItem | null>(null)
  const [selectedDrive, setSelectedDrive] = useState<DriveItem | null>(null) // highlighted in list

  const [path, setPath] = useState('')
  const [stack, setStack] = useState<string[]>([])
  const [items, setItems] = useState<string[]>([])
  const [selectedFolder, setSelectedFolder] = useState('')
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [foldersError, setFoldersError] = useState('')
  const [confirmed, setConfirmed] = useState<string | null>(null)

  function toggleGroup(prefix: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(prefix)) next.delete(prefix)
      else next.add(prefix)
      return next
    })
  }

  // Load drives on mount
  useEffect(() => {
    if (!remote) return
    loadDrives()
  }, [remote])

  async function loadDrives() {
    setLoadingDrives(true)
    setDrivesError('')
    setDrives([])
    const result = await window.api.rclone.listDrives(remote)
    setLoadingDrives(false)
    if (result && result.length > 0) {
      setDrives(result)
    } else {
      setDrivesError('Sin Shared Drives disponibles. Comprueba permisos.')
    }
  }

  const loadFolders = useCallback(async (drive: DriveItem, folderPath: string) => {
    setLoadingFolders(true)
    setFoldersError('')
    setItems([])
    setSelectedFolder('')
    const result = await window.api.rclone.listFolders(remote, folderPath, undefined, undefined, drive.id)
    setLoadingFolders(false)
    if ('error' in result) {
      setFoldersError(result.error || 'Error al cargar carpetas')
    } else {
      setItems(result.folders)
    }
  }, [remote])

  function enterDrive(drive: DriveItem) {
    setActiveDrive(drive)
    setPath('')
    setStack([])
    setConfirmed(null)
    setLevel('folders')
    loadFolders(drive, '')
  }

  function enterFolder() {
    if (!selectedFolder || !activeDrive) return
    const newPath = path ? `${path}/${selectedFolder}` : selectedFolder
    setStack(s => [...s, path])
    setPath(newPath)
    loadFolders(activeDrive, newPath)
  }

  function goUp() {
    if (stack.length === 0) {
      // Back to drives list
      setLevel('drives')
      setActiveDrive(null)
      setSelectedDrive(null)
      setPath('')
      setStack([])
      setConfirmed(null)
      return
    }
    const prev = stack[stack.length - 1]
    setStack(s => s.slice(0, -1))
    setPath(prev)
    loadFolders(activeDrive!, prev)
  }

  function confirmSelection() {
    if (!activeDrive) return
    setConfirmed(`${activeDrive.name}${path ? `/${path}` : '/'}`)
    onSelect(activeDrive, path)
  }

  const breadcrumb = activeDrive
    ? `/${activeDrive.name}${path ? `/${path}` : ''}`
    : '/'

  const loading = level === 'drives' ? loadingDrives : loadingFolders
  const error = level === 'drives' ? drivesError : foldersError

  const groups = computeGroups(drives)

  return (
    <div className="flex-col gap-8" style={{ height: '100%' }}>
      {/* Breadcrumb */}
      <div className="mono text-muted" style={{ fontSize: 12, padding: '0 2px' }}>
        {breadcrumb}
      </div>

      {/* List */}
      <ul className="folder-list" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {loading && (
          <li className="folder-item text-muted" style={{ justifyContent: 'center', padding: '12px 0' }}>
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
            &nbsp;Cargando…
          </li>
        )}
        {!loading && error && (
          <li className="folder-item text-red">{error}</li>
        )}
        {!loading && !error && level === 'drives' && drives.length === 0 && (
          <li className="folder-item text-muted" style={{ padding: '12px 0', justifyContent: 'center' }}>
            (sin unidades compartidas)
          </li>
        )}
        {!loading && !error && level === 'folders' && items.length === 0 && (
          <li className="folder-item text-muted" style={{ padding: '12px 0', justifyContent: 'center' }}>
            (sin subcarpetas)
          </li>
        )}

        {/* Drives — grouped by prefix */}
        {!loading && level === 'drives' && groups.map(group => {
          if (group.items.length === 1) {
            // Single item: render directly
            const d = group.items[0]
            return (
              <li
                key={d.id}
                className={`folder-item${selectedDrive?.id === d.id ? ' active' : ''}`}
                onClick={() => setSelectedDrive(d)}
                onDoubleClick={() => enterDrive(d)}
              >
                <span style={{ color: 'var(--orange)', fontSize: 13 }}>🗂</span>
                {d.name}
              </li>
            )
          }
          // Multi-item group: collapsible
          const isExpanded = expandedGroups.has(group.prefix)
          return (
            <li key={group.prefix} style={{ listStyle: 'none' }}>
              <div
                className="folder-item"
                style={{ fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleGroup(group.prefix)}
              >
                <span style={{ color: 'var(--orange)', fontSize: 11, minWidth: 12 }}>
                  {isExpanded ? '▾' : '▸'}
                </span>
                <span style={{ color: 'var(--orange)', fontSize: 13 }}>🗂</span>
                {group.prefix}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', paddingLeft: 8 }}>
                  {group.items.length}
                </span>
              </div>
              {isExpanded && group.items.map(d => (
                <div
                  key={d.id}
                  className={`folder-item${selectedDrive?.id === d.id ? ' active' : ''}`}
                  style={{ paddingLeft: 32 }}
                  onClick={() => setSelectedDrive(d)}
                  onDoubleClick={() => enterDrive(d)}
                >
                  <span style={{ color: 'var(--orange)', fontSize: 13 }}>🗂</span>
                  {d.name}
                </div>
              ))}
            </li>
          )
        })}

        {/* Folders inside drive */}
        {!loading && level === 'folders' && items.map(item => (
          <li
            key={item}
            className={`folder-item${selectedFolder === item ? ' active' : ''}`}
            onClick={() => setSelectedFolder(item)}
            onDoubleClick={() => { setSelectedFolder(item); enterFolder() }}
          >
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>📁</span>
            {item}
          </li>
        ))}
      </ul>

      {/* Controls */}
      <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
        <button
          className="btn btn-sm"
          onClick={goUp}
          disabled={loading || (level === 'drives')}
        >
          ↑ Subir
        </button>
        <button
          className="btn btn-sm"
          onClick={level === 'drives' ? () => selectedDrive && enterDrive(selectedDrive) : enterFolder}
          disabled={loading || (level === 'drives' ? !selectedDrive : !selectedFolder)}
        >
          Entrar →
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={confirmSelection}
          disabled={loading || !activeDrive}
        >
          Destino aquí
        </button>
        <button
          className="btn btn-sm"
          onClick={() => level === 'drives' ? loadDrives() : loadFolders(activeDrive!, path)}
          disabled={loading}
        >
          ↺ Recargar
        </button>
      </div>

      {confirmed && (
        <div className="badge badge-ok" style={{ alignSelf: 'flex-start' }}>
          ✓ {confirmed}
        </div>
      )}
    </div>
  )
}
