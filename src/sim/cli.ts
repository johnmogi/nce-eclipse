import { RULESET_PRESETS } from '../engine/rulesets.js';
import type { AgentPolicyId } from './agents.js';
import { formatBatchAsText } from './formatters.js';
import { runSimulationBatch } from './runner.js';

function parseArgs(argv: string[]): {
  runs: number;
  preset: string;
  policy: AgentPolicyId;
  seedPrefix: string;
  json: boolean;
} {
  let runs = 500;
  let preset = 'poker-proto-d1';
  let policy: AgentPolicyId = 'bluffing-rival';
  let seedPrefix = 'nce-md1';
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--runs' && argv[i + 1]) {
      runs = Math.max(1, Math.min(10000, Number.parseInt(argv[i + 1]!, 10) || 100));
      i += 1;
    } else if (arg === '--preset' && argv[i + 1]) {
      preset = argv[i + 1]!;
      i += 1;
    } else if (arg === '--policy' && argv[i + 1]) {
      policy = argv[i + 1]! as AgentPolicyId;
      i += 1;
    } else if (arg === '--seed-prefix' && argv[i + 1]) {
      seedPrefix = argv[i + 1]!;
      i += 1;
    } else if (arg === '--json') {
      json = true;
    }
  }

  return { runs, preset, policy, seedPrefix, json };
}

const args = parseArgs(process.argv.slice(2));
const ruleset = RULESET_PRESETS[args.preset];
if (!ruleset) {
  console.error(
    `Unknown preset "${args.preset}". Available presets: ${Object.keys(RULESET_PRESETS).join(', ')}`
  );
  process.exit(1);
}

const summary = runSimulationBatch({
  ruleset,
  runs: args.runs,
  seedPrefix: args.seedPrefix,
  policy: args.policy,
  verifyReplaySample: Math.min(args.runs, 25)
});

if (args.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('============================================================');
  console.log(formatBatchAsText(summary));
  console.log('============================================================');
}

if (summary.invariantFailures > 0 || summary.replayFailures > 0) {
  process.exit(1);
}
