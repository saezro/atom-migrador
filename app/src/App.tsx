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
  const [rcloneReady, setRcloneReady] = useState(false)

  useEffect(() => {
    window.api.rclone.check().then(r => {
      if (r?.found) setRcloneReady(true)
    }).catch(() => {})

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
        <div style={{ display: tab === 'Cuentas' ? '' : 'none' }}>
          <AccountsPage
            remoteDB={remoteDB}
            remoteGD={remoteGD}
            onRemoteDBChange={setRemoteDB}
            onRemoteGDChange={setRemoteGD}
            onReady={() => setTab('Migrar')}
          />
        </div>
        <div style={{ display: tab === 'Migrar' ? '' : 'none', height: '100%' }}>
          <MigratePage
            remoteDB={remoteDB}
            remoteGD={remoteGD}
            rcloneReady={rcloneReady}
            onJobQueued={() => setTab('Cola')}
          />
        </div>
        <div style={{ display: tab === 'Cola' ? '' : 'none' }}>
          <JobsPage />
        </div>
      </div>
    </div>
  )
}
