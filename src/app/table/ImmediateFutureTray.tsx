import {
  ELEMENT_META,
  type ProjectedGameView,
  type Viewer
} from '../../engine/index.js';
import { CardBack } from '../components/CardBack.js';
import type { ElementalSelectionState, ElementalTargetContext } from '../elementalTargeting.js';

/**
 * Interactive Deck of Days & Immediate Future (#1–#3) browser.
 * Fixes the R1 read-only browser trap: when Air/Fire/Earth targeting is active
 * (hand card OR free Reader Bonus), clicking directly on #1–#3 inside the Immediate Future
 * targets Deck of Days cleanly and clearly explains Tier-1 vs Tier-2+ limits!
 */
export function ImmediateFutureTray({
  view,
  viewer,
  canTargetDays,
  elementalSelection,
  elementalCtx,
  onSelectDaysCount,
  onClose
}: {
  view: ProjectedGameView;
  viewer: Viewer;
  canTargetDays: boolean;
  elementalSelection: ElementalSelectionState;
  elementalCtx: ElementalTargetContext;
  onSelectDaysCount: (count: number) => void;
  onClose: () => void;
}) {
  const isAdmin = viewer.role === 'admin';
  const items = view.daysBrowserItems;
  const immediateFuture = items.slice(0, 3);
  const laterDeck = items.slice(3);
  const activeElement = elementalCtx.activeElement;
  const maxSelectableFromDays = Math.min(
    view.daysCount,
    Math.max(1, elementalCtx.strength - elementalSelection.boardSlots.length)
  );

  const renderCard = (
    item: (typeof items)[number],
    inImmediateFuture: boolean,
    idxInImmediate: number
  ) => {
    const isNextUpcoming = item.position === 1;
    const isClickable =
      inImmediateFuture &&
      canTargetDays &&
      activeElement !== null &&
      activeElement !== 'water' &&
      idxInImmediate < maxSelectableFromDays;
    const isSelectedForAction =
      inImmediateFuture &&
      canTargetDays &&
      elementalSelection.daysSelected &&
      idxInImmediate < elementalSelection.daysCount;
    const isBeyondStrength =
      inImmediateFuture &&
      canTargetDays &&
      activeElement !== null &&
      activeElement !== 'water' &&
      idxInImmediate >= maxSelectableFromDays;

    return (
      <div
        key={`days-pos-${item.position}`}
        data-testid={isNextUpcoming ? 'immediate-future-card-1' : `immediate-future-card-${item.position}`}
        className={`browser-item-card ${inImmediateFuture ? 'immediate-future-card' : ''} ${
          isNextUpcoming ? 'next-upcoming-card' : ''
        } ${isClickable ? 'clickable' : ''} ${isSelectedForAction ? 'selected' : ''}`}
        role={isClickable ? 'button' : undefined}
        tabIndex={isClickable ? 0 : undefined}
        onClick={isClickable ? () => onSelectDaysCount(idxInImmediate + 1) : undefined}
        onKeyDown={
          isClickable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectDaysCount(idxInImmediate + 1);
                }
              }
            : undefined
        }
        title={
          isBeyondStrength
            ? `Beyond current strength (Tier ${elementalCtx.strength} affects up to ${maxSelectableFromDays} card${maxSelectableFromDays === 1 ? '' : 's'})`
            : undefined
        }
      >
        <div className="browser-pos-tag">
          {isNextUpcoming
            ? 'Next Upcoming (#1)'
            : inImmediateFuture
              ? `#${item.position} Upcoming`
              : `#${item.position}`}
        </div>
        {item.hidden ? (
          <div className="browser-hidden-wrap">
            <CardBack backGroup={item.backGroup} size="sm" />
            <div className="browser-item-meta">
              {item.backGroup === 'major' ? 'Major back' : 'Minor back'}
            </div>
          </div>
        ) : (
          <div
            className={`browser-face-wrap ${
              item.card.color === 'red' ? 'color-red' : 'color-black'
            }`}
          >
            <div className="browser-face-glyph">{item.card.shortLabel}</div>
            <div className="browser-item-name">{item.card.label}</div>
            <div className="browser-item-meta">
              {item.card.family === 'classic-court'
                ? `Court +${item.card.courtBonus ?? 1}`
                : `${item.card.vp} VP`}
            </div>
          </div>
        )}
        {isSelectedForAction && <div className="badge badge-ok">✓ Targeted</div>}
        {isClickable && !isSelectedForAction && (
          <div className="browser-item-meta">
            Click to target top {idxInImmediate + 1}
          </div>
        )}
        {isBeyondStrength && (
          <div className="browser-item-meta">Needs Tier {idxInImmediate + 1}+</div>
        )}
      </div>
    );
  };

  return (
    <div className="zone-browser-panel" data-testid="deck-days-browser">
      <div className="zone-browser-header">
        <div>
          <strong>
            Deck of Days — Ordered Draw Sequence ({items.length} card{items.length === 1 ? '' : 's'})
          </strong>
          <div className="brand-sub">
            Draw flow reads left → right: <strong>Next Upcoming (#1)</strong> is drawn next.
            {isAdmin
              ? ' Admin Inspector shows all card faces.'
              : ' Card backs show Minor vs Major without revealing concealed faces.'}
          </div>
        </div>
        <div className="toolbar-group">
          {canTargetDays && activeElement && activeElement !== 'water' && (
            <span className="badge badge-ok">
              {ELEMENT_META[activeElement].suitSymbol} {ELEMENT_META[activeElement].label} Tier{' '}
              {elementalCtx.strength}: click #1
              {maxSelectableFromDays > 1 ? `–#${maxSelectableFromDays}` : ''} to target
              {elementalCtx.strength === 1 && activeElement === 'earth'
                ? ' (reordering 2+ requires Tier 2+)'
                : ''}
            </span>
          )}
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close Browser
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="brand-sub">Deck of Days is empty.</div>
      ) : (
        <div className="days-browser-sections">
          <div className="immediate-future-box" data-testid="immediate-future-zone">
            <div className="immediate-future-header">
              <span className="immediate-future-title">
                THE IMMEDIATE FUTURE (Next {immediateFuture.length} Card
                {immediateFuture.length === 1 ? '' : 's'})
              </span>
              <span className="immediate-future-flow">Next drawn →</span>
            </div>
            <div className="browser-card-strip">
              {immediateFuture.map((item, idx) => renderCard(item, true, idx))}
            </div>
          </div>

          {laterDeck.length > 0 && (
            <div className="later-deck-box">
              <div className="later-deck-header">
                Later in Deck of Days (#4–#{items.length})
              </div>
              <div className="browser-card-strip">
                {laterDeck.map((item) => renderCard(item, false, 99))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
