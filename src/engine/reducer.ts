import {
  canSpendReaderBonusInPhase,
  computeElementalStrength,
  expireUnusedReaderBonuses,
  getAvailableReaderBonusesForTurn,
  getElementalActionsUsedCount,
  hasAnyLegalElementalAction,
  hasRemainingHandElementalAction,
  validateAndExecuteElementalEffect,
  validateAndExecuteReaderBonus,
  type ElementalMutableContext
} from './elemental-effects.js';
import {
  applyEvolutionWithEvents,
  evaluateCompletion,
  fail,
  finalizeState,
  makeEvent
} from './event-helpers.js';
import { computeStateHash } from './hash.js';
import {
  activateReadyDormantMajors,
  drawNextMinorRoutingMajors,
  evaluateCombos,
  isMajorCard,
  placeDrawnMajorOnBoard,
  type MajorMutableBoard
} from './majors.js';
import {
  computeReadingHints,
  createReadingForTurn,
  finalizeReadingReward,
  isCardObjectivelyHelpful
} from './readings.js';
import { evaluateReconciliation, eventCardToReality } from './reconciliation.js';
import { createGame } from './setup.js';
import type {
  BoardTargetSlot,
  Card,
  Command,
  CommandRecord,
  CreateGameOptions,
  DispatchResult,
  GameEvent,
  GameOutcome,
  GamePhase,
  GameState,
  MajorPendingEntry,
  PendingEarthReorderState,
  PlayerState,
  ReadingRecord,
  Ruleset,
  ValidationError
} from './types.js';

export { createGame, isCardObjectivelyHelpful };

const FUTURE_FEATURE_COMMANDS: Readonly<
  Record<string, { flag: keyof Ruleset['features']; label: string }>
> = {
  GiveReading: { flag: 'readings', label: 'Readings (Level 1.2)' },
  PursueCenter: { flag: 'readings', label: 'Readings (Level 1.2)' },
  DiscardCenter: { flag: 'readings', label: 'Readings (Level 1.2)' },
  ResolveEvent: { flag: 'barriersAndTrials', label: 'Event Realities (Milestone C / Level 1.3)' },
  AbandonCenter: { flag: 'barriersAndTrials', label: 'Event Realities (Milestone C / Level 1.3)' },
  ClaimAbandonedCard: { flag: 'barriersAndTrials', label: 'Event Realities (Milestone C / Level 1.3)' },
  DeclineAbandonedCard: { flag: 'barriersAndTrials', label: 'Event Realities (Milestone C / Level 1.3)' },
  UseElementalEffect: { flag: 'elementalEffects', label: 'Elemental Hand Effects (Milestone D1)' },
  UseReaderBonus: { flag: 'elementalEffects', label: 'Reader Bonus Elemental Action (Milestone D1)' },
  StartEarthPeek: { flag: 'elementalEffects', label: 'Earth Immediate Future Peek (Stage R1)' },
  CommitEarthReorder: { flag: 'elementalEffects', label: 'Earth Deliberate Reorder (Stage R1)' },
  AdvanceToReading: { flag: 'elementalEffects', label: 'Pre-Reading Elemental Prep (Milestone E)' },
  ProposeTrade: { flag: 'tradingMarket', label: 'Trading Market (Milestone D2)' },
  AcceptTrade: { flag: 'tradingMarket', label: 'Trading Market (Milestone D2)' },
  ChooseMajorExit: { flag: 'majors', label: 'Major Arcana Contention (Milestone E)' },
  ResolveEntropy: { flag: 'moonSunCycle', label: 'Moon/Sun Entropy Cycle (Milestone F)' }
};

/**
 * Pure deterministic command dispatcher implementing Milestones A + B + C + D0 + D1.
 */
export function dispatch(state: GameState, command: Command): DispatchResult {
  const futureGate = FUTURE_FEATURE_COMMANDS[command.type];
  if (futureGate) {
    const enabled = state.ruleset.features[futureGate.flag];
    if (!enabled) {
      return fail(state, command, {
        code: 'FEATURE_DISABLED',
        message: `${command.type} is disabled in ruleset "${state.ruleset.id}" (${futureGate.label} is not active yet).`,
        details: { featureFlag: futureGate.flag }
      });
    }
  }

  if (state.status !== 'playing' || state.phase === 'GAME_OVER') {
    return fail(state, command, {
      code: 'GAME_OVER',
      message: 'Game has already completed; start a new game or replay from an earlier step.'
    });
  }

  const actorIndex = state.players.findIndex((p) => p.id === command.playerId);
  if (actorIndex === -1) {
    return fail(state, command, {
      code: 'INVALID_PLAYER',
      message: `Unknown player "${command.playerId}".`
    });
  }

  if (command.type === 'GiveReading') {
    if (state.phase !== 'AWAITING_READING' || !state.currentReading) {
      return fail(state, command, {
        code: 'INVALID_PHASE',
        message: `Cannot give a reading during phase ${state.phase}.`
      });
    }
    if (command.playerId !== state.currentReading.readerId) {
      return fail(state, command, {
        code: 'NOT_READER_PLAYER',
        message: `Only designated reader ${state.currentReading.readerId} can give the reading, not ${command.playerId}.`
      });
    }
  } else if (command.playerId !== state.activePlayerId) {
    return fail(state, command, {
      code: 'NOT_ACTIVE_PLAYER',
      message: `It is ${state.activePlayerId}'s turn, not ${command.playerId}'s.`
    });
  }

  const stateHashBefore = state.stateHash;
  const eventSeqStart = state.events.length + 1;
  let seqCounter = state.events.length;
  const nextSeq = (): number => {
    seqCounter += 1;
    return seqCounter;
  };

  const newEvents: GameEvent[] = [];
  const players: PlayerState[] = state.players.map((p) => ({
    ...p,
    hand: [...p.hand],
    pendingReaderBonuses: [...p.pendingReaderBonuses]
  }));
  let days = [...state.days];
  let veil = [...state.veil];
  let boardEvent = [...state.board.event];
  let boardCenter = [...state.board.center];
  let boardParallel = [...state.board.parallel];
  let majorPending: MajorPendingEntry[] = state.majorPending.map((m) => ({ ...m }));
  let eventRevealed = state.eventRevealed;
  let centerRevealed = state.centerRevealed;
  let centerAbandoned = state.centerAbandoned;
  let abandonedByPlayerId = state.abandonedByPlayerId;
  let discardedCenterThisTurn = state.discardedCenterThisTurn;
  let rngState = state.rngState;
  let currentReading: ReadingRecord | null = state.currentReading ? { ...state.currentReading } : null;
  const readingHistory: ReadingRecord[] = [...state.readingHistory];
  let pendingEarthReorder: PendingEarthReorderState | null = state.pendingEarthReorder
    ? { ...state.pendingEarthReorder, peekedCardIds: [...state.pendingEarthReorder.peekedCardIds] }
    : null;
  let phase: GamePhase = state.phase;
  let turn = state.turn;
  let round = state.round;
  let activePlayerIndex = state.activePlayerIndex;
  let activePlayerId = state.activePlayerId;
  let comboOutcome: GameOutcome | undefined;

  const activePlayer = players[state.activePlayerIndex]!;

  const makeMajorBoardCtx = (): MajorMutableBoard => ({
    cards: state.cards,
    ruleset: state.ruleset,
    turn,
    round,
    phase,
    activePlayerIndex,
    players,
    days,
    veil,
    boardEvent,
    boardCenter,
    boardParallel,
    eventRevealed,
    centerRevealed,
    centerAbandoned,
    abandonedByPlayerId,
    majorPending,
    newEvents,
    nextSeq
  });

  const syncFromMajorBoardCtx = (ctx: MajorMutableBoard): void => {
    days = ctx.days;
    veil = ctx.veil;
    boardEvent = ctx.boardEvent;
    boardCenter = ctx.boardCenter;
    boardParallel = ctx.boardParallel;
    eventRevealed = ctx.eventRevealed;
    centerRevealed = ctx.centerRevealed;
    centerAbandoned = ctx.centerAbandoned;
    abandonedByPlayerId = ctx.abandonedByPlayerId;
    majorPending = ctx.majorPending;
  };

  const applyComboOutcomeIfAny = (found: GameOutcome | undefined, source: string): boolean => {
    if (!found) return false;
    comboOutcome = found;
    phase = 'GAME_OVER';
    currentReading = null;
    newEvents.push(
      makeEvent(nextSeq(), turn, round, 'GAME_OVER', state.ruleset.version, {
        actor: 'system',
        type: 'GameCompleted',
        affectedCardIds: [],
        source,
        reason: found.reason,
        visibility: 'public',
        summary: found.summary,
        payload: { ...found }
      })
    );
    return true;
  };

  const runComboCheck = (source: string): boolean => {
    if (!state.ruleset.features.eclipse && !state.ruleset.features.triangulation) return false;
    const mctx = makeMajorBoardCtx();
    const res = evaluateCombos(mctx);
    syncFromMajorBoardCtx(mctx);
    return applyComboOutcomeIfAny(res, source);
  };

  const populateEventSlotFromDays = (source: string): boolean => {
    if (
      !state.ruleset.features.barriersAndTrials ||
      boardEvent.length > 0 ||
      days.length === 0 ||
      state.ruleset.boardOccupancyLimits.event < 1
    ) {
      return false;
    }
    const mctx = makeMajorBoardCtx();
    const drawEv = drawNextMinorRoutingMajors(mctx, 'event', source);
    syncFromMajorBoardCtx(mctx);
    if (applyComboOutcomeIfAny(drawEv.outcome, source)) {
      return true;
    }
    if (drawEv.minorCardId) {
      const nextEventId = drawEv.minorCardId;
      const nextEventCard = state.cards[nextEventId]!;
      boardEvent.push(nextEventId);
      eventRevealed = false;
      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
          actor: 'system',
          type: 'CardMoved',
          affectedCardIds: [],
          source,
          reason: 'populate-event-concealed',
          visibility: 'public',
          summary: `Turn ${turn} Event card placed face-down in Left slot (${nextEventCard.backGroup} back).`,
          payload: { from: 'days', to: 'event', concealed: true }
        })
      );
      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
          actor: 'system',
          type: 'CardMoved',
          affectedCardIds: [nextEventId],
          source,
          reason: 'populate-event-admin-detail',
          visibility: 'admin_only',
          summary: `[Admin] Turn ${turn} concealed Left Event is ${nextEventCard.label} (${eventCardToReality(nextEventCard)}, ${nextEventCard.vp} VP).`,
          payload: { from: 'days', to: 'event', cardId: nextEventId }
        })
      );
    }
    return false;
  };

  const populateParallelSlotFromDays = (source: string): boolean => {
    if (
      state.ruleset.emptyChamberMode ||
      boardParallel.length > 0 ||
      days.length === 0 ||
      state.ruleset.boardOccupancyLimits.parallel < 1
    ) {
      return false;
    }
    const rightId = days.shift()!;
    const rightCard = state.cards[rightId]!;
    if (state.ruleset.features.majors && isMajorCard(rightCard)) {
      const mctx = makeMajorBoardCtx();
      const outcome = placeDrawnMajorOnBoard(mctx, rightId, source);
      syncFromMajorBoardCtx(mctx);
      return applyComboOutcomeIfAny(outcome, source);
    }
    boardParallel.push(rightId);
    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
        actor: 'system',
        type: 'CardMoved',
        affectedCardIds: [],
        source,
        reason: 'populate-parallel-concealed',
        visibility: 'public',
        summary: `Turn ${turn} Right chamber populated face-down (${rightCard.backGroup} back).`,
        payload: { from: 'days', to: 'parallel', concealed: true, backGroup: rightCard.backGroup }
      })
    );
    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
        actor: 'system',
        type: 'CardMoved',
        affectedCardIds: [rightId],
        source,
        reason: 'populate-parallel-admin-detail',
        visibility: 'admin_only',
        summary: `[Admin] Turn ${turn} concealed Right chamber card is ${rightCard.label}.`,
        payload: { from: 'days', to: 'parallel', cardId: rightId }
      })
    );
    return false;
  };

  const resolvePostEncounterPhase = (): GamePhase => {
    const currentActive = players[state.activePlayerIndex]!;
    if (currentActive.hand.length > state.ruleset.maxHandSize) {
      return 'AWAITING_HAND_DISCARD';
    }
    if (
      state.ruleset.features.elementalEffects &&
      state.ruleset.elementalTiming === 'after_encounter'
    ) {
      const hasAvailableBonus =
        getAvailableReaderBonusesForTurn(currentActive, turn, state.ruleset).length > 0;
      const canAct =
        !currentActive.effectUsedThisTurn ||
        (!state.ruleset.readerBonusConsumesTurnAction && hasAvailableBonus);
      if (canAct) {
        return 'AWAITING_ELEMENTAL_ACTION';
      }
    }
    return 'READY_TO_END_TURN';
  };

  const claimCenterAndEvolve = (sourceName: string): Card => {
    const claimedId = boardCenter.shift()!;
    const claimedCard = state.cards[claimedId]!;
    centerRevealed = true;
    centerAbandoned = false;
    abandonedByPlayerId = null;

    const updatedActive: PlayerState = {
      ...players[state.activePlayerIndex]!,
      hand: [...players[state.activePlayerIndex]!.hand, claimedId]
    };
    players[state.activePlayerIndex] = updatedActive;

    const evo = applyEvolutionWithEvents(updatedActive, state.cards, state.ruleset, {
      turn,
      round,
      phase,
      source: sourceName,
      nextSeq
    });
    players[state.activePlayerIndex] = evo.player;
    newEvents.push(...evo.events);

    return claimedCard;
  };

  const moveResolvedEventToVeil = (reason: string, summaryPrefix = 'Resolved Left Event'): void => {
    if (boardEvent.length === 0) return;
    const evId = boardEvent[0]!;
    // Classic Court (Major) standing in Left Event remains on the Board for Eclipse/Triangulation!
    if (isMajorCard(state.cards[evId])) return;
    boardEvent.shift();
    eventRevealed = false;
    veil.push(evId);
    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
        actor: 'system',
        type: 'CardMoved',
        affectedCardIds: [evId],
        source: 'event-cleanup',
        reason,
        visibility: 'public',
        summary: `${summaryPrefix} (${state.cards[evId]!.label}) moved to the Veil.`,
        payload: { from: 'event', to: 'veil' }
      })
    );
  };

  const dealFreshConcealedCenterForReading = (
    sourceName: string,
    deferReadingForPreElemental = false
  ): boolean => {
    if (days.length === 0 || state.ruleset.boardOccupancyLimits.center < 1) {
      phase = 'READY_TO_END_TURN';
      return false;
    }
    const mctx = makeMajorBoardCtx();
    const drawCtr = drawNextMinorRoutingMajors(mctx, 'center', sourceName);
    syncFromMajorBoardCtx(mctx);
    if (applyComboOutcomeIfAny(drawCtr.outcome, sourceName)) {
      return true;
    }
    if (!drawCtr.minorCardId) {
      phase = 'READY_TO_END_TURN';
      return false;
    }
    const nextCenterId = drawCtr.minorCardId;
    const nextCenterCard = state.cards[nextCenterId]!;
    boardCenter.push(nextCenterId);
    centerRevealed = false;
    const reader = players[(activePlayerIndex + 1) % players.length]!;
    if (deferReadingForPreElemental) {
      currentReading = null;
      phase = 'AWAITING_ELEMENTAL_ACTION';
    } else {
      currentReading = createReadingForTurn(
        players,
        activePlayerIndex,
        nextCenterCard,
        turn,
        round,
        state.ruleset
      );
      phase = 'AWAITING_READING';
    }

    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
        actor: 'system',
        type: 'CardMoved',
        affectedCardIds: [],
        source: sourceName,
        reason: 'populate-center-concealed',
        visibility: 'public',
        summary: deferReadingForPreElemental
          ? `Turn ${turn} concealed card placed in Center (${nextCenterCard.backGroup} back). Optional Elemental Prep open before Reading.`
          : `Turn ${turn} concealed card placed in Center (${nextCenterCard.backGroup} back). Waiting for ${reader.name}'s reading.`,
        payload: { from: 'days', to: 'center', concealed: true, backGroup: nextCenterCard.backGroup }
      })
    );
    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
        actor: 'system',
        type: 'CardMoved',
        affectedCardIds: [nextCenterId],
        source: sourceName,
        reason: 'populate-center-admin-detail',
        visibility: 'admin_only',
        summary: `[Admin] Turn ${turn} concealed Center card is ${nextCenterCard.label}.`,
        payload: { from: 'days', to: 'center', cardId: nextCenterId }
      })
    );
    return false;
  };

  const enterReadingOrAbandonedPhase = (sourceName: string): void => {
    if (populateEventSlotFromDays(sourceName)) return;
    if (centerAbandoned && boardCenter.length > 0) {
      phase = 'AWAITING_ABANDONED_CHOICE';
      currentReading = null;
      return;
    }
    if (boardCenter.length > 0) {
      const existingCenterId = boardCenter[0]!;
      const existingCenterCard = state.cards[existingCenterId]!;
      if (state.ruleset.features.readings) {
        centerRevealed = false;
        currentReading = createReadingForTurn(
          players,
          activePlayerIndex,
          existingCenterCard,
          turn,
          round,
          state.ruleset
        );
        phase = 'AWAITING_READING';
      } else {
        centerRevealed = true;
        currentReading = null;
        phase = 'AWAITING_CENTER_DECISION';
      }
      return;
    }
    if (days.length > 0) {
      if (state.ruleset.features.readings) {
        dealFreshConcealedCenterForReading(sourceName, false);
      } else {
        const nextCenterId = days.shift()!;
        boardCenter.push(nextCenterId);
        centerRevealed = true;
        currentReading = null;
        phase = 'AWAITING_CENTER_DECISION';
      }
      return;
    }
    phase = 'READY_TO_END_TURN';
  };

  const makeElementalContext = (): ElementalMutableContext => ({
    cards: state.cards,
    ruleset: state.ruleset,
    turn,
    round,
    phase,
    activePlayerIndex: state.activePlayerIndex,
    players,
    days,
    veil,
    boardEvent,
    boardCenter,
    boardParallel,
    majorPending,
    eventRevealed,
    centerRevealed,
    centerAbandoned,
    abandonedByPlayerId,
    rngState,
    newEvents,
    nextSeq
  });

  const syncFromElementalContext = (ctx: ElementalMutableContext): void => {
    days = ctx.days;
    veil = ctx.veil;
    boardEvent = ctx.boardEvent;
    boardCenter = ctx.boardCenter;
    boardParallel = ctx.boardParallel;
    majorPending = ctx.majorPending;
    eventRevealed = ctx.eventRevealed;
    centerRevealed = ctx.centerRevealed;
    centerAbandoned = ctx.centerAbandoned;
    abandonedByPlayerId = ctx.abandonedByPlayerId;
    rngState = ctx.rngState;
  };

  switch (command.type) {
    case 'ClaimAbandonedCard': {
      if (state.phase !== 'AWAITING_ABANDONED_CHOICE' || !centerAbandoned || boardCenter.length === 0) {
        return fail(state, command, {
          code: 'NO_ABANDONED_CARD',
          message: 'There is no abandoned Center card available to claim.'
        });
      }

      const claimedId = boardCenter[0]!;
      const claimedCard = state.cards[claimedId]!;
      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
          actor: activePlayer.id,
          type: 'AbandonedCardClaimed',
          affectedCardIds: [claimedId],
          source: 'ClaimAbandonedCard',
          reason: 'free-treasure-instead-of-reading',
          visibility: 'public',
          summary: `${activePlayer.name} claimed abandoned ${claimedCard.label} as free Treasure (forfeiting this turn's reading).`
        })
      );

      claimCenterAndEvolve('ClaimAbandonedCard');
      phase = resolvePostEncounterPhase();
      break;
    }

    case 'DeclineAbandonedCard': {
      if (state.phase !== 'AWAITING_ABANDONED_CHOICE' || !centerAbandoned || boardCenter.length === 0) {
        return fail(state, command, {
          code: 'NO_ABANDONED_CARD',
          message: 'There is no abandoned Center card to decline.'
        });
      }

      const declinedId = boardCenter.shift()!;
      const declinedCard = state.cards[declinedId]!;
      centerAbandoned = false;
      abandonedByPlayerId = null;
      veil.push(declinedId);

      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
          actor: activePlayer.id,
          type: 'AbandonedCardDeclined',
          affectedCardIds: [declinedId],
          source: 'DeclineAbandonedCard',
          reason: state.ruleset.declinedAbandonedPolicy,
          visibility: 'public',
          summary: `${activePlayer.name} declined abandoned ${declinedCard.label} → moved to the Veil to take a fresh reading.`,
          payload: { policy: state.ruleset.declinedAbandonedPolicy }
        })
      );

      if (state.ruleset.features.readings) {
        dealFreshConcealedCenterForReading('DeclineAbandonedCard');
      } else if (days.length > 0) {
        const nextId = days.shift()!;
        boardCenter.push(nextId);
        centerRevealed = true;
        phase = 'AWAITING_CENTER_DECISION';
      } else {
        phase = resolvePostEncounterPhase();
      }
      break;
    }

    case 'GiveReading': {
      const centerId = boardCenter[0];
      if (!centerId || !currentReading) {
        return fail(state, command, {
          code: 'NO_CENTER_CARD',
          message: 'There is no concealed Center card to read.'
        });
      }
      const centerCard = state.cards[centerId]!;
      const reader = players[actorIndex]!;
      const hints = computeReadingHints(activePlayer, centerCard, state.ruleset);
      const adviceTruthful =
        (command.advice === 'good' && currentReading.objectiveHelpful) ||
        (command.advice === 'bad' && !currentReading.objectiveHelpful);

      currentReading = {
        ...currentReading,
        advice: command.advice,
        hints,
        adviceTruthful
      };
      phase = 'AWAITING_READING_DECISION';

      const hintParts: string[] = [];
      if (hints?.color) hintParts.push(`Color: ${hints.color}`);
      if (hints?.tier) hintParts.push(`Tier: ${hints.tier}`);
      const hintSuffix = hintParts.length > 0 ? ` (Optional hints: ${hintParts.join(', ')})` : '';

      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
          actor: reader.id,
          type: 'ReadingGiven',
          affectedCardIds: [],
          source: 'GiveReading',
          reason: 'reader-advice',
          visibility: 'public',
          summary: `${reader.name} advised ${activePlayer.name}: "${command.advice.toUpperCase()}"${hintSuffix}.`,
          payload: { advice: command.advice, hints }
        })
      );
      break;
    }

    case 'PursueCenter': {
      if (state.phase !== 'AWAITING_READING_DECISION' || !currentReading || !currentReading.advice) {
        return fail(state, command, {
          code: 'INVALID_PHASE',
          message: `Cannot pursue Center during phase ${state.phase}.`
        });
      }
      if (boardCenter.length === 0) {
        return fail(state, command, {
          code: 'NO_CENTER_CARD',
          message: 'There is no Center card to pursue.'
        });
      }

      const centerId = boardCenter[0]!;
      const centerCard = state.cards[centerId]!;
      const adviceFollowed = currentReading.advice === 'good';
      centerRevealed = true;

      currentReading = {
        ...currentReading,
        playerAction: 'pursue',
        adviceFollowed
      };

      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
          actor: activePlayer.id,
          type: 'CenterPursued',
          affectedCardIds: [centerId],
          source: 'PursueCenter',
          reason: adviceFollowed ? 'followed-good-advice' : 'pursued-despite-bad-advice',
          visibility: 'public',
          summary: `${activePlayer.name} chose to PURSUE Center → revealed ${centerCard.label} (advice was "${currentReading.advice?.toUpperCase()}", ${currentReading.adviceTruthful ? 'truthful' : 'deceptive'}).`,
          payload: {
            advice: currentReading.advice,
            playerAction: 'pursue',
            adviceFollowed,
            adviceTruthful: currentReading.adviceTruthful
          }
        })
      );

      if (state.ruleset.features.barriersAndTrials && boardEvent.length > 0) {
        const eventId = boardEvent[0]!;
        const eventCard = state.cards[eventId]!;
        eventRevealed = true;
        const reality = eventCardToReality(eventCard);
        phase = 'AWAITING_EVENT_RESOLUTION';

        newEvents.push(
          makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
            actor: 'system',
            type: 'EventRevealed',
            affectedCardIds: [eventId],
            source: 'PursueCenter',
            reason: `left-event-${reality}`,
            visibility: 'public',
            summary: `Left Event revealed: ${eventCard.label} (${eventCard.vp} VP) → ${reality.toUpperCase()}!`,
            payload: {
              eventCardId: eventId,
              eventVP: eventCard.vp,
              eventElement: eventCard.element ?? null,
              reality
            }
          })
        );
      } else {
        claimCenterAndEvolve('PursueCenter');
        finalizeReadingReward({
          reading: currentReading,
          resolution: 'claimed',
          sourceCard: centerCard,
          activePlayerId: activePlayer.id,
          players,
          readingHistory,
          newEvents,
          turn,
          round,
          phase,
          ruleset: state.ruleset,
          nextSeq
        });
        currentReading = null;
        phase = resolvePostEncounterPhase();
      }
      break;
    }

    case 'DiscardCenter': {
      if (state.phase !== 'AWAITING_READING_DECISION' || !currentReading || !currentReading.advice) {
        return fail(state, command, {
          code: 'INVALID_PHASE',
          message: `Cannot discard Center during phase ${state.phase}.`
        });
      }
      if (boardCenter.length === 0) {
        return fail(state, command, {
          code: 'NO_CENTER_CARD',
          message: 'There is no Center card to discard.'
        });
      }

      const discardedId = boardCenter.shift()!;
      const discardedCard = state.cards[discardedId]!;
      const adviceFollowed = currentReading.advice === 'bad';
      centerRevealed = true;
      discardedCenterThisTurn = !state.ruleset.replaceCenterOnDiscard;
      veil.push(discardedId);

      const updatedReading: ReadingRecord = {
        ...currentReading,
        playerAction: 'discard',
        adviceFollowed
      };

      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
          actor: activePlayer.id,
          type: 'CenterDiscarded',
          affectedCardIds: [discardedId],
          source: 'DiscardCenter',
          reason: adviceFollowed ? 'followed-bad-advice' : 'discarded-despite-good-advice',
          visibility: 'public',
          summary: `${activePlayer.name} rejected Center → ${discardedCard.label} revealed in the Veil (advice was "${updatedReading.advice?.toUpperCase()}", ${updatedReading.adviceTruthful ? 'truthful' : 'deceptive'}).`,
          payload: {
            advice: updatedReading.advice,
            playerAction: 'discard',
            adviceFollowed,
            adviceTruthful: updatedReading.adviceTruthful
          }
        })
      );

      finalizeReadingReward({
        reading: updatedReading,
        resolution: 'discarded',
        sourceCard: discardedCard,
        activePlayerId: activePlayer.id,
        players,
        readingHistory,
        newEvents,
        turn,
        round,
        phase,
        ruleset: state.ruleset,
        nextSeq
      });
      currentReading = null;

      // Stage R1 (RD-04 AGREED): Rejecting the read Center card draws & flips a fresh replacement card
      // AND flips Left Event to determine Treasure / Barrier / Trial so the player never loses their turn!
      if (state.ruleset.replaceCenterOnDiscard) {
        let replacementId: string | null = null;
        if (days.length > 0) {
          const mctx = makeMajorBoardCtx();
          const drawRep = drawNextMinorRoutingMajors(mctx, 'center', 'DiscardCenter-replacement');
          syncFromMajorBoardCtx(mctx);
          if (applyComboOutcomeIfAny(drawRep.outcome, 'DiscardCenter-replacement')) {
            break;
          }
          replacementId = drawRep.minorCardId;
        }

        if (replacementId) {
          const replacementCard = state.cards[replacementId]!;
          boardCenter.push(replacementId);
          centerRevealed = true;

          newEvents.push(
            makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
              actor: activePlayer.id,
              type: 'CardMoved',
              affectedCardIds: [replacementId],
              source: 'DiscardCenter',
              reason: 'replacement-after-reject',
              visibility: 'public',
              summary: `${activePlayer.name} drew and flipped replacement Center card: ${replacementCard.label} (${replacementCard.vp} VP).`,
              payload: { from: 'days', to: 'center', replacement: true }
            })
          );

          if (state.ruleset.features.barriersAndTrials && boardEvent.length > 0) {
            const eventId = boardEvent[0]!;
            const eventCard = state.cards[eventId]!;
            eventRevealed = true;
            const reality = eventCardToReality(eventCard);
            phase = 'AWAITING_EVENT_RESOLUTION';

            newEvents.push(
              makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
                actor: 'system',
                type: 'EventRevealed',
                affectedCardIds: [eventId],
                source: 'DiscardCenter',
                reason: `left-event-${reality}`,
                visibility: 'public',
                summary: `Left Event revealed for replacement card: ${eventCard.label} (${eventCard.vp} VP) → ${reality.toUpperCase()}!`,
                payload: {
                  eventCardId: eventId,
                  eventVP: eventCard.vp,
                  eventElement: eventCard.element ?? null,
                  reality
                }
              })
            );
          } else {
            claimCenterAndEvolve('DiscardCenter-replacement');
            phase = resolvePostEncounterPhase();
          }
        } else {
          phase = resolvePostEncounterPhase();
        }
      } else {
        phase = resolvePostEncounterPhase();
      }
      break;
    }

    case 'ResolveEvent': {
      if (state.phase !== 'AWAITING_EVENT_RESOLUTION') {
        return fail(state, command, {
          code: 'INVALID_PHASE',
          message: `Cannot resolve event during phase ${state.phase}.`
        });
      }
      if (boardCenter.length === 0 || boardEvent.length === 0) {
        return fail(state, command, {
          code: 'NO_CENTER_CARD',
          message: 'Both Center and Event cards are required to resolve an event.'
        });
      }

      const seenSac = new Set<string>();
      for (const sacId of command.sacrificeCardIds) {
        if (seenSac.has(sacId)) {
          return fail(state, command, {
            code: 'DUPLICATE_SACRIFICE',
            message: `Duplicate sacrifice card "${sacId}".`
          });
        }
        seenSac.add(sacId);
        if (!activePlayer.hand.includes(sacId)) {
          return fail(state, command, {
            code: 'CARD_NOT_IN_HAND',
            message: `Sacrifice card "${sacId}" is not in ${activePlayer.id}'s hand.`
          });
        }
      }

      const eventCard = state.cards[boardEvent[0]!]!;
      const centerCard = state.cards[boardCenter[0]!]!;
      const breakdown = evaluateReconciliation({
        player: activePlayer,
        eventCard,
        centerCard,
        sacrificeCardIds: command.sacrificeCardIds,
        cards: state.cards,
        ruleset: state.ruleset
      });

      if (!breakdown.passes) {
        if (breakdown.reality === 'treasure' && command.sacrificeCardIds.length > 0) {
          return fail(state, command, {
            code: 'UNEXPECTED_SACRIFICE',
            message: breakdown.failureReason ?? 'Treasure requires no sacrifice.',
            details: { breakdown }
          });
        }
        if (
          breakdown.reality === 'trial' &&
          state.ruleset.trialRequireAdvantage &&
          !breakdown.hasElementalAdvantage
        ) {
          return fail(state, command, {
            code: 'ELEMENTAL_ADVANTAGE_REQUIRED',
            message: breakdown.failureReason ?? 'Trial requires elemental advantage.',
            details: { breakdown }
          });
        }
        return fail(state, command, {
          code: 'INSUFFICIENT_VP',
          message: breakdown.failureReason ?? 'Insufficient effective VP to reconcile obstacle.',
          details: { breakdown }
        });
      }

      if (command.sacrificeCardIds.length > 0) {
        const sacSet = new Set(command.sacrificeCardIds);
        players[state.activePlayerIndex] = {
          ...players[state.activePlayerIndex]!,
          hand: players[state.activePlayerIndex]!.hand.filter((id) => !sacSet.has(id))
        };
        for (const sacId of command.sacrificeCardIds) {
          veil.push(sacId);
        }
        newEvents.push(
          makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
            actor: activePlayer.id,
            type: 'CardMoved',
            affectedCardIds: command.sacrificeCardIds,
            source: 'ResolveEvent',
            reason: 'reconciliation-sacrifice',
            visibility: 'public',
            summary: `${activePlayer.name} sacrificed ${command.sacrificeCardIds.map((id) => state.cards[id]!.label).join(', ')} to the Veil.`,
            payload: { from: 'hand', to: state.ruleset.sacrificeDestination }
          })
        );
      }

      if (breakdown.reality === 'treasure') {
        newEvents.push(
          makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
            actor: activePlayer.id,
            type: 'TreasureClaimed',
            affectedCardIds: [centerCard.id],
            source: 'ResolveEvent',
            reason: 'treasure-free-claim',
            visibility: 'public',
            summary: `${activePlayer.name} claimed ${centerCard.label} as a Treasure (Event ${eventCard.label}, 3 VP).`,
            payload: { breakdown }
          })
        );
      } else if (breakdown.reality === 'barrier') {
        newEvents.push(
          makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
            actor: activePlayer.id,
            type: 'BarrierReconciled',
            affectedCardIds: [centerCard.id, eventCard.id, ...command.sacrificeCardIds],
            source: 'ResolveEvent',
            reason: 'barrier-reconciled',
            visibility: 'public',
            summary: `${activePlayer.name} reconciled ${eventCard.label} Barrier (${eventCard.vp} VP) with ${breakdown.effectiveVP} effective VP (lineage ${breakdown.lineageVP} + sacrifice ${breakdown.sacrificedVP}${breakdown.wasCapped ? `, capped at ${breakdown.capLimit}` : ''}) and claimed ${centerCard.label}.`,
            payload: { breakdown }
          })
        );
      } else {
        newEvents.push(
          makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
            actor: activePlayer.id,
            type: 'TrialPassed',
            affectedCardIds: [centerCard.id, eventCard.id, ...command.sacrificeCardIds],
            source: 'ResolveEvent',
            reason: 'trial-passed',
            visibility: 'public',
            summary: `${activePlayer.name} passed ${eventCard.label} Trial (> ${eventCard.vp} VP) with ${breakdown.effectiveVP} effective VP (lineage ${breakdown.lineageVP} + sacrifice ${breakdown.sacrificedVP} + advantage ${breakdown.advantageModifierVP}${breakdown.wasCapped ? `, capped at ${breakdown.capLimit}` : ''}) and claimed ${centerCard.label}.`,
            payload: { breakdown }
          })
        );
      }

      claimCenterAndEvolve('ResolveEvent');

      if (currentReading) {
        finalizeReadingReward({
          reading: currentReading,
          resolution: 'claimed',
          sourceCard: centerCard,
          activePlayerId: activePlayer.id,
          players,
          readingHistory,
          newEvents,
          turn,
          round,
          phase,
          ruleset: state.ruleset,
          nextSeq
        });
        currentReading = null;
      }

      moveResolvedEventToVeil(`event-${breakdown.reality}-resolved`);
      phase = resolvePostEncounterPhase();
      break;
    }

    case 'AbandonCenter': {
      if (state.phase !== 'AWAITING_EVENT_RESOLUTION') {
        return fail(state, command, {
          code: 'INVALID_PHASE',
          message: `Can only abandon a Barrier or Trial during AWAITING_EVENT_RESOLUTION (current: ${state.phase}).`
        });
      }
      if (boardCenter.length === 0 || boardEvent.length === 0) {
        return fail(state, command, {
          code: 'NO_CENTER_CARD',
          message: 'No active Center/Event pair to abandon.'
        });
      }

      const eventCard = state.cards[boardEvent[0]!]!;
      const centerCard = state.cards[boardCenter[0]!]!;
      const reality = eventCardToReality(eventCard);
      if (reality === 'treasure') {
        return fail(state, command, {
          code: 'CANNOT_ABANDON_TREASURE',
          message: 'Treasure has no obstacle; claim it freely instead of abandoning.'
        });
      }

      centerAbandoned = true;
      centerRevealed = true;
      abandonedByPlayerId = activePlayer.id;

      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
          actor: activePlayer.id,
          type: 'CenterAbandoned',
          affectedCardIds: [centerCard.id, eventCard.id],
          source: 'AbandonCenter',
          reason: `abandoned-${reality}`,
          visibility: 'public',
          summary: `${activePlayer.name} abandoned ${centerCard.label} rather than reconciling ${eventCard.label} (${reality.toUpperCase()}). It stays face-up for the next player to claim freely.`,
          payload: { reality, eventCardId: eventCard.id, centerCardId: centerCard.id }
        })
      );

      if (currentReading) {
        finalizeReadingReward({
          reading: currentReading,
          resolution: 'abandoned',
          sourceCard: centerCard,
          activePlayerId: activePlayer.id,
          players,
          readingHistory,
          newEvents,
          turn,
          round,
          phase,
          ruleset: state.ruleset,
          nextSeq
        });
        currentReading = null;
      }

      moveResolvedEventToVeil(`event-${reality}-abandoned`);
      phase = resolvePostEncounterPhase();
      break;
    }

    case 'ClaimCenterCard': {
      if (state.phase !== 'AWAITING_CENTER_DECISION') {
        return fail(state, command, {
          code: 'INVALID_PHASE',
          message: `Cannot claim Center directly during phase ${state.phase}.`
        });
      }
      if (boardCenter.length === 0) {
        return fail(state, command, {
          code: 'NO_CENTER_CARD',
          message: 'There is no card in the Center slot to claim.'
        });
      }
      const claimedCard = state.cards[boardCenter[0]!]!;
      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
          actor: activePlayer.id,
          type: 'CenterClaimed',
          affectedCardIds: [claimedCard.id],
          source: 'ClaimCenterCard',
          reason: 'acquire-center',
          visibility: 'public',
          summary: `${activePlayer.name} claimed ${claimedCard.label} from Center.`
        })
      );
      claimCenterAndEvolve('ClaimCenterCard');
      phase = resolvePostEncounterPhase();
      break;
    }

    case 'DiscardCenterCard': {
      if (state.phase !== 'AWAITING_CENTER_DECISION') {
        return fail(state, command, {
          code: 'INVALID_PHASE',
          message: `Cannot discard Center directly during phase ${state.phase}.`
        });
      }
      if (boardCenter.length === 0) {
        return fail(state, command, {
          code: 'NO_CENTER_CARD',
          message: 'There is no card in the Center slot to discard.'
        });
      }
      const discardedId = boardCenter.shift()!;
      const discardedCard = state.cards[discardedId]!;
      veil.push(discardedId);
      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
          actor: activePlayer.id,
          type: 'CenterDiscarded',
          affectedCardIds: [discardedId],
          source: 'DiscardCenterCard',
          reason: 'pass-center-to-veil',
          visibility: 'public',
          summary: `${activePlayer.name} sent ${discardedCard.label} from Center to the Veil.`
        })
      );
      phase = resolvePostEncounterPhase();
      break;
    }

    case 'DiscardHandCard': {
      if (state.phase !== 'AWAITING_HAND_DISCARD') {
        return fail(state, command, {
          code: 'INVALID_PHASE',
          message: `Hand discard is only required during AWAITING_HAND_DISCARD (current: ${state.phase}).`
        });
      }
      if (!activePlayer.hand.includes(command.cardId)) {
        return fail(state, command, {
          code: 'CARD_NOT_IN_HAND',
          message: `Card "${command.cardId}" is not in ${activePlayer.id}'s hand.`
        });
      }

      const card = state.cards[command.cardId]!;
      const nextHand = activePlayer.hand.filter((id) => id !== command.cardId);
      players[state.activePlayerIndex] = { ...activePlayer, hand: nextHand };
      veil.push(command.cardId);

      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
          actor: activePlayer.id,
          type: 'HandCardDiscarded',
          affectedCardIds: [command.cardId],
          source: 'DiscardHandCard',
          reason: 'hand-limit-enforced',
          visibility: 'public',
          summary: `${activePlayer.name} discarded ${card.label} to the Veil to meet hand limit (${state.ruleset.maxHandSize}).`
        })
      );

      phase = resolvePostEncounterPhase();
      break;
    }

    case 'AdvanceToReading': {
      if (
        state.phase !== 'AWAITING_ELEMENTAL_ACTION' ||
        state.ruleset.elementalTiming !== 'before_reading'
      ) {
        return fail(state, command, {
          code: 'INVALID_PHASE',
          message: `AdvanceToReading is only valid during pre-reading AWAITING_ELEMENTAL_ACTION (current: ${state.phase}).`
        });
      }
      enterReadingOrAbandonedPhase('AdvanceToReading');
      break;
    }

    case 'UseElementalEffect': {
      const ctx = makeElementalContext();
      const res = validateAndExecuteElementalEffect(ctx, command);
      if (!res.ok) {
        return fail(state, command, res.error);
      }
      syncFromElementalContext(ctx);
      if (!runComboCheck('UseElementalEffect')) {
        if (state.ruleset.elementalTiming === 'before_reading') {
          const currentActive = players[state.activePlayerIndex]!;
          const canContinuePrep = hasAnyLegalElementalAction({
            player: currentActive,
            cards: state.cards,
            turn,
            ruleset: state.ruleset,
            daysCount: days.length,
            veilCount: veil.length,
            boardOccupiedCount: boardEvent.length + boardCenter.length + boardParallel.length
          });
          if (!canContinuePrep) {
            enterReadingOrAbandonedPhase('UseElementalEffect');
          }
        } else {
          phase = resolvePostEncounterPhase();
        }
      }
      break;
    }

    case 'UseReaderBonus': {
      const ctx = makeElementalContext();
      const res = validateAndExecuteReaderBonus(ctx, command);
      if (!res.ok) {
        return fail(state, command, res.error);
      }
      syncFromElementalContext(ctx);
      if (!runComboCheck('UseReaderBonus')) {
        if (state.phase === 'AWAITING_ELEMENTAL_ACTION') {
          if (state.ruleset.elementalTiming === 'before_reading') {
            const currentActive = players[state.activePlayerIndex]!;
            const canContinuePrep = hasAnyLegalElementalAction({
              player: currentActive,
              cards: state.cards,
              turn,
              ruleset: state.ruleset,
              daysCount: days.length,
              veilCount: veil.length,
              boardOccupiedCount: boardEvent.length + boardCenter.length + boardParallel.length
            });
            if (!canContinuePrep) {
              enterReadingOrAbandonedPhase('UseReaderBonus');
            }
          } else {
            phase = resolvePostEncounterPhase();
          }
        } else if (state.phase === 'AWAITING_READING_DECISION' && boardCenter.length === 0) {
          // If the player burned/shuffled/repositioned the Center card mid-reading via Reader Bonus, refill or finish cleanly
          currentReading = null;
          enterReadingOrAbandonedPhase('UseReaderBonus');
        } else if (state.phase === 'AWAITING_ABANDONED_CHOICE' && boardCenter.length === 0) {
          enterReadingOrAbandonedPhase('UseReaderBonus');
        }
      }
      break;
    }

    case 'StartEarthPeek': {
      const isBonus = Boolean(command.bonusId);
      if (isBonus) {
        if (!canSpendReaderBonusInPhase(state.phase, state.ruleset)) {
          return fail(state, command, {
            code: 'INVALID_PHASE',
            message: `Cannot use an Earth Reader Bonus during phase ${state.phase}.`
          });
        }
      } else if (state.phase !== 'AWAITING_ELEMENTAL_ACTION') {
        return fail(state, command, {
          code: 'INVALID_PHASE',
          message: `Earth hand card peek is only valid during AWAITING_ELEMENTAL_ACTION (current: ${state.phase}).`
        });
      }

      // Validate source BEFORE checking target bounds or mutating anything!
      let strength = 1;
      let sourceCommand: 'UseElementalEffect' | 'UseReaderBonus' = 'UseElementalEffect';
      let sourceCardId: string | null = null;
      let bonusId: string | null = null;
      let bonusIdx = -1;

      if (isBonus && command.bonusId) {
        if (state.ruleset.readerBonusPolicy === 'record_only') {
          return fail(state, command, {
            code: 'FEATURE_DISABLED',
            message: 'Reader bonus spending is disabled in this ruleset.'
          });
        }
        if (
          state.ruleset.readerBonusConsumesTurnAction &&
          !hasRemainingHandElementalAction(activePlayer, state.ruleset)
        ) {
          return fail(state, command, {
            code: 'EFFECT_ALREADY_USED_THIS_TURN',
            message: `${activePlayer.name} has already used their elemental action this turn.`
          });
        }
        bonusIdx = activePlayer.pendingReaderBonuses.findIndex((b) => b.id === command.bonusId);
        const bonus = bonusIdx >= 0 ? activePlayer.pendingReaderBonuses[bonusIdx] : undefined;
        if (!bonus || bonus.status !== 'available' || bonus.earnedOnTurn >= turn) {
          return fail(state, command, {
            code: 'NO_AVAILABLE_READER_BONUS',
            message: `Reader bonus "${command.bonusId}" is not available.`
          });
        }
        if (bonus.sourceElement !== 'earth') {
          return fail(state, command, {
            code: 'ELEMENT_MISMATCH',
            message: `Reader bonus "${bonus.id}" is ${bonus.sourceElement ?? 'none'}, not earth.`
          });
        }
        sourceCommand = 'UseReaderBonus';
        bonusId = bonus.id;
        strength = 1;
      } else if (command.sourceCardId) {
        if (!hasRemainingHandElementalAction(activePlayer, state.ruleset)) {
          return fail(state, command, {
            code: 'EFFECT_ALREADY_USED_THIS_TURN',
            message: `${activePlayer.name} has already used all elemental actions this turn.`
          });
        }
        if (!activePlayer.hand.includes(command.sourceCardId)) {
          return fail(state, command, {
            code: 'CARD_NOT_IN_HAND',
            message: `Card "${command.sourceCardId}" is not in ${activePlayer.id}'s hand.`
          });
        }
        const sourceCard = state.cards[command.sourceCardId];
        if (!sourceCard || sourceCard.element !== 'earth') {
          return fail(state, command, {
            code: 'ELEMENT_MISMATCH',
            message: `Card "${command.sourceCardId}" is not an Earth card.`
          });
        }
        const computed = computeElementalStrength(activePlayer, sourceCard, state.ruleset);
        strength = computed.strength;
        sourceCardId = sourceCard.id;
      } else {
        return fail(state, command, {
          code: 'INVALID_CARD',
          message: 'StartEarthPeek requires either sourceCardId or bonusId.'
        });
      }

      // Validate requested Board slots + Immediate Future Days count BEFORE consuming source!
      const requestedBoardSlots: BoardTargetSlot[] = [];
      for (const slot of command.targetBoardSlots ?? []) {
        if (slot !== 'event' && slot !== 'center' && slot !== 'parallel') {
          return fail(state, command, {
            code: 'INVALID_TARGET_SELECTION',
            message: `Unsupported board slot "${String(slot)}".`
          });
        }
        if (requestedBoardSlots.includes(slot)) {
          return fail(state, command, {
            code: 'INVALID_TARGET_SELECTION',
            message: `Duplicate board slot "${slot}".`
          });
        }
        const slotArr =
          slot === 'event' ? boardEvent : slot === 'center' ? boardCenter : boardParallel;
        if (slotArr.length === 0) {
          return fail(state, command, {
            code: 'INSUFFICIENT_TARGET_CARDS',
            message: `Board slot "${slot}" is empty.`
          });
        }
        requestedBoardSlots.push(slot);
      }

      const explicitDays = command.daysCount;
      const effectiveDaysCount =
        explicitDays !== undefined
          ? explicitDays
          : requestedBoardSlots.length > 0
            ? 0
            : Math.min(strength, days.length);

      if (effectiveDaysCount < 0 || !Number.isInteger(effectiveDaysCount)) {
        return fail(state, command, {
          code: 'INVALID_TARGET_SELECTION',
          message: `Invalid Earth daysCount "${effectiveDaysCount}".`
        });
      }
      const totalSelected = requestedBoardSlots.length + effectiveDaysCount;
      if (totalSelected === 0 || totalSelected > strength) {
        return fail(state, command, {
          code: 'INVALID_TARGET_SELECTION',
          message: `Earth strength is ${strength}, but ${totalSelected} target(s) were selected.`
        });
      }
      if (days.length < effectiveDaysCount) {
        return fail(state, command, {
          code: 'INSUFFICIENT_TARGET_CARDS',
          message: `Deck of Days only has ${days.length} card(s), fewer than requested ${effectiveDaysCount}.`
        });
      }
      if (requestedBoardSlots.length === 0 && days.length < 2) {
        return fail(state, command, {
          code: 'INSUFFICIENT_TARGET_CARDS',
          message: 'Deck of Days needs at least 2 cards to inspect and reorder the Immediate Future.'
        });
      }
      if (requestedBoardSlots.length > 0 && totalSelected < 2) {
        return fail(state, command, {
          code: 'INVALID_TARGET_SELECTION',
          message: 'Reordering Board slots requires at least 2 targeted cards across Board and/or Deck of Days.'
        });
      }

      // ---- Atomic consumption BEFORE revealing cards (cheat-proof!) ----
      const limit = state.ruleset.maxElementalActionsPerTurn ?? 1;
      if (isBonus && bonusId && bonusIdx >= 0) {
        const bonus = activePlayer.pendingReaderBonuses[bonusIdx]!;
        const updatedBonuses = activePlayer.pendingReaderBonuses.map((b, idx) =>
          idx === bonusIdx ? { ...b, status: 'consumed' as const, consumedOnTurn: turn } : b
        );
        const nextUsed = state.ruleset.readerBonusConsumesTurnAction
          ? getElementalActionsUsedCount(activePlayer) + 1
          : getElementalActionsUsedCount(activePlayer);
        const exhausted = state.ruleset.readerBonusConsumesTurnAction
          ? limit !== 'unlimited' && nextUsed >= limit
          : activePlayer.effectUsedThisTurn;
        players[state.activePlayerIndex] = {
          ...activePlayer,
          pendingReaderBonuses: updatedBonuses,
          elementalActionsUsedThisTurn: nextUsed,
          effectUsedThisTurn: exhausted
        };
        newEvents.push(
          makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
            actor: activePlayer.id,
            type: 'ReaderBonusConsumed',
            affectedCardIds: [bonus.sourceCardId],
            source: 'StartEarthPeek',
            reason: state.ruleset.readerBonusPolicy,
            visibility: 'public',
            summary: `${activePlayer.name} spent Earth Reader Bonus (Tier 1 · 0 hand cost) to inspect the Immediate Future.`,
            payload: { bonusId: bonus.id, element: 'earth', strength: 1 }
          })
        );
      } else if (sourceCardId) {
        const sourceCard = state.cards[sourceCardId]!;
        const nextUsed = getElementalActionsUsedCount(activePlayer) + 1;
        const exhausted = limit !== 'unlimited' && nextUsed >= limit;
        players[state.activePlayerIndex] = {
          ...activePlayer,
          hand: activePlayer.hand.filter((id) => id !== sourceCard.id),
          elementalActionsUsedThisTurn: nextUsed,
          effectUsedThisTurn: exhausted
        };
        veil.push(sourceCard.id);
        newEvents.push(
          makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
            actor: activePlayer.id,
            type: 'ElementalEffectActivated',
            affectedCardIds: [sourceCard.id],
            source: 'StartEarthPeek',
            reason: 'activate-earth-peek',
            visibility: 'public',
            summary: `${activePlayer.name} activated Earth (♦) using ${sourceCard.label} (strength ${strength}) to inspect and reorder.`,
            payload: {
              element: 'earth',
              sourceCardId: sourceCard.id,
              strength,
              boardSlots: requestedBoardSlots,
              daysCount: effectiveDaysCount
            }
          })
        );
        newEvents.push(
          makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
            actor: activePlayer.id,
            type: 'CardMoved',
            affectedCardIds: [sourceCard.id],
            source: 'StartEarthPeek',
            reason: 'elemental-activation-cost',
            visibility: 'public',
            summary: `${sourceCard.label} consumed from ${activePlayer.name}'s hand into the Veil.`,
            payload: { from: 'hand', to: 'veil' }
          })
        );
      }

      const boardPeekIds = requestedBoardSlots.map((slot) =>
        slot === 'event' ? boardEvent[0]! : slot === 'center' ? boardCenter[0]! : boardParallel[0]!
      );
      const daysPeekIds = days.slice(0, effectiveDaysCount);
      const peekedCardIds = [...boardPeekIds, ...daysPeekIds];

      pendingEarthReorder = {
        playerId: activePlayer.id,
        sourceCommand,
        sourceCardId,
        bonusId,
        strength,
        boardSlots: requestedBoardSlots,
        daysCount: effectiveDaysCount,
        peekedCardIds,
        returnPhase: state.phase
      };
      phase = 'AWAITING_EARTH_REORDER';

      const scopeDesc =
        requestedBoardSlots.length > 0 && effectiveDaysCount > 0
          ? `${requestedBoardSlots.length} Board slot(s) + top ${effectiveDaysCount} of the Immediate Future`
          : requestedBoardSlots.length > 0
            ? `${requestedBoardSlots.length} Board slot(s)`
            : `top ${effectiveDaysCount} card${effectiveDaysCount === 1 ? '' : 's'} of the Immediate Future`;

      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
          actor: activePlayer.id,
          type: 'EarthPeekStarted',
          affectedCardIds: [],
          source: 'StartEarthPeek',
          reason: 'earth-private-peek',
          visibility: 'public',
          summary: `${activePlayer.name} privately inspected ${scopeDesc}.`,
          payload: { boardSlots: requestedBoardSlots, daysCount: effectiveDaysCount, strength }
        })
      );
      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
          actor: activePlayer.id,
          type: 'EarthPeekStarted',
          affectedCardIds: peekedCardIds,
          source: 'StartEarthPeek',
          reason: 'earth-private-peek-admin',
          visibility: 'admin_only',
          summary: `[Admin] ${activePlayer.name} peeked at ${scopeDesc}: ${peekedCardIds.map((id) => state.cards[id]!.label).join(', ')}.`,
          payload: { peekedCardIds, boardSlots: requestedBoardSlots, daysCount: effectiveDaysCount }
        })
      );
      break;
    }

    case 'CommitEarthReorder': {
      if (state.phase !== 'AWAITING_EARTH_REORDER' || !pendingEarthReorder) {
        return fail(state, command, {
          code: 'INVALID_PHASE',
          message: 'No active Earth reorder session to commit.'
        });
      }
      if (pendingEarthReorder.playerId !== command.playerId) {
        return fail(state, command, {
          code: 'NOT_ACTIVE_PLAYER',
          message: `Only ${pendingEarthReorder.playerId} can commit this Earth reorder.`
        });
      }

      const {
        boardSlots,
        daysCount,
        peekedCardIds,
        strength,
        sourceCommand,
        sourceCardId,
        bonusId,
        returnPhase
      } = pendingEarthReorder;

      if (command.moveTopToBottom && boardSlots.length === 0) {
        const moved = days.shift()!;
        days.push(moved);
        newEvents.push(
          makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
            actor: activePlayer.id,
            type: 'CardMoved',
            affectedCardIds: [],
            source: 'CommitEarthReorder',
            reason: 'earth-reposition-days-to-bottom',
            visibility: 'public',
            summary: `${activePlayer.name} deliberately moved the Next Upcoming card of Deck of Days to the bottom.`,
            payload: { from: 'days', to: 'days', placement: 'bottom', count: 1 }
          })
        );
        newEvents.push(
          makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
            actor: activePlayer.id,
            type: 'ElementalEffectResolved',
            affectedCardIds: [],
            source: sourceCommand,
            reason: 'earth-days_to_bottom',
            visibility: 'public',
            summary: `${activePlayer.name} resolved Earth (Reorder · strength ${strength}, moved Next Upcoming → bottom).`,
            payload: { element: 'earth', strength, mode: 'days_to_bottom', sourceCardId, bonusId }
          })
        );
      } else {
        const newOrder = command.newOrder ?? peekedCardIds;
        if (
          newOrder.length !== peekedCardIds.length ||
          new Set(newOrder).size !== peekedCardIds.length ||
          !peekedCardIds.every((id) => newOrder.includes(id))
        ) {
          return fail(state, command, {
            code: 'INVALID_REORDER_SPEC',
            message: 'Earth newOrder must be an exact permutation of the inspected cards.'
          });
        }

        const newBoardIds = newOrder.slice(0, boardSlots.length);
        const newDaysTop = newOrder.slice(boardSlots.length);

        boardSlots.forEach((slot, idx) => {
          const placedId = newBoardIds[idx]!;
          const placedMajor = isMajorCard(state.cards[placedId]);
          if (slot === 'event') {
            boardEvent = [placedId];
            eventRevealed = placedMajor;
          } else if (slot === 'parallel') {
            boardParallel = [placedId];
          } else {
            boardCenter = [placedId];
            centerRevealed = placedMajor;
            centerAbandoned = false;
            abandonedByPlayerId = null;
          }
        });
        // Keep majorPending strictly synced to cards still physically on the Board
        majorPending = majorPending.filter(
          (m) =>
            boardParallel.includes(m.cardId) ||
            boardEvent.includes(m.cardId) ||
            boardCenter.includes(m.cardId)
        );
        if (daysCount > 0) {
          days = [...newDaysTop, ...days.slice(daysCount)];
        }

        const modeLabel =
          boardSlots.length > 0 && daysCount > 0
            ? 'board_and_days_reorder'
            : boardSlots.length > 0
              ? 'board_reorder'
              : 'days_reorder';

        newEvents.push(
          makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
            actor: activePlayer.id,
            type: 'CardMoved',
            affectedCardIds: [],
            source: 'CommitEarthReorder',
            reason: `earth-${modeLabel}`,
            visibility: 'public',
            summary:
              boardSlots.length > 0 && daysCount > 0
                ? `${activePlayer.name} deliberately reordered ${boardSlots.length} Board slot(s) and top ${daysCount} card(s) of the Immediate Future.`
                : boardSlots.length > 0
                  ? `${activePlayer.name} deliberately reordered Board slots (${boardSlots.join(' ↔ ')}).`
                  : `${activePlayer.name} deliberately arranged the top ${daysCount} card${daysCount === 1 ? '' : 's'} of the Immediate Future.`,
            payload: { boardSlots, daysCount }
          })
        );
        newEvents.push(
          makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
            actor: activePlayer.id,
            type: 'CardMoved',
            affectedCardIds: newOrder,
            source: 'CommitEarthReorder',
            reason: `earth-${modeLabel}-admin`,
            visibility: 'admin_only',
            summary: `[Admin] Earth arranged ${modeLabel}: ${newOrder.map((id) => state.cards[id]!.label).join(' → ')}.`,
            payload: { newOrder, boardSlots, daysCount }
          })
        );
        newEvents.push(
          makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
            actor: activePlayer.id,
            type: 'ElementalEffectResolved',
            affectedCardIds: [],
            source: sourceCommand,
            reason: `earth-${modeLabel}`,
            visibility: 'public',
            summary: `${activePlayer.name} resolved Earth (Reorder · strength ${strength}, ${modeLabel}).`,
            payload: { element: 'earth', strength, mode: modeLabel, sourceCardId, bonusId }
          })
        );
      }

      pendingEarthReorder = null;
      if (!runComboCheck('CommitEarthReorder')) {
        if (returnPhase === 'AWAITING_ELEMENTAL_ACTION') {
          if (state.ruleset.elementalTiming === 'before_reading') {
            const currentActive = players[state.activePlayerIndex]!;
            const canContinuePrep = hasAnyLegalElementalAction({
              player: currentActive,
              cards: state.cards,
              turn,
              ruleset: state.ruleset,
              daysCount: days.length,
              veilCount: veil.length,
              boardOccupiedCount: boardEvent.length + boardCenter.length + boardParallel.length
            });
            if (!canContinuePrep) {
              enterReadingOrAbandonedPhase('CommitEarthReorder');
            } else {
              phase = 'AWAITING_ELEMENTAL_ACTION';
            }
          } else {
            phase = resolvePostEncounterPhase();
          }
        } else {
          phase = returnPhase;
        }
      }
      break;
    }

    case 'EndTurn': {
      if (state.phase === 'AWAITING_HAND_DISCARD') {
        return fail(state, command, {
          code: 'HAND_LIMIT_EXCEEDED',
          message: `Hand size (${activePlayer.hand.length}) exceeds maxHandSize (${state.ruleset.maxHandSize}); discard first.`
        });
      }
      const canEndFromElemental =
        state.phase === 'AWAITING_ELEMENTAL_ACTION' &&
        state.ruleset.elementalTiming === 'after_encounter';
      if (
        state.phase !== 'READY_TO_END_TURN' &&
        !canEndFromElemental &&
        !(state.phase === 'AWAITING_CENTER_DECISION' && boardCenter.length === 0)
      ) {
        return fail(state, command, {
          code: 'INVALID_PHASE',
          message: `Resolve the active step before ending the turn (current phase: ${state.phase}).`
        });
      }

      // Expire any unused Reader bonuses earned prior to this turn
      const afterExpiry = expireUnusedReaderBonuses({
        player: players[state.activePlayerIndex]!,
        currentTurn: turn,
        round,
        phase,
        ruleset: state.ruleset,
        newEvents,
        nextSeq
      });

      players[state.activePlayerIndex] = {
        ...afterExpiry,
        turnsTaken: afterExpiry.turnsTaken + 1,
        effectUsedThisTurn: false,
        elementalActionsUsedThisTurn: 0
      };

      // D0 Finding D: Optional provisional rotation of unused Left Event when Center was discarded
      if (
        state.ruleset.rotateEventOnCenterDiscard &&
        discardedCenterThisTurn &&
        boardEvent.length > 0 &&
        !eventRevealed
      ) {
        moveResolvedEventToVeil(
          'rotate-unused-event-on-center-discard',
          'Unused Left Event rotated to Veil after Center discard'
        );
      }
      discardedCenterThisTurn = false;

      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
          actor: activePlayer.id,
          type: 'TurnFinished',
          affectedCardIds: [],
          source: 'EndTurn',
          reason: 'turn-complete',
          visibility: 'public',
          summary: `${activePlayer.name} finished Turn ${turn}.`
        })
      );

      const immediateOutcome = evaluateCompletion(players, days, boardCenter, state.ruleset);
      if (immediateOutcome) {
        phase = 'GAME_OVER';
        currentReading = null;
        newEvents.push(
          makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
            actor: 'system',
            type: 'GameCompleted',
            affectedCardIds: [],
            source: 'EndTurn',
            reason: immediateOutcome.reason,
            visibility: 'public',
            summary: immediateOutcome.summary,
            payload: { ...immediateOutcome }
          })
        );
      } else {
        turn += 1;
        activePlayerIndex = (activePlayerIndex + 1) % players.length;
        if (activePlayerIndex === 0) {
          round += 1;
        }
        activePlayerId = players[activePlayerIndex]!.id;

        // Awaken any dormant Major Arcana whose dormancy expires on this turn
        if (state.ruleset.features.majors && majorPending.length > 0) {
          const mctx = makeMajorBoardCtx();
          activateReadyDormantMajors(mctx);
          syncFromMajorBoardCtx(mctx);
        }

        const endedByEventDraw = populateEventSlotFromDays('turn-refill');
        const preReadingElementalRequested =
          state.ruleset.features.elementalEffects &&
          state.ruleset.elementalTiming === 'before_reading';

        const computeNextTurnPreElemental = (): boolean =>
          preReadingElementalRequested &&
          hasAnyLegalElementalAction({
            player: players[activePlayerIndex]!,
            cards: state.cards,
            turn,
            ruleset: state.ruleset,
            daysCount: days.length,
            veilCount: veil.length,
            boardOccupiedCount:
              boardEvent.length + boardCenter.length + boardParallel.length + 1
          });

        if (!endedByEventDraw) {
          if (centerAbandoned && boardCenter.length > 0) {
            // Ensure all 3 Board positions are set FIRST before Elemental Prep!
            if (!populateParallelSlotFromDays('turn-refill')) {
              const canPrep =
                preReadingElementalRequested &&
                hasAnyLegalElementalAction({
                  player: players[activePlayerIndex]!,
                  cards: state.cards,
                  turn,
                  ruleset: state.ruleset,
                  daysCount: days.length,
                  veilCount: veil.length,
                  boardOccupiedCount:
                    boardEvent.length + boardCenter.length + boardParallel.length
                });
              phase = canPrep ? 'AWAITING_ELEMENTAL_ACTION' : 'AWAITING_ABANDONED_CHOICE';
              currentReading = null;
            }
          } else if (boardCenter.length === 0 && !state.ruleset.emptyChamberMode && boardParallel.length > 0 && !isMajorCard(state.cards[boardParallel[0]!])) {
            // Stage R1 (RD-15): Slide concealed Minor from Right chamber -> Center, then refill Right from Days!
            const slidId = boardParallel.shift()!;
            const slidCard = state.cards[slidId]!;
            boardCenter.push(slidId);
            centerRevealed = !state.ruleset.features.readings;
            const reader = players[(activePlayerIndex + 1) % players.length]!;
            const canPrep = computeNextTurnPreElemental();
            if (!state.ruleset.features.readings) {
              currentReading = null;
              phase = 'AWAITING_CENTER_DECISION';
            } else if (canPrep) {
              currentReading = null;
              phase = 'AWAITING_ELEMENTAL_ACTION';
            } else {
              currentReading = createReadingForTurn(
                players,
                activePlayerIndex,
                slidCard,
                turn,
                round,
                state.ruleset
              );
              phase = 'AWAITING_READING';
            }
            newEvents.push(
              makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
                actor: 'system',
                type: 'CardMoved',
                affectedCardIds: [],
                source: 'turn-refill',
                reason: 'slide-parallel-to-center',
                visibility: 'public',
                summary: canPrep
                  ? `Turn ${turn}: Right chamber card slid into Center (${slidCard.backGroup} back). Optional Elemental Prep open before Reading.`
                  : `Turn ${turn}: Right chamber card slid into Center (${slidCard.backGroup} back). Waiting for ${reader.name}'s reading.`,
                payload: { from: 'parallel', to: 'center', concealed: !centerRevealed }
              })
            );
            newEvents.push(
              makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
                actor: 'system',
                type: 'CardMoved',
                affectedCardIds: [slidId],
                source: 'turn-refill',
                reason: 'slide-parallel-to-center-admin',
                visibility: 'admin_only',
                summary: `[Admin] Turn ${turn} slid ${slidCard.label} from Right chamber to Center.`,
                payload: { from: 'parallel', to: 'center', cardId: slidId }
              })
            );
            populateParallelSlotFromDays('turn-refill');
          } else if (boardCenter.length === 0 && days.length > 0) {
            if (state.ruleset.features.readings) {
              const canPrep = computeNextTurnPreElemental();
              if (!dealFreshConcealedCenterForReading('turn-refill', canPrep)) {
                populateParallelSlotFromDays('turn-refill');
              }
            } else {
              const nextCenterId = days.shift()!;
              boardCenter.push(nextCenterId);
              centerRevealed = true;
              currentReading = null;
              phase = 'AWAITING_CENTER_DECISION';
              newEvents.push(
                makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
                  actor: 'system',
                  type: 'CardMoved',
                  affectedCardIds: [nextCenterId],
                  source: 'turn-refill',
                  reason: 'populate-center',
                  visibility: 'public',
                  summary: `Turn ${turn} Center revealed: ${state.cards[nextCenterId]!.label}.`,
                  payload: { from: 'days', to: 'center' }
                })
              );
              populateParallelSlotFromDays('turn-refill');
            }
          } else {
            const postOutcome = evaluateCompletion(players, days, boardCenter, state.ruleset);
            if (postOutcome) {
              phase = 'GAME_OVER';
              currentReading = null;
              newEvents.push(
                makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
                  actor: 'system',
                  type: 'GameCompleted',
                  affectedCardIds: [],
                  source: 'EndTurn',
                  reason: postOutcome.reason,
                  visibility: 'public',
                  summary: postOutcome.summary,
                  payload: { ...postOutcome }
                })
              );
            } else {
              phase = 'READY_TO_END_TURN';
            }
          }
        }

        if (phase !== 'GAME_OVER') {
          newEvents.push(
            makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
              actor: activePlayerId,
              type: 'TurnStarted',
              affectedCardIds: [],
              source: 'turn-cycle',
              reason: 'turn-begin',
              visibility: 'public',
              summary: `Round ${round}, Turn ${turn} — ${players[activePlayerIndex]!.name}'s turn.`
            })
          );
        }
      }
      break;
    }

    default: {
      return fail(state, command, {
        code: 'FEATURE_DISABLED',
        message: `Command "${command.type}" is not active in this ruleset.`
      });
    }
  }

  let outcome: GameOutcome | undefined = comboOutcome ?? state.outcome;
  if (phase !== 'GAME_OVER') {
    const midOutcome = evaluateCompletion(players, days, boardCenter, state.ruleset);
    if (midOutcome && midOutcome.reason === 'target_rank_reached') {
      outcome = midOutcome;
      phase = 'GAME_OVER';
      currentReading = null;
      newEvents.push(
        makeEvent(nextSeq(), turn, round, 'GAME_OVER', state.ruleset.version, {
          actor: 'system',
          type: 'GameCompleted',
          affectedCardIds: [],
          source: command.type,
          reason: midOutcome.reason,
          visibility: 'public',
          summary: midOutcome.summary,
          payload: { ...midOutcome }
        })
      );
    }
  } else {
    outcome = comboOutcome ?? evaluateCompletion(players, days, boardCenter, state.ruleset);
  }

  const allEvents = [...state.events, ...newEvents];
  const draftState: Omit<GameState, 'stateHash'> = {
    ...state,
    rngState,
    phase,
    round,
    turn,
    activePlayerIndex,
    activePlayerId,
    days,
    veil,
    board: {
      event: boardEvent,
      center: boardCenter,
      parallel: boardParallel
    },
    eventRevealed,
    centerRevealed,
    centerAbandoned,
    abandonedByPlayerId,
    discardedCenterThisTurn,
    currentReading,
    readingHistory,
    pendingEarthReorder,
    majorPending,
    players,
    status: outcome ? 'completed' : 'playing',
    outcome,
    events: allEvents,
    commandHistory: state.commandHistory
  };

  const stateHashAfter = computeStateHash(draftState);
  const commandRecord: CommandRecord = {
    index: state.commandHistory.length,
    command,
    stateHashBefore,
    stateHashAfter,
    eventSeqStart,
    eventSeqEnd: allEvents.length
  };

  const nextState: GameState = finalizeState({
    ...draftState,
    commandHistory: [...state.commandHistory, commandRecord]
  });

  return {
    ok: true,
    state: nextState,
    events: newEvents,
    commandRecord
  };
}

export interface ReplayStepSnapshot {
  readonly stepIndex: number;
  readonly command?: Command;
  readonly state: GameState;
  readonly stateHash: string;
}

export interface ReplayResult {
  readonly ok: boolean;
  readonly initialState: GameState;
  readonly finalState: GameState;
  readonly snapshots: readonly ReplayStepSnapshot[];
  readonly error?: ValidationError;
  readonly failedAtCommandIndex?: number;
}

export function replay(
  seed: string,
  ruleset: Ruleset,
  commands: readonly Command[],
  options: CreateGameOptions = {}
): ReplayResult {
  const initialState = createGame(ruleset, seed, options);
  const snapshots: ReplayStepSnapshot[] = [
    {
      stepIndex: 0,
      state: initialState,
      stateHash: initialState.stateHash
    }
  ];

  let current = initialState;
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!;
    const result = dispatch(current, cmd);
    if (!result.ok) {
      return {
        ok: false,
        initialState,
        finalState: current,
        snapshots,
        error: result.error,
        failedAtCommandIndex: i
      };
    }
    current = result.state;
    snapshots.push({
      stepIndex: i + 1,
      command: cmd,
      state: current,
      stateHash: current.stateHash
    });
  }

  return {
    ok: true,
    initialState,
    finalState: current,
    snapshots
  };
}
