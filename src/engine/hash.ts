import type { GameState } from './types.js';

function fnv1a32(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Pure deterministic canonical hash over authoritative game state.
 */
export function computeStateHash(state: Omit<GameState, 'stateHash'>): string {
  const canonical = JSON.stringify({
    engineVersion: state.engineVersion,
    rulesetId: state.ruleset.id,
    rulesetVersion: state.ruleset.version,
    seed: state.seed,
    rngState: state.rngState,
    phase: state.phase,
    round: state.round,
    turn: state.turn,
    activePlayerIndex: state.activePlayerIndex,
    activePlayerId: state.activePlayerId,
    days: state.days,
    veil: state.veil,
    reserve: state.reserve,
    board: state.board,
    eventRevealed: state.eventRevealed,
    centerRevealed: state.centerRevealed,
    centerAbandoned: state.centerAbandoned,
    abandonedByPlayerId: state.abandonedByPlayerId,
    discardedCenterThisTurn: state.discardedCenterThisTurn,
    currentReading: state.currentReading,
    readingHistory: state.readingHistory,
    majorPending: state.majorPending,
    players: state.players.map((p) => ({
      id: p.id,
      primaryElement: p.primaryElement,
      lineage: p.lineage,
      hand: p.hand,
      championCardId: p.championCardId ?? null,
      eclipseCount: p.eclipseCount,
      effectUsedThisTurn: p.effectUsedThisTurn,
      pendingReaderBonuses: p.pendingReaderBonuses,
      evolutionsCompleted: p.evolutionsCompleted,
      maxChainLength: p.maxChainLength,
      turnsTaken: p.turnsTaken
    })),
    activeEffects: state.activeEffects,
    connections: state.connections,
    entropy: state.entropy,
    status: state.status,
    outcome: state.outcome ?? null
  });

  const hi = fnv1a32(canonical, 0x811c9dc5).toString(16).padStart(8, '0');
  const lo = fnv1a32(canonical, 0x9e3779b9).toString(16).padStart(8, '0');
  return `${hi}${lo}`;
}
