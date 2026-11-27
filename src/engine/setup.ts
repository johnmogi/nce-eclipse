import { buildCardCatalog, ELEMENTS } from './cards.js';
import { hasAnyLegalElementalAction } from './elemental-effects.js';
import {
  applyEvolutionWithEvents,
  evaluateCompletion,
  finalizeState,
  makeEvent
} from './event-helpers.js';
import { isEligibleEvolution } from './evolution.js';
import {
  drawNextMinorRoutingMajors,
  isMajorCard,
  placeDrawnMajorOnBoard,
  type MajorMutableBoard
} from './majors.js';
import { createReadingForTurn } from './readings.js';
import { eventCardToReality } from './reconciliation.js';
import { deterministicShuffle, seedToUint32 } from './rng.js';
import { ENGINE_VERSION } from './rulesets.js';
import type {
  CreateGameOptions,
  Element,
  GameEvent,
  GameOutcome,
  GamePhase,
  GameState,
  MajorPendingEntry,
  PlayerState,
  ReadingRecord,
  Ruleset
} from './types.js';

/**
 * Pure deterministic game initializer supporting Milestones A–E.
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
      eclipseBonusVP: 0,
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

  const preReadingElemental =
    ruleset.features.elementalEffects && ruleset.elementalTiming === 'before_reading';

  const initialOpenPhase: GamePhase = preReadingElemental
    ? 'AWAITING_ELEMENTAL_ACTION'
    : ruleset.features.readings
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

  // Deal starting hands: Minors only (Majors/Courts stay in Deck of Days to enter via Board!).
  // Stage R1 (RD-01): When preventSetupEvolution is enabled, also skip any Minor that would
  // immediately consume itself evolving the starting Ace so every player starts Turn 1 with 3 playable cards.
  for (let i = 0; i < players.length; i++) {
    const dealt: string[] = [];
    if (options.overrideHands?.[i]) {
      dealt.push(...options.overrideHands[i]!);
    } else {
      const skippedCards: string[] = [];
      while (dealt.length < ruleset.startingHandSize && days.length > 0) {
        const candidateId = days.shift()!;
        const candidate = catalog[candidateId]!;
        const skipMajor = ruleset.features.majors && isMajorCard(candidate);
        const skipSetupEvo =
          Boolean(ruleset.preventSetupEvolution) &&
          isEligibleEvolution(players[i]!.lineage, candidate, ruleset);
        if (skipMajor || skipSetupEvo) {
          skippedCards.push(candidateId);
        } else {
          dealt.push(candidateId);
        }
      }
      if (skippedCards.length > 0) {
        // Re-insert any skipped Majors / Turn-0 evolving cards cleanly into Days deterministically
        const recombined = [...skippedCards, ...days];
        const reshuffled = deterministicShuffle(recombined, rngState);
        rngState = reshuffled.nextState;
        days.splice(0, days.length, ...reshuffled.shuffled);
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

  // Populate Turn 1 Board (routing any drawn Major Arcana / Courts cleanly to Parallel -> Event -> Center!)
  const majorBoardCtx: MajorMutableBoard = {
    cards: catalog,
    ruleset,
    turn: 1,
    round: 1,
    phase: initialOpenPhase,
    activePlayerIndex: 0,
    players,
    days,
    veil,
    boardEvent: [],
    boardCenter: [],
    boardParallel: [],
    eventRevealed: false,
    centerRevealed: !ruleset.features.readings,
    centerAbandoned: false,
    abandonedByPlayerId: null,
    majorPending: [] as MajorPendingEntry[],
    newEvents: events,
    nextSeq
  };

  // Populate Turn 1 Board.
  // Invariant for normal games (!options.overrideDaysTop):
  // - Veil MUST start completely empty (0 cards — never displace cards or trigger Turn-0 Eclipses during setup!).
  // - Left Event and Center ALWAYS begin with concealed Minor cards.
  // - Right Parallel (unless emptyChamberMode) receives 1 card (face-down Minor or at most 1 dormant Classic Court).
  // When deterministic test fixtures explicitly pass `options.overrideDaysTop`, route Majors as stacked for scenario testing.
  const isFixtureOverride = Boolean(options.overrideDaysTop && options.overrideDaysTop.length > 0);

  const drawSetupMinorSkippingMajors = (): string | null => {
    const skippedMajors: string[] = [];
    let chosen: string | null = null;
    while (majorBoardCtx.days.length > 0) {
      const candidateId = majorBoardCtx.days.shift()!;
      const candidate = catalog[candidateId]!;
      if (ruleset.features.majors && isMajorCard(candidate)) {
        skippedMajors.push(candidateId);
      } else {
        chosen = candidateId;
        break;
      }
    }
    if (skippedMajors.length > 0) {
      const recombined = [...skippedMajors, ...majorBoardCtx.days];
      const reshuffled = deterministicShuffle(recombined, rngState);
      rngState = reshuffled.nextState;
      majorBoardCtx.days.splice(0, majorBoardCtx.days.length, ...reshuffled.shuffled);
    }
    return chosen;
  };

  let comboOutcome: GameOutcome | undefined;

  if (ruleset.features.barriersAndTrials && majorBoardCtx.days.length > 0 && ruleset.boardOccupancyLimits.event >= 1) {
    let firstEventId: string | null = null;
    if (isFixtureOverride) {
      const drawEv = drawNextMinorRoutingMajors(majorBoardCtx, 'event', 'turn-setup');
      comboOutcome = drawEv.outcome;
      firstEventId = drawEv.minorCardId;
    } else {
      firstEventId = drawSetupMinorSkippingMajors();
    }
    if (!comboOutcome && firstEventId) {
      const firstEventCard = catalog[firstEventId]!;
      majorBoardCtx.boardEvent.push(firstEventId);
      majorBoardCtx.eventRevealed = false;

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
  }

  let currentReading: ReadingRecord | null = null;

  if (!comboOutcome && majorBoardCtx.days.length > 0 && ruleset.boardOccupancyLimits.center >= 1) {
    let firstCenterId: string | null = null;
    if (isFixtureOverride) {
      const drawCtr = drawNextMinorRoutingMajors(majorBoardCtx, 'center', 'turn-setup');
      comboOutcome = drawCtr.outcome;
      firstCenterId = drawCtr.minorCardId;
    } else {
      firstCenterId = drawSetupMinorSkippingMajors();
    }
    if (!comboOutcome && firstCenterId) {
      const firstCenterCard = catalog[firstCenterId]!;
      majorBoardCtx.boardCenter.push(firstCenterId);

      if (ruleset.features.readings) {
        majorBoardCtx.centerRevealed = false;
        if (!preReadingElemental) {
          currentReading = createReadingForTurn(players, 0, firstCenterCard, 1, 1, ruleset);
        }
        events.push(
          makeEvent(nextSeq(), 1, 1, initialOpenPhase, ruleset.version, {
            actor: 'system',
            type: 'CardMoved',
            affectedCardIds: [],
            source: 'turn-setup',
            reason: 'populate-center-concealed',
            visibility: 'public',
            summary: preReadingElemental
              ? `Turn 1 concealed card placed in Center (${firstCenterCard.backGroup} back). Optional Elemental Prep open before Reading.`
              : `Turn 1 concealed card placed in Center (${firstCenterCard.backGroup} back). Waiting for ${players[1]!.name}'s reading.`,
            payload: { from: 'days', to: 'center', concealed: true, backGroup: firstCenterCard.backGroup }
          })
        );
        events.push(
          makeEvent(nextSeq(), 1, 1, initialOpenPhase, ruleset.version, {
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
        majorBoardCtx.centerRevealed = true;
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
  }

  // Stage R1 (RD-15 AGREED): Unless emptyChamberMode is enabled, Turn 1 populates ALL 3 Board slots
  // (Event, Center, AND Right Parallel Dimension) so the third chamber is never left artificially empty.
  if (
    !comboOutcome &&
    !ruleset.emptyChamberMode &&
    majorBoardCtx.boardParallel.length === 0 &&
    majorBoardCtx.days.length > 0 &&
    ruleset.boardOccupancyLimits.parallel >= 1
  ) {
    const rightId = majorBoardCtx.days.shift()!;
    const rightCard = catalog[rightId]!;
    if (ruleset.features.majors && isMajorCard(rightCard)) {
      comboOutcome = placeDrawnMajorOnBoard(majorBoardCtx, rightId, 'turn-setup');
    } else {
      majorBoardCtx.boardParallel.push(rightId);
      events.push(
        makeEvent(nextSeq(), 1, 1, initialOpenPhase, ruleset.version, {
          actor: 'system',
          type: 'CardMoved',
          affectedCardIds: [],
          source: 'turn-setup',
          reason: 'populate-parallel-concealed',
          visibility: 'public',
          summary: `Turn 1 Right chamber populated face-down (${rightCard.backGroup} back).`,
          payload: { from: 'days', to: 'parallel', concealed: true, backGroup: rightCard.backGroup }
        })
      );
      events.push(
        makeEvent(nextSeq(), 1, 1, initialOpenPhase, ruleset.version, {
          actor: 'system',
          type: 'CardMoved',
          affectedCardIds: [rightId],
          source: 'turn-setup',
          reason: 'populate-parallel-admin-detail',
          visibility: 'admin_only',
          summary: `[Admin] Turn 1 concealed Right chamber card is ${rightCard.label}.`,
          payload: { from: 'days', to: 'parallel', cardId: rightId }
        })
      );
    }
  }

  const outcome =
    comboOutcome ?? evaluateCompletion(players, majorBoardCtx.days, majorBoardCtx.boardCenter, ruleset);

  const canDoPreReadingElemental =
    preReadingElemental &&
    hasAnyLegalElementalAction({
      player: players[0]!,
      cards: catalog,
      turn: 1,
      ruleset,
      daysCount: majorBoardCtx.days.length,
      veilCount: majorBoardCtx.veil.length,
      boardOccupiedCount:
        majorBoardCtx.boardEvent.length +
        majorBoardCtx.boardCenter.length +
        majorBoardCtx.boardParallel.length
    });

  // If pre-reading elemental prep was skipped because NO legal elemental action exists,
  // initialize Turn 1's Reading record cleanly so the turn opens directly at AWAITING_READING.
  if (
    !outcome &&
    preReadingElemental &&
    !canDoPreReadingElemental &&
    ruleset.features.readings &&
    majorBoardCtx.boardCenter.length > 0 &&
    !currentReading
  ) {
    currentReading = createReadingForTurn(
      players,
      0,
      catalog[majorBoardCtx.boardCenter[0]!]!,
      1,
      1,
      ruleset
    );
    events.push(
      makeEvent(nextSeq(), 1, 1, 'AWAITING_READING', ruleset.version, {
        actor: players[0]!.id,
        type: 'TurnStarted',
        affectedCardIds: [],
        source: 'elemental-prep-check',
        reason: 'no-legal-elemental-action-auto-skip',
        visibility: 'public',
        summary: `${players[0]!.name} has no legal elemental action available on Turn 1 — proceeding directly to Reading.`
      })
    );
  }

  const phase: GamePhase = outcome
    ? 'GAME_OVER'
    : majorBoardCtx.boardCenter.length === 0
      ? 'READY_TO_END_TURN'
      : canDoPreReadingElemental
        ? 'AWAITING_ELEMENTAL_ACTION'
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
    days: majorBoardCtx.days,
    veil: majorBoardCtx.veil,
    reserve,
    board: {
      event: majorBoardCtx.boardEvent,
      center: majorBoardCtx.boardCenter,
      parallel: majorBoardCtx.boardParallel
    },
    eventRevealed: majorBoardCtx.eventRevealed,
    centerRevealed: majorBoardCtx.centerRevealed,
    centerAbandoned: majorBoardCtx.centerAbandoned,
    abandonedByPlayerId: majorBoardCtx.abandonedByPlayerId,
    discardedCenterThisTurn: false,
    currentReading,
    readingHistory: [],
    pendingEarthReorder: null,
    majorPending: majorBoardCtx.majorPending,
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
