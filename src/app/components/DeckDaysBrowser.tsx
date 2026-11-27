import { ELEMENT_META, type ProjectedGameView, type Viewer } from '../../engine/index.js';
import { CardBack } from './CardBack.js';

export function DeckDaysBrowser({
  view,
  viewer,
  onClose
}: {
  view: ProjectedGameView;
  viewer: Viewer;
  onClose: () => void;
}) {
  const isAdmin = viewer.role === 'admin';
  const visibilityLabel =
    view.zoneVisibility.days === 'full'
      ? 'Full Order (Read-Only)'
      : view.zoneVisibility.days === 'top_only'
        ? 'Top Card Visible (Reflection)'
        : 'Concealed Sequence (Card Backs Only)';

  return (
    <div className="browser-drawer" data-testid="deck-days-browser">
      <div className="browser-drawer-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong>Deck of Days — Ordered Draw Pile ({view.daysCount})</strong>
            <span className={`badge ${isAdmin ? 'badge-warn' : 'badge-ok'}`}>
              {isAdmin ? 'Admin God Mode' : visibilityLabel}
            </span>
          </div>
          <div className="brand-sub">
            {isAdmin
              ? 'Exact draw order from top (#1 drawn next) to bottom. Strictly read-only inspection with per-card movement history.'
              : 'Hidden card identities and draw order remain protected. Scroll to inspect remaining stack depth and recognizable card-back categories.'}
          </div>
        </div>
        <button className="btn btn-sm" onClick={onClose}>
          Close Browser
        </button>
      </div>

      {view.daysBrowserItems.length === 0 ? (
        <div className="brand-sub" style={{ padding: '6px 0' }}>
          Deck of Days is exhausted (0 cards remaining).
        </div>
      ) : (
        <div className="browser-scroll-grid">
          {view.daysBrowserItems.map((item) => (
            <div
              key={item.hidden ? `days-hid-${item.position}` : `days-card-${item.card.id}`}
              className={`browser-item-card ${
                !item.hidden
                  ? item.card.color === 'red'
                    ? 'color-red'
                    : 'color-black'
                  : ''
              }`}
              data-position={item.position}
            >
              <div className="browser-item-top">
                <span className="badge mono">#{item.position}</span>
                <span className="badge">{item.backGroup}</span>
              </div>

              {item.hidden ? (
                <div className="browser-item-hidden">
                  <CardBack backGroup={item.backGroup} size="sm" />
                  <div className="card-meta">{item.label}</div>
                </div>
              ) : (
                <div className="browser-item-face">
                  <div className="browser-face-glyph">{item.card.shortLabel}</div>
                  <div className="browser-face-label">
                    {item.card.label} ({item.card.vp} VP)
                  </div>
                  <div className="card-meta">
                    {item.card.element
                      ? `${ELEMENT_META[item.card.element].label} · ${item.card.color}`
                      : item.card.family}
                  </div>
                  {item.movementHistory.length > 0 && (
                    <div className="browser-history-list">
                      {item.movementHistory.slice(-2).map((entry, idx) => (
                        <div key={idx} className="browser-history-entry" title={entry}>
                          {entry}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
