import { ELEMENT_META, type ProjectedGameView } from '../../engine/index.js';
import type { ElementalSelectionState, ElementalTargetContext } from '../elementalTargeting.js';
import { CardBack } from './CardBack.js';

export function VeilBrowser({
  view,
  isWaterMode,
  elementalSelection,
  elementalCtx,
  onToggleVeilCard,
  onClose
}: {
  view: ProjectedGameView;
  isWaterMode: boolean;
  elementalSelection: ElementalSelectionState;
  elementalCtx: ElementalTargetContext;
  onToggleVeilCard: (cardId: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className={`browser-drawer ${isWaterMode ? 'veil-tray-water' : ''}`}
      data-testid="veil-browser"
    >
      <div className="browser-drawer-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong>The Veil — Complete Discard History ({view.veil.length})</strong>
            <span className="badge badge-ok">Newest First</span>
            {!view.zoneAccess.canResurfaceFromVeil && (
              <span className="badge badge-danger">Veil Access Restricted</span>
            )}
          </div>
          <div className="brand-sub">
            {isWaterMode
              ? `Water Resurface active: click up to ${elementalCtx.strength} eligible card${
                  elementalCtx.strength === 1 ? '' : 's'
                } to return to Deck of Days (${view.ruleset.waterResurfaceDestination}).${
                  elementalCtx.sourceCard
                    ? ` ${elementalCtx.sourceCard.shortLabel} enters the Veil on confirm and cannot resurface itself.`
                    : ''
                }`
              : 'Browse every discarded, sacrificed, burned, and resolved card in order from newest (Top) to oldest.'}
          </div>
        </div>
        <button className="btn btn-sm" onClick={onClose}>
          Close Veil
        </button>
      </div>

      {view.veilBrowserItems.length === 0 ? (
        <div className="brand-sub" style={{ padding: '6px 0' }}>
          The Veil is empty. Discarded Center cards, resolved Events, sacrifices, and consumed
          elemental cards appear here newest-first.
        </div>
      ) : (
        <div className="browser-scroll-grid">
          {view.veilBrowserItems.map((item) => {
            if (item.hidden) {
              return (
                <div
                  key={`veil-hid-${item.position}`}
                  className="browser-item-card"
                  data-position={item.position}
                >
                  <div className="browser-item-top">
                    <span className="badge mono">
                      {item.position === 1 ? 'Top' : `#${item.position}`}
                    </span>
                    <span className="badge">{item.backGroup}</span>
                  </div>
                  <div className="browser-item-hidden">
                    <CardBack backGroup={item.backGroup} size="sm" />
                    <div className="card-meta">{item.label}</div>
                  </div>
                </div>
              );
            }

            const card = item.card;
            const selIdx = elementalSelection.veilCardIds.indexOf(card.id);
            const isSelected = isWaterMode && selIdx >= 0;
            const isEligible =
              isWaterMode &&
              view.zoneAccess.canResurfaceFromVeil &&
              elementalCtx.eligibleVeilCardIds.includes(card.id);
            const atCap =
              isWaterMode &&
              !isSelected &&
              elementalSelection.veilCardIds.length >= elementalCtx.strength;
            const clickable = isWaterMode && isEligible && !atCap;

            return (
              <div
                key={`veil-card-${card.id}`}
                className={`browser-item-card ${
                  card.color === 'red' ? 'color-red' : 'color-black'
                } ${clickable ? 'clickable' : ''} ${isSelected ? 'selected-sacrifice' : ''} ${
                  isWaterMode && (!isEligible || atCap) ? 'card-disabled' : ''
                }`}
                data-position={item.position}
                onClick={clickable || isSelected ? () => onToggleVeilCard(card.id) : undefined}
                role={clickable || isSelected ? 'button' : undefined}
                tabIndex={clickable || isSelected ? 0 : undefined}
                onKeyDown={
                  clickable || isSelected
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onToggleVeilCard(card.id);
                        }
                      }
                    : undefined
                }
              >
                <div className="browser-item-top">
                  <span className="badge mono">
                    {item.position === 1 ? 'Top' : `#${item.position}`}
                  </span>
                  {isSelected ? (
                    <span className="badge badge-warn">Pick #{selIdx + 1}</span>
                  ) : (
                    <span className="badge">{card.vp} VP</span>
                  )}
                </div>

                <div className="browser-item-face">
                  <div className="browser-face-glyph">{card.shortLabel}</div>
                  <div className="browser-face-label">{card.label}</div>
                  <div className="card-meta">
                    {card.element ? `${ELEMENT_META[card.element].label} · ${card.color}` : card.family}
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
