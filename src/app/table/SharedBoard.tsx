import type {
  BoardTargetSlot,
  ProjectedGameView
} from '../../engine/index.js';
import { CardBack } from '../components/CardBack.js';
import type { ElementalSelectionState, ElementalTargetContext } from '../elementalTargeting.js';

export function SharedBoard({
  view,
  canTargetZones,
  elementalSelection,
  elementalCtx,
  daysBrowserOpen,
  veilTrayOpen,
  onToggleDaysBrowser,
  onToggleVeilTray,
  onClickDaysZone,
  onClickBoardSlot
}: {
  view: ProjectedGameView;
  canTargetZones: boolean;
  elementalSelection: ElementalSelectionState;
  elementalCtx: ElementalTargetContext;
  daysBrowserOpen: boolean;
  veilTrayOpen: boolean;
  onToggleDaysBrowser: () => void;
  onToggleVeilTray: () => void;
  onClickDaysZone: () => void;
  onClickBoardSlot: (slot: BoardTargetSlot) => void;
}) {
  const daysClickable = canTargetZones && elementalCtx.eligibleZones.days;
  const eventClickable = canTargetZones && elementalCtx.eligibleZones.boardEvent;
  const centerClickable = canTargetZones && elementalCtx.eligibleZones.boardCenter;
  const parallelClickable = canTargetZones && elementalCtx.eligibleZones.boardParallel;
  const veilHighlighted = canTargetZones && elementalCtx.eligibleZones.veil;
  const topVeilCard = view.veil.length > 0 ? view.veil[view.veil.length - 1]! : null;
  const dormantSet = new Set(view.dormantMajorCardIds);

  const renderCourtTag = (cardId: string, courtBonus?: number) => {
    const dormant = dormantSet.has(cardId);
    return dormant
      ? `Court +${courtBonus ?? 1} · Dormant`
      : `Court +${courtBonus ?? 1} · Active`;
  };

  return (
    <div className="table-zones-row">
      {/* ZONE 1: DECK OF DAYS */}
      <div
        className={`table-zone ${daysClickable ? 'zone-target-eligible' : ''} ${
          elementalSelection.daysSelected || daysBrowserOpen ? 'zone-target-selected' : ''
        }`}
        data-testid="deck-of-days-zone"
        onClick={daysClickable ? onClickDaysZone : onToggleDaysBrowser}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (daysClickable) onClickDaysZone();
            else onToggleDaysBrowser();
          }
        }}
      >
        <div className="table-zone-title">DECK OF DAYS</div>
        <div className="table-zone-visual">
          {view.daysCount > 0 && view.daysTopBackGroup ? (
            <CardBack
              backGroup={view.daysTopBackGroup}
              size="md"
              highlighted={daysClickable}
              selected={elementalSelection.daysSelected}
            />
          ) : (
            <div className="empty-card-outline">Empty</div>
          )}
        </div>
        <div className="table-zone-count">
          {view.daysCount} card{view.daysCount === 1 ? '' : 's'}
        </div>
        <div className="table-zone-sub">
          {daysClickable
            ? elementalSelection.daysSelected
              ? `✓ Immediate Future targeted (top ${elementalSelection.daysCount})`
              : 'Click to target Immediate Future'
            : daysBrowserOpen
              ? 'Hide Immediate Future ▲'
              : 'Browse Immediate Future ▾'}
        </div>
        {daysClickable && (
          <button
            type="button"
            className="btn btn-sm zone-inline-browse-btn"
            onClick={(e) => {
              e.stopPropagation();
              onToggleDaysBrowser();
            }}
          >
            {daysBrowserOpen ? 'Hide #1–#3' : 'Open #1–#3'}
          </button>
        )}
      </div>

      {/* ZONE 2: SHARED BOARD (EVENT · CENTER · PARALLEL) */}
      <div className="table-zone table-zone-board">
        <div className="table-zone-title">SHARED BOARD</div>
        <div className="board-three-slots">
          {/* LEFT: EVENT */}
          <div
            className={`board-slot-card ${eventClickable ? 'slot-target-eligible' : ''} ${
              elementalSelection.boardSlots.includes('event') ? 'slot-target-selected' : ''
            }`}
            data-testid="board-slot-event"
            onClick={eventClickable ? () => onClickBoardSlot('event') : undefined}
            role={eventClickable ? 'button' : undefined}
            tabIndex={eventClickable ? 0 : undefined}
            onKeyDown={
              eventClickable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onClickBoardSlot('event');
                    }
                  }
                : undefined
            }
          >
            <div className="slot-heading">Event</div>
            {view.board.event.length === 0 ? (
              <div className="empty-card-outline sm">Empty</div>
            ) : (
              view.board.event.map((item, idx) =>
                item.hidden ? (
                  <CardBack
                    key={`ev-back-${idx}`}
                    backGroup={item.backGroup}
                    size="sm"
                    highlighted={eventClickable}
                    selected={elementalSelection.boardSlots.includes('event')}
                  />
                ) : (
                  <div
                    key={item.card.id}
                    className={`mini-face-card ${
                      item.card.color === 'red' ? 'color-red' : 'color-black'
                    } ${item.card.family === 'classic-court' ? 'slot-major-card' : ''}`}
                  >
                    <div className="mini-face-glyph">{item.card.shortLabel}</div>
                    <div className="mini-face-tag">
                      {item.card.family === 'classic-court'
                        ? 'Major Resonance'
                        : view.eventReality
                          ? view.eventReality.toUpperCase()
                          : `${item.card.vp} VP`}
                    </div>
                  </div>
                )
              )
            )}
          </div>

          {/* CENTER */}
          <div
            className={`board-slot-card ${centerClickable ? 'slot-target-eligible' : ''} ${
              elementalSelection.boardSlots.includes('center') ? 'slot-target-selected' : ''
            } ${view.centerAbandoned ? 'slot-abandoned' : ''}`}
            data-testid="board-slot-center"
            onClick={centerClickable ? () => onClickBoardSlot('center') : undefined}
            role={centerClickable ? 'button' : undefined}
            tabIndex={centerClickable ? 0 : undefined}
            onKeyDown={
              centerClickable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onClickBoardSlot('center');
                    }
                  }
                : undefined
            }
          >
            <div className="slot-heading">Center</div>
            {view.board.center.length === 0 ? (
              <div className="empty-card-outline sm">Empty</div>
            ) : (
              view.board.center.map((item, idx) =>
                item.hidden ? (
                  <CardBack
                    key={`ctr-back-${idx}`}
                    backGroup={item.backGroup}
                    size="sm"
                    highlighted={centerClickable}
                    selected={elementalSelection.boardSlots.includes('center')}
                  />
                ) : (
                  <div
                    key={item.card.id}
                    className={`mini-face-card ${
                      item.card.color === 'red' ? 'color-red' : 'color-black'
                    }`}
                  >
                    <div className="mini-face-glyph">{item.card.shortLabel}</div>
                    <div className="mini-face-tag">
                      {item.privateToReader
                        ? 'Reader Peek'
                        : view.centerAbandoned
                          ? 'Abandoned'
                          : `${item.card.vp} VP`}
                    </div>
                  </div>
                )
              )
            )}
          </div>

          {/* RIGHT: PARALLEL DIMENSION */}
          <div
            className={`board-slot-card ${!view.ruleset.features.majors ? 'slot-parallel' : ''} ${
              parallelClickable ? 'slot-target-eligible' : ''
            } ${elementalSelection.boardSlots.includes('parallel') ? 'slot-target-selected' : ''}`}
            data-testid="board-slot-parallel"
            onClick={parallelClickable ? () => onClickBoardSlot('parallel') : undefined}
            role={parallelClickable ? 'button' : undefined}
            tabIndex={parallelClickable ? 0 : undefined}
            onKeyDown={
              parallelClickable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onClickBoardSlot('parallel');
                    }
                  }
                : undefined
            }
          >
            <div className="slot-heading">Parallel</div>
            {view.board.parallel.length === 0 ? (
              <div className="empty-card-outline sm">◇</div>
            ) : (
              view.board.parallel.map((item, idx) =>
                item.hidden ? (
                  <CardBack
                    key={`par-back-${idx}`}
                    backGroup={item.backGroup}
                    size="sm"
                    highlighted={parallelClickable}
                    selected={elementalSelection.boardSlots.includes('parallel')}
                  />
                ) : (
                  <div
                    key={item.card.id}
                    className={`mini-face-card ${
                      item.card.color === 'red' ? 'color-red' : 'color-black'
                    } ${item.card.family === 'classic-court' ? 'slot-major-card' : ''}`}
                  >
                    <div className="mini-face-glyph">{item.card.shortLabel}</div>
                    <div className="mini-face-tag">
                      {item.card.family === 'classic-court'
                        ? renderCourtTag(item.card.id, item.card.courtBonus)
                        : item.privateToReader
                          ? 'Next (Hidden)'
                          : `${item.card.vp} VP`}
                    </div>
                  </div>
                )
              )
            )}
          </div>
        </div>
        <div className="table-zone-sub">
          {eventClickable || centerClickable || parallelClickable
            ? 'Click an occupied Board slot to target'
            : 'Dedicated Parallel chamber holds Classic Courts (1-turn dormancy)'}
        </div>
      </div>

      {/* ZONE 3: THE VEIL */}
      <div
        className={`table-zone ${veilHighlighted ? 'zone-target-eligible' : ''} ${
          veilTrayOpen || elementalSelection.veilCardIds.length > 0 ? 'zone-target-selected' : ''
        }`}
        data-testid="veil-zone"
        onClick={onToggleVeilTray}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleVeilTray();
          }
        }}
      >
        <div className="table-zone-title">THE VEIL</div>
        <div className="table-zone-visual">
          {topVeilCard ? (
            <div
              className={`veil-top-card ${
                topVeilCard.color === 'red' ? 'color-red' : 'color-black'
              } ${veilHighlighted ? 'target-highlight' : ''}`}
            >
              <div className="veil-top-glyph">{topVeilCard.shortLabel}</div>
              <div className="veil-top-label">Face up</div>
            </div>
          ) : (
            <div className="empty-card-outline">Empty</div>
          )}
        </div>
        <div className="table-zone-count">
          {view.veil.length} card{view.veil.length === 1 ? '' : 's'}
        </div>
        <div className="table-zone-sub">
          {veilHighlighted
            ? `Click to choose up to ${elementalCtx.strength} (${elementalSelection.veilCardIds.length}/${elementalCtx.strength})`
            : veilTrayOpen
              ? 'Hide history ▲'
              : 'Visible history ▾'}
        </div>
      </div>
    </div>
  );
}
