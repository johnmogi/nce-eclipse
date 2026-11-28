import type { BatchSimulationSummary } from './runner.js';

export function formatBatchAsText(summary: BatchSimulationSummary): string {
  const lines: string[] = [
    `NEXUS CENTRAL ENGINE — SIMULATION BATCH SUMMARY`,
    `Ruleset: ${summary.rulesetId} v${summary.rulesetVersion} | Policy: ${summary.policy}`,
    `Runs: ${summary.runs} | Seed Prefix: ${summary.seedPrefix} | Elapsed: ${summary.durationMs} ms`,
    '------------------------------------------------------------',
    `Avg Turns (med/min-max): ${summary.avgTurns} (med ${summary.medianTurns}, ${summary.minTurns}-${summary.maxTurns}) | Avg Days Left: ${summary.avgDaysRemaining}`,
    `Avg Highest Rank:    ${summary.avgHighestRank} | Rank 7+: ${summary.pctReachingRank7Plus}% | Rank 9: ${summary.pctReachingRank9}%`,
    `Avg Evolutions/Game: ${summary.avgEvolutionsPerGame} | Multi-Step Chains: ${summary.multiStepChainRuns} runs (avg max ${summary.avgMaxChainLength})`,
    `Readings Given:      ${summary.totalReadings} (followed: ${summary.adviceFollowPct}%, bluffs: ${summary.deceptionPct}%, avg bonuses: ${summary.avgReaderBonuses})`,
    `Reader Opportunity:  ${Object.entries(summary.avgReadingsPerPlayer).map(([pid, avg]) => `${pid}: ${avg}/game`).join(' | ')} (parity ratio: ${summary.readerParityRatio})`,
    `Reader Bonuses:      Consumed ${summary.totalReaderBonusesConsumed} | Expired ${summary.totalReaderBonusesExpired} | Withheld on Abandon ${summary.totalWithheldOnAbandon}`,
    `Event Realities:     Treasures ${summary.totalTreasures} | Barriers Passed ${summary.totalBarriersPassed} | Trials Passed ${summary.totalTrialsPassed}`,
    `Abandonment Loop:    Abandoned ${summary.totalAbandoned} | Claimed ${summary.totalAbandonedClaimedFree} (${summary.abandonedClaimRatePct}%) | Declined ${summary.totalAbandonedDeclined} | Consecutive-Abandon Games ${summary.gamesWithConsecutiveAbandon} (win rate ${summary.winRateAfterConsecutiveAbandonPct}%)`,
    `Elemental Effects:   Air ${summary.totalAirEffects} | Fire ${summary.totalFireEffects} | Water ${summary.totalWaterEffects} | Earth ${summary.totalEarthEffects} (Revealed-Board: ${summary.totalRevealedBoardElementalActions})`,
    `Majors & Combos:     Eclipses ${summary.totalEclipsesFormed} (${summary.eclipseVictories} wins) | Triangulation Wins ${summary.triangulationVictories} | Contentions ${summary.totalMajorContentions} (Rank 7+ choices: ${summary.totalRank7MajorChoices})`,
    `Trading Market:      Windows ${summary.totalMarketWindows} | Proposals ${summary.totalTradeOffers} | Completed Trades ${summary.totalTradesCompleted}`,
    `Integrity Gates:     ${summary.invariantFailures} invariant failures, ${summary.replayFailures} replay failures`,
    '------------------------------------------------------------',
    `Element Breakdown:`
  ];

  for (const el of summary.byElement) {
    if (el.appearances === 0) continue;
    lines.push(
      `  ${el.element.padEnd(6)} | appearances: ${el.appearances} | avg rank: ${el.avgFinalRank.toFixed(2)} | win/tie share: ${el.winSharePct.toFixed(1)}%`
    );
  }

  return lines.join('\n');
}

export function formatBatchAsCsv(summary: BatchSimulationSummary): string {
  const header = [
    'seed',
    'ruleset_id',
    'ruleset_version',
    'policy',
    'outcome_reason',
    'winner_ids',
    'highest_rank',
    'turns',
    'rounds',
    'days_remaining',
    'total_evolutions',
    'max_chain_length',
    'readings_given',
    'advice_followed',
    'deceptive_readings',
    'reader_bonuses_granted',
    'reader_bonuses_consumed',
    'reader_bonuses_expired',
    'reader_bonuses_withheld_abandon',
    'treasures_claimed',
    'barriers_reconciled',
    'trials_passed',
    'centers_abandoned',
    'abandoned_claimed_free',
    'air_effects_used',
    'fire_effects_used',
    'water_effects_used',
    'earth_effects_used',
    'invariant_ok',
    'replay_verified',
    'final_state_hash'
  ].join(',');

  const rows = summary.sampleRuns.map((r) =>
    [
      r.seed,
      r.rulesetId,
      r.rulesetVersion,
      r.policy,
      r.outcomeReason,
      `"${r.winnerIds.join(';')}"`,
      r.highestRank,
      r.turns,
      r.rounds,
      r.daysRemaining,
      r.totalEvolutions,
      r.maxChainLength,
      r.readingsGiven,
      r.adviceFollowed,
      r.deceptiveReadings,
      r.readerBonusesGranted,
      r.readerBonusesConsumed,
      r.readerBonusesExpired,
      r.readerBonusesWithheldOnAbandon,
      r.treasuresClaimed,
      r.barriersReconciled,
      r.trialsPassed,
      r.centersAbandoned,
      r.abandonedClaimedFree,
      r.airEffectsUsed,
      r.fireEffectsUsed,
      r.waterEffectsUsed,
      r.earthEffectsUsed,
      r.invariantOk,
      r.replayVerified,
      r.finalStateHash
    ].join(',')
  );

  return [header, ...rows].join('\n');
}
