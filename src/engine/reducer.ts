import {
  expireUnusedReaderBonuses,
  getAvailableReaderBonusesForTurn,
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
  computeReadingHints,
  createReadingForTurn,
  finalizeReadingReward,
  isCardObjectivelyHelpful
} from './readings.js';
import { evaluateReconciliation, eventCardToReality } from './reconciliation.js';
import { createGame } from './setup.js';
import type {
  Card,
  Command,
  CommandRecord,
  CreateGameOptions,
  DispatchResult,
  GameEvent,
  GameOutcome,
  GamePhase,
  GameState,
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
  const boardParallel = [...state.board.parallel];
  let eventRevealed = state.eventRevealed;
  let centerRevealed = state.centerRevealed;
  let centerAbandoned = state.centerAbandoned;
  let abandonedByPlayerId = state.abandonedByPlayerId;
  let discardedCenterThisTurn = state.discardedCenterThisTurn;
  let rngState = state.rngState;
  let currentReading: ReadingRecord | null = state.currentReading ? { ...state.currentReading } : null;
  const readingHistory: ReadingRecord[] = [...state.readingHistory];
  let phase: GamePhase = state.phase;
  let turn = state.turn;
  let round = state.round;
  let activePlayerIndex = state.activePlayerIndex;
  let activePlayerId = state.activePlayerId;

  const activePlayer = players[state.activePlayerIndex]!;

  const resolvePostEncounterPhase = (): GamePhase => {
    const currentActive = players[state.activePlayerIndex]!;
    if (currentActive.hand.length > state.ruleset.maxHandSize) {
      return 'AWAITING_HAND_DISCARD';
    }
    if (state.ruleset.features.elementalEffects) {
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
    const evId = boardEvent.shift()!;
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

  const dealFreshConcealedCenterForReading = (sourceName: string): void => {
    if (days.length === 0 || state.ruleset.boardOccupancyLimits.center < 1) {
      phase = 'READY_TO_END_TURN';
      return;
    }
    const nextCenterId = days.shift()!;
    const nextCenterCard = state.cards[nextCenterId]!;
    boardCenter.push(nextCenterId);
    centerRevealed = false;
    currentReading = createReadingForTurn(
      players,
      activePlayerIndex,
      nextCenterCard,
      turn,
      round,
      state.ruleset
    );
    const reader = players[(activePlayerIndex + 1) % players.length]!;
    phase = 'AWAITING_READING';

    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
        actor: 'system',
        type: 'CardMoved',
        affectedCardIds: [],
        source: sourceName,
        reason: 'populate-center-concealed',
        visibility: 'public',
        summary: `Turn ${turn} concealed card placed in Center (${nextCenterCard.backGroup} back). Waiting for ${reader.name}'s reading.`,
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
      discardedCenterThisTurn = true;
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
          summary: `${activePlayer.name} chose to DISCARD Center → ${discardedCard.label} revealed in the Veil (advice was "${updatedReading.advice?.toUpperCase()}", ${updatedReading.adviceTruthful ? 'truthful' : 'deceptive'}).`,
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
      phase = resolvePostEncounterPhase();
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

    case 'UseElementalEffect': {
      const ctx = makeElementalContext();
      const res = validateAndExecuteElementalEffect(ctx, command);
      if (!res.ok) {
        return fail(state, command, res.error);
      }
      syncFromElementalContext(ctx);
      phase = resolvePostEncounterPhase();
      break;
    }

    case 'UseReaderBonus': {
      const ctx = makeElementalContext();
      const res = validateAndExecuteReaderBonus(ctx, command);
      if (!res.ok) {
        return fail(state, command, res.error);
      }
      syncFromElementalContext(ctx);
      phase = resolvePostEncounterPhase();
      break;
    }

    case 'EndTurn': {
      if (state.phase === 'AWAITING_HAND_DISCARD') {
        return fail(state, command, {
          code: 'HAND_LIMIT_EXCEEDED',
          message: `Hand size (${activePlayer.hand.length}) exceeds maxHandSize (${state.ruleset.maxHandSize}); discard first.`
        });
      }
      if (
        state.phase !== 'READY_TO_END_TURN' &&
        state.phase !== 'AWAITING_ELEMENTAL_ACTION' &&
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
        effectUsedThisTurn: false
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

        if (
          state.ruleset.features.barriersAndTrials &&
          boardEvent.length === 0 &&
          days.length > 0 &&
          state.ruleset.boardOccupancyLimits.event >= 1
        ) {
          const nextEventId = days.shift()!;
          const nextEventCard = state.cards[nextEventId]!;
          boardEvent.push(nextEventId);
          eventRevealed = false;
          newEvents.push(
            makeEvent(nextSeq(), turn, round, 'AWAITING_READING', state.ruleset.version, {
              actor: 'system',
              type: 'CardMoved',
              affectedCardIds: [],
              source: 'turn-refill',
              reason: 'populate-event-concealed',
              visibility: 'public',
              summary: `Turn ${turn} Event card placed face-down in Left slot (${nextEventCard.backGroup} back).`,
              payload: { from: 'days', to: 'event', concealed: true }
            })
          );
          newEvents.push(
            makeEvent(nextSeq(), turn, round, 'AWAITING_READING', state.ruleset.version, {
              actor: 'system',
              type: 'CardMoved',
              affectedCardIds: [nextEventId],
              source: 'turn-refill',
              reason: 'populate-event-admin-detail',
              visibility: 'admin_only',
              summary: `[Admin] Turn ${turn} concealed Left Event is ${nextEventCard.label} (${eventCardToReality(nextEventCard)}, ${nextEventCard.vp} VP).`,
              payload: { from: 'days', to: 'event', cardId: nextEventId }
            })
          );
        }

        if (centerAbandoned && boardCenter.length > 0) {
          phase = 'AWAITING_ABANDONED_CHOICE';
          currentReading = null;
        } else if (boardCenter.length === 0 && days.length > 0) {
          if (state.ruleset.features.readings) {
            dealFreshConcealedCenterForReading('turn-refill');
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

  let outcome: GameOutcome | undefined = state.outcome;
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
    outcome = evaluateCompletion(players, days, boardCenter, state.ruleset);
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
