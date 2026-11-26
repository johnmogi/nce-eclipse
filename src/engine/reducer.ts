import { buildCardCatalog, ELEMENTS } from './cards.js';
import { isEligibleEvolution, resolveMandatoryEvolutionChain } from './evolution.js';
import { computeStateHash } from './hash.js';
import { assertInvariants } from './invariants.js';
import { evaluateReconciliation, eventCardToReality } from './reconciliation.js';
import { deterministicShuffle, seedToUint32 } from './rng.js';
import { ENGINE_VERSION } from './rulesets.js';
import type {
  Card,
  Command,
  CommandRecord,
  CreateGameOptions,
  DispatchResult,
  Element,
  EventVisibility,
  GameEvent,
  GameEventType,
  GameOutcome,
  GamePhase,
  GameState,
  PlayerState,
  ReadingHints,
  ReadingRecord,
  Ruleset,
  ValidationError
} from './types.js';

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
  UseElementalEffect: { flag: 'elementalEffects', label: 'Elemental Hand Effects (Milestone D)' },
  ProposeTrade: { flag: 'tradingMarket', label: 'Trading Market (Milestone D)' },
  AcceptTrade: { flag: 'tradingMarket', label: 'Trading Market (Milestone D)' },
  ChooseMajorExit: { flag: 'majors', label: 'Major Arcana Contention (Milestone E)' },
  ResolveEntropy: { flag: 'moonSunCycle', label: 'Moon/Sun Entropy Cycle (Milestone F)' }
};

function makeEvent(
  seq: number,
  turn: number,
  round: number,
  phase: GamePhase,
  rulesetVersion: string,
  params: {
    actor: string;
    type: GameEventType;
    affectedCardIds: readonly string[];
    source: string;
    reason: string;
    visibility: EventVisibility;
    summary: string;
    payload?: Readonly<Record<string, unknown>>;
  }
): GameEvent {
  return {
    seq,
    turn,
    round,
    phase,
    rulesetVersion,
    ...params
  };
}

function finalizeState(draft: Omit<GameState, 'stateHash'>): GameState {
  const stateHash = computeStateHash(draft);
  const fullState: GameState = { ...draft, stateHash };
  assertInvariants(fullState);
  return fullState;
}

function fail(state: GameState, command: Command, error: ValidationError): DispatchResult {
  const nextSeq = state.events.length + 1;
  const rejectionEvent = makeEvent(
    nextSeq,
    state.turn,
    state.round,
    state.phase,
    state.ruleset.version,
    {
      actor: command.playerId,
      type: 'CommandRejected',
      affectedCardIds: [],
      source: command.type,
      reason: error.code,
      visibility: 'public',
      summary: `Rejected ${command.type} by ${command.playerId}: ${error.message}`,
      payload: { code: error.code, details: error.details ?? null }
    }
  );

  const nextState: GameState = {
    ...state,
    rejectedCommands: [...state.rejectedCommands, { atTurn: state.turn, command, error }],
    events: [...state.events, rejectionEvent]
  };

  return { ok: false, state: nextState, error };
}

export function isCardObjectivelyHelpful(
  recipient: PlayerState,
  card: Card,
  ruleset: Ruleset
): boolean {
  if (isEligibleEvolution(recipient.lineage, card, ruleset)) return true;
  if (card.family !== 'classic-number' || !card.color || !card.element) return false;
  if (card.rank <= recipient.lineage.rank) return false;
  if (ruleset.allowedEvolutionColors === 'same-element') {
    return card.element === recipient.lineage.element;
  }
  if (ruleset.allowedEvolutionColors === 'same-color') {
    return card.color === recipient.lineage.color;
  }
  return true;
}

function computeReadingHints(
  recipient: PlayerState,
  centerCard: Card,
  ruleset: Ruleset
): ReadingHints | null {
  if (!ruleset.readingTierHintsEnabled) return null;
  if (recipient.lineage.rank <= 3) return null;
  if (recipient.lineage.rank <= 6) {
    return { color: centerCard.color };
  }
  return { color: centerCard.color, tier: centerCard.tier };
}

function createReadingForTurn(
  players: readonly PlayerState[],
  activePlayerIndex: number,
  centerCard: Card,
  turn: number,
  round: number,
  ruleset: Ruleset
): ReadingRecord {
  const recipient = players[activePlayerIndex]!;
  const reader = players[(activePlayerIndex + 1) % players.length]!;
  return {
    turn,
    round,
    readerId: reader.id,
    recipientId: recipient.id,
    centerCardId: centerCard.id,
    advice: null,
    hints: null,
    playerAction: null,
    adviceFollowed: null,
    objectiveHelpful: isCardObjectivelyHelpful(recipient, centerCard, ruleset),
    adviceTruthful: null,
    resolution: 'pending',
    readerReward: 'pending',
    readerRewardReason: null
  };
}

function evaluateCompletion(
  players: readonly PlayerState[],
  days: readonly string[],
  center: readonly string[],
  ruleset: Ruleset
): GameOutcome | undefined {
  if (ruleset.stopOnTargetRank && ruleset.l11TargetRank > 0) {
    const reached = players.filter((p) => p.lineage.rank >= ruleset.l11TargetRank);
    if (reached.length > 0) {
      const highestRank = Math.max(...players.map((p) => p.lineage.rank));
      const winners = players.filter((p) => p.lineage.rank === highestRank).map((p) => p.id);
      return {
        reason: 'target_rank_reached',
        winnerIds: winners,
        highestRank,
        summary: `Target rank ${ruleset.l11TargetRank} reached by ${winners.join(', ')}.`
      };
    }
  }

  if (days.length === 0 && center.length === 0) {
    const highestRank = Math.max(...players.map((p) => p.lineage.rank));
    const winners = players.filter((p) => p.lineage.rank === highestRank).map((p) => p.id);
    return {
      reason: 'days_exhausted',
      winnerIds: winners,
      highestRank,
      summary: `Deck of Days exhausted. Winner of the day (Rank ${highestRank}): ${winners.join(', ')}.`
    };
  }

  return undefined;
}

function applyEvolutionWithEvents(
  player: PlayerState,
  cards: Readonly<Record<string, Card>>,
  ruleset: Ruleset,
  context: {
    turn: number;
    round: number;
    phase: GamePhase;
    source: string;
    nextSeq: () => number;
  }
): { player: PlayerState; events: GameEvent[] } {
  const res = resolveMandatoryEvolutionChain(player, cards, ruleset);
  if (res.steps.length === 0) {
    return { player, events: [] };
  }

  const events: GameEvent[] = [];
  for (const step of res.steps) {
    events.push(
      makeEvent(context.nextSeq(), context.turn, context.round, context.phase, ruleset.version, {
        actor: player.id,
        type: 'LineageEvolved',
        affectedCardIds: [step.toCard.id],
        source: context.source,
        reason: step.matchReason,
        visibility: 'public',
        summary: `${player.name}: ${step.fromCard.label} evolves to ${step.toCard.label} (${step.matchReason}).`,
        payload: {
          fromCardId: step.fromCard.id,
          toCardId: step.toCard.id,
          fromRank: step.fromCard.rank,
          toRank: step.toCard.rank,
          rankDelta: step.rankDelta,
          tieBreakPolicy: ruleset.evolutionTieBreak,
          tieBreakApplied: step.tieBreakApplied,
          competingCandidateIds: step.competingCandidateIds
        }
      })
    );
  }

  if (res.steps.length > 1) {
    events.push(
      makeEvent(context.nextSeq(), context.turn, context.round, context.phase, ruleset.version, {
        actor: player.id,
        type: 'EvolutionChainCompleted',
        affectedCardIds: res.steps.map((s) => s.toCard.id),
        source: context.source,
        reason: 'mandatory-chain',
        visibility: 'public',
        summary: `${player.name} completed a ${res.steps.length}-step evolution chain up to Rank ${res.player.lineage.rank} (${cards[res.player.lineage.cardIds[res.player.lineage.cardIds.length - 1]!]!.label}).`,
        payload: {
          chainLength: res.steps.length,
          finalRank: res.player.lineage.rank
        }
      })
    );
  }

  return { player: res.player, events };
}

/**
 * Pure deterministic game initializer.
 * Supports optional deterministic card-placement overrides for worked GDD acceptance scenarios (S1–S6).
 */
export function createGame(
  ruleset: Ruleset,
  seed: string,
  options: CreateGameOptions = {}
): GameState {
  if (ruleset.playerCount < 2 || ruleset.playerCount > 4) {
    throw new Error(`Unsupported playerCount ${ruleset.playerCount}; expected 2..4`);
  }

  const catalog = buildCardCatalog(ruleset);
  const allCardIds = Object.keys(catalog).sort();
  let rngState = seedToUint32(`${ruleset.id}:${ruleset.version}:${seed}`);

  const chosenElements: Element[] = options.startingElements
    ? [...options.startingElements]
    : [...ELEMENTS.slice(0, ruleset.playerCount)];

  if (chosenElements.length !== ruleset.playerCount) {
    throw new Error(`startingElements length must equal ruleset.playerCount (${ruleset.playerCount})`);
  }
  if (new Set(chosenElements).size !== chosenElements.length) {
    throw new Error('Starting elements must be distinct per player');
  }

  const assignedAceIds = new Set<string>();
  const players: PlayerState[] = [];

  for (let i = 0; i < ruleset.playerCount; i++) {
    const element = chosenElements[i]!;
    const aceId = `classic-${element}-01`;
    const aceCard = catalog[aceId];
    if (!aceCard || !aceCard.color) {
      throw new Error(`Missing starting Ace "${aceId}" in card catalog`);
    }
    assignedAceIds.add(aceId);
    const id = `p${i + 1}`;
    const name = options.playerNames?.[i] ?? `Player ${i + 1}`;
    players.push({
      id,
      name,
      primaryElement: element,
      lineage: {
        rank: 1,
        element,
        color: aceCard.color,
        cardIds: [aceId]
      },
      hand: [],
      eclipseCount: 0,
      effectUsedThisTurn: false,
      pendingReaderBonuses: [],
      evolutionsCompleted: 0,
      maxChainLength: 0,
      turnsTaken: 0
    });
  }

  // Reserve and overridden cards handling
  const overriddenSet = new Set<string>();
  if (options.overrideHands) {
    for (const hand of options.overrideHands) {
      for (const id of hand) {
        if (!catalog[id]) throw new Error(`Unknown override hand card "${id}"`);
        if (assignedAceIds.has(id) || overriddenSet.has(id)) {
          throw new Error(`Duplicate override card "${id}"`);
        }
        overriddenSet.add(id);
      }
    }
  }
  if (options.overrideDaysTop) {
    for (const id of options.overrideDaysTop) {
      if (!catalog[id]) throw new Error(`Unknown override Days card "${id}"`);
      if (assignedAceIds.has(id) || overriddenSet.has(id)) {
        throw new Error(`Duplicate override card "${id}"`);
      }
      overriddenSet.add(id);
    }
  }

  const reserve: string[] = [];
  const poolToShuffle: string[] = [];

  for (const id of allCardIds) {
    if (assignedAceIds.has(id) || overriddenSet.has(id)) continue;
    const card = catalog[id]!;
    if (card.rank === 1 && !ruleset.unusedAcesInDeck) {
      reserve.push(id);
    } else {
      poolToShuffle.push(id);
    }
  }

  const shuffled = deterministicShuffle(poolToShuffle, rngState);
  rngState = shuffled.nextState;
  const days = [...(options.overrideDaysTop ?? []), ...shuffled.shuffled];

  let seqCounter = 0;
  const nextSeq = (): number => {
    seqCounter += 1;
    return seqCounter;
  };

  const initialOpenPhase: GamePhase = ruleset.features.readings
    ? 'AWAITING_READING'
    : 'AWAITING_CENTER_DECISION';

  const events: GameEvent[] = [
    makeEvent(nextSeq(), 1, 1, initialOpenPhase, ruleset.version, {
      actor: 'system',
      type: 'GameCreated',
      affectedCardIds: [],
      source: 'createGame',
      reason: 'setup',
      visibility: 'public',
      summary: `Started ${ruleset.name} (v${ruleset.version}) with seed "${seed}".`,
      payload: { rulesetId: ruleset.id, rulesetVersion: ruleset.version, seed }
    })
  ];

  // Deal starting hands (override or drawn from Days)
  for (let i = 0; i < players.length; i++) {
    const dealt: string[] = [];
    if (options.overrideHands?.[i]) {
      dealt.push(...options.overrideHands[i]!);
    } else {
      for (let c = 0; c < ruleset.startingHandSize && days.length > 0; c++) {
        dealt.push(days.shift()!);
      }
    }
    players[i] = { ...players[i]!, hand: dealt };

    if (dealt.length > 0) {
      events.push(
        makeEvent(nextSeq(), 1, 1, initialOpenPhase, ruleset.version, {
          actor: players[i]!.id,
          type: 'CardMoved',
          affectedCardIds: dealt,
          source: 'setup-deal',
          reason: 'starting-hand',
          visibility: 'private_to_actor',
          summary: `${players[i]!.name} received starting hand: ${dealt.map((id) => catalog[id]!.label).join(', ')}.`,
          payload: { from: 'days', to: 'hand', count: dealt.length }
        })
      );
    }
  }

  // Enforce mandatory personal evolution immediately on initial hands
  for (let i = 0; i < players.length; i++) {
    const evo = applyEvolutionWithEvents(players[i]!, catalog, ruleset, {
      turn: 1,
      round: 1,
      phase: initialOpenPhase,
      source: 'setup-deal',
      nextSeq
    });
    players[i] = evo.player;
    events.push(...evo.events);
  }

  // Populate Turn 1 Board: Left Event (concealed until Center pursued) + Center (concealed for Reading)
  const boardEvent: string[] = [];
  let eventRevealed = false;
  if (ruleset.features.barriersAndTrials && days.length > 0 && ruleset.boardOccupancyLimits.event >= 1) {
    const firstEventId = days.shift()!;
    const firstEventCard = catalog[firstEventId]!;
    boardEvent.push(firstEventId);
    eventRevealed = false;

    events.push(
      makeEvent(nextSeq(), 1, 1, initialOpenPhase, ruleset.version, {
        actor: 'system',
        type: 'CardMoved',
        affectedCardIds: [],
        source: 'turn-setup',
        reason: 'populate-event-concealed',
        visibility: 'public',
        summary: `Turn 1 Event card placed face-down in Left slot (${firstEventCard.backGroup} back).`,
        payload: { from: 'days', to: 'event', concealed: true }
      })
    );
    events.push(
      makeEvent(nextSeq(), 1, 1, initialOpenPhase, ruleset.version, {
        actor: 'system',
        type: 'CardMoved',
        affectedCardIds: [firstEventId],
        source: 'turn-setup',
        reason: 'populate-event-admin-detail',
        visibility: 'admin_only',
        summary: `[Admin] Turn 1 concealed Left Event is ${firstEventCard.label} (${eventCardToReality(firstEventCard)}, ${firstEventCard.vp} VP).`,
        payload: { from: 'days', to: 'event', cardId: firstEventId }
      })
    );
  }

  const boardCenter: string[] = [];
  let centerRevealed = !ruleset.features.readings;
  let currentReading: ReadingRecord | null = null;

  if (days.length > 0 && ruleset.boardOccupancyLimits.center >= 1) {
    const firstCenterId = days.shift()!;
    const firstCenterCard = catalog[firstCenterId]!;
    boardCenter.push(firstCenterId);

    if (ruleset.features.readings) {
      centerRevealed = false;
      currentReading = createReadingForTurn(players, 0, firstCenterCard, 1, 1, ruleset);
      events.push(
        makeEvent(nextSeq(), 1, 1, 'AWAITING_READING', ruleset.version, {
          actor: 'system',
          type: 'CardMoved',
          affectedCardIds: [],
          source: 'turn-setup',
          reason: 'populate-center-concealed',
          visibility: 'public',
          summary: `Turn 1 concealed card placed in Center (${firstCenterCard.backGroup} back). Waiting for ${players[1]!.name}'s reading.`,
          payload: { from: 'days', to: 'center', concealed: true, backGroup: firstCenterCard.backGroup }
        })
      );
      events.push(
        makeEvent(nextSeq(), 1, 1, 'AWAITING_READING', ruleset.version, {
          actor: 'system',
          type: 'CardMoved',
          affectedCardIds: [firstCenterId],
          source: 'turn-setup',
          reason: 'populate-center-admin-detail',
          visibility: 'admin_only',
          summary: `[Admin] Turn 1 concealed Center card is ${firstCenterCard.label}.`,
          payload: { from: 'days', to: 'center', cardId: firstCenterId }
        })
      );
    } else {
      centerRevealed = true;
      events.push(
        makeEvent(nextSeq(), 1, 1, 'AWAITING_CENTER_DECISION', ruleset.version, {
          actor: 'system',
          type: 'CardMoved',
          affectedCardIds: [firstCenterId],
          source: 'turn-setup',
          reason: 'populate-center',
          visibility: 'public',
          summary: `Turn 1 Center revealed: ${firstCenterCard.label}.`,
          payload: { from: 'days', to: 'center' }
        })
      );
    }
  }

  const outcome = evaluateCompletion(players, days, boardCenter, ruleset);
  const phase: GamePhase = outcome
    ? 'GAME_OVER'
    : boardCenter.length === 0
      ? 'READY_TO_END_TURN'
      : ruleset.features.readings
        ? 'AWAITING_READING'
        : 'AWAITING_CENTER_DECISION';

  if (outcome) {
    currentReading = null;
    events.push(
      makeEvent(nextSeq(), 1, 1, 'GAME_OVER', ruleset.version, {
        actor: 'system',
        type: 'GameCompleted',
        affectedCardIds: [],
        source: 'setup-completion',
        reason: outcome.reason,
        visibility: 'public',
        summary: outcome.summary,
        payload: { ...outcome }
      })
    );
  } else {
    events.push(
      makeEvent(nextSeq(), 1, 1, phase, ruleset.version, {
        actor: players[0]!.id,
        type: 'TurnStarted',
        affectedCardIds: [],
        source: 'turn-cycle',
        reason: 'turn-begin',
        visibility: 'public',
        summary: `Round 1, Turn 1 — ${players[0]!.name}'s turn.`
      })
    );
  }

  return finalizeState({
    engineVersion: ENGINE_VERSION,
    ruleset,
    seed,
    rngState,
    cards: catalog,
    deckCardIds: allCardIds,
    phase,
    round: 1,
    turn: 1,
    activePlayerIndex: 0,
    activePlayerId: players[0]!.id,
    days,
    veil: [],
    reserve,
    board: { event: boardEvent, center: boardCenter, parallel: [] },
    eventRevealed,
    centerRevealed,
    centerAbandoned: false,
    abandonedByPlayerId: null,
    currentReading,
    readingHistory: [],
    majorPending: [],
    players,
    activeEffects: [],
    connections: [],
    entropy: { active: false, cycleIndex: 0 },
    status: outcome ? 'completed' : 'playing',
    outcome,
    commandHistory: [],
    rejectedCommands: [],
    events
  });
}

/**
 * Pure deterministic command dispatcher implementing Milestones A + B + C.
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
  const days = [...state.days];
  const veil = [...state.veil];
  const boardEvent = [...state.board.event];
  const boardCenter = [...state.board.center];
  const boardParallel = [...state.board.parallel];
  let eventRevealed = state.eventRevealed;
  let centerRevealed = state.centerRevealed;
  let centerAbandoned = state.centerAbandoned;
  let abandonedByPlayerId = state.abandonedByPlayerId;
  let currentReading: ReadingRecord | null = state.currentReading ? { ...state.currentReading } : null;
  const readingHistory: ReadingRecord[] = [...state.readingHistory];
  let phase: GamePhase = state.phase;
  let turn = state.turn;
  let round = state.round;
  let activePlayerIndex = state.activePlayerIndex;
  let activePlayerId = state.activePlayerId;

  const activePlayer = players[state.activePlayerIndex]!;

  const finalizeReadingReward = (
    reading: ReadingRecord,
    resolution: 'claimed' | 'discarded' | 'abandoned',
    sourceCard: Card
  ): void => {
    const readerIdx = players.findIndex((p) => p.id === reading.readerId);
    const reader = readerIdx >= 0 ? players[readerIdx]! : null;

    let grant = false;
    let trigger: 'good_claimed' | 'bad_discarded' | 'good_abandoned' | null = null;
    let reason = 'advice_not_followed';

    if (reading.adviceFollowed) {
      if (reading.advice === 'bad' && resolution === 'discarded') {
        grant = true;
        trigger = 'bad_discarded';
        reason = 'followed_bad_advice_discarded';
      } else if (reading.advice === 'good' && resolution === 'claimed') {
        grant = true;
        trigger = 'good_claimed';
        reason = 'followed_good_advice_claimed';
      } else if (reading.advice === 'good' && resolution === 'abandoned') {
        if (state.ruleset.readerBonusOnAbandon) {
          grant = true;
          trigger = 'good_abandoned';
          reason = 'followed_good_advice_abandoned_override';
        } else {
          grant = false;
          reason = 'abandoned_before_claim';
        }
      }
    }

    const completedRecord: ReadingRecord = {
      ...reading,
      resolution,
      readerReward: grant ? 'granted' : 'withheld',
      readerRewardReason: reason
    };
    readingHistory.push(completedRecord);

    if (grant && reader && trigger) {
      const bonus = {
        id: `rb-t${turn}-${reader.pendingReaderBonuses.length + 1}`,
        earnedOnTurn: turn,
        fromPlayerId: activePlayer.id,
        sourceCardId: sourceCard.id,
        sourceElement: sourceCard.element,
        trigger,
        status: 'pending_spec' as const
      };
      players[readerIdx] = {
        ...reader,
        pendingReaderBonuses: [...reader.pendingReaderBonuses, bonus]
      };
      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
          actor: reader.id,
          type: 'ReaderRewardGranted',
          affectedCardIds: [sourceCard.id],
          source: 'reading-resolution',
          reason,
          visibility: 'public',
          summary: `${reader.name} earned a pending Reader elemental bonus (${sourceCard.element ?? 'neutral'} from ${sourceCard.label}; ${reason}).`,
          payload: { ...bonus, adviceTruthful: completedRecord.adviceTruthful }
        })
      );
    } else if (reader) {
      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, state.ruleset.version, {
          actor: reader.id,
          type: 'ReaderRewardWithheld',
          affectedCardIds: [sourceCard.id],
          source: 'reading-resolution',
          reason,
          visibility: 'public',
          summary: `${reader.name}'s Reader bonus was withheld (${reason}).`,
          payload: {
            readerId: reader.id,
            advice: completedRecord.advice,
            playerAction: completedRecord.playerAction,
            resolution,
            adviceFollowed: completedRecord.adviceFollowed,
            adviceTruthful: completedRecord.adviceTruthful
          }
        })
      );
    }
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

  const moveResolvedEventToVeil = (reason: string): void => {
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
        summary: `Resolved Left Event (${state.cards[evId]!.label}) moved to the Veil.`,
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

      const postHand = players[state.activePlayerIndex]!.hand;
      phase =
        postHand.length > state.ruleset.maxHandSize ? 'AWAITING_HAND_DISCARD' : 'READY_TO_END_TURN';
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
        phase = 'READY_TO_END_TURN';
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

      // If Event Realities (Milestone C) are enabled and an Event card exists, reveal Left Event!
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
        // Tutorial 1.2 (no Event realities) OR Days exhausted so no Event card left -> frictionless claim
        claimCenterAndEvolve('PursueCenter');
        finalizeReadingReward(currentReading, 'claimed', centerCard);
        currentReading = null;

        const postHand = players[state.activePlayerIndex]!.hand;
        phase =
          postHand.length > state.ruleset.maxHandSize ? 'AWAITING_HAND_DISCARD' : 'READY_TO_END_TURN';
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

      finalizeReadingReward(updatedReading, 'discarded', discardedCard);
      currentReading = null;
      phase = 'READY_TO_END_TURN';
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

      // Validate sacrificed card IDs belong uniquely to activePlayer's hand
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

      // Move sacrificed cards to Veil (provisional test preset)
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

      // Claim Center & run mandatory chained evolution!
      claimCenterAndEvolve('ResolveEvent');

      // Finalize Reading Reward (GOOD + PURSUE + CLAIM grants bonus!)
      if (currentReading) {
        finalizeReadingReward(currentReading, 'claimed', centerCard);
        currentReading = null;
      }

      // Cleanup Left Event to Veil
      moveResolvedEventToVeil(`event-${breakdown.reality}-resolved`);

      const postHand = players[state.activePlayerIndex]!.hand;
      phase =
        postHand.length > state.ruleset.maxHandSize ? 'AWAITING_HAND_DISCARD' : 'READY_TO_END_TURN';
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

      // Leave Center face-up for the next player!
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

      // Creator ruling: GOOD + PURSUE + ABANDON withholds Reader bonus unless readerBonusOnAbandon=true
      if (currentReading) {
        finalizeReadingReward(currentReading, 'abandoned', centerCard);
        currentReading = null;
      }

      moveResolvedEventToVeil(`event-${reality}-abandoned`);
      phase = 'READY_TO_END_TURN';
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
      const postHand = players[state.activePlayerIndex]!.hand;
      phase =
        postHand.length > state.ruleset.maxHandSize ? 'AWAITING_HAND_DISCARD' : 'READY_TO_END_TURN';
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
      phase =
        players[state.activePlayerIndex]!.hand.length > state.ruleset.maxHandSize
          ? 'AWAITING_HAND_DISCARD'
          : 'READY_TO_END_TURN';
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

      phase =
        nextHand.length > state.ruleset.maxHandSize ? 'AWAITING_HAND_DISCARD' : 'READY_TO_END_TURN';
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
        !(state.phase === 'AWAITING_CENTER_DECISION' && boardCenter.length === 0)
      ) {
        return fail(state, command, {
          code: 'INVALID_PHASE',
          message: `Resolve the active step before ending the turn (current phase: ${state.phase}).`
        });
      }

      players[state.activePlayerIndex] = {
        ...activePlayer,
        turnsTaken: activePlayer.turnsTaken + 1,
        effectUsedThisTurn: false
      };

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

        // Refill Left Event if empty & barriersAndTrials enabled (never double-draw if unrevealed Event persisted!)
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

        // Check if an abandoned Center card persisted from previous turn
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
          // Days ran out and no Center card left -> game ends now!
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
