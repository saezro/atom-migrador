import { useState, useEffect } from 'react'
import AccountsPage from './pages/AccountsPage'
import MigratePage from './pages/MigratePage'
import JobsPage from './pages/JobsPage'
import TitleBar from './components/TitleBar'
import UpdateBanner from './components/UpdateBanner'

const TABS = ['Cuentas', 'Migrar', 'Cola'] as const
type Tab = (typeof TABS)[number]

interface UpdateInfo {
  hasUpdate: boolean
  version: string
  currentVersion: string
  url: string
}

export default function App() {
  const [tab, setTab] = useState<Tab>('Cuentas')
  const [remoteDB, setRemoteDB] = useState('dropbox')
  const [remoteGD, setRemoteGD] = useState('gdrive')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)

  useEffect(() => {
    // Detectar rclone en segundo plano (activa la cola si hay jobs pendientes)
    window.api.rclone.check().catch(() => {})

    const timer = setTimeout(() => {
      window.api.updates.check().then((info) => {
        if (info?.hasUpdate) setUpdateInfo(info)
      }).catch(() => {})
    }, 3000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="app-shell">
      <TitleBar />
      {updateInfo && (
        <UpdateBanner info={updateInfo} onDismiss={() => setUpdateInfo(null)} />
      )}
      <nav className="nav-bar">
        {TABS.map((t) => (
          <button
            key={t}
            className={`nav-tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="page-content" style={{ overflow: 'auto' }}>
        {tab === 'Cuentas' && (
          <AccountsPage
            remoteDB={remoteDB}
            remoteGD={remoteGD}
            onRemoteDBChange={setRemoteDB}
            onRemoteGDChange={setRemoteGD}
            onReady={() => setTab('Migrar')}
          />
        )}
        {tab === 'Migrar' && (
          <MigratePage
            remoteDB={remoteDB}
            remoteGD={remoteGD}
            onJobQueued={() => setTab('Cola')}
          />
        )}
        {tab === 'Cola' && <JobsPage />}
      </div>
    </div>
  )
}
