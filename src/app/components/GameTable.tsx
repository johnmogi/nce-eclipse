import {
  ELEMENT_META,
  type BoardTargetSlot,
  type Command,
  type Element,
  type GamePhase,
  type ProjectedGameView,
  type ProjectedPlayerView,
  type ReconciliationBreakdown,
  type Viewer
} from '../../engine/index.js';
import type { PlayControlMode } from '../../sim/botController.js';
import {
  buildElementalCommand,
  moveEarthOrderSlot,
  type ElementalSelectionState,
  type ElementalTargetContext
} from '../elementalTargeting.js';
import { CardBack } from './CardBack.js';
import { CardTile } from './CardTile.js';
import { DeckDaysBrowser } from './DeckDaysBrowser.js';
import { VeilBrowser } from './VeilBrowser.js';

const ELEMENT_VERB_HINT: Readonly<Record<Element, string>> = {
  air: 'Shuffle — click Deck of Days or an occupied Board card to shuffle unpredictably.',
  fire: 'Burn — click Deck of Days or an occupied Board card to burn directly to the Veil.',
  water: 'Resurface — click the Veil to select face-up cards to return to Deck of Days.',
  earth: 'Reorder — click Deck of Days or an occupied Board card to arrange card order.'
};

const ELEMENT_SHORT_VERB: Readonly<Record<Element, string>> = {
  air: '♠ Shuffle',
  fire: '♣ Burn',
  water: '♥ Resurface',
  earth: '♦ Reorder'
};

function getTurnProgressIndex(phase: GamePhase): number {
  switch (phase) {
    case 'AWAITING_ABANDONED_CHOICE':
    case 'AWAITING_READING':
    case 'AWAITING_READING_DECISION':
      return 0; // Reading
    case 'AWAITING_EVENT_RESOLUTION':
    case 'AWAITING_CENTER_DECISION':
    case 'AWAITING_HAND_DISCARD':
      return 1; // Encounter
    case 'AWAITING_ELEMENTAL_ACTION':
      return 2; // Elemental Action
    case 'READY_TO_END_TURN':
    case 'GAME_OVER':
      return 3; // End Turn
  }
}

const TURN_STEPS = [
  { id: 'reading', label: '1. Reading' },
  { id: 'encounter', label: '2. Encounter' },
  { id: 'elemental', label: '3. Elemental Action' },
  { id: 'end', label: '4. End Turn' }
] as const;

export function GameTable({
  view,
  viewer,
  controlMode,
  humanPlayerId,
  isBotActing,
  lastBotSummary,
  activePlayer,
  canActAsActivePlayer,
  canActAsReader,
  isViewingHistory,
  currentStepIndex,
  maxStepIndex,
  liveReconciliation,
  selectedSacrificeIds,
  elementalSelection,
  elementalCtx,
  daysBrowserOpen,
  veilTrayOpen,
  onToggleDaysBrowser,
  onToggleVeilTray,
  onReturnToLive,
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
  controlMode: PlayControlMode;
  humanPlayerId: string;
  isBotActing: boolean;
  lastBotSummary: string | null;
  activePlayer: ProjectedPlayerView;
  canActAsActivePlayer: boolean;
  canActAsReader: boolean;
  isViewingHistory: boolean;
  currentStepIndex: number;
  maxStepIndex: number;
  liveReconciliation: ReconciliationBreakdown | null;
  selectedSacrificeIds: readonly string[];
  elementalSelection: ElementalSelectionState;
  elementalCtx: ElementalTargetContext;
  daysBrowserOpen: boolean;
  veilTrayOpen: boolean;
  onToggleDaysBrowser: () => void;
  onToggleVeilTray: () => void;
  onReturnToLive: () => void;
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
  const isHumanVsBot = controlMode === 'human-vs-bot';
  const isElementalWindow =
    view.phase === 'AWAITING_ELEMENTAL_ACTION' && canActAsActivePlayer && !isBotActing;
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

  // In Human vs Bot, primary hand is always Human (p1) unless Admin inspects active player
  const focusedPlayer =
    viewer.role === 'player'
      ? view.players.find((p) => p.id === viewer.playerId) ?? activePlayer
      : isHumanVsBot
        ? view.players.find((p) => p.id === humanPlayerId) ?? activePlayer
        : activePlayer;

  const canSelectSacrifice =
    view.phase === 'AWAITING_EVENT_RESOLUTION' &&
    liveReconciliation?.reality !== 'treasure' &&
    focusedPlayer.id === view.activePlayerId &&
    canActAsActivePlayer &&
    !isBotActing;

  const needsHandDiscard =
    view.phase === 'AWAITING_HAND_DISCARD' &&
    focusedPlayer.id === view.activePlayerId &&
    canActAsActivePlayer &&
    !isBotActing;

  const canPickElementalHandCard =
    isElementalWindow &&
    focusedPlayer.id === view.activePlayerId &&
    !focusedPlayer.effectUsedThisTurn;

  const maxDaysPick = Math.min(
    view.daysCount,
    Math.max(1, elementalCtx.strength - elementalSelection.boardSlots.length)
  );

  const progressIndex = getTurnProgressIndex(view.phase);

  const getPlayerRoleTitle = (p: ProjectedPlayerView): string => {
    if (isHumanVsBot) {
      return p.id === humanPlayerId ? 'PLAYER 1 — YOU' : `${p.name.toUpperCase()} — BOT`;
    }
    if (controlMode === 'auto-sim') {
      return `${p.name.toUpperCase()} — SIM BOT`;
    }
    return p.name.toUpperCase();
  };

  const getPlayerStatusPill = (p: ProjectedPlayerView): { text: string; tone: string } => {
    if (p.isCurrentReader && view.phase === 'AWAITING_READING') {
      if (isHumanVsBot && p.id === humanPlayerId) {
        return { text: 'Your Reading for Bot', tone: 'badge-warn' };
      }
      return { text: 'Reader', tone: 'badge-warn' };
    }
    if (p.isActive) {
      if (isHumanVsBot && p.id === humanPlayerId) {
        return { text: 'Your Turn', tone: 'badge-ok' };
      }
      if (isHumanVsBot && p.id !== humanPlayerId) {
        return { text: isBotActing ? 'Bot Acting…' : "Bot's Turn", tone: 'badge-ok' };
      }
      return { text: 'Active Turn', tone: 'badge-ok' };
    }
    if (p.isCurrentReader) {
      return { text: 'Reader', tone: '' };
    }
    return { text: 'Waiting', tone: '' };
  };

  return (
    <section className="panel table-panel">
      {/* Compact Table Header */}
      <div className="table-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong className="table-brand">NEXUS ECLIPSE</strong>
          <span className="badge badge-ok">
            {controlMode === 'human-vs-bot'
              ? 'Human vs Bot'
              : controlMode === 'hotseat'
                ? 'Hotseat (2P)'
                : 'Auto-Sim'}
          </span>
          <span className="badge">
            Round {view.round} · Turn {view.turn}
          </span>
          {viewer.role === 'admin' && (
            <span className="badge badge-warn">Admin God Mode (Inspector)</span>
          )}
        </div>

        <div className="toolbar-group">
          {lastBotSummary && isHumanVsBot && (
            <span className="bot-activity-chip" title={lastBotSummary}>
              🤖 {lastBotSummary}
            </span>
          )}
          <span className="badge" title="Periodic consensual Trading Market arrives in Milestone D2">
            Market: D2 Upcoming
          </span>
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
      {/* PERMANENT DUAL PLAYER IDENTITY STRIP (PRIMARY ACES + CURRENT LINEAGE) */}
      {/* Both Primary Aces stay permanently visible even after evolution!       */}
      {/* ===================================================================== */}
      <div className="identity-strip">
        {view.players.map((p) => {
          const statusPill = getPlayerStatusPill(p);
          const primaryAce = p.lineage.primaryAceCard;
          const currentTop = p.lineage.topCard;
          const hasEvolved = currentTop.id !== primaryAce.id;
          const isBotPlayer = isHumanVsBot && p.id !== humanPlayerId;

          return (
            <div
              key={p.id}
              className={`identity-card ${p.isActive ? 'identity-active' : ''}`}
              data-player-id={p.id}
            >
              <div className="identity-top-row">
                <div className="identity-name">
                  <span aria-hidden="true">{isBotPlayer ? '🤖' : '👤'}</span>
                  <strong>{getPlayerRoleTitle(p)}</strong>
                </div>
                <span className={`badge ${statusPill.tone}`}>{statusPill.text}</span>
              </div>

              <div className="identity-lineage-row">
                {/* Permanent Primary Ace */}
                <div
                  className={`identity-ace-box ${
                    primaryAce.color === 'red' ? 'color-red' : 'color-black'
                  }`}
                  data-testid={`primary-ace-${p.id}`}
                >
                  <div className="identity-ace-glyph">{primaryAce.shortLabel}</div>
                  <div className="identity-ace-meta">
                    Primary Ace · {ELEMENT_META[p.primaryElement].label}
                  </div>
                </div>

                <div className="identity-arrow" aria-hidden="true">
                  →
                </div>

                {/* Evolving Current Lineage */}
                <div
                  className={`identity-lineage-box ${
                    currentTop.color === 'red' ? 'color-red' : 'color-black'
                  }`}
                  data-testid={`current-lineage-${p.id}`}
                >
                  <div className="identity-lineage-top">
                    <strong>{currentTop.shortLabel}</strong>
                    <span className="badge">Rank {p.lineage.rank}</span>
                    <span className="badge">{currentTop.vp} VP</span>
                  </div>
                  <div className="identity-ace-meta">
                    {hasEvolved
                      ? `Current Lineage · ${ELEMENT_META[p.lineage.element].label} (${p.evolutionsCompleted} evo)`
                      : `At Primary Ace (${ELEMENT_META[p.lineage.element].label})`}
                  </div>
                </div>

                {/* Public Stats: Hand Count (never reveals Bot hand) + Bonuses */}
                <div className="identity-meta-col">
                  <span className="badge">
                    Hand: {p.handCount}/{view.ruleset.maxHandSize}
                    {p.hand === null ? ' (Hidden)' : ''}
                  </span>
                  {p.availableReaderBonusCount > 0 ? (
                    <span className="badge badge-warn">
                      ★ {p.availableReaderBonusCount} Bonus Ready
                    </span>
                  ) : p.pendingReaderBonusCount > 0 ? (
                    <span className="badge">+{p.pendingReaderBonusCount} Bonus Next Turn</span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ===================================================================== */}
      {/* PRIMARY 3-ZONE TABLETOP ROW: DECK OF DAYS | SHARED BOARD | THE VEIL   */}
      {/* ===================================================================== */}
      <div className="table-top-trio">
        {/* ZONE 1: DECK OF DAYS */}
        <div
          className={`table-zone ${daysClickable ? 'zone-target-eligible' : ''} ${
            elementalSelection.daysSelected || daysBrowserOpen ? 'zone-target-selected' : ''
          }`}
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
            {view.daysCount > 0 ? (
              view.zoneVisibility.days === 'top_only' &&
              view.daysBrowserItems[0] &&
              !view.daysBrowserItems[0].hidden ? (
                <div
                  className={`veil-top-card ${
                    view.daysBrowserItems[0].card.color === 'red' ? 'color-red' : 'color-black'
                  } ${daysClickable ? 'target-highlight' : ''}`}
                >
                  <div className="veil-top-glyph">{view.daysBrowserItems[0].card.shortLabel}</div>
                  <div className="veil-top-label">Top Revealed</div>
                </div>
              ) : (
                <CardBack
                  backGroup={view.daysTopBackGroup ?? 'minor'}
                  stacked
                  size="md"
                  highlighted={daysClickable}
                  selected={elementalSelection.daysSelected}
                />
              )
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
              : daysBrowserOpen
                ? 'Hide draw pile ▲'
                : viewer.role === 'admin'
                  ? 'Click to browse full order ▾'
                  : 'Unknown future · Browse stack ▾'}
          </div>
          {daysClickable && (
            <button
              className="btn btn-sm zone-browse-btn"
              onClick={(e) => {
                e.stopPropagation();
                onToggleDaysBrowser();
              }}
            >
              {daysBrowserOpen ? 'Hide Deck ▲' : 'Browse Deck ▾'}
            </button>
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

      {/* EXPANDABLE ORDERED DECK OF DAYS BROWSER (READ-ONLY) */}
      {daysBrowserOpen && (
        <DeckDaysBrowser view={view} viewer={viewer} onClose={onToggleDaysBrowser} />
      )}

      {/* EXPANDABLE COMPLETE VEIL BROWSER (NEWEST FIRST · AUTO-OPENS FOR WATER) */}
      {(veilTrayOpen || activeElement === 'water') && (
        <VeilBrowser
          view={view}
          isWaterMode={activeElement === 'water' && isElementalWindow}
          elementalSelection={elementalSelection}
          elementalCtx={elementalCtx}
          onToggleVeilCard={onToggleVeilCard}
          onClose={onToggleVeilTray}
        />
      )}

      {/* ===================================================================== */}
      {/* PERSISTENT 4-STEP TURN PROGRESS INDICATOR                             */}
      {/* Reading -> Encounter -> Elemental Action -> End Turn                  */}
      {/* ===================================================================== */}
      <div className="turn-stepper" aria-label="Turn progress">
        {TURN_STEPS.map((step, idx) => {
          const isCurrent = idx === progressIndex && view.status === 'playing';
          const isDone = idx < progressIndex || view.status === 'completed';
          return (
            <div key={step.id} className="turn-stepper-item">
              <span
                className={`turn-step-pill ${
                  isCurrent ? 'step-current' : isDone ? 'step-done' : ''
                }`}
              >
                {isDone ? '✓ ' : ''}
                {step.label}
              </span>
              {idx < TURN_STEPS.length - 1 && (
                <span className="turn-step-arrow" aria-hidden="true">
                  →
                </span>
              )}
            </div>
          );
        })}

        {view.ruleset.features.elementalEffects && view.status === 'playing' && (
          <span
            className={`badge ${
              view.phase === 'AWAITING_ELEMENTAL_ACTION' && !activePlayer.effectUsedThisTurn
                ? 'badge-ok'
                : ''
            }`}
            style={{ marginLeft: 'auto' }}
          >
            {activePlayer.effectUsedThisTurn
              ? 'Elemental action used (0 left)'
              : '1 elemental action available'}
          </span>
        )}
      </div>

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
        ) : isBotActing ? (
          <div className="action-row">
            <div>
              <h2 className="decision-title">
                🤖 {activePlayer.name} (Bot) is taking its turn…
              </h2>
              <div className="brand-sub">
                {lastBotSummary ?? 'Bot evaluates only public & role-authorized information.'}
              </div>
            </div>
            <span className="badge badge-ok">Autonomous Bot Turn</span>
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
                  ? isHumanVsBot && view.currentReading.readerId === humanPlayerId
                    ? `You are the Reader for ${activePlayer.name} (Bot) — Advise GOOD or BAD`
                    : `Reader (${view.currentReading.readerName}): Inspect Center & Advise ${activePlayer.name}`
                  : `Waiting for ${view.currentReading.readerName}'s Reading`}
              </h2>
              <div className="brand-sub">
                {canActAsReader
                  ? 'You see Center privately on the Shared Board above. Tell the truth or bluff — then Bot plays its own turn automatically.'
                  : 'Center is concealed until the Reader delivers GOOD or BAD advice.'}
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
              ) : controlMode === 'hotseat' ? (
                <button
                  className="btn btn-primary"
                  onClick={() =>
                    onSwitchViewer({ role: 'player', playerId: view.currentReading!.readerId })
                  }
                >
                  Switch to {view.currentReading.readerName} (Hotseat)
                </button>
              ) : null}
            </div>
          </div>
        ) : view.phase === 'AWAITING_READING_DECISION' && view.currentReading?.advice ? (
          <div className="action-row">
            <div>
              <h2 className="decision-title">
                {isHumanVsBot && view.currentReading.readerId !== humanPlayerId
                  ? 'Bot advises: '
                  : `${view.currentReading.readerName} advises: `}
                <span
                  className={
                    view.currentReading.advice === 'good' ? 'badge badge-ok' : 'badge badge-danger'
                  }
                >
                  {view.currentReading.advice.toUpperCase()}
                </span>
              </h2>
              <div className="brand-sub">
                The Center card remains concealed. You decide whether to pursue it (revealing Center
                &amp; Left Event) or discard it straight to the Veil.
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
              ) : controlMode === 'hotseat' ? (
                <button
                  className="btn btn-primary"
                  onClick={() => onSwitchViewer({ role: 'player', playerId: view.activePlayerId })}
                >
                  Hand Back to {activePlayer.name}
                </button>
              ) : null}
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
                    : 'Your elemental action (Optional · 1 remaining)'}
                </h2>
                <div className="brand-sub">
                  {activeElement
                    ? ELEMENT_VERB_HINT[activeElement]
                    : 'Click any highlighted card in your hand below (consumes card → Veil), then click the highlighted Deck, Board, or Veil zone to confirm.'}
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

            {(activeElement === 'air' || activeElement === 'fire') &&
              elementalSelection.daysSelected &&
              maxDaysPick > 1 && (
                <div className="direct-controls-strip">
                  <span className="brand-sub">
                    {activeElement === 'air'
                      ? 'Cards from Days to shuffle:'
                      : 'Cards from Days to burn:'}
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
                                  earthIndexOrder: len === 3 ? [1, 2, 0] : [1, 0]
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
              <div className="brand-sub">Finish turn to pass play to the next player.</div>
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
      {/* YOUR HAND AREA (PLAYABLE CARDS HIGHLIGHTED DURING ELEMENTAL WINDOW)   */}
      {/* ===================================================================== */}
      <div className={`hand-area ${canPickElementalHandCard ? 'hand-area-elemental' : ''}`}>
        <div className="hand-area-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <strong>
              {isHumanVsBot && focusedPlayer.id === humanPlayerId
                ? `Your hand (${focusedPlayer.handCount}/${view.ruleset.maxHandSize})`
                : `${focusedPlayer.name}'s hand (${focusedPlayer.handCount}/${view.ruleset.maxHandSize})`}
            </strong>
            {canPickElementalHandCard && (
              <span className="badge badge-ok">Playable for Elemental Action</span>
            )}
          </div>
          <span className="brand-sub">
            {canSelectSacrifice
              ? 'Click cards to sacrifice for obstacle'
              : needsHandDiscard
                ? 'Click card to discard to Veil'
                : canPickElementalHandCard
                  ? 'Click any card to activate its element (consumes card → Veil)'
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
                  subtitle={
                    canPickElementalHandCard && card.element
                      ? ELEMENT_SHORT_VERB[card.element]
                      : undefined
                  }
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
    </section>
  );
}
