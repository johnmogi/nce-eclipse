import {
  ELEMENT_META,
  type Command,
  type Element,
  type ProjectedGameView,
  type ProjectedPlayerView,
  type ReconciliationBreakdown
} from '../../engine/index.js';
import {
  buildElementalCommand,
  type ElementalSelectionState,
  type ElementalTargetContext
} from '../elementalTargeting.js';
import type { PlayControlMode } from '../../sim/botController.js';
import { MajorContentionModal } from './MajorContentionModal.js';
import { MarketDrawer } from './MarketDrawer.js';

const ELEMENT_VERB_HINT: Record<Element, string> = {
  air: 'Shuffle Board and/or Deck of Days cards unpredictably.',
  fire: 'Burn Board and/or Immediate Future cards into the Veil.',
  water: 'Resurface Veil cards back into Deck of Days.',
  earth: 'Privately inspect & deliberately reorder Board and/or Immediate Future cards.'
};

export function ActionDock({
  view,
  controlMode,
  humanPlayerId,
  activePlayer,
  focusedPlayer,
  canActAsActivePlayer,
  canActAsReader,
  isBotActing,
  liveReconciliation,
  selectedSacrificeIds,
  revealedHandMode,
  canUseRevealedBoardHandElemental,
  isRevealedElementalActive,
  isBonusWindow,
  elementalSelection,
  elementalCtx,
  earthPeekOrder,
  onMovePeekCard,
  onSetRevealedHandMode,
  onClearSacrifices,
  onSelectBonusForElemental,
  onCancelElemental,
  onUpdateElementalSelection,
  onOpenDaysBrowser,
  onSwitchViewer,
  onSendCommand,
  onPlayAnotherSeed,
  onWatchFullReplay
}: {
  view: ProjectedGameView;
  controlMode: PlayControlMode;
  humanPlayerId: string;
  activePlayer: ProjectedPlayerView;
  focusedPlayer: ProjectedPlayerView;
  canActAsActivePlayer: boolean;
  canActAsReader: boolean;
  isBotActing: boolean;
  liveReconciliation: ReconciliationBreakdown | null;
  selectedSacrificeIds: readonly string[];
  revealedHandMode: 'sacrifice' | 'elemental';
  canUseRevealedBoardHandElemental: boolean;
  isRevealedElementalActive: boolean;
  isBonusWindow: boolean;
  elementalSelection: ElementalSelectionState;
  elementalCtx: ElementalTargetContext;
  earthPeekOrder: readonly string[];
  onMovePeekCard: (fromIdx: number, dir: -1 | 1) => void;
  onSetRevealedHandMode: (mode: 'sacrifice' | 'elemental') => void;
  onClearSacrifices: () => void;
  onSelectBonusForElemental: (bonusId: string) => void;
  onCancelElemental: () => void;
  onUpdateElementalSelection: (patch: Partial<ElementalSelectionState>) => void;
  onOpenDaysBrowser: () => void;
  onSwitchViewer: (next: { role: 'player'; playerId: string }) => void;
  onSendCommand: (cmd: Command) => void;
  onPlayAnotherSeed: () => void;
  onWatchFullReplay: () => void;
}) {
  const isHumanVsBot = controlMode === 'human-vs-bot';
  const activeElement = elementalCtx.activeElement;
  const cmdBuild = buildElementalCommand(view, elementalSelection, elementalCtx);

  const bonusDescriptors = view.actionDescriptors.filter((d) => d.category === 'reader_bonus');
  const endTurnDescriptor = view.actionDescriptors.find((d) => d.commandType === 'EndTurn');
  const availableBonuses =
    !activePlayer.effectUsedThisTurn || !view.ruleset.readerBonusConsumesTurnAction
      ? activePlayer.pendingReaderBonuses.filter(
          (b) => b.status === 'available' && b.earnedOnTurn < view.turn && Boolean(b.sourceElement)
        )
      : [];

  const maxDaysPick = Math.min(
    view.daysCount,
    Math.max(1, elementalCtx.strength - elementalSelection.boardSlots.length)
  );

  const renderElementalConfirmControls = (confirmTestId?: string) => {
    if (!activeElement) return null;
    const isEarthPeekEligible =
      activeElement === 'earth' &&
      (elementalSelection.daysSelected ||
        elementalSelection.boardSlots.length >= 2 ||
        (elementalSelection.sourceKind === 'bonus' && elementalSelection.boardSlots.length === 0));

    const reqDays = elementalSelection.daysSelected
      ? Math.min(
          elementalSelection.daysCount,
          view.daysCount,
          Math.max(1, elementalCtx.strength - elementalSelection.boardSlots.length)
        )
      : 0;

    return (
      <div className="elemental-confirm-strip">
        <div className="brand-sub">
          <strong>
            {ELEMENT_META[activeElement].suitSymbol} {ELEMENT_META[activeElement].label} Tier{' '}
            {elementalCtx.strength}
          </strong>
          {elementalSelection.sourceKind === 'bonus'
            ? ' (Free Reader Bonus · 0 hand cost)'
            : elementalCtx.sourceCard
              ? ` (${elementalCtx.sourceCard.shortLabel} → Veil)`
              : ''}
          :{' '}
          {activeElement === 'earth' && elementalCtx.strength === 1
            ? 'Privately peek #1 Next Upcoming and optionally send to bottom (reordering 2+ requires Tier 2+).'
            : ELEMENT_VERB_HINT[activeElement]}
        </div>

        {(activeElement === 'air' || activeElement === 'fire' || activeElement === 'earth') &&
          elementalSelection.daysSelected &&
          maxDaysPick > 1 && (
            <div className="toolbar-group">
              <span className="brand-sub">Immediate Future cards:</span>
              {Array.from({ length: maxDaysPick }, (_, i) => i + 1).map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  className={`btn btn-sm ${elementalSelection.daysCount === cnt ? 'btn-active' : ''}`}
                  onClick={() => onUpdateElementalSelection({ daysCount: cnt })}
                >
                  Top {cnt}
                </button>
              ))}
            </div>
          )}

        <div className="toolbar-group">
          {isEarthPeekEligible ? (
            <button
              type="button"
              className="btn btn-primary"
              data-testid="start-earth-peek-btn"
              disabled={
                elementalSelection.boardSlots.length === 0
                  ? view.daysCount < 2
                  : elementalSelection.boardSlots.length + reqDays < 2
              }
              onClick={() =>
                onSendCommand({
                  type: 'StartEarthPeek',
                  playerId: view.activePlayerId,
                  sourceCardId:
                    elementalSelection.sourceKind === 'hand'
                      ? elementalCtx.sourceCard?.id
                      : undefined,
                  bonusId:
                    elementalSelection.sourceKind === 'bonus' ? elementalCtx.bonus?.id : undefined,
                  targetBoardSlots:
                    elementalSelection.boardSlots.length > 0
                      ? elementalSelection.boardSlots
                      : undefined,
                  daysCount:
                    elementalSelection.boardSlots.length > 0 ? reqDays : undefined
                })
              }
            >
              {elementalSelection.boardSlots.length > 0 && reqDays > 0
                ? `👁 Privately Peek & Reorder (${elementalSelection.boardSlots.length} Board + Top ${reqDays})`
                : elementalSelection.boardSlots.length >= 2
                  ? `👁 Privately Reorder Board (${elementalSelection.boardSlots.join(' ↔ ').toUpperCase()})`
                  : elementalCtx.strength === 1
                    ? '👁 Privately Peek #1 Next Upcoming (Tier 1)'
                    : `👁 Privately Peek Top ${Math.min(elementalCtx.strength, view.daysCount)} of Immediate Future`}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              data-testid={confirmTestId}
              disabled={!cmdBuild.ok}
              onClick={() => {
                if (cmdBuild.ok) onSendCommand(cmdBuild.command);
              }}
            >
              {cmdBuild.ok ? `Confirm: ${cmdBuild.actionLabel}` : 'Click a Highlighted Target Above'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              onCancelElemental();
              if (revealedHandMode === 'elemental') onSetRevealedHandMode('sacrifice');
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="decision-panel" data-testid="action-dock">
      {view.status === 'completed' && view.outcome ? (
        <div className="endgame-summary-box" data-testid="endgame-summary">
          <div className="action-row">
            <div>
              <h2 className="decision-title">
                {view.outcome.reason === 'eclipse_victory'
                  ? '☀ ECLIPSE VICTORY'
                  : view.outcome.reason === 'triangulation_victory'
                    ? '△ TRIANGULATION VICTORY'
                    : '⌛ DECK OF DAYS EXHAUSTED — WINNER OF THE DAY'}
              </h2>
              <div className="brand-sub">{view.outcome.summary}</div>
            </div>
            <div className="toolbar-group">
              <button type="button" className="btn btn-primary" onClick={onPlayAnotherSeed}>
                Play Another Seed
              </button>
              <button type="button" className="btn" onClick={onWatchFullReplay}>
                Watch Replay
              </button>
            </div>
          </div>

          <div className="endgame-players-grid">
            {view.players.map((p) => (
              <div
                key={p.id}
                className={`endgame-player-stat ${
                  view.outcome!.winnerIds.includes(p.id) ? 'endgame-winner' : ''
                }`}
              >
                <strong>
                  {p.name} {view.outcome!.winnerIds.includes(p.id) ? '🏆' : ''}
                </strong>
                <span>
                  Rank {p.lineage.rank} ({p.lineage.topCard.shortLabel}) · {p.evolutionsCompleted}{' '}
                  evolutions
                </span>
                <span>
                  ☀ Eclipses: {p.eclipseCount} (+{p.eclipseBonusVP} persistent VP)
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : view.phase === 'AWAITING_MARKET' && view.market ? (
        <MarketDrawer
          view={view}
          market={view.market}
          viewerPlayer={focusedPlayer}
          canAct={!isBotActing}
          onSendCommand={onSendCommand}
        />
      ) : view.phase === 'AWAITING_MAJOR_CONTENTION' && view.pendingMajorContention ? (
        <MajorContentionModal
          contention={view.pendingMajorContention}
          canAct={!isBotActing}
          onSendCommand={onSendCommand}
        />
      ) : isBotActing && isHumanVsBot ? (
        <div className="action-row">
          <div>
            <h2 className="decision-title">🤖 {activePlayer.name} is taking its turn…</h2>
            <div className="brand-sub">
              The bot uses only public information and its own private hand.
            </div>
          </div>
        </div>
      ) : view.phase === 'AWAITING_ABANDONED_CHOICE' ? (
        <div className="action-row">
          <div>
            <h2 className="decision-title">
              Abandoned Card Available — Claim Free or Decline for Normal Turn
            </h2>
            <div className="brand-sub">
              {view.ruleset.abandonedClaimPolicy === 'free_no_prep'
                ? 'Claiming takes Center as free Treasure (forfeiting this turn’s Reading & ordinary Elemental Prep). Declining sends it to the Veil and starts your full turn. Earned free Reader Bonuses remain usable below!'
                : 'Claim freely (forfeiting Reading) or decline to the Veil for a fresh Reading.'}
            </div>
          </div>
          <div className="toolbar-group">
            <button
              type="button"
              className="btn btn-primary"
              data-testid="claim-abandoned-btn"
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
              type="button"
              className="btn"
              data-testid="decline-abandoned-btn"
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
                ? 'Center is privately visible to you on the Shared Board above. Tell the truth or bluff — if followed, you earn a free Tier-1 Reader Bonus next turn.'
                : 'Center stays concealed until the Reader delivers GOOD or BAD advice.'}
            </div>
          </div>
          <div className="toolbar-group">
            {canActAsReader ? (
              <>
                <button
                  type="button"
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
                  type="button"
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
                type="button"
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
                ? 'Center remains concealed. Accept to flip Center & Event — or Reject it face-up to the Veil to draw & flip a fresh replacement + Event.'
                : 'Center remains concealed. Pursue to flip Center & Event, or Discard to Veil.'}
            </div>
          </div>
          <div className="toolbar-group">
            {canActAsActivePlayer ? (
              <>
                <button
                  type="button"
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
                  type="button"
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
                type="button"
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
                {liveReconciliation.reality === 'major_resonance'
                  ? 'Major Resonance — Claim Center Cleanly'
                  : liveReconciliation.reality === 'treasure'
                    ? 'Treasure Revealed — Free Claim'
                    : liveReconciliation.reality === 'barrier'
                      ? liveReconciliation.passes && selectedSacrificeIds.length === 0
                        ? `Barrier (${liveReconciliation.eventVP} VP) — Cleared by Your Lineage`
                        : `Barrier (${liveReconciliation.eventVP} VP) — Sacrifice to Claim or Abandon`
                      : liveReconciliation.passes && selectedSacrificeIds.length === 0
                        ? `Elemental Trial (> ${liveReconciliation.eventVP} VP) — Cleared by Your Lineage`
                        : `Elemental Trial (> ${liveReconciliation.eventVP} VP) — Sacrifice to Claim or Abandon`}
              </h2>
              <div className="brand-sub">{liveReconciliation.requiredCondition}</div>
            </div>
            <div className="toolbar-group">
              <button
                type="button"
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
                {liveReconciliation.reality === 'major_resonance'
                  ? 'Claim Card (Major Resonance)'
                  : liveReconciliation.reality === 'treasure'
                    ? 'Claim Treasure'
                    : !liveReconciliation.passes
                      ? 'Select Sacrifice Card(s) Below'
                      : selectedSacrificeIds.length === 0
                        ? 'Claim Card (No Sacrifice Needed)'
                        : `Sacrifice ${selectedSacrificeIds.length} Card${
                            selectedSacrificeIds.length === 1 ? '' : 's'
                          } & Claim`}
              </button>
              {liveReconciliation.reality !== 'treasure' &&
                liveReconciliation.reality !== 'major_resonance' && (
                  <button
                    type="button"
                    className="btn"
                    disabled={!canActAsActivePlayer}
                    onClick={() =>
                      onSendCommand({ type: 'AbandonCenter', playerId: view.activePlayerId })
                    }
                  >
                    Leave for Next Player
                  </button>
                )}
              {selectedSacrificeIds.length > 0 && (
                <button type="button" className="btn btn-sm" onClick={onClearSacrifices}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {liveReconciliation.reality !== 'treasure' &&
            liveReconciliation.reality !== 'major_resonance' && (
              <div className="calc-strip">
                <span>
                  <strong>Base Lineage:</strong> {liveReconciliation.lineageVP} VP
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
                {(liveReconciliation.activeCourtAuraVP ?? 0) > 0 && (
                  <>
                    <span>+</span>
                    <span className="badge badge-ok">
                      Court Aura +{liveReconciliation.activeCourtAuraVP} VP
                    </span>
                  </>
                )}
                {(liveReconciliation.persistentEclipseBonusVP ?? 0) > 0 && (
                  <>
                    <span>+</span>
                    <span className="badge badge-ok">
                      Eclipse +{liveReconciliation.persistentEclipseBonusVP} VP
                    </span>
                  </>
                )}
                <span>=</span>
                <span className={`badge ${liveReconciliation.passes ? 'badge-ok' : 'badge-warn'}`}>
                  Effective: {liveReconciliation.effectiveVP} VP
                  {liveReconciliation.wasCapped ? ` (base cap ${liveReconciliation.capLimit})` : ''}
                </span>
              </div>
            )}

          {/* Unambiguous Sacrifice vs Revealed-Board Elemental Intervention Switcher */}
          {canUseRevealedBoardHandElemental && (
            <div className="bonus-cta-strip" data-testid="revealed-hand-mode-bar">
              <div className="bonus-cta-meta">
                <span
                  className={`badge ${isRevealedElementalActive ? 'badge-ok' : 'badge-warn'}`}
                >
                  {isRevealedElementalActive
                    ? 'ELEMENTAL INTERVENTION ACTIVE — Consumes 1 hand card → Veil (1/turn)'
                    : 'Optional: Intervene on Revealed Board (1 ordinary action left)'}
                </span>
              </div>
              <div className="toolbar-group">
                <button
                  type="button"
                  data-testid="mode-sacrifice-btn"
                  className={`btn btn-sm ${!isRevealedElementalActive ? 'btn-active' : ''}`}
                  onClick={() => {
                    onSetRevealedHandMode('sacrifice');
                    onCancelElemental();
                  }}
                >
                  {liveReconciliation.reality === 'treasure' ||
                  liveReconciliation.reality === 'major_resonance'
                    ? 'Claim Mode'
                    : 'Sacrifice Mode'}
                </button>
                <button
                  type="button"
                  data-testid="mode-elemental-btn"
                  className={`btn btn-sm ${isRevealedElementalActive ? 'btn-primary' : ''}`}
                  onClick={() => {
                    onClearSacrifices();
                    onSetRevealedHandMode('elemental');
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
                renderElementalConfirmControls('confirm-revealed-elemental-btn')
              ) : (
                <div className="brand-sub">
                  Click any card in your hand below to activate its element on the revealed Board,
                  Immediate Future, or Veil.
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
                🪨 Earth Private Peek — Arrange{' '}
                {view.pendingEarthReorder.boardSlots.length > 0 &&
                view.pendingEarthReorder.daysCount > 0
                  ? `Board (${view.pendingEarthReorder.boardSlots.join(', ').toUpperCase()}) + Immediate Future (${view.pendingEarthReorder.daysCount})`
                  : view.pendingEarthReorder.boardSlots.length > 0
                    ? `Board Slots (${view.pendingEarthReorder.boardSlots.join(' ↔ ').toUpperCase()})`
                    : view.pendingEarthReorder.count === 1
                      ? 'Next Upcoming (#1) — Keep on Top or Send to Bottom'
                      : `The Immediate Future (Top ${view.pendingEarthReorder.count} Cards)`}
              </h2>
              <div className="brand-sub">
                Only you can see these cards.{' '}
                {view.pendingEarthReorder.count === 1 &&
                view.pendingEarthReorder.boardSlots.length === 0
                  ? 'Tier-1 Earth peeks #1 Next Upcoming: keep it on top or bury it on the bottom of Deck of Days.'
                  : 'Arrange left → right into exact slots, then confirm.'}
              </div>
            </div>
            <div className="toolbar-group">
              {canActAsActivePlayer && (
                <>
                  <button
                    type="button"
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
                    {view.pendingEarthReorder.count === 1 &&
                    view.pendingEarthReorder.boardSlots.length === 0
                      ? 'Keep on Top of Days'
                      : 'Confirm Deliberate Order'}
                  </button>
                  {view.pendingEarthReorder.boardSlots.length === 0 && (
                    <button
                      type="button"
                      className="btn"
                      data-testid="earth-send-bottom-btn"
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
                      {card.label} ({card.family === 'classic-court' ? `Court +${card.courtBonus}` : `${card.vp} VP`})
                    </div>
                    {earthPeekOrder.length > 1 && canActAsActivePlayer && (
                      <div className="toolbar-group">
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={posIdx === 0}
                          onClick={() => onMovePeekCard(posIdx, -1)}
                        >
                          ← Earlier
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={posIdx === earthPeekOrder.length - 1}
                          onClick={() => onMovePeekCard(posIdx, 1)}
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
              {activePlayer.name} is privately inspecting and arranging cards…
            </div>
          )}
        </div>
      ) : view.phase === 'AWAITING_ELEMENTAL_ACTION' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="action-row">
            <div>
              <h2 className="decision-title">
                {view.ruleset.elementalTiming === 'before_reading'
                  ? 'Step 1 · Board Set Complete — Optional Elemental Prep (Before Reading)'
                  : 'Optional Elemental Action (1 per turn)'}
              </h2>
              <div className="brand-sub">
                {view.ruleset.elementalTiming === 'before_reading'
                  ? 'Board is populated. Click any card in your hand below to act before Reading — or proceed to Reading and save your 1 ordinary action for after the Board reveals.'
                  : 'Play 1 elemental card from hand or finish your turn.'}
              </div>
            </div>
            <div className="toolbar-group">
              {view.ruleset.elementalTiming === 'before_reading' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="proceed-to-reading-btn"
                  disabled={!canActAsActivePlayer}
                  onClick={() =>
                    onSendCommand({ type: 'AdvanceToReading', playerId: view.activePlayerId })
                  }
                >
                  Proceed to Reading →
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="end-turn-btn"
                  disabled={!canActAsActivePlayer}
                  onClick={() => onSendCommand({ type: 'EndTurn', playerId: view.activePlayerId })}
                >
                  Finish Turn →
                </button>
              )}
            </div>
          </div>

          {elementalSelection.sourceKind === 'hand' &&
            activeElement &&
            renderElementalConfirmControls('confirm-prep-elemental-btn')}
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
              type="button"
              className="btn btn-primary"
              disabled={!canActAsActivePlayer}
              onClick={() =>
                onSendCommand({ type: 'ClaimCenterCard', playerId: view.activePlayerId })
              }
            >
              Claim Center Card
            </button>
            <button
              type="button"
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="action-row">
            <div>
              <h2 className="decision-title">{activePlayer.name}: Turn Complete</h2>
              <div className="brand-sub">Finish turn to pass play to the next player.</div>
            </div>
            <button
              type="button"
              className={`btn ${endTurnDescriptor?.expiryWarning ? 'btn-warn' : 'btn-primary'}`}
              data-testid="end-turn-btn"
              disabled={!canActAsActivePlayer}
              onClick={() => onSendCommand({ type: 'EndTurn', playerId: view.activePlayerId })}
            >
              {endTurnDescriptor?.expiryWarning
                ? 'Finish Turn Anyway (Expires Bonus) →'
                : 'Finish Turn →'}
            </button>
          </div>

          {/* Explicit End-Turn Reader Bonus Expiry Guard! */}
          {endTurnDescriptor?.expiryWarning && availableBonuses.length > 0 && (
            <div className="banner-warn" data-testid="end-turn-bonus-warning">
              <strong>{endTurnDescriptor.expiryWarning}</strong>{' '}
              <button
                type="button"
                className="btn btn-sm btn-primary"
                data-testid="spend-expiring-bonus-btn"
                onClick={() => {
                  onSelectBonusForElemental(availableBonuses[0]!.id);
                  if (availableBonuses[0]!.sourceElement !== 'water') {
                    onOpenDaysBrowser();
                  }
                }}
              >
                ★ Use Free {ELEMENT_META[availableBonuses[0]!.sourceElement!].label} Bonus Now
              </button>
            </div>
          )}
        </div>
      )}

      {/* UNIFIED FREE READER BONUS BAR (Engine-Derived Descriptors · Never Obscured!) */}
      {view.phase !== 'AWAITING_EARTH_REORDER' &&
        view.phase !== 'AWAITING_MARKET' &&
        view.phase !== 'AWAITING_MAJOR_CONTENTION' &&
        view.status === 'playing' &&
        isBonusWindow &&
        availableBonuses.length > 0 && (
          <div className="bonus-cta-strip" style={{ marginTop: 10 }} data-testid="reader-bonus-strip">
            <div className="bonus-cta-meta">
              <span className="badge badge-warn">
                ★ Free Tier-1 Reader Bonus Available (0 hand cost · Separate from Ordinary Prep)
              </span>
              {bonusDescriptors[0] && (
                <span className="brand-sub" data-testid="reader-bonus-guidance">
                  {bonusDescriptors[0].effectSummary}
                </span>
              )}
            </div>
            <div className="toolbar-group">
              {availableBonuses.map((b) => {
                const el = b.sourceElement!;
                const isSelected =
                  elementalSelection.sourceKind === 'bonus' && elementalSelection.bonusId === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    data-testid={`activate-bonus-${b.id}`}
                    className={`btn ${isSelected ? 'btn-warn-active' : 'btn-warn'}`}
                    onClick={() => {
                      onSelectBonusForElemental(b.id);
                      if (el !== 'water') onOpenDaysBrowser();
                    }}
                  >
                    {isSelected ? '✓ Active: ' : '★ Activate '}
                    {ELEMENT_META[el].suitSymbol} {ELEMENT_META[el].label} Tier 1 (Free)
                  </button>
                );
              })}
            </div>
            {elementalSelection.sourceKind === 'bonus' &&
              activeElement &&
              renderElementalConfirmControls('confirm-bonus-elemental-btn')}
          </div>
        )}
    </div>
  );
}
