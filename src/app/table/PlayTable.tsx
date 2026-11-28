import { useEffect, useMemo, useRef, useState } from 'react';
import {
  canSpendReaderBonusInPhase,
  type BoardTargetSlot,
  type Command,
  type Element,
  type GamePhase,
  type ProjectedGameView,
  type ProjectedPlayerView,
  type ReconciliationBreakdown,
  type Viewer
} from '../../engine/index.js';
import { CardTile } from '../components/CardTile.js';
import { VeilBrowser } from '../components/VeilBrowser.js';
import type { ElementalSelectionState, ElementalTargetContext } from '../elementalTargeting.js';
import type { PlayControlMode } from '../../sim/botController.js';
import { ActionDock } from './ActionDock.js';
import {
  EventPlaybackOverlay,
  extractEclipsePresentation,
  type EclipsePresentationItem
} from './EventPlaybackOverlay.js';
import { ImmediateFutureTray } from './ImmediateFutureTray.js';
import { PlayerIdentityBar } from './PlayerIdentityBar.js';
import { SharedBoard } from './SharedBoard.js';

const ELEMENT_BADGE_LABEL: Record<Element, string> = {
  air: '💨 Air · Shuffle',
  fire: '🔥 Fire · Burn',
  water: '💧 Water · Resurface',
  earth: '🪨 Earth · Reorder'
};

const TURN_STEPS_PRE = [
  { id: 'board-set', label: 'Board Set' },
  { id: 'elemental', label: '1. Elemental Prep' },
  { id: 'reading', label: '2. Reading' },
  { id: 'encounter', label: '3. Encounter' },
  { id: 'end', label: '4. End Turn' }
] as const;

const TURN_STEPS_POST = [
  { id: 'reading', label: '1. Reading' },
  { id: 'encounter', label: '2. Encounter' },
  { id: 'elemental', label: '3. Elemental Action' },
  { id: 'end', label: '4. End Turn' }
] as const;

function getTurnProgressIndex(phase: GamePhase, preReading: boolean): number {
  if (preReading) {
    switch (phase) {
      case 'AWAITING_ELEMENTAL_ACTION':
      case 'AWAITING_EARTH_REORDER':
        return 1;
      case 'AWAITING_ABANDONED_CHOICE':
      case 'AWAITING_READING':
      case 'AWAITING_READING_DECISION':
        return 2;
      case 'AWAITING_EVENT_RESOLUTION':
      case 'AWAITING_CENTER_DECISION':
      case 'AWAITING_HAND_DISCARD':
        return 3;
      case 'READY_TO_END_TURN':
      case 'GAME_OVER':
        return 4;
      default:
        return 0;
    }
  }
  switch (phase) {
    case 'AWAITING_ABANDONED_CHOICE':
    case 'AWAITING_READING':
    case 'AWAITING_READING_DECISION':
      return 0;
    case 'AWAITING_EVENT_RESOLUTION':
    case 'AWAITING_CENTER_DECISION':
    case 'AWAITING_HAND_DISCARD':
      return 1;
    case 'AWAITING_ELEMENTAL_ACTION':
    case 'AWAITING_EARTH_REORDER':
      return 2;
    case 'READY_TO_END_TURN':
    case 'GAME_OVER':
      return 3;
    default:
      return 0;
  }
}

export function PlayTable({
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
  onOpenDaysBrowser,
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
  onOpenDaysBrowser: () => void;
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

  // Sequential Eclipse Spotlight Presentation (pure UI pause on newly arrived EclipseFormed events!)
  const seenEclipseSeqRef = useRef<number>(0);
  const [activeEclipseOverlay, setActiveEclipseOverlay] =
    useState<EclipsePresentationItem | null>(null);

  const latestEclipseEvent = useMemo(() => {
    for (let i = view.events.length - 1; i >= 0; i--) {
      if (view.events[i]!.type === 'EclipseFormed') return view.events[i]!;
    }
    return null;
  }, [view.events]);

  useEffect(() => {
    // Reset tracker on new game
    if (view.events.length <= 12 && !latestEclipseEvent) {
      seenEclipseSeqRef.current = 0;
      setActiveEclipseOverlay(null);
      return;
    }
    if (
      latestEclipseEvent &&
      latestEclipseEvent.seq > seenEclipseSeqRef.current &&
      !isViewingHistory &&
      controlMode !== 'auto-sim'
    ) {
      seenEclipseSeqRef.current = latestEclipseEvent.seq;
      const item = extractEclipsePresentation(latestEclipseEvent, view);
      if (item) setActiveEclipseOverlay(item);
    }
  }, [latestEclipseEvent, view, isViewingHistory, controlMode]);

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

  const focusedPlayer =
    viewer.role === 'player'
      ? view.players.find((p) => p.id === viewer.playerId) ?? activePlayer
      : isHumanVsBot
        ? view.players.find((p) => p.id === humanPlayerId) ?? activePlayer
        : activePlayer;

  const focusedHandHasCards = focusedPlayer.hand !== null && focusedPlayer.hand.length > 0;
  const canSelectSacrifice =
    view.phase === 'AWAITING_EVENT_RESOLUTION' &&
    liveReconciliation?.reality !== 'treasure' &&
    liveReconciliation?.reality !== 'major_resonance' &&
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

  const preReadingElemental = view.ruleset.elementalTiming === 'before_reading';
  const turnSteps = preReadingElemental ? TURN_STEPS_PRE : TURN_STEPS_POST;
  const progressIndex = getTurnProgressIndex(view.phase, preReadingElemental);
  const activeElement = elementalCtx.activeElement;

  const recentNoticeEvent = useMemo(() => {
    for (let i = view.events.length - 1; i >= Math.max(0, view.events.length - 8); i--) {
      const ev = view.events[i]!;
      if (
        ev.type === 'AbandonedCardClaimed' ||
        ev.type === 'AbandonedCardDeclined' ||
        ev.type === 'MajorContentionResolved' ||
        ev.type === 'TradeAccepted' ||
        ev.type === 'TradeRejected'
      ) {
        return ev;
      }
    }
    return null;
  }, [view.events]);

  return (
    <section className="panel table-panel">
      {/* Sequential Eclipse Spotlight Presentation */}
      <EventPlaybackOverlay
        eclipse={activeEclipseOverlay}
        onAcknowledge={() => setActiveEclipseOverlay(null)}
      />

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
          <span className="badge">
            {view.ruleset.features.tradingMarket && view.ruleset.marketFrequencyRounds > 0
              ? `Market: Every ${view.ruleset.marketFrequencyRounds} Rounds`
              : 'Market: Off'}
          </span>
        </div>
      </div>

      {isViewingHistory && (
        <div className="banner-warn">
          <strong>Inspecting History (Step {currentStepIndex}/{maxStepIndex}):</strong> Read-only
          view — live state untouched.{' '}
          <button type="button" className="btn btn-sm" onClick={onReturnToLive}>
            Return to Live
          </button>
        </div>
      )}

      {recentNoticeEvent && view.status === 'playing' && (
        <div className="table-recent-beat" data-testid="recent-beat-banner">
          <span className="badge">Latest Beat</span>
          <span>{recentNoticeEvent.summary}</span>
        </div>
      )}

      {/* PLAYER IDENTITY BAR WITH PERSISTENT ECLIPSE TROPHIES & CLICKABLE READER BONUS */}
      <PlayerIdentityBar
        view={view}
        controlMode={controlMode}
        humanPlayerId={humanPlayerId}
        isBotActing={isBotActing}
        onQuickActivateBonus={(bonusId) => {
          onSelectBonusForElemental(bonusId);
          onOpenDaysBrowser();
        }}
      />

      {/* SHARED TABLE ZONES (DECK OF DAYS · EVENT/CENTER/PARALLEL · VEIL) */}
      <SharedBoard
        view={view}
        canTargetZones={canTargetZones}
        elementalSelection={elementalSelection}
        elementalCtx={elementalCtx}
        daysBrowserOpen={daysBrowserOpen}
        veilTrayOpen={veilTrayOpen}
        onToggleDaysBrowser={onToggleDaysBrowser}
        onToggleVeilTray={onToggleVeilTray}
        onClickDaysZone={onClickDaysZone}
        onClickBoardSlot={onClickBoardSlot}
      />

      {/* INTERACTIVE IMMEDIATE FUTURE (#1–#3) & DECK OF DAYS BROWSER */}
      {daysBrowserOpen && (
        <ImmediateFutureTray
          view={view}
          viewer={viewer}
          canTargetDays={canTargetZones && elementalCtx.eligibleZones.days}
          elementalSelection={elementalSelection}
          elementalCtx={elementalCtx}
          onSelectDaysCount={(cnt) =>
            onUpdateElementalSelection({
              daysSelected: true,
              daysCount: cnt
            })
          }
          onClose={onToggleDaysBrowser}
        />
      )}

      {/* VEIL BROWSER (AUTO-OPENS FOR WATER) */}
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

      {/* TURN PROGRESS STEPPER (BOARD SET FIRST -> 1. ELEMENTAL PREP -> 2. READING -> 3. ENCOUNTER -> 4. END TURN) */}
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
            className={`badge ${!activePlayer.effectUsedThisTurn ? 'badge-ok' : ''}`}
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
                  ? 'Ordinary elemental action used (0 left)'
                  : '1 ordinary elemental action available'}
          </span>
        )}
      </div>

      {/* INTENT-DRIVEN ACTION DOCK */}
      <ActionDock
        view={view}
        controlMode={controlMode}
        humanPlayerId={humanPlayerId}
        activePlayer={activePlayer}
        focusedPlayer={focusedPlayer}
        canActAsActivePlayer={canActAsActivePlayer}
        canActAsReader={canActAsReader}
        isBotActing={isBotActing}
        liveReconciliation={liveReconciliation}
        selectedSacrificeIds={selectedSacrificeIds}
        revealedHandMode={revealedHandMode}
        canUseRevealedBoardHandElemental={canUseRevealedBoardHandElemental}
        isRevealedElementalActive={isRevealedElementalActive}
        isBonusWindow={isBonusWindow}
        elementalSelection={elementalSelection}
        elementalCtx={elementalCtx}
        earthPeekOrder={earthPeekOrder}
        onMovePeekCard={movePeekCard}
        onSetRevealedHandMode={setRevealedHandMode}
        onClearSacrifices={onClearSacrifices}
        onSelectBonusForElemental={onSelectBonusForElemental}
        onCancelElemental={onCancelElemental}
        onUpdateElementalSelection={onUpdateElementalSelection}
        onOpenDaysBrowser={onOpenDaysBrowser}
        onSwitchViewer={(next) => onSwitchViewer(next)}
        onSendCommand={onSendCommand}
        onPlayAnotherSeed={onPlayAnotherSeed}
        onWatchFullReplay={onWatchFullReplay}
      />

      {/* HAND AREA (HIDDEN DURING MARKET SINCE MARKET HAS ITS OWN OFFER HAND) */}
      {view.phase !== 'AWAITING_MARKET' && (
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
                    : 'ELEMENTAL PREP — Click Card to Activate (→ Veil)'}
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
                        ? ELEMENT_BADGE_LABEL[card.element]
                        : canSelectSacrifice
                          ? isSelectedForSac
                            ? '✓ Sacrifice'
                            : 'Sacrifice'
                          : card.element
                            ? ELEMENT_BADGE_LABEL[card.element]
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
      )}
    </section>
  );
}
