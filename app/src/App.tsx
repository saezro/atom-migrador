import { useState } from 'react'
import RequirementsPage from './pages/RequirementsPage'
import AccountsPage from './pages/AccountsPage'
import MigratePage from './pages/MigratePage'
import TitleBar from './components/TitleBar'

const TABS = ['Requisitos', 'Cuentas', 'Migrar'] as const
type Tab = (typeof TABS)[number]

export default function App() {
  const [tab, setTab] = useState<Tab>('Requisitos')
  // Shared state lifted up so pages can communicate
  const [remoteDB, setRemoteDB] = useState('dropbox')
  const [remoteGD, setRemoteGD] = useState('gdrive')
  const [rcReady, setRcReady] = useState(false)
  const [accountsReady, setAccountsReady] = useState(false)

  return (
    <div className="app-shell">
      <TitleBar />
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
