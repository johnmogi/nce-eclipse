import type { Command, Ruleset } from '../../engine/index.js';
import type { AgentPolicyId } from '../../sim/agents.js';
import { formatBatchAsCsv, formatBatchAsText } from '../../sim/formatters.js';
import type { BatchSimulationSummary } from '../../sim/runner.js';

export function SimulationLabView({
  ruleset,
  simRuns,
  simPolicy,
  simSeedPrefix,
  simSummary,
  onSetSimPolicy,
  onSetSimSeedPrefix,
  onRunBatch,
  onCopyText,
  onDownloadBlob,
  onInspectRun
}: {
  ruleset: Ruleset;
  simRuns: number;
  simPolicy: AgentPolicyId;
  simSeedPrefix: string;
  simSummary: BatchSimulationSummary | null;
  onSetSimPolicy: (policy: AgentPolicyId) => void;
  onSetSimSeedPrefix: (prefix: string) => void;
  onRunBatch: (runs: number) => void;
  onCopyText: (text: string, label: string) => void;
  onDownloadBlob: (filename: string, content: string, mime: string) => void;
  onInspectRun: (seed: string, commands: readonly Command[], watchTurnByTurn: boolean) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          Deterministic Batch Simulation Lab · {ruleset.id} (v{ruleset.version})
        </h2>
        <div className="toolbar-group">
          {simSummary && (
            <>
              <button
                className="btn btn-sm btn-primary"
                onClick={() =>
                  onCopyText(
                    formatBatchAsText(simSummary),
                    'Copied Simulation Summary (TXT) to clipboard.'
                  )
                }
              >
                Copy Summary
              </button>
              <button
                className="btn btn-sm"
                onClick={() =>
                  onDownloadBlob(
                    `nce-batch-${simSummary.rulesetId}-${simSummary.seedPrefix}.csv`,
                    formatBatchAsCsv(simSummary),
                    'text/csv'
                  )
                }
              >
                Export CSV
              </button>
              <button
                className="btn btn-sm"
                onClick={() =>
                  onDownloadBlob(
                    `nce-batch-${simSummary.rulesetId}-${simSummary.seedPrefix}.json`,
                    JSON.stringify(simSummary, null, 2),
                    'application/json'
                  )
                }
              >
                Export JSON
              </button>
            </>
          )}
        </div>
      </div>

      <div className="toolbar-group">
        <select
          className="select"
          value={simPolicy}
          onChange={(e) => onSetSimPolicy(e.target.value as AgentPolicyId)}
        >
          <option value="bluffing-rival">Policy: bluffing-rival</option>
          <option value="evolution-greedy">Policy: evolution-greedy</option>
          <option value="always-claim">Policy: always-claim</option>
        </select>

        <input
          className="input mono"
          value={simSeedPrefix}
          onChange={(e) => onSetSimSeedPrefix(e.target.value)}
          placeholder="seed-prefix"
        />

        {[10, 50, 100, 500].map((n) => (
          <button
            key={n}
            className={`btn ${simRuns === n && simSummary ? 'btn-active' : 'btn-primary'}`}
            onClick={() => onRunBatch(n)}
          >
            Run {n} Games
          </button>
        ))}
      </div>

      {simSummary && (
        <>
          <div className="metrics-grid">
            <div className="metric-box">
              <div className="metric-label">Avg Turns</div>
              <div className="metric-value">{simSummary.avgTurns}</div>
              <div className="brand-sub">
                range {simSummary.minTurns}–{simSummary.maxTurns}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Evolution Reach</div>
              <div className="metric-value">Rank {simSummary.avgHighestRank}</div>
              <div className="brand-sub">
                7+: {simSummary.pctReachingRank7Plus}% · 9: {simSummary.pctReachingRank9}%
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Realities Resolved</div>
              <div className="metric-value">
                {simSummary.totalTreasures}T / {simSummary.totalBarriersPassed}B /{' '}
                {simSummary.totalTrialsPassed}Tr
              </div>
              <div className="brand-sub">
                Abandoned: {simSummary.totalAbandoned} (claimed free:{' '}
                {simSummary.totalAbandonedClaimedFree})
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Elemental Effects (D1)</div>
              <div className="metric-value">
                {simSummary.totalAirEffects}♠ / {simSummary.totalFireEffects}♣ /{' '}
                {simSummary.totalWaterEffects}♥ / {simSummary.totalEarthEffects}♦
              </div>
              <div className="brand-sub">
                Reader Bonuses: {simSummary.totalReaderBonusesConsumed} used ·{' '}
                {simSummary.totalReaderBonusesExpired} expired
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Readings &amp; Rewards</div>
              <div className="metric-value">{simSummary.adviceFollowPct}% followed</div>
              <div className="brand-sub">
                Bluffs: {simSummary.deceptionPct}% · Withheld on abandon:{' '}
                {simSummary.totalWithheldOnAbandon}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">Integrity Gates</div>
              <div className="metric-value">
                {simSummary.invariantFailures === 0 && simSummary.replayFailures === 0
                  ? 'PASS'
                  : 'FAIL'}
              </div>
              <div className="brand-sub">
                {simSummary.durationMs} ms · {simSummary.invariantFailures} inv /{' '}
                {simSummary.replayFailures} replay errs
              </div>
            </div>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Seed</th>
                <th>Turns</th>
                <th>Top Rank</th>
                <th>T / B / Tr</th>
                <th>Elemental (♠/♣/♥/♦)</th>
                <th>Bonuses Used</th>
                <th>Final Hash</th>
                <th>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {simSummary.sampleRuns.map((r) => (
                <tr key={r.seed}>
                  <td className="mono">{r.seed}</td>
                  <td>{r.turns}</td>
                  <td>{r.highestRank}</td>
                  <td>
                    {r.treasuresClaimed} / {r.barriersReconciled} / {r.trialsPassed}
                  </td>
                  <td>
                    {r.airEffectsUsed} / {r.fireEffectsUsed} / {r.waterEffectsUsed} /{' '}
                    {r.earthEffectsUsed}
                  </td>
                  <td>{r.readerBonusesConsumed}</td>
                  <td className="mono">{r.finalStateHash}</td>
                  <td>
                    <div className="toolbar-group">
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => onInspectRun(r.seed, r.commands, true)}
                      >
                        ▶ Watch Turn by Turn
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => onInspectRun(r.seed, r.commands, false)}
                      >
                        End State
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
