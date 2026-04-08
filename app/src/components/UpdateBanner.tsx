interface UpdateInfo {
  hasUpdate: boolean
  version: string
  currentVersion: string
  url: string
}

interface Props {
  info: UpdateInfo
  onDismiss: () => void
}

export default function UpdateBanner({ info, onDismiss }: Props) {
  function openDownload() {
    window.api.shell.openExternal(info.url)
  }

  return (
    <div style={{
      background: 'rgba(238,118,58,0.12)',
      borderBottom: '1px solid rgba(238,118,58,0.4)',
      padding: '7px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexShrink: 0,
      fontSize: 13
    }}>
      <span style={{ color: 'var(--orange)', fontWeight: 600 }}>↑ Nueva versión disponible</span>
      <span style={{ color: 'var(--fg-muted)' }}>
        v{info.version} <span style={{ opacity: 0.5 }}>· actual v{info.currentVersion}</span>
      </span>
      <span style={{ flex: 1 }} />
      <button
        className="btn btn-primary"
        style={{ padding: '3px 14px', fontSize: 12 }}
        onClick={openDownload}
      >
        Descargar v{info.version}
      </button>
      <button
        className="btn"
        style={{ padding: '3px 10px', fontSize: 12, opacity: 0.6 }}
        onClick={onDismiss}
      >
        Ahora no
      </button>
    </div>
  )
}
