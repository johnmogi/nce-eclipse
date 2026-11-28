import { useEffect, useState } from 'react';
import {
  canSpendReaderBonusInPhase,
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
  type ElementalSelectionState,
  type ElementalTargetContext
} from '../elementalTargeting.js';
import { CardBack } from './CardBack.js';
import { CardTile } from './CardTile.js';
import { DeckDaysBrowser } from './DeckDaysBrowser.js';
import { VeilBrowser } from './VeilBrowser.js';

const ELEMENT_VERB_HINT: Readonly<Record<Element, string>> = {
  air: 'Shuffle — click occupied Board slot(s) and/or Deck of Days (Immediate Future) to shuffle unpredictably.',
  fire: 'Burn — click occupied Board slot(s) and/or Deck of Days (Immediate Future) to burn straight to the Veil.',
  water: 'Resurface — click The Veil below to select face-up cards to return to Deck of Days.',
  earth: 'Reorder — click occupied Board slot(s) and/or Deck of Days (Immediate Future) up to your VP to privately peek & arrange order across both!'
};

const READER_BONUS_ACTION_SPEC: Readonly<Record<Element, string>> = {
  air: 'Shuffle 1 Board card or the Immediate Future (top 3 of Days)',
  fire: 'Burn 1 Board card or Immediate Future card → Veil',
  water: 'Resurface 1 card from The Veil → Deck of Days',
  earth: 'Privately peek & reposition 1 Board or Immediate Future card'
};

const ELEMENT_SHORT_VERB: Readonly<Record<Element, string>> = {
  air: '♠ Shuffle',
  fire: '♣ Burn',
  water: '♥ Resurface',
  earth: '♦ Reorder'
};

function getTurnProgressIndex(phase: GamePhase, preReadingElemental: boolean): number {
  if (preReadingElemental) {
    switch (phase) {
      case 'AWAITING_ELEMENTAL_ACTION':
      case 'AWAITING_EARTH_REORDER':
        return 1; // Elemental Prep (after Board Set)
      case 'AWAITING_ABANDONED_CHOICE':
      case 'AWAITING_READING':
      case 'AWAITING_READING_DECISION':
        return 2; // Reading
      case 'AWAITING_EVENT_RESOLUTION':
      case 'AWAITING_CENTER_DECISION':
      case 'AWAITING_HAND_DISCARD':
        return 3; // Encounter
      case 'READY_TO_END_TURN':
      case 'GAME_OVER':
        return 4; // End Turn
    }
  }
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
    case 'AWAITING_EARTH_REORDER':
      return 2; // Elemental Action
    case 'READY_TO_END_TURN':
    case 'GAME_OVER':
      return 3; // End Turn
  }
}

const TURN_STEPS_POST = [
  { id: 'reading', label: '1. Reading' },
  { id: 'encounter', label: '2. Encounter' },
  { id: 'elemental', label: '3. Elemental Action' },
  { id: 'end', label: '4. End Turn' }
] as const;

const TURN_STEPS_PRE = [
  { id: 'board', label: 'Board Set' },
  { id: 'elemental', label: '1. Elemental Prep' },
  { id: 'reading', label: '2. Reading' },
  { id: 'encounter', label: '3. Encounter' },
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
  const isBonusWindow =
    canSpendReaderBonusInPhase(view.phase, view.ruleset) && canActAsActivePlayer && !isBotActing;
  const [revealedHandMode, setRevealedHandMode] = useState<'sacrifice' | 'elemental'>('sacrifice');
  const canUseRevealedBoardHandElemental =
    view.phase === 'AWAITING_EVENT_RESOLUTION' &&
    Boolean(view.ruleset.allowRevealedBoardElemental) &&
    view.ruleset.features.elementalEffects &&
    canActAsActivePlayer &&
    !isBotActing &&
    !activePlayer.effectUsedThisTurn &&
    activePlayer.hand !== null &&
    activePlayer.hand.length > 0;
  useEffect(() => {
    if (!canUseRevealedBoardHandElemental) {
      setRevealedHandMode('sacrifice');
    }
  }, [canUseRevealedBoardHandElemental, view.phase, view.turn]);
  const isRevealedElementalActive =
    canUseRevealedBoardHandElemental && revealedHandMode === 'elemental';
  const canTargetZones =
    isElementalWindow ||
    isRevealedElementalActive ||
    (isBonusWindow && elementalSelection.sourceKind === 'bonus');
  const activeElement = elementalCtx.activeElement;
  const cmdBuild = buildElementalCommand(view, elementalSelection, elementalCtx);

  const [earthPeekOrder, setEarthPeekOrder] = useState<string[]>([]);
  const earthPeekKey = view.pendingEarthReorder?.cards?.map((c) => c.id).join(',') ?? '';
  useEffect(() => {
    setEarthPeekOrder(earthPeekKey ? earthPeekKey.split(',') : []);
  }, [earthPeekKey]);

  const movePeekCard = (fromIdx: number, dir: -1 | 1) => {
    const toIdx = fromIdx + dir;
    if (toIdx < 0 || toIdx >= earthPeekOrder.length) return;
    setEarthPeekOrder((prev) => {
      const next = [...prev];
      const tmp = next[fromIdx]!;
      next[fromIdx] = next[toIdx]!;
      next[toIdx] = tmp;
      return next;
    });
  };

  const daysClickable = canTargetZones && elementalCtx.eligibleZones.days;
  const eventClickable = canTargetZones && elementalCtx.eligibleZones.boardEvent;
  const centerClickable = canTargetZones && elementalCtx.eligibleZones.boardCenter;
  const parallelClickable = canTargetZones && elementalCtx.eligibleZones.boardParallel;
  const veilHighlighted = canTargetZones && elementalCtx.eligibleZones.veil;
  const preReadingElemental = view.ruleset.elementalTiming === 'before_reading';
  const requiredEclipses =
    view.ruleset.eclipseVictoryCount === 'players-plus-one'
      ? view.ruleset.playerCount + 1
      : view.ruleset.eclipseVictoryCount;

  const topVeilCard = view.veil.length > 0 ? view.veil[view.veil.length - 1]! : null;
  const canUseReaderBonusNow =
    !activePlayer.effectUsedThisTurn || !view.ruleset.readerBonusConsumesTurnAction;
  const availableBonuses = canUseReaderBonusNow
    ? activePlayer.pendingReaderBonuses.filter(
        (b) => b.status === 'available' && b.earnedOnTurn < view.turn && Boolean(b.sourceElement)
      )
    : [];

  // In Human vs Bot, primary hand is always Human (p1) unless Admin inspects active player
  const focusedPlayer =
    viewer.role === 'player'
      ? view.players.find((p) => p.id === viewer.playerId) ?? activePlayer
      : isHumanVsBot
        ? view.players.find((p) => p.id === humanPlayerId) ?? activePlayer
        : activePlayer;

  const focusedHandHasCards = focusedPlayer.hand !== null && focusedPlayer.hand.length > 0;
  const setupDealEvent = view.events.find(
    (e) =>
      e.type === 'CardMoved' &&
      e.source === 'setup-deal' &&
      e.actor === focusedPlayer.id
  );
  const setupEvoEvents = view.events.filter(
    (e) =>
      e.type === 'LineageEvolved' &&
      e.source === 'setup-deal' &&
      e.actor === focusedPlayer.id
  );

  const canSelectSacrifice =
    view.phase === 'AWAITING_EVENT_RESOLUTION' &&
    liveReconciliation?.reality !== 'treasure' &&
    !isRevealedElementalActive &&
    focusedPlayer.id === view.activePlayerId &&
    canActAsActivePlayer &&
    !isBotActing;

  const needsHandDiscard =
    view.phase === 'AWAITING_HAND_DISCARD' &&
    focusedPlayer.id === view.activePlayerId &&
    canActAsActivePlayer &&
    !isBotActing;

  const canPickElementalHandCard =
    (isElementalWindow || isRevealedElementalActive) &&
    focusedPlayer.id === view.activePlayerId &&
    !focusedPlayer.effectUsedThisTurn &&
    focusedHandHasCards;

  const maxDaysPick = Math.min(
    view.daysCount,
    Math.max(1, elementalCtx.strength - elementalSelection.boardSlots.length)
  );

  const turnSteps = preReadingElemental ? TURN_STEPS_PRE : TURN_STEPS_POST;
  const progressIndex = getTurnProgressIndex(view.phase, preReadingElemental);

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

                {/* Public Stats: Hand Count + Eclipses + Bonuses */}
                <div className="identity-meta-col">
                  <span className="badge">
                    Hand: {p.handCount}/{view.ruleset.maxHandSize}
                    {p.hand === null ? ' (Hidden)' : ''}
                  </span>
                  {view.ruleset.features.eclipse && (
                    <span className={`badge ${p.eclipseCount > 0 ? 'badge-warn' : ''}`}>
                      ☀ Eclipse: {p.eclipseCount}/{requiredEclipses}
                      {p.eclipseBonusVP > 0 ? ` (+${p.eclipseBonusVP} VP)` : ''}
                    </span>
                  )}
                  {p.availableReaderBonusCount > 0 ? (
                    isBonusWindow &&
                    p.id === view.activePlayerId &&
                    availableBonuses.length > 0 ? (
                      <button
                        type="button"
                        className="badge badge-warn badge-clickable"
                        title="Click to activate your free Reader Bonus elemental effect"
                        onClick={() => onSelectBonusForElemental(availableBonuses[0]!.id)}
                      >
                        ★ {p.availableReaderBonusCount} Bonus Ready — Click to Activate
                      </button>
                    ) : (
                      <span className="badge badge-warn">
                        ★ {p.availableReaderBonusCount} Bonus Ready
                      </span>
                    )
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
                        {item.card.family === 'classic-court'
                          ? `Court +${item.card.courtBonus ?? 1}`
                          : view.eventReality === 'treasure'
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

            {/* RIGHT: PARALLEL DIMENSION (ACTIVE FOR CLASSIC COURTS / MAJOR ARCANA IN MILESTONE E) */}
            <div
              className={`board-slot-card ${
                !view.ruleset.features.majors ? 'slot-parallel' : ''
              } ${parallelClickable ? 'slot-target-eligible' : ''} ${
                elementalSelection.boardSlots.includes('parallel') ? 'slot-target-selected' : ''
              }`}
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
                <div
                  className="empty-card-outline sm"
                  title={
                    view.ruleset.features.majors
                      ? 'Arriving Major Arcana (Courts J/Q/K) enter here'
                      : 'Major Arcana arrive in Milestone E'
                  }
                >
                  ◇
                </div>
              ) : (
                view.board.parallel.map((item, idx) =>
                  item.hidden ? (
                    <CardBack key={`par-back-${idx}`} backGroup={item.backGroup} size="sm" />
                  ) : (
                    <div
                      key={item.card.id}
                      className={`mini-face-card ${
                        item.card.color === 'red' ? 'color-red' : 'color-black'
                      } ${item.card.family === 'classic-court' ? 'slot-major-card' : ''}`}
                      title={
                        item.card.family === 'classic-court'
                          ? `Classic Court (Major Proxy +${item.card.courtBonus ?? 1})`
                          : 'Incoming timeline card (visible to Admin Inspector)'
                      }
                    >
                      <div className="mini-face-glyph">{item.card.shortLabel}</div>
                      <div className="mini-face-tag">
                        {item.card.family === 'classic-court'
                          ? `Court +${item.card.courtBonus ?? 1}`
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
              : 'Encounter and reality'}
          </div>
        </div>

        {/* ZONE 3: THE VEIL (FACE-UP HISTORY) */}
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

      {/* EXPANDABLE ORDERED DECK OF DAYS BROWSER (READ-ONLY) */}
      {daysBrowserOpen && (
        <DeckDaysBrowser view={view} viewer={viewer} onClose={onToggleDaysBrowser} />
      )}

      {/* EXPANDABLE COMPLETE VEIL BROWSER (NEWEST FIRST · AUTO-OPENS FOR WATER) */}
      {(veilTrayOpen || (activeElement === 'water' && canTargetZones)) && (
        <VeilBrowser
          view={view}
          isWaterMode={activeElement === 'water' && canTargetZones}
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
        {turnSteps.map((step, idx) => {
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
              {idx < turnSteps.length - 1 && (
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
            {view.ruleset.maxElementalActionsPerTurn === 'unlimited'
              ? `Elemental chaining ON (${activePlayer.elementalActionsUsedThisTurn} used)`
              : (view.ruleset.maxElementalActionsPerTurn ?? 1) > 1
                ? `${Math.max(
                    0,
                    (view.ruleset.maxElementalActionsPerTurn as number) -
                      activePlayer.elementalActionsUsedThisTurn
                  )}/${view.ruleset.maxElementalActionsPerTurn} elemental actions left`
                : activePlayer.effectUsedThisTurn
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
                {view.ruleset.abandonedClaimPolicy === 'free_no_prep'
                  ? 'Claim Free Treasure (Skips Reading & Prep)'
                  : 'Claim Free Treasure'}
              </button>
              <button
                className="btn"
                disabled={!canActAsActivePlayer}
                onClick={() =>
                  onSendCommand({ type: 'DeclineAbandonedCard', playerId: view.activePlayerId })
                }
              >
                {view.ruleset.abandonedClaimPolicy === 'free_no_prep'
                  ? 'Decline to Veil & Start Normal Turn'
                  : 'Decline to Veil & Read New Card'}
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
                {view.ruleset.replaceCenterOnDiscard
                  ? 'The Center card remains concealed. Accept to flip it & Left Event — or Reject it face-up to the Veil to draw & flip a fresh replacement card + Left Event.'
                  : 'The Center card remains concealed. You decide whether to pursue it (revealing Center & Left Event) or discard it straight to the Veil.'}
              </div>
            </div>
            <div className="toolbar-group">
              {canActAsActivePlayer ? (
                <>
                  <button
                    className="btn btn-primary"
                    data-testid="accept-center-btn"
                    onClick={() =>
                      onSendCommand({ type: 'PursueCenter', playerId: view.activePlayerId })
                    }
                  >
                    {view.ruleset.replaceCenterOnDiscard
                      ? 'Accept & Flip Center'
                      : 'Pursue Center Card'}
                  </button>
                  <button
                    className="btn"
                    data-testid="reject-center-btn"
                    onClick={() =>
                      onSendCommand({ type: 'DiscardCenter', playerId: view.activePlayerId })
                    }
                  >
                    {view.ruleset.replaceCenterOnDiscard
                      ? 'Reject to Veil & Draw New Card'
                      : 'Discard to Veil'}
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
                    ? 'Treasure Revealed — Free Claim'
                    : liveReconciliation.reality === 'barrier'
                      ? liveReconciliation.passes && selectedSacrificeIds.length === 0
                        ? `Barrier (${liveReconciliation.eventVP} VP) — Cleared by Your Lineage`
                        : `Barrier (${liveReconciliation.eventVP} VP) — Sacrifice to Claim or Abandon`
                      : liveReconciliation.passes && selectedSacrificeIds.length === 0
                        ? `Elemental Trial (> ${liveReconciliation.eventVP} VP) — Cleared by Your Lineage`
                        : `Elemental Trial (> ${liveReconciliation.eventVP} VP) — Sacrifice to Claim or Abandon`}
                </h2>
                <div className="brand-sub">
                  {liveReconciliation.reality !== 'treasure' &&
                  liveReconciliation.passes &&
                  selectedSacrificeIds.length === 0
                    ? `Your lineage already meets this ${liveReconciliation.reality} (${liveReconciliation.effectiveVP} VP${liveReconciliation.hasElementalAdvantage ? ' + elemental advantage' : ''}) — no hand sacrifice needed.`
                    : liveReconciliation.requiredCondition}
                </div>
              </div>
              <div className="toolbar-group">
                <button
                  className="btn btn-primary"
                  data-testid="resolve-event-btn"
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
                    : !liveReconciliation.passes
                      ? 'Select Sacrifice Card(s) Below'
                      : selectedSacrificeIds.length === 0
                        ? 'Claim Card (No Sacrifice Needed)'
                        : `Sacrifice ${selectedSacrificeIds.length} Card${
                            selectedSacrificeIds.length === 1 ? '' : 's'
                          } & Claim`}
                </button>
                {liveReconciliation.reality !== 'treasure' && (
                  <button
                    className="btn"
                    disabled={!canActAsActivePlayer}
                    title="Leave Center face-up for the next player instead of taking it into your hand"
                    onClick={() =>
                      onSendCommand({ type: 'AbandonCenter', playerId: view.activePlayerId })
                    }
                  >
                    Leave for Next Player
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

            {/* R1.1 Revealed-Board Elemental Intervention Mode Toggle & Targeting Bar */}
            {canUseRevealedBoardHandElemental && (
              <div
                className="bonus-cta-strip"
                data-testid="revealed-hand-mode-bar"
                style={{ marginTop: 4 }}
              >
                <div className="bonus-cta-meta">
                  <span className={`badge ${isRevealedElementalActive ? 'badge-ok' : 'badge-warn'}`}>
                    {isRevealedElementalActive
                      ? 'Mode: Elemental Intervention (1 action left — consumes card → Veil)'
                      : liveReconciliation.reality === 'treasure'
                        ? 'Optional: Intervene on Revealed Board before Claiming'
                        : 'Mode: Sacrifice for Event (switch to intervene with Elemental Action)'}
                  </span>
                </div>
                <div className="toolbar-group">
                  <button
                    type="button"
                    data-testid="mode-sacrifice-btn"
                    className={`btn btn-sm ${!isRevealedElementalActive ? 'btn-active' : ''}`}
                    onClick={() => {
                      setRevealedHandMode('sacrifice');
                      onCancelElemental();
                    }}
                  >
                    {liveReconciliation.reality === 'treasure'
                      ? 'Reconcile / Claim'
                      : 'Sacrifice Mode'}
                  </button>
                  <button
                    type="button"
                    data-testid="mode-elemental-btn"
                    className={`btn btn-sm ${isRevealedElementalActive ? 'btn-primary' : ''}`}
                    onClick={() => {
                      onClearSacrifices();
                      setRevealedHandMode('elemental');
                    }}
                  >
                    ⚡ Elemental Intervention (1 left)
                  </button>
                </div>
              </div>
            )}

            {isRevealedElementalActive && (
              <div className="elemental-action-bar" data-testid="revealed-elemental-panel">
                {elementalSelection.sourceKind === 'hand' && activeElement ? (
                  <>
                    <div className="brand-sub">
                      <strong>
                        {ELEMENT_META[activeElement].suitSymbol}{' '}
                        {ELEMENT_META[activeElement].label}
                      </strong>{' '}
                      (using <strong>{elementalCtx.sourceCard?.shortLabel}</strong>, strength{' '}
                      {elementalCtx.strength}): {ELEMENT_VERB_HINT[activeElement]}
                    </div>
                    <div className="toolbar-group">
                      {activeElement === 'earth' &&
                      (elementalSelection.daysSelected ||
                        elementalSelection.boardSlots.length >= 2) ? (
                        <button
                          className="btn btn-primary"
                          data-testid="start-earth-peek-btn"
                          disabled={
                            elementalSelection.boardSlots.length === 0
                              ? view.daysCount < 2
                              : elementalSelection.boardSlots.length +
                                  (elementalSelection.daysSelected
                                    ? Math.min(
                                        elementalSelection.daysCount,
                                        view.daysCount,
                                        Math.max(
                                          1,
                                          elementalCtx.strength -
                                            elementalSelection.boardSlots.length
                                        )
                                      )
                                    : 0) <
                                2
                          }
                          onClick={() => {
                            const reqDays = elementalSelection.daysSelected
                              ? Math.min(
                                  elementalSelection.daysCount,
                                  view.daysCount,
                                  Math.max(
                                    1,
                                    elementalCtx.strength - elementalSelection.boardSlots.length
                                  )
                                )
                              : 0;
                            onSendCommand({
                              type: 'StartEarthPeek',
                              playerId: view.activePlayerId,
                              sourceCardId: elementalCtx.sourceCard?.id,
                              targetBoardSlots:
                                elementalSelection.boardSlots.length > 0
                                  ? elementalSelection.boardSlots
                                  : undefined,
                              daysCount:
                                elementalSelection.boardSlots.length > 0 ? reqDays : undefined
                            });
                          }}
                        >
                          👁 Privately Peek &amp; Reorder
                        </button>
                      ) : (
                        <button
                          className="btn btn-primary"
                          data-testid="confirm-revealed-elemental-btn"
                          disabled={!cmdBuild.ok}
                          onClick={() => {
                            if (cmdBuild.ok) onSendCommand(cmdBuild.command);
                          }}
                        >
                          {cmdBuild.ok
                            ? `Confirm: ${cmdBuild.actionLabel}`
                            : 'Select Revealed Board / Days / Veil Target'}
                        </button>
                      )}
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          onCancelElemental();
                          setRevealedHandMode('sacrifice');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="brand-sub">
                    Click any card in your hand below to activate its element on the revealed Board,
                    Immediate Future, or Veil (consumes card → Veil; 1 ordinary action/turn).
                  </div>
                )}
              </div>
            )}
          </div>
        ) : view.phase === 'AWAITING_EARTH_REORDER' && view.pendingEarthReorder ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="action-row">
              <div>
                <h2 className="decision-title">
                  ♦ Earth Private Peek — Arrange{' '}
                  {view.pendingEarthReorder.boardSlots.length > 0 &&
                  view.pendingEarthReorder.daysCount > 0
                    ? `Board (${view.pendingEarthReorder.boardSlots.join(', ').toUpperCase()}) + Immediate Future (${view.pendingEarthReorder.daysCount})`
                    : view.pendingEarthReorder.boardSlots.length > 0
                      ? `Board Slots (${view.pendingEarthReorder.boardSlots.join(' ↔ ').toUpperCase()})`
                      : `The Immediate Future (Top ${view.pendingEarthReorder.count} Card${
                          view.pendingEarthReorder.count === 1 ? '' : 's'
                        })`}
                </h2>
                <div className="brand-sub">
                  Only you can see these cards. Arrange left → right into exact Board and/or
                  Immediate Future slots, then confirm.
                </div>
              </div>
              <div className="toolbar-group">
                {canActAsActivePlayer && (
                  <>
                    <button
                      className="btn btn-primary"
                      data-testid="confirm-earth-order-btn"
                      onClick={() =>
                        onSendCommand({
                          type: 'CommitEarthReorder',
                          playerId: view.activePlayerId,
                          newOrder: earthPeekOrder
                        })
                      }
                    >
                      Confirm Deliberate Order
                    </button>
                    {view.pendingEarthReorder.boardSlots.length === 0 && (
                      <button
                        className="btn"
                        onClick={() =>
                          onSendCommand({
                            type: 'CommitEarthReorder',
                            playerId: view.activePlayerId,
                            moveTopToBottom: true
                          })
                        }
                      >
                        Send Next Upcoming → Bottom of Deck
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {view.pendingEarthReorder.cards ? (
              <div className="earth-slots-row" data-testid="earth-peek-cards">
                {earthPeekOrder.map((cardId, posIdx) => {
                  const card = view.pendingEarthReorder!.cards!.find((c) => c.id === cardId);
                  if (!card) return null;
                  const bSlots = view.pendingEarthReorder!.boardSlots;
                  const slotTitle =
                    posIdx < bSlots.length
                      ? `Board · ${bSlots[posIdx]!.toUpperCase()}`
                      : posIdx - bSlots.length === 0
                        ? 'Next Upcoming (#1)'
                        : `#${posIdx - bSlots.length + 1} Upcoming`;
                  return (
                    <div
                      key={card.id}
                      className={`earth-order-card ${
                        card.color === 'red' ? 'color-red' : 'color-black'
                      }`}
                    >
                      <div className="earth-pos-label">{slotTitle}</div>
                      <div className="earth-card-face">{card.shortLabel}</div>
                      <div className="card-meta">
                        {card.label} ({card.vp} VP)
                      </div>
                      {earthPeekOrder.length > 1 && canActAsActivePlayer && (
                        <div className="toolbar-group">
                          <button
                            className="btn btn-sm"
                            disabled={posIdx === 0}
                            onClick={() => movePeekCard(posIdx, -1)}
                          >
                            ← Earlier
                          </button>
                          <button
                            className="btn btn-sm"
                            disabled={posIdx === earthPeekOrder.length - 1}
                            onClick={() => movePeekCard(posIdx, 1)}
                          >
                            Later →
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="brand-sub">
                {activePlayer.name} is privately inspecting and reordering cards…
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
                    : preReadingElemental
                      ? 'Start of Turn — Elemental Prep (Before Reading · Optional)'
                      : 'Your elemental action (Optional · 1 remaining)'}
                </h2>
                <div className="brand-sub">
                  {activeElement
                    ? ELEMENT_VERB_HINT[activeElement]
                    : !focusedHandHasCards && availableBonuses.length > 0
                      ? 'Your hand is empty, but you have a free Reader Bonus ready! Click the gold ★ Activate button below (0 hand cost), choose your target on the table, then click Confirm — or proceed straight to Reading.'
                      : preReadingElemental
                        ? 'Two choices: (1) Click a card in your hand below (or a gold Reader Bonus) to activate its elemental effect BEFORE Reading — OR (2) Click "Proceed to Reading →" to skip straight to your Reading.'
                        : 'Click any highlighted card in your hand below (consumes card → Veil) or a free Reader Bonus, then click the highlighted Deck, Board, or Veil zone to confirm.'}
                </div>
              </div>

              <div className="toolbar-group">
                {activeElement &&
                  !(
                    activeElement === 'earth' &&
                    (elementalSelection.daysSelected || elementalSelection.boardSlots.length >= 2)
                  ) && (
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
                {activeElement === 'earth' &&
                  (elementalSelection.daysSelected || elementalSelection.boardSlots.length >= 2) && (
                    <>
                      <button
                        className="btn btn-primary"
                        data-testid="start-earth-peek-btn"
                        disabled={
                          !canActAsActivePlayer ||
                          (elementalSelection.boardSlots.length === 0 && view.daysCount < 2)
                        }
                        onClick={() => {
                          const earthDays = elementalSelection.daysSelected
                            ? elementalSelection.daysCount
                            : 0;
                          onSendCommand(
                            elementalSelection.sourceKind === 'bonus' && elementalCtx.bonus
                              ? {
                                  type: 'StartEarthPeek',
                                  playerId: view.activePlayerId,
                                  bonusId: elementalCtx.bonus.id,
                                  targetBoardSlots: elementalSelection.boardSlots,
                                  daysCount: earthDays
                                }
                              : {
                                  type: 'StartEarthPeek',
                                  playerId: view.activePlayerId,
                                  sourceCardId: elementalCtx.sourceCard!.id,
                                  targetBoardSlots: elementalSelection.boardSlots,
                                  daysCount: earthDays
                                }
                          );
                        }}
                      >
                        👁 Privately Peek &amp; Arrange{' '}
                        {elementalSelection.boardSlots.length > 0 && elementalSelection.daysSelected
                          ? `Board (${elementalSelection.boardSlots.join('+')}) + ${elementalSelection.daysCount} Days`
                          : elementalSelection.boardSlots.length >= 2
                            ? `Board (${elementalSelection.boardSlots.join(' ↔ ')})`
                            : `Top ${elementalSelection.daysCount} of Immediate Future`}
                        {elementalCtx.sourceCard
                          ? ` (Consumes ${elementalCtx.sourceCard.shortLabel} → Veil)`
                          : ' (Free Reader Bonus)'}
                      </button>
                      <button className="btn btn-sm" onClick={onCancelElemental}>
                        Cancel
                      </button>
                    </>
                  )}
                {preReadingElemental ? (
                  <button
                    className={`btn ${activeElement ? '' : 'btn-primary'}`}
                    data-testid="proceed-to-reading-btn"
                    disabled={!canActAsActivePlayer}
                    onClick={() =>
                      onSendCommand({ type: 'AdvanceToReading', playerId: view.activePlayerId })
                    }
                  >
                    {view.centerAbandoned
                      ? 'Proceed to Abandoned Choice →'
                      : 'Proceed to Reading →'}
                  </button>
                ) : (
                  <button
                    className={`btn ${activeElement ? '' : 'btn-primary'}`}
                    disabled={!canActAsActivePlayer}
                    onClick={() =>
                      onSendCommand({ type: 'EndTurn', playerId: view.activePlayerId })
                    }
                  >
                    {activeElement ? 'Skip & End Turn →' : 'Finish Turn →'}
                  </button>
                )}
              </div>
            </div>

            {availableBonuses.length > 0 && canActAsActivePlayer && (
              <div className="bonus-cta-strip" data-testid="reader-bonus-strip">
                <div className="bonus-cta-meta">
                  <span className="badge badge-warn">
                    Free Reader Bonus (0 hand cost ·{' '}
                    {view.ruleset.readerBonusAnytimeOnTurn ? 'Usable anytime this turn' : 'Elemental window'})
                  </span>
                  <span className="brand-sub">
                    Click to activate, pick a target on the highlighted zone, then click Confirm.
                  </span>
                </div>
                <div className="toolbar-group">
                  {availableBonuses.map((b) => {
                    const el = b.sourceElement!;
                    const isSelected =
                      elementalSelection.sourceKind === 'bonus' &&
                      elementalSelection.bonusId === b.id;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        className={`btn ${isSelected ? 'btn-warn-active' : 'btn-warn'}`}
                        onClick={() => onSelectBonusForElemental(b.id)}
                      >
                        {isSelected ? '✓ Active: ' : '★ Activate '}
                        {ELEMENT_META[el].suitSymbol} {ELEMENT_META[el].label} Tier 1 —{' '}
                        {READER_BONUS_ACTION_SPEC[el]} (Expires after T{view.turn})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {(activeElement === 'air' || activeElement === 'fire' || activeElement === 'earth') &&
              elementalSelection.daysSelected &&
              maxDaysPick > 1 && (
                <div className="direct-controls-strip">
                  <span className="brand-sub">
                    {activeElement === 'air'
                      ? 'Cards from Immediate Future to shuffle:'
                      : activeElement === 'fire'
                        ? 'Cards from Immediate Future to burn:'
                        : 'Cards from Immediate Future to peek & reorder:'}
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
                    <div className="brand-sub">
                      <strong>Earth · Immediate Future Peek (Private):</strong> Click{' '}
                      <strong>Privately Peek &amp; Arrange</strong> above to consume{' '}
                      {elementalCtx.sourceCard ? elementalCtx.sourceCard.shortLabel : 'your Reader Bonus'}{' '}
                      and privately inspect the top {Math.min(elementalCtx.strength, view.daysCount)}{' '}
                      card{Math.min(elementalCtx.strength, view.daysCount) === 1 ? '' : 's'} of Deck
                      of Days before setting their exact order.
                    </div>
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
              data-testid="end-turn-btn"
              disabled={!canActAsActivePlayer}
              onClick={() => onSendCommand({ type: 'EndTurn', playerId: view.activePlayerId })}
            >
              Finish Turn →
            </button>
          </div>
        )}

        {/* Anytime Free Reader Bonus Bar when outside AWAITING_ELEMENTAL_ACTION */}
        {view.phase !== 'AWAITING_ELEMENTAL_ACTION' &&
          view.phase !== 'AWAITING_EARTH_REORDER' &&
          isBonusWindow &&
          availableBonuses.length > 0 && (
            <div className="bonus-cta-strip" style={{ marginTop: 10 }} data-testid="reader-bonus-anytime-strip">
              <div className="bonus-cta-meta">
                <span className="badge badge-warn">
                  Free Reader Bonus Available Anytime This Turn (0 hand cost)
                </span>
                <span className="brand-sub">
                  {activeElement
                    ? ELEMENT_VERB_HINT[activeElement]
                    : 'Activate now without losing your current turn step.'}
                </span>
              </div>
              <div className="toolbar-group">
                {availableBonuses.map((b) => {
                  const el = b.sourceElement!;
                  const isSelected =
                    elementalSelection.sourceKind === 'bonus' &&
                    elementalSelection.bonusId === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      className={`btn ${isSelected ? 'btn-warn-active' : 'btn-warn'}`}
                      onClick={() => onSelectBonusForElemental(b.id)}
                    >
                      {isSelected ? '✓ Active: ' : '★ Activate '}
                      {ELEMENT_META[el].suitSymbol} {ELEMENT_META[el].label} Tier 1 —{' '}
                      {READER_BONUS_ACTION_SPEC[el]}
                    </button>
                  );
                })}
                {elementalSelection.sourceKind === 'bonus' && activeElement && (
                  <>
                    {activeElement === 'earth' && elementalSelection.daysSelected && elementalCtx.bonus ? (
                      <button
                        className="btn btn-primary"
                        disabled={view.daysCount < 2}
                        onClick={() =>
                          onSendCommand({
                            type: 'StartEarthPeek',
                            playerId: view.activePlayerId,
                            bonusId: elementalCtx.bonus!.id
                          })
                        }
                      >
                        👁 Privately Peek Top 1 of Immediate Future (Free Bonus)
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary"
                        disabled={!cmdBuild.ok}
                        onClick={() => {
                          if (cmdBuild.ok) onSendCommand(cmdBuild.command);
                        }}
                      >
                        {cmdBuild.ok ? `Confirm: ${cmdBuild.actionLabel}` : 'Select Target on Table'}
                      </button>
                    )}
                    <button className="btn btn-sm" onClick={onCancelElemental}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
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
              <span className="badge badge-ok" data-testid="hand-mode-badge">
                {isRevealedElementalActive
                  ? 'ELEMENTAL MODE — Click Card to Activate (→ Veil)'
                  : 'Playable for Elemental Action'}
              </span>
            )}
            {canSelectSacrifice && (
              <span className="badge badge-warn" data-testid="hand-mode-badge">
                SACRIFICE MODE — Click Card(s) to Pay for Obstacle
              </span>
            )}
          </div>
          <span className="brand-sub">
            {canSelectSacrifice
              ? 'Click cards to sacrifice for obstacle (not activating elemental power)'
              : needsHandDiscard
                ? 'Click card to discard to Veil'
                : canPickElementalHandCard
                  ? 'Click any card to activate its element (consumes card → Veil)'
                  : ''}
          </span>
        </div>

        {view.turn === 1 && setupEvoEvents.length > 0 && (
          <div className="setup-evo-note">
            <strong>Setup Evolution Notice:</strong>{' '}
            {setupDealEvent
              ? `${setupDealEvent.summary} `
              : `Starting hand dealt ${view.ruleset.startingHandSize} cards. `}
            Mandatory chained evolution immediately advanced your lineage {setupEvoEvents.length}{' '}
            step{setupEvoEvents.length === 1 ? '' : 's'} to{' '}
            <strong>{focusedPlayer.lineage.topCard.shortLabel}</strong> (Rank{' '}
            {focusedPlayer.lineage.rank}), leaving {focusedPlayer.handCount} card
            {focusedPlayer.handCount === 1 ? '' : 's'} in hand.
          </div>
        )}

        {focusedPlayer.hand === null ? (
          <div className="badge">Hidden ({focusedPlayer.handCount} cards)</div>
        ) : focusedPlayer.hand.length === 0 ? (
          <div className="brand-sub">
            {focusedPlayer.evolutionsCompleted > 0
              ? `Hand is empty — mandatory evolution consumed your dealt/claimed cards to advance your lineage to ${focusedPlayer.lineage.topCard.shortLabel} (Rank ${focusedPlayer.lineage.rank}, ${focusedPlayer.evolutionsCompleted} evolution${focusedPlayer.evolutionsCompleted === 1 ? '' : 's'}).`
              : 'Hand is empty.'}
            {isElementalWindow &&
              focusedPlayer.id === view.activePlayerId &&
              availableBonuses.length > 0 &&
              ' You can still spend your free Reader Bonus above (0 hand cost).'}
          </div>
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
                      : canSelectSacrifice
                        ? isSelectedForSac
                          ? '✓ Sacrifice'
                          : 'Sacrifice'
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
