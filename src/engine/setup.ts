import { buildCardCatalog, ELEMENTS } from './cards.js';
import {
  applyEvolutionWithEvents,
  evaluateCompletion,
  finalizeState,
  makeEvent
} from './event-helpers.js';
import { createReadingForTurn } from './readings.js';
import { eventCardToReality } from './reconciliation.js';
import { deterministicShuffle, seedToUint32 } from './rng.js';
import { ENGINE_VERSION } from './rulesets.js';
import type {
  CreateGameOptions,
  Element,
  GameEvent,
  GamePhase,
  GameState,
  PlayerState,
  ReadingRecord,
  Ruleset
} from './types.js';

/**
 * Pure deterministic game initializer.
 * Supports optional deterministic card-placement overrides for acceptance scenarios.
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
  const registerOverride = (id: string, label: string): void => {
    if (!catalog[id]) throw new Error(`Unknown override ${label} card "${id}"`);
    if (assignedAceIds.has(id) || overriddenSet.has(id)) {
      throw new Error(`Duplicate override card "${id}"`);
    }
    overriddenSet.add(id);
  };

  if (options.overrideHands) {
    for (const hand of options.overrideHands) {
      for (const id of hand) registerOverride(id, 'hand');
    }
  }
  if (options.overrideDaysTop) {
    for (const id of options.overrideDaysTop) registerOverride(id, 'Days');
  }
  if (options.overrideVeil) {
    for (const id of options.overrideVeil) registerOverride(id, 'Veil');
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
  const veil = [...(options.overrideVeil ?? [])];

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
    veil,
    reserve,
    board: { event: boardEvent, center: boardCenter, parallel: [] },
    eventRevealed,
    centerRevealed,
    centerAbandoned: false,
    abandonedByPlayerId: null,
    discardedCenterThisTurn: false,
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
