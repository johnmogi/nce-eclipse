import { computeStateHash } from './hash.js';
import type { GameState } from './types.js';

export interface InvariantReport {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

/**
 * Verifies hard engine invariants:
 * 1. Exact card conservation (every canonical card exists in exactly one zone).
 * 2. Board slot occupancy limits enforced per ruleset.
 * 3. Every player's lineage stack is non-empty, strictly ascending, and matches top card.
 * 4. Active player index/ID consistency.
 * 5. Phase-specific invariants (readings, abandonment, event resolution, elemental window).
 * 6. State hash integrity.
 */
export function checkInvariants(state: GameState): InvariantReport {
  const violations: string[] = [];
  const seen = new Map<string, string>();

  const track = (cardId: string, location: string): void => {
    if (!state.cards[cardId]) {
      violations.push(`Unknown card ID "${cardId}" in ${location}`);
      return;
    }
    const existing = seen.get(cardId);
    if (existing !== undefined) {
      violations.push(`Duplicate card "${cardId}" found in both ${existing} and ${location}`);
    } else {
      seen.set(cardId, location);
    }
  };

  for (const id of state.days) track(id, 'days');
  for (const id of state.veil) track(id, 'veil');
  for (const id of state.reserve) track(id, 'reserve');
  for (const id of state.board.event) track(id, 'board.event');
  for (const id of state.board.center) track(id, 'board.center');
  for (const id of state.board.parallel) track(id, 'board.parallel');
  // majorPending tracks dormancy metadata for Majors currently on the Board (not a separate physical zone)
  for (const pending of state.majorPending) {
    const onBoard =
      state.board.parallel.includes(pending.cardId) ||
      state.board.event.includes(pending.cardId) ||
      state.board.center.includes(pending.cardId);
    if (!onBoard) {
      violations.push(`Dormant majorPending "${pending.cardId}" is not currently on the Board`);
    }
  }

  for (const player of state.players) {
    for (const id of player.hand) track(id, `player(${player.id}).hand`);
    for (const id of player.lineage.cardIds) track(id, `player(${player.id}).lineage`);
    if (player.championCardId) track(player.championCardId, `player(${player.id}).champion`);

    if (player.lineage.cardIds.length === 0) {
      violations.push(`Player "${player.id}" has an empty lineage stack`);
    } else {
      let prevRank = 0;
      for (const id of player.lineage.cardIds) {
        const card = state.cards[id];
        if (!card) continue;
        if (card.rank <= prevRank) {
          violations.push(
            `Player "${player.id}" lineage rank not strictly ascending at "${id}" (${card.rank} <= ${prevRank})`
          );
        }
        prevRank = card.rank;
      }
      const topId = player.lineage.cardIds[player.lineage.cardIds.length - 1]!;
      const topCard = state.cards[topId];
      if (topCard) {
        if (
          topCard.rank !== player.lineage.rank ||
          topCard.element !== player.lineage.element ||
          topCard.color !== player.lineage.color
        ) {
          violations.push(`Player "${player.id}" lineage summary does not match top card "${topId}"`);
        }
      }
    }
  }

  for (const expectedId of state.deckCardIds) {
    if (!seen.has(expectedId)) {
      violations.push(`Missing card "${expectedId}" — disappeared from all zones`);
    }
  }

  if (seen.size !== state.deckCardIds.length) {
    violations.push(
      `Card conservation mismatch: tracked ${seen.size} cards vs expected ${state.deckCardIds.length}`
    );
  }

  const limits = state.ruleset.boardOccupancyLimits;
  if (state.board.event.length > limits.event) {
    violations.push(`board.event exceeds occupancy limit (${state.board.event.length} > ${limits.event})`);
  }
  if (state.board.center.length > limits.center) {
    violations.push(`board.center exceeds occupancy limit (${state.board.center.length} > ${limits.center})`);
  }
  if (state.board.parallel.length > limits.parallel) {
    violations.push(
      `board.parallel exceeds occupancy limit (${state.board.parallel.length} > ${limits.parallel})`
    );
  }

  const activePlayer = state.players[state.activePlayerIndex];
  if (!activePlayer || activePlayer.id !== state.activePlayerId) {
    violations.push(
      `Active player mismatch: index ${state.activePlayerIndex} vs id "${state.activePlayerId}"`
    );
  }

  if (state.phase === 'AWAITING_READING' || state.phase === 'AWAITING_READING_DECISION') {
    if (!state.currentReading) {
      violations.push(`Phase ${state.phase} requires an active currentReading record`);
    }
    if (state.board.center.length === 0) {
      violations.push(`Phase ${state.phase} requires a card in board.center`);
    }
    if (state.centerRevealed) {
      violations.push(`Phase ${state.phase} must keep Center concealed from active player`);
    }
  }

  if (state.phase === 'AWAITING_ABANDONED_CHOICE') {
    if (!state.centerAbandoned || state.board.center.length === 0 || !state.centerRevealed) {
      violations.push('AWAITING_ABANDONED_CHOICE requires a face-up abandoned card in board.center');
    }
  }

  if (state.phase === 'AWAITING_EVENT_RESOLUTION') {
    if (state.board.center.length === 0 || !state.centerRevealed) {
      violations.push('AWAITING_EVENT_RESOLUTION requires a face-up Center card');
    }
    if (state.board.event.length > 0 && !state.eventRevealed) {
      violations.push('AWAITING_EVENT_RESOLUTION requires Left Event card to be revealed');
    }
  }

  if (state.phase === 'AWAITING_ELEMENTAL_ACTION') {
    if (!state.ruleset.features.elementalEffects) {
      violations.push('AWAITING_ELEMENTAL_ACTION is invalid when features.elementalEffects is false');
    }
    if (activePlayer && activePlayer.hand.length > state.ruleset.maxHandSize) {
      violations.push('Cannot enter AWAITING_ELEMENTAL_ACTION while hand exceeds maxHandSize');
    }
  }

  if (state.phase === 'AWAITING_EARTH_REORDER') {
    const pending = state.pendingEarthReorder;
    if (!pending || pending.peekedCardIds.length === 0) {
      violations.push('AWAITING_EARTH_REORDER requires active pendingEarthReorder with peekedCardIds');
    } else {
      const expectedIds: string[] = [];
      for (const slot of pending.boardSlots) {
        const slotArr =
          slot === 'event'
            ? state.board.event
            : slot === 'center'
              ? state.board.center
              : state.board.parallel;
        if (slotArr.length === 0) {
          violations.push(`pendingEarthReorder references empty board slot "${slot}"`);
        } else {
          expectedIds.push(slotArr[0]!);
        }
      }
      if (state.days.length < pending.daysCount) {
        violations.push('pendingEarthReorder daysCount exceeds remaining Deck of Days cards');
      } else {
        expectedIds.push(...state.days.slice(0, pending.daysCount));
      }
      if (
        expectedIds.length !== pending.peekedCardIds.length ||
        expectedIds.some((id, idx) => id !== pending.peekedCardIds[idx])
      ) {
        violations.push('pendingEarthReorder cards do not match targeted Board/Days slots');
      }
    }
  }

  const expectedHash = computeStateHash(state);
  if (state.stateHash !== expectedHash) {
    violations.push(`State hash mismatch: stored "${state.stateHash}" vs computed "${expectedHash}"`);
  }

  return { ok: violations.length === 0, violations };
}

export function assertInvariants(state: GameState): void {
  const report = checkInvariants(state);
  if (!report.ok) {
    throw new Error(`Engine invariant violation(s):\n- ${report.violations.join('\n- ')}`);
  }
}
