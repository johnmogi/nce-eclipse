import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  createGame,
  dispatch,
  projectView,
  replay,
  RULESET_PRESETS,
  type Command,
  type GameState
} from '../src/engine/index.js';
import {
  advanceAutomatedStepsUntilHumanTurn,
  chooseFairBotCommand,
  DEFAULT_HUMAN_VS_BOT_CONFIG,
  getAutomatedActorId,
  runOneAutomatedStep,
  type HumanVsBotConfig
} from '../src/sim/botController.js';

function mustDispatch(state: GameState, cmd: Command): GameState {
  const res = dispatch(state, cmd);
  if (!res.ok) {
    throw new Error(`Expected ${cmd.type} to succeed, got ${res.error.code}: ${res.error.message}`);
  }
  return res.state;
}

describe('Milestone D1.2 — Human vs Bot Autonomous Gameplay & Fairness', () => {
  const d1 = RULESET_PRESETS['poker-proto-d1']!;

  it('fresh Human vs Bot game automatically delivers Bot (p2) opening reading and stops for Human (p1)', () => {
    const fresh = createGame(d1, 'hvb-opening-001');
    expect(fresh.phase).toBe('AWAITING_READING');
    expect(fresh.activePlayerId).toBe('p1');
    expect(fresh.currentReading?.readerId).toBe('p2');

    // Autonomous advance delivers ONLY p2's opening reading and halts for Human p1!
    const booted = advanceAutomatedStepsUntilHumanTurn(fresh, DEFAULT_HUMAN_VS_BOT_CONFIG);
    expect(booted.executed).toHaveLength(1);
    expect(booted.executed[0]!.actorId).toBe('p2');
    expect(booted.executed[0]!.command.type).toBe('GiveReading');

    const s = booted.state;
    expect(s.phase).toBe('AWAITING_READING_DECISION');
    expect(s.activePlayerId).toBe('p1');
    expect(s.currentReading?.advice).not.toBeNull();
    expect(s.centerRevealed).toBe(false);

    // Automation MUST NOT execute any Player 1 decision!
    expect(getAutomatedActorId(s, DEFAULT_HUMAN_VS_BOT_CONFIG)).toBeNull();
    expect(runOneAutomatedStep(s, DEFAULT_HUMAN_VS_BOT_CONFIG)).toBeNull();

    // Player 1 view keeps Center concealed and Bot's hand concealed
    const p1View = projectView(s, { role: 'player', playerId: 'p1' });
    expect(p1View.board.center[0]!.hidden).toBe(true);
    expect(p1View.players[1]!.hand).toBeNull();
    expect(p1View.seed).toBeNull();
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('keeps BOTH Primary Aces permanently visible even after lineage evolves into another element', () => {
    let s = createGame(d1, 'hvb-primary-aces', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        ['classic-water-04', 'classic-earth-05'],
        ['classic-earth-06', 'classic-water-07']
      ],
      // Turn 1: Event 8♥ (Treasure), Center 3♣ (evolves p1 A♠ Air -> 3♣ Fire!)
      overrideDaysTop: ['classic-water-08', 'classic-fire-03']
    });

    const booted = advanceAutomatedStepsUntilHumanTurn(s, DEFAULT_HUMAN_VS_BOT_CONFIG);
    s = booted.state;
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });

    const p1View = projectView(s, { role: 'player', playerId: 'p1' });
    const you = p1View.players.find((p) => p.id === 'p1')!;
    const bot = p1View.players.find((p) => p.id === 'p2')!;

    // You evolved A♠ (Air) -> 3♣ (Fire), yet Primary Ace A♠ remains permanently visible!
    expect(you.lineage.primaryAceCard.id).toBe('classic-air-01');
    expect(you.lineage.primaryAceCard.shortLabel).toBe('A♠');
    expect(you.primaryElement).toBe('air');
    expect(you.lineage.topCard.id).toBe('classic-fire-03');
    expect(you.lineage.element).toBe('fire');
    expect(you.lineage.rank).toBe(3);

    // Bot Primary Ace A♣ remains permanently visible, while Bot's hand stays concealed!
    expect(bot.lineage.primaryAceCard.id).toBe('classic-fire-01');
    expect(bot.lineage.primaryAceCard.shortLabel).toBe('A♣');
    expect(bot.primaryElement).toBe('fire');
    expect(bot.hand).toBeNull();
  });

  it('pauses for Human (p1) to read for Bot (p2), then Bot completes its entire turn and returns control to Human on Turn 3', () => {
    const fresh = createGame(d1, 'hvb-multi-round-001');
    let s = advanceAutomatedStepsUntilHumanTurn(fresh, DEFAULT_HUMAN_VS_BOT_CONFIG).state;

    // Turn 1 (Human p1): DiscardCenter -> Skip Elemental Action -> EndTurn
    expect(s.turn).toBe(1);
    expect(s.activePlayerId).toBe('p1');
    s = mustDispatch(s, { type: 'DiscardCenter', playerId: 'p1' });
    expect(s.phase).toBe('AWAITING_ELEMENTAL_ACTION');
    // Verify Bot NEVER consumes Human's elemental action or EndTurn!
    expect(getAutomatedActorId(s, DEFAULT_HUMAN_VS_BOT_CONFIG)).toBeNull();
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });

    // Turn 2 (Bot p2 active, Human p1 is designated Reader!):
    // Normal Human vs Bot MUST pause so Human can advise GOOD or BAD (including bluffing)!
    expect(s.turn).toBe(2);
    expect(s.activePlayerId).toBe('p2');
    expect(s.phase).toBe('AWAITING_READING');
    expect(s.currentReading?.readerId).toBe('p1');
    expect(getAutomatedActorId(s, DEFAULT_HUMAN_VS_BOT_CONFIG)).toBeNull();

    // Human inspects Center privately as Reader (can see Center!)
    const p1ReaderView = projectView(s, { role: 'player', playerId: 'p1' });
    expect(p1ReaderView.board.center[0]!.hidden).toBe(false);
    expect(p1ReaderView.legalActions).toEqual(['GiveReading']);

    // Human delivers reading (e.g., advises BAD) -> Bot takes over autonomously!
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p1', advice: 'bad' });
    const botTurn = advanceAutomatedStepsUntilHumanTurn(s, DEFAULT_HUMAN_VS_BOT_CONFIG);
    s = botTurn.state;

    // Every single command executed during botTurn belonged strictly to Bot (p2)!
    expect(botTurn.executed.length).toBeGreaterThanOrEqual(2);
    expect(botTurn.executed.every((step) => step.actorId === 'p2')).toBe(true);

    // Control returned cleanly to Human (p1) on Turn 3!
    expect(s.turn).toBe(3);
    expect(s.activePlayerId).toBe('p1');
    expect(['AWAITING_READING_DECISION', 'AWAITING_ABANDONED_CHOICE']).toContain(s.phase);
    expect(getAutomatedActorId(s, DEFAULT_HUMAN_VS_BOT_CONFIG)).toBeNull();

    // Full command history replays deterministically to the exact canonical stateHash!
    const rep = replay('hvb-multi-round-001', d1, s.commandHistory.map((r) => r.command));
    expect(rep.ok).toBe(true);
    expect(rep.finalState.stateHash).toBe(s.stateHash);
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('Fast Test automates Human reading role for Bot while STILL never consuming Human turn decisions', () => {
    const fastConfig: HumanVsBotConfig = {
      ...DEFAULT_HUMAN_VS_BOT_CONFIG,
      fastTestAutoHumanReading: true
    };
    const fresh = createGame(d1, 'hvb-fast-test-001');
    let s = advanceAutomatedStepsUntilHumanTurn(fresh, fastConfig).state;

    // Turn 1 stops for Human p1 decision
    expect(s.turn).toBe(1);
    expect(s.activePlayerId).toBe('p1');
    expect(s.phase).toBe('AWAITING_READING_DECISION');

    // Human discards & ends turn -> Fast Test automatically handles p1's reading for Bot AND Bot's full Turn 2!
    s = mustDispatch(s, { type: 'DiscardCenter', playerId: 'p1' });
    // Even in Fast Test, Human's own elemental window is NEVER automated!
    expect(getAutomatedActorId(s, fastConfig)).toBeNull();
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });

    const autoTurn2 = advanceAutomatedStepsUntilHumanTurn(s, fastConfig);
    s = autoTurn2.state;
    // Automated steps included p1's GiveReading for Bot + Bot's Turn 2 + Bot's Turn 3 reading, then halted on Turn 3 for Human!
    expect(autoTurn2.executed.some((e) => e.actorId === 'p1' && e.command.type === 'GiveReading')).toBe(true);
    expect(autoTurn2.executed.filter((e) => e.actorId === 'p1').every((e) => e.command.type === 'GiveReading')).toBe(true);
    expect(s.turn).toBe(3);
    expect(s.activePlayerId).toBe('p1');
    expect(getAutomatedActorId(s, fastConfig)).toBeNull();
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('enforces bot fairness by rejecting non-masked Admin or wrong-player views', () => {
    const s = createGame(d1, 'hvb-fairness-guard');
    const adminView = projectView(s, { role: 'admin' });
    const p1View = projectView(s, { role: 'player', playerId: 'p1' });
    const p2View = projectView(s, { role: 'player', playerId: 'p2' });

    expect(() => chooseFairBotCommand(adminView, 'p2', 'bluffing-rival')).toThrow(/fairness/i);
    expect(() => chooseFairBotCommand(p1View, 'p2', 'bluffing-rival')).toThrow(/fairness/i);

    // On p2's legitimately masked view, Days order, seed, and p1's hand are strictly null
    expect(p2View.daysCards).toBeNull();
    expect(p2View.seed).toBeNull();
    expect(p2View.players[0]!.hand).toBeNull();
    const cmd = chooseFairBotCommand(p2View, 'p2', 'bluffing-rival');
    expect(cmd).not.toBeNull();
    expect(cmd?.type).toBe('GiveReading');
  });
});
