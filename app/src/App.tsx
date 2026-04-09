import { useState, useEffect } from 'react'
import AccountsPage from './pages/AccountsPage'
import MigratePage from './pages/MigratePage'
import JobsPage from './pages/JobsPage'
import TitleBar from './components/TitleBar'
import UpdateModal from './components/UpdateModal'

const TABS = ['Cuentas', 'Migrar', 'Cola'] as const
type Tab = (typeof TABS)[number]

interface UpdateInfo { version: string; currentVersion: string }

export default function App() {
  const [tab, setTab] = useState<Tab>('Cuentas')
  const [remoteDB, setRemoteDB] = useState('dropbox')
  const [remoteGD, setRemoteGD] = useState('gdrive')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)

  useEffect(() => {
    window.api.rclone.check().catch(() => {})

    const onAvailable = (info: unknown) => {
      const u = info as UpdateInfo
      setUpdateInfo({ version: u.version, currentVersion: u.currentVersion })
    }
    window.api.on('update:available', onAvailable)
    return () => window.api.off('update:available', onAvailable)
  }, [])

  return (
    <div className="app-shell">
      <TitleBar />
      {updateInfo && (
        <UpdateModal
          version={updateInfo.version}
          currentVersion={updateInfo.currentVersion}
          onDismiss={() => setUpdateInfo(null)}
        />
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
