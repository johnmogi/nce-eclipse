import { ELEMENTS } from '../engine/cards.js';
import { checkInvariants } from '../engine/invariants.js';
import { createGame, dispatch, replay } from '../engine/reducer.js';
import type { Command, Element, GameState, Ruleset } from '../engine/types.js';
import { chooseNextCommand, type AgentPolicyId } from './agents.js';

export interface SingleRunReport {
  readonly seed: string;
  readonly rulesetId: string;
  readonly rulesetVersion: string;
  readonly policy: AgentPolicyId;
  readonly outcomeReason: string;
  readonly winnerIds: readonly string[];
  readonly highestRank: number;
  readonly turns: number;
  readonly rounds: number;
  readonly daysRemaining: number;
  readonly totalEvolutions: number;
  readonly maxChainLength: number;
  readonly readingsGiven: number;
  readonly adviceFollowed: number;
  readonly deceptiveReadings: number;
  readonly readerBonusesGranted: number;
  readonly readerBonusesConsumed: number;
  readonly readerBonusesExpired: number;
  readonly readerBonusesWithheldOnAbandon: number;
  readonly treasuresClaimed: number;
  readonly barriersReconciled: number;
  readonly trialsPassed: number;
  readonly centersAbandoned: number;
  readonly abandonedClaimedFree: number;
  readonly airEffectsUsed: number;
  readonly fireEffectsUsed: number;
  readonly waterEffectsUsed: number;
  readonly earthEffectsUsed: number;
  readonly eclipsesFormed: number;
  readonly triangulationsCompleted: number;
  readonly finalStateHash: string;
  readonly replayVerified: boolean;
  readonly invariantOk: boolean;
  readonly commands: readonly Command[];
  readonly playerFinalRanks: readonly {
    playerId: string;
    primaryElement: Element;
    rank: number;
    evolutions: number;
  }[];
}

export interface ElementSummary {
  readonly element: Element;
  readonly appearances: number;
  readonly avgFinalRank: number;
  readonly winSharePct: number;
}

export interface BatchSimulationSummary {
  readonly rulesetId: string;
  readonly rulesetVersion: string;
  readonly policy: AgentPolicyId;
  readonly runs: number;
  readonly seedPrefix: string;
  readonly durationMs: number;
  readonly targetReachedCount: number;
  readonly targetReachedPct: number;
  readonly daysExhaustedCount: number;
  readonly invariantFailures: number;
  readonly replayFailures: number;
  readonly avgTurns: number;
  readonly minTurns: number;
  readonly maxTurns: number;
  readonly avgDaysRemaining: number;
  readonly avgHighestRank: number;
  readonly pctReachingRank7Plus: number;
  readonly pctReachingRank9: number;
  readonly avgEvolutionsPerGame: number;
  readonly avgMaxChainLength: number;
  readonly multiStepChainRuns: number;
  readonly totalReadings: number;
  readonly adviceFollowPct: number;
  readonly deceptionPct: number;
  readonly avgReaderBonuses: number;
  readonly totalReaderBonusesConsumed: number;
  readonly totalReaderBonusesExpired: number;
  readonly totalTreasures: number;
  readonly totalBarriersPassed: number;
  readonly totalTrialsPassed: number;
  readonly totalAbandoned: number;
  readonly totalAbandonedClaimedFree: number;
  readonly totalWithheldOnAbandon: number;
  readonly totalAirEffects: number;
  readonly totalFireEffects: number;
  readonly totalWaterEffects: number;
  readonly totalEarthEffects: number;
  readonly totalEclipsesFormed: number;
  readonly eclipseVictories: number;
  readonly triangulationVictories: number;
  readonly byElement: readonly ElementSummary[];
  readonly sampleRuns: readonly SingleRunReport[];
}

export function runSingleSimulation(
  ruleset: Ruleset,
  seed: string,
  policy: AgentPolicyId,
  options: { verifyReplay?: boolean; maxSteps?: number } = {}
): SingleRunReport {
  const maxSteps = options.maxSteps ?? 800;
  let state: GameState = createGame(ruleset, seed);
  let steps = 0;

  while (state.status === 'playing' && steps < maxSteps) {
    const cmd = chooseNextCommand(state, policy);
    if (!cmd) break;
    const res = dispatch(state, cmd);
    if (!res.ok) {
      throw new Error(
        `Simulation policy produced illegal command on seed "${seed}": ${res.error.message}`
      );
    }
    state = res.state;
    steps += 1;
  }

  const invariantOk = checkInvariants(state).ok;
  const commands = state.commandHistory.map((r) => r.command);

  let replayVerified = true;
  if (options.verifyReplay) {
    const rep = replay(seed, ruleset, commands);
    replayVerified = rep.ok && rep.finalState.stateHash === state.stateHash;
  }

  const totalEvolutions = state.players.reduce((sum, p) => sum + p.evolutionsCompleted, 0);
  const maxChainLength = Math.max(0, ...state.players.map((p) => p.maxChainLength));
  const readerBonusesGranted = state.players.reduce(
    (sum, p) => sum + p.pendingReaderBonuses.length,
    0
  );
  const readerBonusesConsumed = state.events.filter((e) => e.type === 'ReaderBonusConsumed').length;
  const readerBonusesExpired = state.events.filter((e) => e.type === 'ReaderBonusExpired').length;
  const readingsGiven = state.readingHistory.length;
  const adviceFollowed = state.readingHistory.filter((r) => r.adviceFollowed === true).length;
  const deceptiveReadings = state.readingHistory.filter((r) => r.adviceTruthful === false).length;
  const readerBonusesWithheldOnAbandon = state.readingHistory.filter(
    (r) => r.readerReward === 'withheld' && r.readerRewardReason === 'abandoned_before_claim'
  ).length;

  const treasuresClaimed = state.events.filter((e) => e.type === 'TreasureClaimed').length;
  const barriersReconciled = state.events.filter((e) => e.type === 'BarrierReconciled').length;
  const trialsPassed = state.events.filter((e) => e.type === 'TrialPassed').length;
  const centersAbandoned = state.events.filter((e) => e.type === 'CenterAbandoned').length;
  const abandonedClaimedFree = state.events.filter((e) => e.type === 'AbandonedCardClaimed').length;
  const eclipsesFormed = state.events.filter((e) => e.type === 'EclipseFormed').length;
  const triangulationsCompleted = state.events.filter((e) => e.type === 'TriangulationCompleted').length;

  let airEffectsUsed = 0;
  let fireEffectsUsed = 0;
  let waterEffectsUsed = 0;
  let earthEffectsUsed = 0;
  for (const ev of state.events) {
    if (ev.type === 'ElementalEffectResolved') {
      const el = ev.payload?.element;
      if (el === 'air') airEffectsUsed += 1;
      else if (el === 'fire') fireEffectsUsed += 1;
      else if (el === 'water') waterEffectsUsed += 1;
      else if (el === 'earth') earthEffectsUsed += 1;
    }
  }

  return {
    seed,
    rulesetId: ruleset.id,
    rulesetVersion: ruleset.version,
    policy,
    outcomeReason: state.outcome?.reason ?? 'step_limit',
    winnerIds: state.outcome?.winnerIds ?? [],
    highestRank:
      state.outcome?.highestRank ?? Math.max(...state.players.map((p) => p.lineage.rank)),
    turns: state.turn,
    rounds: state.round,
    daysRemaining: state.days.length,
    totalEvolutions,
    maxChainLength,
    readingsGiven,
    adviceFollowed,
    deceptiveReadings,
    readerBonusesGranted,
    readerBonusesConsumed,
    readerBonusesExpired,
    readerBonusesWithheldOnAbandon,
    treasuresClaimed,
    barriersReconciled,
    trialsPassed,
    centersAbandoned,
    abandonedClaimedFree,
    airEffectsUsed,
    fireEffectsUsed,
    waterEffectsUsed,
    earthEffectsUsed,
    eclipsesFormed,
    triangulationsCompleted,
    finalStateHash: state.stateHash,
    replayVerified,
    invariantOk,
    commands,
    playerFinalRanks: state.players.map((p) => ({
      playerId: p.id,
      primaryElement: p.primaryElement,
      rank: p.lineage.rank,
      evolutions: p.evolutionsCompleted
    }))
  };
}

export function runSimulationBatch(params: {
  ruleset: Ruleset;
  runs: number;
  seedPrefix: string;
  policy: AgentPolicyId;
  verifyReplaySample?: number;
  maxSampleRuns?: number;
}): BatchSimulationSummary {
  const start = Date.now();
  const { ruleset, runs, seedPrefix, policy } = params;
  const verifyReplaySample = params.verifyReplaySample ?? Math.min(runs, 20);
  const maxSampleRuns = params.maxSampleRuns ?? 25;

  let targetReachedCount = 0;
  let daysExhaustedCount = 0;
  let invariantFailures = 0;
  let replayFailures = 0;
  let totalTurns = 0;
  let minTurns = Infinity;
  let maxTurns = 0;
  let totalDaysRemaining = 0;
  let totalHighestRank = 0;
  let reachedRank7Plus = 0;
  let reachedRank9 = 0;
  let totalEvolutions = 0;
  let totalMaxChain = 0;
  let multiStepChainRuns = 0;
  let totalReadings = 0;
  let totalAdviceFollowed = 0;
  let totalDeceptive = 0;
  let totalReaderBonuses = 0;
  let totalReaderBonusesConsumed = 0;
  let totalReaderBonusesExpired = 0;
  let totalTreasures = 0;
  let totalBarriersPassed = 0;
  let totalTrialsPassed = 0;
  let totalAbandoned = 0;
  let totalAbandonedClaimedFree = 0;
  let totalWithheldOnAbandon = 0;
  let totalAirEffects = 0;
  let totalFireEffects = 0;
  let totalWaterEffects = 0;
  let totalEarthEffects = 0;
  let totalEclipsesFormed = 0;
  let eclipseVictories = 0;
  let triangulationVictories = 0;

  const elementStats: Record<Element, { appearances: number; rankSum: number; wins: number }> = {
    air: { appearances: 0, rankSum: 0, wins: 0 },
    fire: { appearances: 0, rankSum: 0, wins: 0 },
    water: { appearances: 0, rankSum: 0, wins: 0 },
    earth: { appearances: 0, rankSum: 0, wins: 0 }
  };

  const sampleRuns: SingleRunReport[] = [];

  for (let i = 0; i < runs; i++) {
    const seed = `${seedPrefix}-${String(i + 1).padStart(4, '0')}`;
    const report = runSingleSimulation(ruleset, seed, policy, {
      verifyReplay: i < verifyReplaySample
    });

    if (report.outcomeReason === 'target_rank_reached') targetReachedCount += 1;
    if (report.outcomeReason === 'days_exhausted') daysExhaustedCount += 1;
    if (report.outcomeReason === 'eclipse_victory') eclipseVictories += 1;
    if (report.outcomeReason === 'triangulation_victory') triangulationVictories += 1;
    if (!report.invariantOk) invariantFailures += 1;
    if (!report.replayVerified) replayFailures += 1;

    totalTurns += report.turns;
    minTurns = Math.min(minTurns, report.turns);
    maxTurns = Math.max(maxTurns, report.turns);
    totalDaysRemaining += report.daysRemaining;
    totalHighestRank += report.highestRank;
    if (report.highestRank >= 7) reachedRank7Plus += 1;
    if (report.highestRank >= 9) reachedRank9 += 1;
    totalEvolutions += report.totalEvolutions;
    totalMaxChain += report.maxChainLength;
    if (report.maxChainLength >= 2) multiStepChainRuns += 1;
    totalReadings += report.readingsGiven;
    totalAdviceFollowed += report.adviceFollowed;
    totalDeceptive += report.deceptiveReadings;
    totalReaderBonuses += report.readerBonusesGranted;
    totalReaderBonusesConsumed += report.readerBonusesConsumed;
    totalReaderBonusesExpired += report.readerBonusesExpired;
    totalTreasures += report.treasuresClaimed;
    totalBarriersPassed += report.barriersReconciled;
    totalTrialsPassed += report.trialsPassed;
    totalAbandoned += report.centersAbandoned;
    totalAbandonedClaimedFree += report.abandonedClaimedFree;
    totalWithheldOnAbandon += report.readerBonusesWithheldOnAbandon;
    totalAirEffects += report.airEffectsUsed;
    totalFireEffects += report.fireEffectsUsed;
    totalWaterEffects += report.waterEffectsUsed;
    totalEarthEffects += report.earthEffectsUsed;
    totalEclipsesFormed += report.eclipsesFormed;

    for (const pr of report.playerFinalRanks) {
      const bucket = elementStats[pr.primaryElement];
      bucket.appearances += 1;
      bucket.rankSum += pr.rank;
      if (report.winnerIds.includes(pr.playerId)) {
        bucket.wins += 1;
      }
    }

    if (sampleRuns.length < maxSampleRuns) {
      sampleRuns.push(report);
    }
  }

  const safeRuns = Math.max(1, runs);
  const safeReadings = Math.max(1, totalReadings);
  const byElement: ElementSummary[] = ELEMENTS.map((el) => {
    const s = elementStats[el];
    return {
      element: el,
      appearances: s.appearances,
      avgFinalRank: s.appearances > 0 ? Number((s.rankSum / s.appearances).toFixed(2)) : 0,
      winSharePct: s.appearances > 0 ? Number(((s.wins / s.appearances) * 100).toFixed(1)) : 0
    };
  });

  return {
    rulesetId: ruleset.id,
    rulesetVersion: ruleset.version,
    policy,
    runs,
    seedPrefix,
    durationMs: Date.now() - start,
    targetReachedCount,
    targetReachedPct: Number(((targetReachedCount / safeRuns) * 100).toFixed(1)),
    daysExhaustedCount,
    invariantFailures,
    replayFailures,
    avgTurns: Number((totalTurns / safeRuns).toFixed(2)),
    minTurns: runs > 0 ? minTurns : 0,
    maxTurns,
    avgDaysRemaining: Number((totalDaysRemaining / safeRuns).toFixed(2)),
    avgHighestRank: Number((totalHighestRank / safeRuns).toFixed(2)),
    pctReachingRank7Plus: Number(((reachedRank7Plus / safeRuns) * 100).toFixed(1)),
    pctReachingRank9: Number(((reachedRank9 / safeRuns) * 100).toFixed(1)),
    avgEvolutionsPerGame: Number((totalEvolutions / safeRuns).toFixed(2)),
    avgMaxChainLength: Number((totalMaxChain / safeRuns).toFixed(2)),
    multiStepChainRuns,
    totalReadings,
    adviceFollowPct: totalReadings > 0 ? Number(((totalAdviceFollowed / safeReadings) * 100).toFixed(1)) : 0,
    deceptionPct: totalReadings > 0 ? Number(((totalDeceptive / safeReadings) * 100).toFixed(1)) : 0,
    avgReaderBonuses: Number((totalReaderBonuses / safeRuns).toFixed(2)),
    totalReaderBonusesConsumed,
    totalReaderBonusesExpired,
    totalTreasures,
    totalBarriersPassed,
    totalTrialsPassed,
    totalAbandoned,
    totalAbandonedClaimedFree,
    totalWithheldOnAbandon,
    totalAirEffects,
    totalFireEffects,
    totalWaterEffects,
    totalEarthEffects,
    totalEclipsesFormed,
    eclipseVictories,
    triangulationVictories,
    byElement,
    sampleRuns
  };
}
