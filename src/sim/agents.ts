import { isEligibleEvolution } from '../engine/evolution.js';
import { evaluateReconciliation, eventCardToReality } from '../engine/reconciliation.js';
import { isCardObjectivelyHelpful } from '../engine/reducer.js';
import type { Card, Command, GameState, PlayerState, ReadingAdvice, Ruleset } from '../engine/types.js';

export type AgentPolicyId =
  | 'bluffing-rival'
  | 'evolution-greedy'
  | 'selective-chain'
  | 'always-claim';

function cardMatchesFutureLineage(
  player: PlayerState,
  card: Card,
  ruleset: Ruleset
): boolean {
  if (card.family !== 'classic-number' || !card.color || !card.element) return false;
  if (card.rank <= player.lineage.rank) return false;
  if (ruleset.allowedEvolutionColors === 'same-element') {
    return card.element === player.lineage.element;
  }
  if (ruleset.allowedEvolutionColors === 'same-color') {
    return card.color === player.lineage.color;
  }
  return true;
}

function chooseWorstHandCardToDiscard(state: GameState, player: PlayerState): string {
  const scored = player.hand.map((id) => {
    const card = state.cards[id]!;
    const useful = cardMatchesFutureLineage(player, card, state.ruleset) ? 10 : 0;
    const rankGap =
      card.rank > player.lineage.rank ? Math.max(0, 6 - (card.rank - player.lineage.rank)) : -5;
    return { id, score: useful + rankGap };
  });
  scored.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return scored[0]!.id;
}

/**
 * Finds the cheapest valid sacrifice combination (0, 1, or 2 cards) to reconcile a Barrier/Trial.
 */
function findCheapestLegalSacrifice(
  state: GameState,
  player: PlayerState,
  eventCard: Card,
  centerCard: Card
): string[] | null {
  // Try 0 cards first
  const zero = evaluateReconciliation({
    player,
    eventCard,
    centerCard,
    sacrificeCardIds: [],
    cards: state.cards,
    ruleset: state.ruleset
  });
  if (zero.passes) return [];

  // Rank hand cards from least valuable to keep -> most valuable to keep
  const sortedHand = [...player.hand].sort((a, b) => {
    const ca = state.cards[a]!;
    const cb = state.cards[b]!;
    const keepA = cardMatchesFutureLineage(player, ca, state.ruleset) ? 10 : 0;
    const keepB = cardMatchesFutureLineage(player, cb, state.ruleset) ? 10 : 0;
    if (keepA !== keepB) return keepA - keepB;
    if (ca.vp !== cb.vp) return ca.vp - cb.vp;
    return a.localeCompare(b);
  });

  // Try 1-card sacrifices
  for (const id of sortedHand) {
    const check = evaluateReconciliation({
      player,
      eventCard,
      centerCard,
      sacrificeCardIds: [id],
      cards: state.cards,
      ruleset: state.ruleset
    });
    if (check.passes) return [id];
  }

  // Try 2-card sacrifices
  for (let i = 0; i < sortedHand.length; i++) {
    for (let j = i + 1; j < sortedHand.length; j++) {
      const pair = [sortedHand[i]!, sortedHand[j]!];
      const check = evaluateReconciliation({
        player,
        eventCard,
        centerCard,
        sacrificeCardIds: pair,
        cards: state.cards,
        ruleset: state.ruleset
      });
      if (check.passes) return pair;
    }
  }

  return null;
}

export function chooseReaderAdvice(state: GameState, policy: AgentPolicyId): ReadingAdvice {
  const centerId = state.board.center[0];
  const reading = state.currentReading;
  if (!centerId || !reading) return 'good';

  const card = state.cards[centerId]!;
  const recipient = state.players.find((p) => p.id === reading.recipientId)!;
  const reader = state.players.find((p) => p.id === reading.readerId)!;

  const evolvesNow = isEligibleEvolution(recipient.lineage, card, state.ruleset);
  const helpful = isCardObjectivelyHelpful(recipient, card, state.ruleset);

  if (policy === 'bluffing-rival') {
    if (evolvesNow && recipient.lineage.rank >= reader.lineage.rank) {
      return 'bad';
    }
    if (!helpful && state.turn % 2 === 0) {
      return 'good';
    }
    return helpful ? 'good' : 'bad';
  }

  return helpful ? 'good' : 'bad';
}

/**
 * Deterministic policy selecting the next legal command for Milestones A + B + C.
 */
export function chooseNextCommand(state: GameState, policy: AgentPolicyId): Command | null {
  if (state.status !== 'playing') return null;

  const player = state.players[state.activePlayerIndex]!;
  const playerId = player.id;

  if (state.phase === 'AWAITING_ABANDONED_CHOICE') {
    const centerId = state.board.center[0];
    if (!centerId) return { type: 'EndTurn', playerId };
    const card = state.cards[centerId]!;
    const helpful = isCardObjectivelyHelpful(player, card, state.ruleset);
    if (policy === 'always-claim' || helpful || player.hand.length <= 2) {
      return { type: 'ClaimAbandonedCard', playerId };
    }
    return { type: 'DeclineAbandonedCard', playerId };
  }

  if (state.phase === 'AWAITING_READING' && state.currentReading) {
    return {
      type: 'GiveReading',
      playerId: state.currentReading.readerId,
      advice: chooseReaderAdvice(state, policy)
    };
  }

  if (state.phase === 'AWAITING_READING_DECISION' && state.currentReading?.advice) {
    const advice = state.currentReading.advice;
    const hints = state.currentReading.hints;

    if (policy === 'always-claim') {
      return { type: 'PursueCenter', playerId };
    }

    if (
      hints?.color &&
      state.ruleset.allowedEvolutionColors === 'same-color' &&
      hints.color !== player.lineage.color
    ) {
      return { type: 'DiscardCenter', playerId };
    }

    if (policy === 'bluffing-rival') {
      const priorDeceptions = state.readingHistory.filter(
        (r) => r.recipientId === playerId && r.adviceTruthful === false
      ).length;
      if (priorDeceptions > 0 && state.turn % 3 === 0) {
        return advice === 'good'
          ? { type: 'DiscardCenter', playerId }
          : { type: 'PursueCenter', playerId };
      }
    }

    return advice === 'good'
      ? { type: 'PursueCenter', playerId }
      : { type: 'DiscardCenter', playerId };
  }

  if (state.phase === 'AWAITING_EVENT_RESOLUTION') {
    const eventId = state.board.event[0];
    const centerId = state.board.center[0];
    if (!eventId || !centerId) return { type: 'EndTurn', playerId };
    const eventCard = state.cards[eventId]!;
    const centerCard = state.cards[centerId]!;
    const reality = eventCardToReality(eventCard);

    if (reality === 'treasure') {
      return { type: 'ResolveEvent', playerId, sacrificeCardIds: [] };
    }

    const sac = findCheapestLegalSacrifice(state, player, eventCard, centerCard);
    if (sac === null) {
      return { type: 'AbandonCenter', playerId };
    }

    const evolvesNow = isEligibleEvolution(player.lineage, centerCard, state.ruleset);
    const futureUseful = cardMatchesFutureLineage(player, centerCard, state.ruleset);

    // If free (0 sacrifice) or card helps our lineage or always-claim -> reconcile!
    if (sac.length === 0 || evolvesNow || futureUseful || policy === 'always-claim') {
      return { type: 'ResolveEvent', playerId, sacrificeCardIds: sac };
    }

    // Otherwise don't waste a hand card on a dead Center card -> abandon!
    return { type: 'AbandonCenter', playerId };
  }

  if (state.phase === 'AWAITING_HAND_DISCARD') {
    return {
      type: 'DiscardHandCard',
      playerId,
      cardId: chooseWorstHandCardToDiscard(state, player)
    };
  }

  if (state.phase === 'READY_TO_END_TURN') {
    return { type: 'EndTurn', playerId };
  }

  if (state.phase === 'AWAITING_CENTER_DECISION') {
    const centerId = state.board.center[0];
    if (!centerId) return { type: 'EndTurn', playerId };
    const centerCard = state.cards[centerId]!;

    if (policy === 'always-claim' || isEligibleEvolution(player.lineage, centerCard, state.ruleset)) {
      return { type: 'ClaimCenterCard', playerId };
    }
    const helpsFuture = cardMatchesFutureLineage(player, centerCard, state.ruleset);
    if (policy === 'selective-chain') {
      return helpsFuture
        ? { type: 'ClaimCenterCard', playerId }
        : { type: 'DiscardCenterCard', playerId };
    }
    return helpsFuture || player.hand.length < state.ruleset.maxHandSize - 1
      ? { type: 'ClaimCenterCard', playerId }
      : { type: 'DiscardCenterCard', playerId };
  }

  return null;
}
