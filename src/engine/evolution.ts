import type { Card, LineageState, PlayerState, Ruleset } from './types.js';

export interface EvolutionStep {
  readonly fromCard: Card;
  readonly toCard: Card;
  readonly rankDelta: number;
  readonly matchReason: string;
  readonly tieBreakApplied: boolean;
  readonly competingCandidateIds: readonly string[];
}

export interface EvolutionResolution {
  readonly player: PlayerState;
  readonly steps: readonly EvolutionStep[];
}

export function isEligibleEvolution(
  lineage: LineageState,
  candidate: Card,
  ruleset: Ruleset
): boolean {
  if (candidate.family !== 'classic-number') return false;
  if (!candidate.element || !candidate.color) return false;

  const delta = candidate.rank - lineage.rank;
  if (delta < 1 || delta > ruleset.maxEvolutionJump) {
    return false;
  }

  switch (ruleset.allowedEvolutionColors) {
    case 'same-element':
      return candidate.element === lineage.element;
    case 'same-color':
      return candidate.color === lineage.color;
    case 'any':
      return true;
  }
}

function compareCandidates(
  lineage: LineageState,
  a: Card,
  b: Card,
  ruleset: Ruleset
): number {
  const sameElA = a.element === lineage.element ? 0 : 1;
  const sameElB = b.element === lineage.element ? 0 : 1;

  switch (ruleset.evolutionTieBreak) {
    case 'lowest-rank-same-element': {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (sameElA !== sameElB) return sameElA - sameElB;
      return a.id.localeCompare(b.id);
    }
    case 'lowest-rank-first': {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.id.localeCompare(b.id);
    }
    case 'highest-jump-first': {
      if (a.rank !== b.rank) return b.rank - a.rank;
      if (sameElA !== sameElB) return sameElA - sameElB;
      return a.id.localeCompare(b.id);
    }
  }
}

export function findEligibleEvolutions(
  lineage: LineageState,
  handIds: readonly string[],
  cards: Readonly<Record<string, Card>>,
  ruleset: Ruleset
): Card[] {
  const candidates: Card[] = [];
  for (const id of handIds) {
    const card = cards[id];
    if (card && isEligibleEvolution(lineage, card, ruleset)) {
      candidates.push(card);
    }
  }
  candidates.sort((a, b) => compareCandidates(lineage, a, b, ruleset));
  return candidates;
}

/**
 * Mandatory chained personal evolution:
 * Repeatedly consumes the highest-priority eligible card from the player's hand
 * and advances their lineage until no eligible evolution remains.
 */
export function resolveMandatoryEvolutionChain(
  player: PlayerState,
  cards: Readonly<Record<string, Card>>,
  ruleset: Ruleset
): EvolutionResolution {
  let currentHand = [...player.hand];
  let currentLineage: LineageState = {
    ...player.lineage,
    cardIds: [...player.lineage.cardIds]
  };
  const steps: EvolutionStep[] = [];

  while (true) {
    const candidates = findEligibleEvolutions(currentLineage, currentHand, cards, ruleset);
    if (candidates.length === 0) break;

    const chosen = candidates[0]!;
    const fromCardId = currentLineage.cardIds[currentLineage.cardIds.length - 1]!;
    const fromCard = cards[fromCardId]!;
    const rankDelta = chosen.rank - currentLineage.rank;
    const relation =
      chosen.element === currentLineage.element
        ? 'same element'
        : chosen.color === currentLineage.color
          ? 'same color'
          : 'cross-color';

    const matchReason = `${relation}, +${rankDelta} rank${rankDelta > 1 ? 's' : ''}`;

    currentHand = currentHand.filter((id) => id !== chosen.id);
    currentLineage = {
      rank: chosen.rank,
      element: chosen.element!,
      color: chosen.color!,
      cardIds: [...currentLineage.cardIds, chosen.id]
    };

    steps.push({
      fromCard,
      toCard: chosen,
      rankDelta,
      matchReason,
      tieBreakApplied: candidates.length > 1,
      competingCandidateIds: candidates.map((c) => c.id)
    });
  }

  if (steps.length === 0) {
    return { player, steps };
  }

  const updatedPlayer: PlayerState = {
    ...player,
    hand: currentHand,
    lineage: currentLineage,
    evolutionsCompleted: player.evolutionsCompleted + steps.length,
    maxChainLength: Math.max(player.maxChainLength, steps.length)
  };

  return { player: updatedPlayer, steps };
}
