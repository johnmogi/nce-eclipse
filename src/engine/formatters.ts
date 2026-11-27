import type { ProjectedGameView } from './types.js';

/**
 * Formats a projected game view's event log into a clean human-readable transcript.
 * Because it consumes ProjectedGameView, Player views stay strictly masked and never leak secrets.
 */
export function formatEventsAsText(view: ProjectedGameView): string {
  const scope =
    view.viewer.role === 'admin'
      ? 'ADMIN (GOD MODE)'
      : `PLAYER-SAFE (${view.viewer.playerId.toUpperCase()})`;

  const lines: string[] = [
    `NEXUS CENTRAL ENGINE — EVENT LOG`,
    `Engine: ${view.engineVersion} | Ruleset: ${view.ruleset.id} v${view.ruleset.version}`,
    `Seed: ${view.seed ?? '[redacted]'} | Scope: ${scope}`,
    `Status: ${view.status} | Round ${view.round}, Turn ${view.turn} | Phase: ${view.phase}`,
    `State Hash: ${view.stateHash}`,
    '------------------------------------------------------------'
  ];

  for (const ev of view.events) {
    lines.push(`[#${String(ev.seq).padStart(3, '0')} | R${ev.round}·T${ev.turn} | ${ev.type}] ${ev.summary}`);
  }

  if (view.outcome) {
    lines.push('------------------------------------------------------------');
    lines.push(`OUTCOME: ${view.outcome.summary}`);
  }

  return lines.join('\n');
}
