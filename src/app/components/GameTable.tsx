import {
  ELEMENT_META,
  type BoardTargetSlot,
  type Command,
  type Element,
  type ProjectedGameView,
  type ProjectedPlayerView,
  type ReconciliationBreakdown,
  type Viewer
} from '../../engine/index.js';
import type { AgentPolicyId } from '../../sim/agents.js';
import {
  buildElementalCommand,
  moveEarthOrderSlot,
  type ElementalSelectionState,
  type ElementalTargetContext
} from '../elementalTargeting.js';
import { CardBack } from './CardBack.js';
import { CardTile } from './CardTile.js';

const ELEMENT_VERB_HINT: Readonly<Record<Element, string>> = {
  air: 'Shuffle — click Deck of Days or an occupied Board card to shuffle unpredictably.',
  fire: 'Burn — click Deck of Days or an occupied Board card to burn directly to the Veil.',
  water: 'Resurface — click the Veil to select face-up cards to return to Deck of Days.',
  earth: 'Reorder — click Deck of Days or an occupied Board card to arrange card order.'
};

export function GameTable({
  view,
  viewer,
  activePlayer,
  canActAsActivePlayer,
  canActAsReader,
  isViewingHistory,
  currentStepIndex,
  maxStepIndex,
  autoPlayMode,
  readerBotPolicy,
  liveReconciliation,
  selectedSacrificeIds,
  elementalSelection,
  elementalCtx,
  veilTrayOpen,
  onToggleVeilTray,
  onReturnToLive,
  onToggleAutoWatch,
  onStepBot,
  onTriggerBotReading,
  onSwitchViewer,
  onToggleSacrifice,
  onClearSacrifices,
  onSelectHandCardForElemental,
  onSelectBonusForElemental,
  onCancelElemental,
  onClickDaysZone,
  onClickBoardSlot,
  onToggleVeilCard,
  onUpdateElementalSelection,
  onSendCommand,
  onPlayAnotherSeed,
  onWatchFullReplay
}: {
  view: ProjectedGameView;
  viewer: Viewer;
  activePlayer: ProjectedPlayerView;
  canActAsActivePlayer: boolean;
  canActAsReader: boolean;
  isViewingHistory: boolean;
  currentStepIndex: number;
  maxStepIndex: number;
  autoPlayMode: 'off' | 'live' | 'replay';
  readerBotPolicy: AgentPolicyId;
  liveReconciliation: ReconciliationBreakdown | null;
  selectedSacrificeIds: readonly string[];
  elementalSelection: ElementalSelectionState;
  elementalCtx: ElementalTargetContext;
  veilTrayOpen: boolean;
  onToggleVeilTray: () => void;
  onReturnToLive: () => void;
  onToggleAutoWatch: () => void;
  onStepBot: () => void;
  onTriggerBotReading: () => void;
  onSwitchViewer: (next: Viewer) => void;
  onToggleSacrifice: (cardId: string) => void;
  onClearSacrifices: () => void;
  onSelectHandCardForElemental: (cardId: string) => void;
  onSelectBonusForElemental: (bonusId: string) => void;
  onCancelElemental: () => void;
  onClickDaysZone: () => void;
  onClickBoardSlot: (slot: BoardTargetSlot) => void;
  onToggleVeilCard: (cardId: string) => void;
  onUpdateElementalSelection: (patch: Partial<ElementalSelectionState>) => void;
  onSendCommand: (cmd: Command) => void;
  onPlayAnotherSeed: () => void;
  onWatchFullReplay: () => void;
}) {
  const isElementalWindow = view.phase === 'AWAITING_ELEMENTAL_ACTION' && canActAsActivePlayer;
  const activeElement = elementalCtx.activeElement;
  const cmdBuild = buildElementalCommand(view, elementalSelection, elementalCtx);

  const daysClickable = isElementalWindow && elementalCtx.eligibleZones.days;
  const eventClickable = isElementalWindow && elementalCtx.eligibleZones.boardEvent;
  const centerClickable = isElementalWindow && elementalCtx.eligibleZones.boardCenter;
  const veilHighlighted = isElementalWindow && elementalCtx.eligibleZones.veil;

  const topVeilCard = view.veil.length > 0 ? view.veil[view.veil.length - 1]! : null;
  const availableBonuses = activePlayer.pendingReaderBonuses.filter(
    (b) => b.status === 'available' && b.earnedOnTurn < view.turn && Boolean(b.sourceElement)
  );

  // Determine primary focused player (viewed player in player mode, or active player in Admin mode)
  const focusedPlayer =
    viewer.role === 'player'
      ? view.players.find((p) => p.id === viewer.playerId) ?? activePlayer
      : activePlayer;
  const otherPlayers = view.players.filter((p) => p.id !== focusedPlayer.id);

  const canSelectSacrifice =
    view.phase === 'AWAITING_EVENT_RESOLUTION' &&
    liveReconciliation?.reality !== 'treasure' &&
    focusedPlayer.id === view.activePlayerId &&
    canActAsActivePlayer;

  const needsHandDiscard =
    view.phase === 'AWAITING_HAND_DISCARD' &&
    focusedPlayer.id === view.activePlayerId &&
    canActAsActivePlayer;

  const canPickElementalHandCard =
    isElementalWindow &&
    focusedPlayer.id === view.activePlayerId &&
    !focusedPlayer.effectUsedThisTurn;

  const maxDaysPick = Math.min(
    view.daysCount,
    Math.max(1, elementalCtx.strength - elementalSelection.boardSlots.length)
  );

  return (
    <section className="panel table-panel">
      {/* Compact Table Header */}
      <div className="table-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong className="table-brand">NEXUS ECLIPSE</strong>
          <span className="badge badge-ok">
            Round {view.round} · Turn {view.turn}
          </span>
          <span className="badge">
            Active: {activePlayer.name} ({ELEMENT_META[activePlayer.lineage.element].suitSymbol}{' '}
            Rank {activePlayer.lineage.rank})
          </span>
        </div>

        <div className="toolbar-group">
          <button
            className={`btn btn-sm ${autoPlayMode !== 'off' ? 'btn-danger' : ''}`}
            onClick={onToggleAutoWatch}
          >
            {autoPlayMode !== 'off'
              ? '⏸ Pause'
              : view.status === 'completed'
                ? '▶ Replay'
                : '▶ Auto-Watch'}
          </button>
          <button
            className="btn btn-sm"
            disabled={!isViewingHistory && view.status !== 'playing'}
            onClick={onStepBot}
          >
            ⏭ Bot Step
          </button>
        </div>
      </div>

      {isViewingHistory && (
        <div className="banner-warn">
          <strong>Inspecting History (Step {currentStepIndex}/{maxStepIndex}):</strong> Read-only
          view — live state untouched.{' '}
          <button className="btn btn-sm" onClick={onReturnToLive}>
            Return to Live
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* PRIMARY 3-ZONE TABLETOP ROW: DECK OF DAYS | SHARED BOARD | THE VEIL   */}
      {/* All visible together above the fold on desktop — never a footer!      */}
      {/* ===================================================================== */}
      <div className="table-top-trio">
        {/* ZONE 1: DECK OF DAYS */}
        <div
          className={`table-zone ${daysClickable ? 'zone-target-eligible' : ''} ${
            elementalSelection.daysSelected ? 'zone-target-selected' : ''
          }`}
          onClick={daysClickable ? onClickDaysZone : undefined}
          role={daysClickable ? 'button' : undefined}
          tabIndex={daysClickable ? 0 : undefined}
          onKeyDown={
            daysClickable
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClickDaysZone();
                  }
                }
              : undefined
          }
        >
          <div className="table-zone-title">DECK OF DAYS</div>
          <div className="table-zone-visual">
            {view.daysCount > 0 ? (
              <CardBack
                backGroup={view.daysTopBackGroup ?? 'minor'}
                stacked
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
                ? `Targeted (${activeElement === 'earth' ? 'reorder below' : `${elementalSelection.daysCount} card${elementalSelection.daysCount === 1 ? '' : 's'}`})`
                : `Click to target (${activeElement?.toUpperCase()})`
              : 'Unknown future'}
          </div>
          {view.daysCards !== null && view.daysCards.length > 0 && (
            <div className="admin-peek-strip mono">
              Next: {view.daysCards.slice(0, 4).map((c) => c.shortLabel).join(' · ')}
            </div>
          )}
        </div>

        {/* ZONE 2: SHARED BOARD (EVENT · CENTER · PARALLEL) */}
        <div className="table-zone table-zone-board">
          <div className="table-zone-title">SHARED BOARD</div>
          <div className="shared-board-slots">
            {/* LEFT: EVENT */}
            <div
              className={`board-slot-card ${
                view.phase === 'AWAITING_EVENT_RESOLUTION' ? 'slot-active-focus' : ''
              } ${eventClickable ? 'slot-target-eligible' : ''} ${
                elementalSelection.boardSlots.includes('event') ? 'slot-target-selected' : ''
              }`}
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
              {!view.ruleset.features.barriersAndTrials ? (
                <div className="empty-card-outline sm">Locked</div>
              ) : view.board.event.length === 0 ? (
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
                      }`}
                    >
                      <div className="mini-face-glyph">{item.card.shortLabel}</div>
                      <div className="mini-face-tag">
                        {view.eventReality === 'treasure'
                          ? 'Treasure'
                          : view.eventReality === 'barrier'
                            ? `Barrier ${item.card.vp}`
                            : `Trial >${item.card.vp}`}
                      </div>
                    </div>
                  )
                )
              )}
            </div>

            {/* CENTER: ACTIVE / READING */}
            <div
              className={`board-slot-card ${
                view.phase === 'AWAITING_READING' ||
                view.phase === 'AWAITING_READING_DECISION' ||
                view.phase === 'AWAITING_ABANDONED_CHOICE'
                  ? 'slot-active-focus'
                  : ''
              } ${centerClickable ? 'slot-target-eligible' : ''} ${
                elementalSelection.boardSlots.includes('center') ? 'slot-target-selected' : ''
              }`}
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
            <div className="board-slot-card slot-parallel">
              <div className="slot-heading">Parallel</div>
              {view.board.parallel.length === 0 ? (
                <div className="empty-card-outline sm" title="Major Arcana arrive in Milestone E">
                  ◇
                </div>
              ) : (
                view.board.parallel.map((item, idx) =>
                  item.hidden ? (
                    <CardBack key={`par-back-${idx}`} backGroup={item.backGroup} size="sm" />
                  ) : (
                    <div key={item.card.id} className="mini-face-card">
                      <div className="mini-face-glyph">{item.card.shortLabel}</div>
                      <div className="mini-face-tag">Major</div>
                    </div>
                  )
                )
              )}
            </div>
          </div>
          <div className="table-zone-sub">
            {eventClickable || centerClickable
              ? 'Click an occupied Board slot to target'
              : 'Encounter and reality'}
          </div>
        </div>

        {/* ZONE 3: THE VEIL (FACE-UP HISTORY) */}
        <div
          className={`table-zone ${veilHighlighted ? 'zone-target-eligible' : ''} ${
            veilTrayOpen || elementalSelection.veilCardIds.length > 0 ? 'zone-target-selected' : ''
          }`}
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

      {/* ===================================================================== */}
      {/* EXPANDABLE FACE-UP VEIL HISTORY TRAY (AUTO-OPENS FOR WATER)           */}
      {/* ===================================================================== */}
      {(veilTrayOpen || activeElement === 'water') && (
        <div className={`veil-tray ${activeElement === 'water' ? 'veil-tray-water' : ''}`}>
          <div className="veil-tray-header">
            <div>
              <strong>The Veil — Face-Up Discard History ({view.veil.length})</strong>
              {activeElement === 'water' && (
                <span className="brand-sub" style={{ marginLeft: 8 }}>
                  Click up to {elementalCtx.strength} card
                  {elementalCtx.strength === 1 ? '' : 's'} to resurface → Deck of Days (
                  {view.ruleset.waterResurfaceDestination}).
                  {elementalCtx.sourceCard
                    ? ` ${elementalCtx.sourceCard.shortLabel} enters Veil on confirm and cannot resurface itself.`
                    : ''}
                </span>
              )}
            </div>
            <button className="btn btn-sm" onClick={onToggleVeilTray}>
              {veilTrayOpen ? 'Close Veil' : 'Collapse'}
            </button>
          </div>
          {view.veil.length === 0 ? (
            <div className="brand-sub">No cards in the Veil yet.</div>
          ) : (
            <div className="card-list">
              {[...view.veil].reverse().map((card) => {
                const isWaterMode = activeElement === 'water' && isElementalWindow;
                const selIdx = elementalSelection.veilCardIds.indexOf(card.id);
                const isSelected = selIdx >= 0;
                const isEligible = elementalCtx.eligibleVeilCardIds.includes(card.id);
                const atCap =
                  isWaterMode &&
                  !isSelected &&
                  elementalSelection.veilCardIds.length >= elementalCtx.strength;
                return (
                  <CardTile
                    key={card.id}
                    card={card}
                    compact
                    selected={isWaterMode && isSelected}
                    selectionOrder={isWaterMode && isSelected ? selIdx + 1 : undefined}
                    disabled={isWaterMode && (!isEligible || atCap)}
                    onClick={isWaterMode ? () => onToggleVeilCard(card.id) : undefined}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* CONTEXTUAL ACTION BAND (ZERO DROPDOWNS!)                              */}
      {/* ===================================================================== */}
      <div className="action-stage">
        {view.status === 'completed' && view.outcome ? (
          <div className="action-row">
            <div>
              <h2 className="decision-title">Game Complete — {view.outcome.summary}</h2>
            </div>
            <div className="toolbar-group">
              <button className="btn btn-primary" onClick={onPlayAnotherSeed}>
                Play Another Seed
              </button>
              <button className="btn" onClick={onWatchFullReplay}>
                ▶ Watch Full Replay
              </button>
            </div>
          </div>
        ) : view.phase === 'AWAITING_ABANDONED_CHOICE' ? (
          <div className="action-row">
            <div>
              <h2 className="decision-title">
                {activePlayer.name}: Claim the abandoned Center card freely?
              </h2>
              <div className="brand-sub">
                Claim it directly as free Treasure (skipping your reading), or decline it to the Veil
                for a fresh concealed reading.
              </div>
            </div>
            <div className="toolbar-group">
              <button
                className="btn btn-primary"
                disabled={!canActAsActivePlayer}
                onClick={() =>
                  onSendCommand({ type: 'ClaimAbandonedCard', playerId: view.activePlayerId })
                }
              >
                Claim Free Treasure
              </button>
              <button
                className="btn"
                disabled={!canActAsActivePlayer}
                onClick={() =>
                  onSendCommand({ type: 'DeclineAbandonedCard', playerId: view.activePlayerId })
                }
              >
                Decline to Veil &amp; Read New Card
              </button>
            </div>
          </div>
        ) : view.phase === 'AWAITING_READING' && view.currentReading ? (
          <div className="action-row">
            <div>
              <h2 className="decision-title">
                {canActAsReader
                  ? `Reader (${view.currentReading.readerName}): Inspect Center & Advise ${activePlayer.name}`
                  : `Waiting for ${view.currentReading.readerName}'s Reading`}
              </h2>
              <div className="brand-sub">
                {canActAsReader
                  ? 'Center is visible only to you. Advise GOOD or BAD (honest or bluff).'
                  : `Center is face-down. Receive ${view.currentReading.readerName}'s reading before choosing Pursue or Discard.`}
              </div>
            </div>
            <div className="toolbar-group">
              {canActAsReader ? (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={() =>
                      onSendCommand({
                        type: 'GiveReading',
                        playerId: view.currentReading!.readerId,
                        advice: 'good'
                      })
                    }
                  >
                    Advise: GOOD
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() =>
                      onSendCommand({
                        type: 'GiveReading',
                        playerId: view.currentReading!.readerId,
                        advice: 'bad'
                      })
                    }
                  >
                    Advise: BAD
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn btn-primary"
                    disabled={isViewingHistory}
                    onClick={onTriggerBotReading}
                  >
                    Receive Bot Reading ({readerBotPolicy === 'bluffing-rival' ? 'Rival AI' : 'Honest AI'})
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      onSwitchViewer({ role: 'player', playerId: view.currentReading!.readerId })
                    }
                  >
                    Switch to {view.currentReading.readerName} (Hotseat)
                  </button>
                </>
              )}
            </div>
          </div>
        ) : view.phase === 'AWAITING_READING_DECISION' && view.currentReading?.advice ? (
          <div className="action-row">
            <div>
              <h2 className="decision-title">
                {view.currentReading.readerName} advises{' '}
                <span
                  className={
                    view.currentReading.advice === 'good' ? 'badge badge-ok' : 'badge badge-danger'
                  }
                >
                  {view.currentReading.advice.toUpperCase()}
                </span>{' '}
                — {activePlayer.name}, Pursue or Discard?
              </h2>
              <div className="brand-sub">
                {view.ruleset.features.barriersAndTrials
                  ? 'Pursuing reveals Center and the Left Event (Treasure, Barrier, or Trial). Discarding sends Center straight to the Veil.'
                  : 'Pursuing reveals and claims Center. Discarding sends it to the Veil.'}
              </div>
            </div>
            <div className="toolbar-group">
              {canActAsActivePlayer ? (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={() =>
                      onSendCommand({ type: 'PursueCenter', playerId: view.activePlayerId })
                    }
                  >
                    Pursue Center Card
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      onSendCommand({ type: 'DiscardCenter', playerId: view.activePlayerId })
                    }
                  >
                    Discard to Veil
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => onSwitchViewer({ role: 'player', playerId: view.activePlayerId })}
                >
                  Hand Back to {activePlayer.name}
                </button>
              )}
            </div>
          </div>
        ) : view.phase === 'AWAITING_EVENT_RESOLUTION' && liveReconciliation ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="action-row">
              <div>
                <h2 className="decision-title">
                  {liveReconciliation.reality === 'treasure'
                    ? 'Treasure Revealed — Claim Center Freely'
                    : liveReconciliation.reality === 'barrier'
                      ? `Barrier (${liveReconciliation.eventVP} VP) — Reconcile or Abandon`
                      : `Elemental Trial (> ${liveReconciliation.eventVP} VP) — Reconcile or Abandon`}
                </h2>
                <div className="brand-sub">{liveReconciliation.requiredCondition}</div>
              </div>
              <div className="toolbar-group">
                <button
                  className="btn btn-primary"
                  disabled={!canActAsActivePlayer || !liveReconciliation.passes}
                  onClick={() =>
                    onSendCommand({
                      type: 'ResolveEvent',
                      playerId: view.activePlayerId,
                      sacrificeCardIds: selectedSacrificeIds
                    })
                  }
                >
                  {liveReconciliation.reality === 'treasure'
                    ? 'Claim Treasure'
                    : liveReconciliation.reality === 'barrier'
                      ? `Reconcile Barrier (${selectedSacrificeIds.length} sacrifice)`
                      : `Pass Trial (${selectedSacrificeIds.length} sacrifice)`}
                </button>
                {liveReconciliation.reality !== 'treasure' && (
                  <button
                    className="btn"
                    disabled={!canActAsActivePlayer}
                    onClick={() =>
                      onSendCommand({ type: 'AbandonCenter', playerId: view.activePlayerId })
                    }
                  >
                    Abandon Center
                  </button>
                )}
                {selectedSacrificeIds.length > 0 && (
                  <button className="btn btn-sm" onClick={onClearSacrifices}>
                    Clear
                  </button>
                )}
              </div>
            </div>

            {liveReconciliation.reality !== 'treasure' && (
              <div className="calc-strip">
                <span>
                  <strong>Lineage:</strong> {liveReconciliation.lineageVP} VP
                </span>
                <span>+</span>
                <span>
                  <strong>Sacrifice ({selectedSacrificeIds.length}):</strong>{' '}
                  {liveReconciliation.sacrificedVP} VP
                </span>
                {liveReconciliation.reality === 'trial' && (
                  <>
                    <span>+</span>
                    <span>
                      <strong>Advantage (beat {liveReconciliation.targetElement}):</strong>{' '}
                      {liveReconciliation.hasElementalAdvantage
                        ? `+${liveReconciliation.advantageModifierVP} VP ✓`
                        : 'Missing ✗'}
                    </span>
                  </>
                )}
                <span>=</span>
                <span className={`badge ${liveReconciliation.passes ? 'badge-ok' : 'badge-warn'}`}>
                  Effective: {liveReconciliation.effectiveVP} VP
                  {liveReconciliation.wasCapped ? ` (cap ${liveReconciliation.capLimit})` : ''}
                </span>
                {liveReconciliation.failureReason && (
                  <span className="brand-sub">· Click hand cards below to sacrifice</span>
                )}
              </div>
            )}
          </div>
        ) : view.phase === 'AWAITING_ELEMENTAL_ACTION' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="action-row">
              <div>
                <h2 className="decision-title">
                  {activeElement
                    ? `${ELEMENT_META[activeElement].suitSymbol} ${ELEMENT_META[activeElement].label} (${elementalCtx.strength} VP)`
                    : 'Your elemental action'}
                </h2>
                <div className="brand-sub">
                  {activeElement
                    ? ELEMENT_VERB_HINT[activeElement]
                    : 'Select a card from your hand, then interact directly with the highlighted Deck, Board, or Veil.'}
                </div>
              </div>

              <div className="toolbar-group">
                {activeElement && (
                  <>
                    <button
                      className="btn btn-primary"
                      disabled={!cmdBuild.ok || !canActAsActivePlayer}
                      onClick={() => {
                        if (cmdBuild.ok) onSendCommand(cmdBuild.command);
                      }}
                    >
                      {cmdBuild.ok ? `Confirm: ${cmdBuild.actionLabel}` : 'Select Target on Table'}
                    </button>
                    <button className="btn btn-sm" onClick={onCancelElemental}>
                      Cancel
                    </button>
                  </>
                )}
                <button
                  className={`btn ${activeElement ? '' : 'btn-primary'}`}
                  disabled={!canActAsActivePlayer}
                  onClick={() => onSendCommand({ type: 'EndTurn', playerId: view.activePlayerId })}
                >
                  {activeElement ? 'Skip & End Turn →' : 'Finish Turn →'}
                </button>
              </div>
            </div>

            {/* Available Reader Bonuses (Separate from physical hand-card activations) */}
            {availableBonuses.length > 0 && canActAsActivePlayer && (
              <div className="bonus-pill-row">
                <span className="badge badge-warn">Provisional Reader Bonus (0 hand cost):</span>
                {availableBonuses.map((b) => (
                  <button
                    key={b.id}
                    className={`btn btn-sm ${
                      elementalSelection.sourceKind === 'bonus' &&
                      elementalSelection.bonusId === b.id
                        ? 'btn-active'
                        : ''
                    }`}
                    onClick={() => onSelectBonusForElemental(b.id)}
                  >
                    ★ Use {ELEMENT_META[b.sourceElement!].suitSymbol}{' '}
                    {ELEMENT_META[b.sourceElement!].label} Tier 1 (Expires after T{view.turn})
                  </button>
                ))}
              </div>
            )}

            {/* Direct Stepper Pills for Air/Fire on Days (NO DROPDOWN!) */}
            {(activeElement === 'air' || activeElement === 'fire') &&
              elementalSelection.daysSelected &&
              maxDaysPick > 1 && (
                <div className="direct-controls-strip">
                  <span className="brand-sub">
                    {activeElement === 'air' ? 'Cards from Days to shuffle:' : 'Cards from Days to burn:'}
                  </span>
                  {Array.from({ length: maxDaysPick }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      className={`btn btn-sm ${elementalSelection.daysCount === n ? 'btn-active' : ''}`}
                      onClick={() => onUpdateElementalSelection({ daysCount: n })}
                    >
                      {n} card{n === 1 ? '' : 's'}
                    </button>
                  ))}
                </div>
              )}

            {/* Visual Card-Reordering Interface for Earth (NO DROPDOWN!) */}
            {activeElement === 'earth' &&
              (elementalSelection.daysSelected || elementalSelection.boardSlots.length > 0) && (
                <div className="earth-reorder-box">
                  {elementalSelection.daysSelected ? (
                    <>
                      <div className="toolbar-group" style={{ justifyContent: 'space-between' }}>
                        <strong>Earth Reorder · Deck of Days</strong>
                        <div className="toolbar-group">
                          {elementalCtx.strength >= 2 && view.daysCount >= 2 && (
                            <button
                              className={`btn btn-sm ${
                                elementalSelection.earthMode === 'days_reorder' ? 'btn-active' : ''
                              }`}
                              onClick={() => {
                                const len = Math.min(elementalCtx.strength, view.daysCount);
                                onUpdateElementalSelection({
                                  earthMode: 'days_reorder',
                                  earthIndexOrder:
                                    len === 3 ? [1, 2, 0] : [1, 0]
                                });
                              }}
                            >
                              Arrange Top {Math.min(elementalCtx.strength, view.daysCount)}
                            </button>
                          )}
                          <button
                            className={`btn btn-sm ${
                              elementalSelection.earthMode === 'days_to_bottom' ? 'btn-active' : ''
                            }`}
                            onClick={() =>
                              onUpdateElementalSelection({ earthMode: 'days_to_bottom', daysCount: 1 })
                            }
                          >
                            Move Top Card → Bottom
                          </button>
                        </div>
                      </div>

                      {elementalSelection.earthMode === 'days_reorder' &&
                      elementalCtx.strength >= 2 ? (
                        <div className="earth-slots-row">
                          {elementalSelection.earthIndexOrder.map((origIdx, posIdx) => {
                            const adminCard = view.daysCards?.[origIdx];
                            return (
                              <div key={`earth-pos-${origIdx}`} className="earth-order-card">
                                <div className="earth-pos-label">New #{posIdx + 1}</div>
                                {adminCard ? (
                                  <div className="earth-card-face">{adminCard.shortLabel}</div>
                                ) : (
                                  <CardBack
                                    backGroup={view.daysTopBackGroup ?? 'minor'}
                                    size="sm"
                                    label={`Orig #${origIdx + 1}`}
                                  />
                                )}
                                <div className="toolbar-group">
                                  <button
                                    className="btn btn-sm"
                                    disabled={posIdx === 0}
                                    onClick={() =>
                                      onUpdateElementalSelection({
                                        earthIndexOrder: moveEarthOrderSlot(
                                          elementalSelection.earthIndexOrder,
                                          posIdx,
                                          -1
                                        )
                                      })
                                    }
                                  >
                                    ←
                                  </button>
                                  <button
                                    className="btn btn-sm"
                                    disabled={
                                      posIdx === elementalSelection.earthIndexOrder.length - 1
                                    }
                                    onClick={() =>
                                      onUpdateElementalSelection({
                                        earthIndexOrder: moveEarthOrderSlot(
                                          elementalSelection.earthIndexOrder,
                                          posIdx,
                                          1
                                        )
                                      })
                                    }
                                  >
                                    →
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="brand-sub">
                          Deliberately moves the top card of Deck of Days to the bottom of the deck.
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="toolbar-group" style={{ justifyContent: 'space-between' }}>
                      <strong>
                        Earth Reorder · Board ({elementalSelection.boardSlots.join(' + ')})
                      </strong>
                      <div className="toolbar-group">
                        <button
                          className={`btn btn-sm ${
                            elementalSelection.earthMode === 'board_to_days_top' ? 'btn-active' : ''
                          }`}
                          onClick={() =>
                            onUpdateElementalSelection({ earthMode: 'board_to_days_top' })
                          }
                        >
                          Place on Top of Days
                        </button>
                        <button
                          className={`btn btn-sm ${
                            elementalSelection.earthMode === 'board_to_days_bottom'
                              ? 'btn-active'
                              : ''
                          }`}
                          onClick={() =>
                            onUpdateElementalSelection({ earthMode: 'board_to_days_bottom' })
                          }
                        >
                          Place on Bottom of Days
                        </button>
                        {elementalCtx.canSwapBoard && (
                          <button
                            className={`btn btn-sm ${
                              elementalSelection.earthMode === 'board_swap' ? 'btn-active' : ''
                            }`}
                            onClick={() =>
                              onUpdateElementalSelection({
                                boardSlots: ['event', 'center'],
                                earthMode: 'board_swap'
                              })
                            }
                          >
                            Swap Event ↔ Center
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
          </div>
        ) : view.phase === 'AWAITING_HAND_DISCARD' ? (
          <div className="action-row">
            <div>
              <h2 className="decision-title">
                {activePlayer.name}: Discard down to {view.ruleset.maxHandSize} cards
              </h2>
              <div className="brand-sub">Click any card in your hand below to send it to the Veil.</div>
            </div>
          </div>
        ) : view.phase === 'AWAITING_CENTER_DECISION' ? (
          <div className="action-row">
            <h2 className="decision-title">Tutorial 1.1: Claim or Discard Center</h2>
            <div className="toolbar-group">
              <button
                className="btn btn-primary"
                disabled={!canActAsActivePlayer}
                onClick={() =>
                  onSendCommand({ type: 'ClaimCenterCard', playerId: view.activePlayerId })
                }
              >
                Claim Center Card
              </button>
              <button
                className="btn"
                disabled={!canActAsActivePlayer}
                onClick={() =>
                  onSendCommand({ type: 'DiscardCenterCard', playerId: view.activePlayerId })
                }
              >
                Discard to Veil
              </button>
            </div>
          </div>
        ) : (
          <div className="action-row">
            <div>
              <h2 className="decision-title">{activePlayer.name}: Turn Complete</h2>
              <div className="brand-sub">Finish turn to pass play and refresh the board.</div>
            </div>
            <button
              className="btn btn-primary"
              disabled={!canActAsActivePlayer}
              onClick={() => onSendCommand({ type: 'EndTurn', playerId: view.activePlayerId })}
            >
              Finish Turn →
            </button>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* YOUR HAND & LINEAGE AREA (PRIMARY PLAYER FOCUS)                       */}
      {/* ===================================================================== */}
      <div className="hand-area">
        <div className="hand-area-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <strong>
              {focusedPlayer.name}&apos;s hand ({focusedPlayer.handCount}/{view.ruleset.maxHandSize})
            </strong>
            <span className="badge badge-ok">
              Lineage: {focusedPlayer.lineage.topCard.shortLabel} · Rank {focusedPlayer.lineage.rank}{' '}
              ({focusedPlayer.lineage.topCard.vp} VP · {focusedPlayer.evolutionsCompleted} evo)
            </span>
            {focusedPlayer.availableReaderBonusCount > 0 && (
              <span className="badge badge-warn">
                ★ {focusedPlayer.availableReaderBonusCount} Reader Bonus Ready
              </span>
            )}
          </div>
          <span className="brand-sub">
            {canSelectSacrifice
              ? 'Click cards to sacrifice for obstacle'
              : needsHandDiscard
                ? 'Click card to discard to Veil'
                : canPickElementalHandCard
                  ? 'Click a card to activate its element (Card → Veil)'
                  : focusedPlayer.effectUsedThisTurn
                    ? 'Elemental action used this turn'
                    : ''}
          </span>
        </div>

        {focusedPlayer.hand === null ? (
          <div className="badge">Hidden ({focusedPlayer.handCount} cards)</div>
        ) : focusedPlayer.hand.length === 0 ? (
          <div className="brand-sub">Hand is empty.</div>
        ) : (
          <div className="hand-cards-grid">
            {focusedPlayer.hand.map((card) => {
              const isSelectedForSac = canSelectSacrifice && selectedSacrificeIds.includes(card.id);
              const isSelectedForEl =
                canPickElementalHandCard &&
                elementalSelection.sourceKind === 'hand' &&
                elementalSelection.sourceCardId === card.id;
              return (
                <CardTile
                  key={card.id}
                  card={card}
                  large
                  selected={isSelectedForSac || isSelectedForEl}
                  onClick={
                    canSelectSacrifice
                      ? () => onToggleSacrifice(card.id)
                      : needsHandDiscard
                        ? () =>
                            onSendCommand({
                              type: 'DiscardHandCard',
                              playerId: focusedPlayer.id,
                              cardId: card.id
                            })
                        : canPickElementalHandCard
                          ? () => onSelectHandCardForElemental(card.id)
                          : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Compact Opponent Status Strip */}
      <div className="opponents-strip">
        {otherPlayers.map((opp) => (
          <div key={opp.id} className="opponent-pill">
            <strong>
              {opp.name} {opp.isActive ? '● Active' : opp.isCurrentReader ? '◉ Reader' : ''}
            </strong>
            <span className="badge">
              Lineage {opp.lineage.topCard.shortLabel} (Rank {opp.lineage.rank} ·{' '}
              {opp.lineage.topCard.vp} VP)
            </span>
            <span className="badge">
              Hand: {opp.hand ? opp.hand.map((c) => c.shortLabel).join(' ') || 'Empty' : `${opp.handCount} hidden`}
            </span>
            {opp.pendingReaderBonusCount > 0 && (
              <span className="badge badge-warn">+{opp.pendingReaderBonusCount} Bonus</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
