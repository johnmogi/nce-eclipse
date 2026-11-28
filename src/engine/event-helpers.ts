import { resolveMandatoryEvolutionChain } from './evolution.js';
import { computeStateHash } from './hash.js';
import { assertInvariants } from './invariants.js';
import type {
  Card,
  Command,
  DispatchResult,
  EventVisibility,
  GameEvent,
  GameEventType,
  GameOutcome,
  GamePhase,
  GameState,
  PlayerState,
  Ruleset,
  ValidationError
} from './types.js';

export function makeEvent(
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

export function finalizeState(draft: Omit<GameState, 'stateHash'>): GameState {
  const stateHash = computeStateHash(draft);
  const fullState: GameState = { ...draft, stateHash };
  assertInvariants(fullState);
  return fullState;
}

export function fail(state: GameState, command: Command, error: ValidationError): DispatchResult {
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

export function evaluateCompletion(
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

export function applyEvolutionWithEvents(
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
