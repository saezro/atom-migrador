import AtomIcon from './AtomIcon'

export default function TitleBar() {
  return (
    <div className="title-bar">
      <div className="title-bar-logo">
        <AtomIcon size={20} />
        <span className="title-bar-title">ATOM MIGRADOR</span>
      </div>
      <div className="title-bar-spacer" />
      <div className="title-bar-controls">
        <button className="wc-btn" onClick={() => window.api.window.minimize()} title="Minimizar">
          ─
        </button>
        <button className="wc-btn" onClick={() => window.api.window.maximize()} title="Maximizar">
          □
        </button>
        <button className="wc-btn close" onClick={() => window.api.window.close()} title="Cerrar">
          ✕
        </button>
      </div>
    </div>
  )
}
