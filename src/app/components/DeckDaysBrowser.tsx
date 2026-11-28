import { ELEMENT_META, type ProjectedGameView, type ProjectedOrderedZoneItem, type Viewer } from '../../engine/index.js';
import { CardBack } from './CardBack.js';

function renderDeckCard(item: ProjectedOrderedZoneItem, isImmediateFuture: boolean) {
  const positionLabel =
    item.position === 1
      ? 'Next Upcoming (#1)'
      : isImmediateFuture
        ? `#${item.position} Upcoming`
        : `#${item.position}`;

  return (
    <div
      key={item.hidden ? `days-hid-${item.position}` : `days-card-${item.card.id}`}
      className={`browser-item-card ${isImmediateFuture ? 'immediate-future-card' : ''} ${
        !item.hidden ? (item.card.color === 'red' ? 'color-red' : 'color-black') : ''
      }`}
      data-position={item.position}
    >
      <div className="browser-item-top">
        <span className={`badge mono ${item.position === 1 ? 'badge-warn' : ''}`}>
          {positionLabel}
        </span>
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
  );
}

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
        ? 'Next Upcoming Visible (Reflection)'
        : 'Concealed Sequence (Card Backs Only)';

  const immediateFutureItems = view.daysBrowserItems.slice(0, 3);
  const laterTimelineItems = view.daysBrowserItems.slice(3);

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
            <strong>Draw Flow (Left → Right):</strong> Next Upcoming (#1) → #2 → #3 → … → Bottom of
            Deck.{' '}
            {isAdmin
              ? 'Admin Inspector shows full read-only order with movement history.'
              : 'Card faces remain concealed; stack depth and card-back groups (Minor vs Major) stay visible.'}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Bordered Immediate Future (#1 - #3) */}
          <div className="immediate-future-box" data-testid="immediate-future-zone">
            <div className="immediate-future-header">
              <strong>THE IMMEDIATE FUTURE — Next {immediateFutureItems.length} Upcoming Card{immediateFutureItems.length === 1 ? '' : 's'}</strong>
              <span className="brand-sub">
                Primary target zone for Air (Shuffle), Fire (Burn), and Earth (Peek &amp; Reorder)
              </span>
            </div>
            <div className="immediate-future-grid">
              {immediateFutureItems.map((item) => renderDeckCard(item, true))}
            </div>
          </div>

          {laterTimelineItems.length > 0 && (
            <div>
              <div className="brand-sub" style={{ marginBottom: 6 }}>
                Later Timeline (#4–#{view.daysBrowserItems.length} · Drawn Left → Right)
              </div>
              <div className="browser-scroll-grid">
                {laterTimelineItems.map((item) => renderDeckCard(item, false))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
