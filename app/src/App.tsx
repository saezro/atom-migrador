import { useState, useEffect } from 'react'
import RequirementsPage from './pages/RequirementsPage'
import AccountsPage from './pages/AccountsPage'
import MigratePage from './pages/MigratePage'
import TitleBar from './components/TitleBar'
import UpdateBanner from './components/UpdateBanner'

const TABS = ['Requisitos', 'Cuentas', 'Migrar'] as const
type Tab = (typeof TABS)[number]

interface UpdateInfo {
  hasUpdate: boolean
  version: string
  currentVersion: string
  url: string
}

export default function App() {
  const [tab, setTab] = useState<Tab>('Requisitos')
  const [remoteDB, setRemoteDB] = useState('dropbox')
  const [remoteGD, setRemoteGD] = useState('gdrive')
  const [rcReady, setRcReady] = useState(false)
  const [accountsReady, setAccountsReady] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)

  useEffect(() => {
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
        {tab === 'Requisitos' && (
          <RequirementsPage onReady={() => { setRcReady(true); setTab('Cuentas') }} />
        )}
        {tab === 'Cuentas' && (
          <AccountsPage
            remoteDB={remoteDB}
            remoteGD={remoteGD}
            onRemoteDBChange={setRemoteDB}
            onRemoteGDChange={setRemoteGD}
            onReady={() => { setAccountsReady(true); setTab('Migrar') }}
          />
        )}
        {tab === 'Migrar' && (
          <MigratePage remoteDB={remoteDB} remoteGD={remoteGD} />
        )}
      </div>
    </div>
  )
}
