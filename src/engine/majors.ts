import { rankToName, rankToShort } from './cards.js';
import { makeEvent } from './event-helpers.js';
import type {
  BoardState,
  Card,
  EclipseTrophy,
  GameEvent,
  GameOutcome,
  GamePhase,
  MajorContentionResumeContext,
  MajorPendingEntry,
  PendingMajorContentionState,
  PlayerState,
  Ruleset
} from './types.js';

export function isMajorCard(card: Card | undefined): boolean {
  if (!card) return false;
  return (
    card.family === 'classic-court' ||
    card.family === 'sun-major' ||
    card.family === 'moon-major'
  );
}

export function getRequiredEclipses(ruleset: Ruleset): number {
  return ruleset.eclipseVictoryCount === 'players-plus-one'
    ? ruleset.playerCount + 1
    : ruleset.eclipseVictoryCount;
}

export function isMajorDormant(
  cardId: string,
  majorPending: readonly MajorPendingEntry[]
): boolean {
  return majorPending.some((m) => m.cardId === cardId);
}

/**
 * RD-08: Computes active (non-dormant) Classic Court aura VP for a player.
 * Applies ONLY to non-dormant Courts standing on the Board whose element
 * matches the player's current lineage element.
 */
export function getActiveCourtAuraVP(params: {
  player: PlayerState;
  board: BoardState;
  majorPending: readonly MajorPendingEntry[];
  cards: Readonly<Record<string, Card>>;
}): number {
  const { player, board, majorPending, cards } = params;
  const dormantSet = new Set(majorPending.map((m) => m.cardId));
  const boardIds = [...board.parallel, ...board.event, ...board.center];
  let total = 0;
  for (const id of boardIds) {
    if (dormantSet.has(id)) continue;
    const card = cards[id];
    if (card?.family === 'classic-court' && card.element === player.lineage.element) {
      total += card.courtBonus ?? 1;
    }
  }
  return total;
}

export interface MajorMutableBoard {
  readonly cards: Readonly<Record<string, Card>>;
  readonly ruleset: Ruleset;
  readonly turn: number;
  readonly round: number;
  readonly phase: GamePhase;
  readonly activePlayerIndex: number;
  readonly players: PlayerState[];
  days: string[];
  veil: string[];
  boardEvent: string[];
  boardCenter: string[];
  boardParallel: string[];
  eventRevealed: boolean;
  centerRevealed: boolean;
  centerAbandoned: boolean;
  abandonedByPlayerId: string | null;
  majorPending: MajorPendingEntry[];
  readonly newEvents: GameEvent[];
  readonly nextSeq: () => number;
}

export interface MajorArrivalResult {
  readonly status: 'placed' | 'eclipsed' | 'contended_resolved' | 'awaiting_choice' | 'game_over';
  readonly outcome?: GameOutcome;
  readonly pendingContention?: PendingMajorContentionState;
}

export function activateReadyDormantMajors(ctx: MajorMutableBoard): void {
  if (ctx.majorPending.length === 0) return;
  const stillDormant: MajorPendingEntry[] = [];
  for (const entry of ctx.majorPending) {
    const onBoard =
      ctx.boardParallel.includes(entry.cardId) ||
      ctx.boardEvent.includes(entry.cardId) ||
      ctx.boardCenter.includes(entry.cardId);
    if (!onBoard) continue;
    if (entry.dormantUntilTurn <= ctx.turn) {
      const card = ctx.cards[entry.cardId]!;
      ctx.newEvents.push(
        makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
          actor: 'system',
          type: 'MajorActivated',
          affectedCardIds: [entry.cardId],
          source: 'major-lifecycle',
          reason: 'dormancy-complete',
          visibility: 'public',
          summary: `Classic Court ${card.label} (${card.shortLabel}, +${card.courtBonus ?? 1} ${card.element ?? ''} aura) awakened from dormancy and is now active on the Board.`,
          payload: {
            cardId: entry.cardId,
            courtBonus: card.courtBonus ?? null,
            element: card.element ?? null
          }
        })
      );
    } else {
      stillDormant.push(entry);
    }
  }
  ctx.majorPending = stillDormant;
}

function removeCardFromBoardSlot(ctx: MajorMutableBoard, cardId: string): void {
  const evIdx = ctx.boardEvent.indexOf(cardId);
  if (evIdx >= 0) {
    ctx.boardEvent.splice(evIdx, 1);
    if (ctx.boardEvent.length === 0) ctx.eventRevealed = false;
  }
  const ctrIdx = ctx.boardCenter.indexOf(cardId);
  if (ctrIdx >= 0) {
    ctx.boardCenter.splice(ctrIdx, 1);
    if (ctx.boardCenter.length === 0) {
      ctx.centerRevealed = false;
      ctx.centerAbandoned = false;
      ctx.abandonedByPlayerId = null;
    }
  }
  const parIdx = ctx.boardParallel.indexOf(cardId);
  if (parIdx >= 0) {
    ctx.boardParallel.splice(parIdx, 1);
  }
  ctx.majorPending = ctx.majorPending.filter((p) => p.cardId !== cardId);
}

function awardClassicEclipse(
  ctx: MajorMutableBoard,
  residentCard: Card,
  arrivingCard: Card,
  source: string
): GameOutcome | undefined {
  const activePlayer = ctx.players[ctx.activePlayerIndex]!;
  const disposition = ctx.ruleset.eclipseCardDisposition ?? 'both_to_veil';

  removeCardFromBoardSlot(ctx, residentCard.id);
  removeCardFromBoardSlot(ctx, arrivingCard.id);

  let keptCardIds: string[] = [];
  let veiledIds: string[] = [];
  if (disposition === 'keep_pair_beside_ace') {
    keptCardIds = [residentCard.id, arrivingCard.id];
  } else if (disposition === 'keep_one_beside_ace') {
    const preferred =
      residentCard.element === activePlayer.primaryElement
        ? residentCard
        : arrivingCard.element === activePlayer.primaryElement
          ? arrivingCard
          : residentCard;
    const other = preferred.id === residentCard.id ? arrivingCard : residentCard;
    keptCardIds = [preferred.id];
    veiledIds = [other.id];
  } else {
    veiledIds = [residentCard.id, arrivingCard.id];
  }

  if (veiledIds.length > 0) {
    ctx.veil.push(...veiledIds);
  }

  const bonusVP = (residentCard.courtBonus ?? 1) as 1 | 2 | 3;
  const existingTrophies = activePlayer.eclipseTrophies ?? [];
  const rankName = rankToName(residentCard.rank);
  const rankShort = rankToShort(residentCard.rank);
  const trophy: EclipseTrophy = {
    id: `eclipse-t${ctx.turn}-${existingTrophies.length + 1}`,
    rank: residentCard.rank,
    label: `${rankName} Eclipse (+${bonusVP} VP)`,
    shortLabel: `☀ ${rankShort} +${bonusVP}`,
    bonusVP,
    cardIds: [residentCard.id, arrivingCard.id],
    keptCardIds,
    earnedOnTurn: ctx.turn
  };

  const updatedPlayer: PlayerState = {
    ...activePlayer,
    eclipseCount: activePlayer.eclipseCount + 1,
    eclipseBonusVP: activePlayer.eclipseBonusVP + bonusVP,
    eclipseTrophies: [...existingTrophies, trophy]
  };
  ctx.players[ctx.activePlayerIndex] = updatedPlayer;

  const required = getRequiredEclipses(ctx.ruleset);
  ctx.newEvents.push(
    makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
      actor: activePlayer.id,
      type: 'EclipseFormed',
      affectedCardIds: [residentCard.id, arrivingCard.id],
      source,
      reason: 'classic-court-eclipse',
      visibility: 'public',
      summary: `ECLIPSE! ${activePlayer.name} aligned ${residentCard.label} (${residentCard.shortLabel}) + ${arrivingCard.label} (${arrivingCard.shortLabel}) → +${bonusVP} persistent Eclipse VP (${updatedPlayer.eclipseCount}/${required} Eclipses)!`,
      payload: {
        residentCardId: residentCard.id,
        arrivingCardId: arrivingCard.id,
        cardIds: [residentCard.id, arrivingCard.id],
        rank: residentCard.rank,
        courtBonusVP: bonusVP,
        eclipseCount: updatedPlayer.eclipseCount,
        requiredEclipses: required,
        disposition,
        keptCardIds,
        trophy
      }
    })
  );

  if (veiledIds.length > 0) {
    ctx.newEvents.push(
      makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
        actor: 'system',
        type: 'CardMoved',
        affectedCardIds: veiledIds,
        source,
        reason: 'eclipse-resolved',
        visibility: 'public',
        summary: `Eclipsed Court${veiledIds.length === 1 ? '' : 's'} (${veiledIds
          .map((id) => ctx.cards[id]!.label)
          .join(', ')}) moved to the Veil. Permanent ${trophy.label} locked beside ${activePlayer.name}'s Ace.`,
        payload: { from: 'board', to: 'veil', keptCardIds }
      })
    );
  }

  if (updatedPlayer.eclipseCount >= required) {
    const highestRank = Math.max(...ctx.players.map((p) => p.lineage.rank));
    return {
      reason: 'eclipse_victory',
      winnerIds: [updatedPlayer.id],
      highestRank,
      summary: `${updatedPlayer.name} achieved Eclipse Victory (${updatedPlayer.eclipseCount}/${required} Eclipses)!`
    };
  }

  return undefined;
}

/**
 * Checks whether a candidate Court forms an opposite-color same-rank Classic Eclipse
 * with any Court currently standing on the Board (Parallel, Event, or Center).
 */
export function findMatchingEclipsePartnerOnBoard(
  ctx: MajorMutableBoard,
  candidate: Card
): Card | null {
  if (candidate.family !== 'classic-court' || !candidate.color) return null;
  const boardMajorIds = [
    ...ctx.boardParallel,
    ...ctx.boardEvent,
    ...ctx.boardCenter
  ].filter((id) => id !== candidate.id && isMajorCard(ctx.cards[id]));

  for (const id of boardMajorIds) {
    const other = ctx.cards[id]!;
    if (
      other.family === 'classic-court' &&
      other.color &&
      other.rank === candidate.rank &&
      other.color !== candidate.color
    ) {
      return other;
    }
  }
  return null;
}

/**
 * Central combo evaluator: runs after EVERY Board mutation (draws, Earth reorder, elemental actions).
 * 1. Classic Eclipse: opposite-color same-rank Courts simultaneously on the Board.
 * 2. Classic Triangulation: 3 Major Arcana occupying Event + Center + Parallel simultaneously.
 */
export function evaluateCombos(ctx: MajorMutableBoard): GameOutcome | undefined {
  const activePlayer = ctx.players[ctx.activePlayerIndex]!;

  // 1. Check Classic Eclipse
  if (ctx.ruleset.features.eclipse) {
    const boardMajorIds = [
      ...ctx.boardParallel,
      ...ctx.boardEvent,
      ...ctx.boardCenter
    ].filter((id) => isMajorCard(ctx.cards[id]));

    let eclipsedPair: [Card, Card] | null = null;
    for (let i = 0; i < boardMajorIds.length && !eclipsedPair; i++) {
      const a = ctx.cards[boardMajorIds[i]!]!;
      if (a.family !== 'classic-court' || !a.color) continue;
      for (let j = i + 1; j < boardMajorIds.length; j++) {
        const b = ctx.cards[boardMajorIds[j]!]!;
        if (b.family !== 'classic-court' || !b.color) continue;
        if (a.rank === b.rank && a.color !== b.color) {
          eclipsedPair = [a, b];
          break;
        }
      }
    }

    if (eclipsedPair) {
      const [resident, arriving] = eclipsedPair;
      const win = awardClassicEclipse(ctx, resident, arriving, 'evaluateCombos');
      if (win) return win;
    }
  }

  // 2. Check Classic Triangulation (3 Majors occupying Event + Center + Parallel)
  if (ctx.ruleset.features.triangulation) {
    const evCard = ctx.boardEvent[0] ? ctx.cards[ctx.boardEvent[0]] : undefined;
    const ctrCard = ctx.boardCenter[0] ? ctx.cards[ctx.boardCenter[0]] : undefined;
    const parCard = ctx.boardParallel[0] ? ctx.cards[ctx.boardParallel[0]] : undefined;

    if (isMajorCard(evCard) && isMajorCard(ctrCard) && isMajorCard(parCard)) {
      ctx.newEvents.push(
        makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
          actor: activePlayer.id,
          type: 'TriangulationCompleted',
          affectedCardIds: [evCard!.id, ctrCard!.id, parCard!.id],
          source: 'evaluateCombos',
          reason: 'three-slot-triangulation',
          visibility: 'public',
          summary: `TRIANGULATION! ${activePlayer.name} aligned three Major Arcana across all three Board slots (${evCard!.shortLabel} · ${ctrCard!.shortLabel} · ${parCard!.shortLabel})!`,
          payload: {
            eventCardId: evCard!.id,
            centerCardId: ctrCard!.id,
            parallelCardId: parCard!.id
          }
        })
      );

      const highestRank = Math.max(...ctx.players.map((p) => p.lineage.rank));
      return {
        reason: 'triangulation_victory',
        winnerIds: [activePlayer.id],
        highestRank,
        summary: `${activePlayer.name} achieved Triangulation Victory (${evCard!.shortLabel} · ${ctrCard!.shortLabel} · ${parCard!.shortLabel})!`
      };
    }
  }

  return undefined;
}

/**
 * Classic MVP R2 Explicit Major Arcana Arrival State Machine (RD-06):
 * 1. Check Eclipse FIRST against all Courts on the Board (even if resident is dormant).
 * 2. Route to dedicated Parallel Dimension ONLY (NO automatic overflow into Event or Center!).
 *    - If Parallel holds a Minor: displace Minor face-up -> Veil; Court enters Parallel dormant 1 turn.
 * 3. If Parallel already holds a non-matching Court (Contention):
 *    - Rank 7–9 active player (outside initial setup): pause in AWAITING_MAJOR_CONTENTION for ChooseMajorExit.
 *    - Rank 1–6 active player: resolve via configured departure policy (default true LIFO: arriving exits -> Veil, resident stays).
 */
export function resolveMajorArrival(
  ctx: MajorMutableBoard,
  majorCardId: string,
  source: string,
  resumeContext: MajorContentionResumeContext,
  options: { allowContentionPause?: boolean; deferReadingForPreElemental?: boolean } = {}
): MajorArrivalResult {
  const arrivingCard = ctx.cards[majorCardId]!;
  const activePlayer = ctx.players[ctx.activePlayerIndex]!;

  // Step 1: Eclipse checked FIRST on arrival/contention!
  if (ctx.ruleset.features.eclipse) {
    const partner = findMatchingEclipsePartnerOnBoard(ctx, arrivingCard);
    if (partner) {
      ctx.newEvents.push(
        makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
          actor: 'system',
          type: 'MajorArrived',
          affectedCardIds: [majorCardId],
          source,
          reason: 'major-arrived-for-eclipse',
          visibility: 'public',
          summary: `Classic Court ${arrivingCard.label} (${arrivingCard.shortLabel}) arrived at Parallel Dimension and met matching ${partner.label} (${partner.shortLabel})!`,
          payload: {
            cardId: majorCardId,
            destination: 'parallel',
            courtBonus: arrivingCard.courtBonus ?? null,
            eclipseMatchWith: partner.id
          }
        })
      );
      const outcome = awardClassicEclipse(ctx, partner, arrivingCard, source);
      if (outcome) {
        return { status: 'game_over', outcome };
      }
      return { status: 'eclipsed' };
    }
  }

  // Step 2: Parallel empty or occupied by a Minor -> Court claims Parallel (dormant 1 turn)
  const parallelResidentId = ctx.boardParallel[0];
  const parallelResident = parallelResidentId ? ctx.cards[parallelResidentId] : undefined;

  if (!parallelResident || !isMajorCard(parallelResident)) {
    if (parallelResidentId && parallelResident) {
      ctx.boardParallel.shift();
      ctx.veil.push(parallelResidentId);
      ctx.newEvents.push(
        makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
          actor: 'system',
          type: 'CardMoved',
          affectedCardIds: [parallelResidentId],
          source,
          reason: 'displaced-by-major-arrival',
          visibility: 'public',
          summary: `${parallelResident.label} displaced from Parallel chamber to the Veil by arriving Classic Court ${arrivingCard.label}.`,
          payload: { from: 'parallel', to: 'veil' }
        })
      );
    }

    ctx.boardParallel.push(majorCardId);
    ctx.majorPending.push({ cardId: majorCardId, dormantUntilTurn: ctx.turn + 1 });

    ctx.newEvents.push(
      makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
        actor: 'system',
        type: 'MajorArrived',
        affectedCardIds: [majorCardId],
        source,
        reason: 'major-routed-to-parallel',
        visibility: 'public',
        summary: `Classic Court ${arrivingCard.label} (${arrivingCard.shortLabel}, +${arrivingCard.courtBonus ?? 1} ${arrivingCard.element ?? ''}) entered Parallel Dimension (dormant until Turn ${ctx.turn + 1}).`,
        payload: {
          cardId: majorCardId,
          destination: 'parallel',
          courtBonus: arrivingCard.courtBonus ?? null,
          dormantUntilTurn: ctx.turn + 1
        }
      })
    );

    const outcome = evaluateCombos(ctx);
    if (outcome) {
      return { status: 'game_over', outcome };
    }
    return { status: 'placed' };
  }

  // Step 3: Non-Matching Court Contention in Parallel Dimension!
  const allowPause = options.allowContentionPause !== false && ctx.ruleset.majorContentionEnabled !== false;
  if (allowPause && activePlayer.lineage.rank >= 7) {
    const pendingContention: PendingMajorContentionState = {
      playerId: activePlayer.id,
      incumbentCardId: parallelResident.id,
      arrivingCardId: arrivingCard.id,
      source,
      resumeContext,
      deferReadingForPreElemental: options.deferReadingForPreElemental
    };

    ctx.newEvents.push(
      makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, 'AWAITING_MAJOR_CONTENTION', ctx.ruleset.version, {
        actor: activePlayer.id,
        type: 'MajorContentionPaused',
        affectedCardIds: [parallelResident.id, arrivingCard.id],
        source,
        reason: 'rank7-major-contention',
        visibility: 'public',
        summary: `Major Contention! ${arrivingCard.label} (${arrivingCard.shortLabel}) challenges resident ${parallelResident.label} (${parallelResident.shortLabel}) in Parallel — ${activePlayer.name} (Rank ${activePlayer.lineage.rank}) chooses which Court exits to the Veil.`,
        payload: {
          playerId: activePlayer.id,
          incumbentCardId: parallelResident.id,
          arrivingCardId: arrivingCard.id
        }
      })
    );

    return { status: 'awaiting_choice', pendingContention };
  }

  // Default Rank 1–6 arrival-order contention policy (true LIFO default: arriving exits -> Veil, resident stays!)
  const policy = ctx.ruleset.majorDefaultDeparture ?? 'lifo';
  if (policy === 'fifo') {
    // Incumbent exits -> Veil; arriving enters Parallel dormant 1 turn
    removeCardFromBoardSlot(ctx, parallelResident.id);
    ctx.veil.push(parallelResident.id);
    ctx.boardParallel.push(majorCardId);
    ctx.majorPending.push({ cardId: majorCardId, dormantUntilTurn: ctx.turn + 1 });

    ctx.newEvents.push(
      makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
        actor: 'system',
        type: 'MajorContentionResolved',
        affectedCardIds: [parallelResident.id, arrivingCard.id],
        source,
        reason: 'major-contention-fifo',
        visibility: 'public',
        summary: `Major Contention (FIFO): arriving ${arrivingCard.label} replaced ${parallelResident.label} in Parallel (${parallelResident.shortLabel} → Veil; ${arrivingCard.shortLabel} dormant until Turn ${ctx.turn + 1}).`,
        payload: {
          policy: 'fifo',
          incumbentCardId: parallelResident.id,
          arrivingCardId: arrivingCard.id,
          keptCardId: arrivingCard.id,
          exitedCardId: parallelResident.id
        }
      })
    );
    ctx.newEvents.push(
      makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
        actor: 'system',
        type: 'CardMoved',
        affectedCardIds: [parallelResident.id],
        source,
        reason: 'major-contention-fifo',
        visibility: 'public',
        summary: `${parallelResident.label} exited Parallel Dimension to the Veil.`,
        payload: { from: 'parallel', to: 'veil' }
      })
    );
    ctx.newEvents.push(
      makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
        actor: 'system',
        type: 'MajorArrived',
        affectedCardIds: [arrivingCard.id],
        source,
        reason: 'major-routed-to-parallel',
        visibility: 'public',
        summary: `Classic Court ${arrivingCard.label} (${arrivingCard.shortLabel}) entered Parallel Dimension (dormant until Turn ${ctx.turn + 1}).`,
        payload: {
          cardId: arrivingCard.id,
          destination: 'parallel',
          courtBonus: arrivingCard.courtBonus ?? null,
          dormantUntilTurn: ctx.turn + 1
        }
      })
    );
  } else {
    // True LIFO (default): arriving (last-in) exits -> Veil; resident (first-in) stays in Parallel!
    ctx.veil.push(majorCardId);
    ctx.newEvents.push(
      makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
        actor: 'system',
        type: 'MajorContentionResolved',
        affectedCardIds: [parallelResident.id, arrivingCard.id],
        source,
        reason: 'major-contention-lifo',
        visibility: 'public',
        summary: `Major Contention (LIFO): resident ${parallelResident.label} (${parallelResident.shortLabel}) holds Parallel Dimension; arriving ${arrivingCard.label} (${arrivingCard.shortLabel}) departed to the Veil.`,
        payload: {
          policy: 'lifo',
          incumbentCardId: parallelResident.id,
          arrivingCardId: arrivingCard.id,
          keptCardId: parallelResident.id,
          exitedCardId: arrivingCard.id
        }
      })
    );
    ctx.newEvents.push(
      makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
        actor: 'system',
        type: 'CardMoved',
        affectedCardIds: [arrivingCard.id],
        source,
        reason: 'major-contention-lifo',
        visibility: 'public',
        summary: `Arriving Classic Court ${arrivingCard.label} departed to the Veil under LIFO contention.`,
        payload: { from: 'days', to: 'veil' }
      })
    );
  }

  return { status: 'contended_resolved' };
}

/**
 * Resolves a Rank 7–9 player's explicit ChooseMajorExit decision.
 */
export function resolveRank7MajorChoice(
  ctx: MajorMutableBoard,
  pending: PendingMajorContentionState,
  chosenExitCardId: string
): GameOutcome | undefined {
  const incumbent = ctx.cards[pending.incumbentCardId]!;
  const arriving = ctx.cards[pending.arrivingCardId]!;
  const activePlayer = ctx.players[ctx.activePlayerIndex]!;

  if (chosenExitCardId === pending.arrivingCardId) {
    // Keep incumbent in Parallel; arriving exits to Veil
    ctx.veil.push(arriving.id);
    ctx.newEvents.push(
      makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
        actor: activePlayer.id,
        type: 'MajorContentionResolved',
        affectedCardIds: [incumbent.id, arriving.id],
        source: 'ChooseMajorExit',
        reason: 'rank7-major-choice',
        visibility: 'public',
        summary: `${activePlayer.name} (Rank ${activePlayer.lineage.rank}) kept resident ${incumbent.label} (${incumbent.shortLabel}) in Parallel and sent arriving ${arriving.label} (${arriving.shortLabel}) to the Veil.`,
        payload: {
          policy: 'rank7_choice',
          incumbentCardId: incumbent.id,
          arrivingCardId: arriving.id,
          keptCardId: incumbent.id,
          exitedCardId: arriving.id
        }
      })
    );
    ctx.newEvents.push(
      makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
        actor: activePlayer.id,
        type: 'CardMoved',
        affectedCardIds: [arriving.id],
        source: 'ChooseMajorExit',
        reason: 'rank7-major-choice',
        visibility: 'public',
        summary: `${arriving.label} moved to the Veil.`,
        payload: { from: 'days', to: 'veil' }
      })
    );
    return undefined;
  }

  // Exit incumbent to Veil; arriving enters Parallel dormant 1 turn
  removeCardFromBoardSlot(ctx, incumbent.id);
  ctx.veil.push(incumbent.id);
  ctx.boardParallel.push(arriving.id);
  ctx.majorPending.push({ cardId: arriving.id, dormantUntilTurn: ctx.turn + 1 });

  ctx.newEvents.push(
    makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
      actor: activePlayer.id,
      type: 'MajorContentionResolved',
      affectedCardIds: [incumbent.id, arriving.id],
      source: 'ChooseMajorExit',
      reason: 'rank7-major-choice',
      visibility: 'public',
      summary: `${activePlayer.name} (Rank ${activePlayer.lineage.rank}) sent resident ${incumbent.label} (${incumbent.shortLabel}) to the Veil and welcomed ${arriving.label} (${arriving.shortLabel}) into Parallel (dormant until Turn ${ctx.turn + 1}).`,
      payload: {
        policy: 'rank7_choice',
        incumbentCardId: incumbent.id,
        arrivingCardId: arriving.id,
        keptCardId: arriving.id,
        exitedCardId: incumbent.id
      }
    })
  );
  ctx.newEvents.push(
    makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
      actor: activePlayer.id,
      type: 'CardMoved',
      affectedCardIds: [incumbent.id],
      source: 'ChooseMajorExit',
      reason: 'rank7-major-choice',
      visibility: 'public',
      summary: `${incumbent.label} exited Parallel Dimension to the Veil.`,
      payload: { from: 'parallel', to: 'veil' }
    })
  );
  ctx.newEvents.push(
    makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
      actor: 'system',
      type: 'MajorArrived',
      affectedCardIds: [arriving.id],
      source: 'ChooseMajorExit',
      reason: 'major-routed-to-parallel',
      visibility: 'public',
      summary: `Classic Court ${arriving.label} (${arriving.shortLabel}) entered Parallel Dimension (dormant until Turn ${ctx.turn + 1}).`,
      payload: {
        cardId: arriving.id,
        destination: 'parallel',
        courtBonus: arriving.courtBonus ?? null,
        dormantUntilTurn: ctx.turn + 1
      }
    })
  );

  return evaluateCombos(ctx);
}

/**
 * Draws from the top of Deck of Days for a Minor slot (Event or Center).
 * Any Classic Court drawn along the way routes cleanly through resolveMajorArrival()
 * (dedicated Parallel -> Eclipse check -> Contention / Rank 7-9 pause — NEVER overflowing into Event/Center!).
 */
export function drawNextMinorRoutingMajors(
  ctx: MajorMutableBoard,
  forSlot: 'event' | 'center',
  source: string,
  resumeContext: MajorContentionResumeContext = forSlot === 'event' ? 'populate_event' : 'populate_center_reading',
  options: { allowContentionPause?: boolean; deferReadingForPreElemental?: boolean } = {}
): {
  minorCardId: string | null;
  outcome?: GameOutcome;
  pendingContention?: PendingMajorContentionState;
} {
  while (ctx.days.length > 0) {
    if (forSlot === 'event' && ctx.boardEvent.length > 0) {
      return { minorCardId: null };
    }
    if (forSlot === 'center' && ctx.boardCenter.length > 0) {
      return { minorCardId: null };
    }

    const nextId = ctx.days.shift()!;
    const card = ctx.cards[nextId]!;
    if (ctx.ruleset.features.majors && isMajorCard(card)) {
      const arrival = resolveMajorArrival(ctx, nextId, source, resumeContext, options);
      if (arrival.status === 'game_over') {
        return { minorCardId: null, outcome: arrival.outcome };
      }
      if (arrival.status === 'awaiting_choice') {
        return { minorCardId: null, pendingContention: arrival.pendingContention };
      }
      continue;
    }

    return { minorCardId: nextId };
  }

  return { minorCardId: null };
}
