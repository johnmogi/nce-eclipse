import { makeEvent } from './event-helpers.js';
import type {
  Card,
  GameEvent,
  GameOutcome,
  GamePhase,
  MajorPendingEntry,
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
          summary: `Major Arcana ${card.label} awakened from dormancy and is now active on the Board.`,
          payload: { cardId: entry.cardId, courtBonus: card.courtBonus ?? null }
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

/**
 * Central combo evaluator (Blueprint §9.2): runs after EVERY board mutation!
 * Checks:
 * 1. Classic Eclipse: Black + Red Classic Courts of the same rank simultaneously on the Board.
 * 2. Classic Triangulation: 3 Major Arcana (Courts) occupying Left Event, Center, and Right Parallel.
 */
export function evaluateCombos(ctx: MajorMutableBoard): GameOutcome | undefined {
  const activePlayer = ctx.players[ctx.activePlayerIndex]!;

  // 1. Check Classic Eclipse (Black + Red Court of same rank on Board)
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
      const [cardA, cardB] = eclipsedPair;
      removeCardFromBoardSlot(ctx, cardA.id);
      removeCardFromBoardSlot(ctx, cardB.id);
      ctx.veil.push(cardA.id, cardB.id);

      const bonusVP = cardA.courtBonus ?? 1;
      const updatedPlayer: PlayerState = {
        ...activePlayer,
        eclipseCount: activePlayer.eclipseCount + 1,
        eclipseBonusVP: activePlayer.eclipseBonusVP + bonusVP
      };
      ctx.players[ctx.activePlayerIndex] = updatedPlayer;

      const required = getRequiredEclipses(ctx.ruleset);
      ctx.newEvents.push(
        makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
          actor: activePlayer.id,
          type: 'EclipseFormed',
          affectedCardIds: [cardA.id, cardB.id],
          source: 'evaluateCombos',
          reason: 'classic-court-eclipse',
          visibility: 'public',
          summary: `ECLIPSE! ${activePlayer.name} aligned ${cardA.label} + ${cardB.label} → +${bonusVP} persistent Eclipse VP (${updatedPlayer.eclipseCount}/${required} Eclipses)!`,
          payload: {
            cardIds: [cardA.id, cardB.id],
            rank: cardA.rank,
            courtBonusVP: bonusVP,
            eclipseCount: updatedPlayer.eclipseCount,
            requiredEclipses: required
          }
        })
      );
      ctx.newEvents.push(
        makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
          actor: 'system',
          type: 'CardMoved',
          affectedCardIds: [cardA.id, cardB.id],
          source: 'evaluateCombos',
          reason: 'eclipse-resolved',
          visibility: 'public',
          summary: `Eclipsed Courts (${cardA.label}, ${cardB.label}) moved to the Veil.`,
          payload: { from: 'board', to: 'veil' }
        })
      );

      if (updatedPlayer.eclipseCount >= required) {
        const highestRank = Math.max(...ctx.players.map((p) => p.lineage.rank));
        return {
          reason: 'eclipse_victory',
          winnerIds: [updatedPlayer.id],
          highestRank,
          summary: `${updatedPlayer.name} achieved Eclipse Victory (${updatedPlayer.eclipseCount}/${required} Eclipses)!`
        };
      }
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
 * Routes a drawn Classic Court (Major Arcana) onto the 3-slot Board:
 * - Slot priority: Right Parallel -> Left Event -> Center.
 * - Any displaced Minor card moves cleanly to the Veil (exact card conservation).
 * - Immediately runs evaluateCombos() to check Eclipse or Triangulation!
 */
export function placeDrawnMajorOnBoard(
  ctx: MajorMutableBoard,
  majorCardId: string,
  source: string
): GameOutcome | undefined {
  const card = ctx.cards[majorCardId]!;
  let destination: 'parallel' | 'event' | 'center' = 'parallel';

  if (ctx.boardParallel.length === 0 || !isMajorCard(ctx.cards[ctx.boardParallel[0]!])) {
    if (ctx.boardParallel.length > 0) {
      const displacedId = ctx.boardParallel.shift()!;
      ctx.veil.push(displacedId);
      ctx.newEvents.push(
        makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
          actor: 'system',
          type: 'CardMoved',
          affectedCardIds: [displacedId],
          source,
          reason: 'displaced-by-major-arrival',
          visibility: 'public',
          summary: `${ctx.cards[displacedId]!.label} displaced from Right chamber to the Veil by arriving Classic Court ${card.label}.`,
          payload: { from: 'parallel', to: 'veil' }
        })
      );
    }
    ctx.boardParallel.push(majorCardId);
    destination = 'parallel';
  } else if (ctx.boardEvent.length === 0 || !isMajorCard(ctx.cards[ctx.boardEvent[0]!])) {
    // Displace any Minor currently sitting in Left Event to Veil
    if (ctx.boardEvent.length > 0) {
      const displacedId = ctx.boardEvent.shift()!;
      ctx.veil.push(displacedId);
      ctx.newEvents.push(
        makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
          actor: 'system',
          type: 'CardMoved',
          affectedCardIds: [displacedId],
          source,
          reason: 'displaced-by-major-arrival',
          visibility: 'public',
          summary: `${ctx.cards[displacedId]!.label} displaced from Left Event to the Veil by arriving Major ${card.label}.`,
          payload: { from: 'event', to: 'veil' }
        })
      );
    }
    ctx.boardEvent.push(majorCardId);
    ctx.eventRevealed = true;
    destination = 'event';
  } else {
    // Both Parallel and Event hold Majors -> 3rd Major enters Center (triggering Eclipse or Triangulation!)
    if (ctx.boardCenter.length > 0 && !isMajorCard(ctx.cards[ctx.boardCenter[0]!])) {
      const displacedId = ctx.boardCenter.shift()!;
      ctx.veil.push(displacedId);
      ctx.centerAbandoned = false;
      ctx.abandonedByPlayerId = null;
      ctx.newEvents.push(
        makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
          actor: 'system',
          type: 'CardMoved',
          affectedCardIds: [displacedId],
          source,
          reason: 'displaced-by-major-arrival',
          visibility: 'public',
          summary: `${ctx.cards[displacedId]!.label} displaced from Center to the Veil by arriving Major ${card.label}.`,
          payload: { from: 'center', to: 'veil' }
        })
      );
    }
    ctx.boardCenter.push(majorCardId);
    ctx.centerRevealed = true;
    ctx.centerAbandoned = false;
    ctx.abandonedByPlayerId = null;
    destination = 'center';
  }

  ctx.majorPending.push({ cardId: majorCardId, dormantUntilTurn: ctx.turn + 1 });

  ctx.newEvents.push(
    makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
      actor: 'system',
      type: 'MajorArrived',
      affectedCardIds: [majorCardId],
      source,
      reason: `major-routed-to-${destination}`,
      visibility: 'public',
      summary: `Major Arcana arrived: ${card.label} (${card.shortLabel}, +${card.courtBonus ?? 1} Court) entered Board · ${destination.toUpperCase()} (dormant 1 turn).`,
      payload: {
        cardId: majorCardId,
        destination,
        courtBonus: card.courtBonus ?? null,
        dormantUntilTurn: ctx.turn + 1
      }
    })
  );

  return evaluateCombos(ctx);
}

/**
 * Draws from the top of Deck of Days for a Minor slot (Event or Center).
 * Any Major/Court cards drawn along the way are routed onto the Board (Parallel -> Event -> Center)
 * and evaluated for Eclipse / Triangulation immediately!
 */
export function drawNextMinorRoutingMajors(
  ctx: MajorMutableBoard,
  forSlot: 'event' | 'center',
  source: string
): { minorCardId: string | null; outcome?: GameOutcome } {
  while (ctx.days.length > 0) {
    // If the target slot was just occupied by a routed Major (e.g., 2nd Major took Event), stop!
    if (forSlot === 'event' && ctx.boardEvent.length > 0) {
      return { minorCardId: null };
    }
    if (forSlot === 'center' && ctx.boardCenter.length > 0) {
      return { minorCardId: null };
    }

    const nextId = ctx.days.shift()!;
    const card = ctx.cards[nextId]!;
    if (ctx.ruleset.features.majors && isMajorCard(card)) {
      const outcome = placeDrawnMajorOnBoard(ctx, nextId, source);
      if (outcome) {
        return { minorCardId: null, outcome };
      }
      continue;
    }

    return { minorCardId: nextId };
  }

  return { minorCardId: null };
}
