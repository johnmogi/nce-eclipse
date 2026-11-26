import { describe, expect, it } from 'vitest';
import {
  buildExportBundle,
  checkInvariants,
  cloneRulesetWithOverrides,
  createGame,
  dispatch,
  formatEventsAsText,
  projectView,
  replay,
  RULESET_PRESETS,
  type Command,
  type GameState
} from '../src/engine/index.js';
import { runSimulationBatch } from '../src/sim/runner.js';

function mustDispatch(state: GameState, cmd: Command): GameState {
  const res = dispatch(state, cmd);
  if (!res.ok) {
    throw new Error(`Expected ${cmd.type} to succeed, got ${res.error.code}: ${res.error.message}`);
  }
  return res.state;
}

describe('Executive Blueprint v0.2 — Milestone C Worked Acceptance Scenarios (S1–S6)', () => {
  const proto = RULESET_PRESETS['poker-proto-c']!;

  it('S1 — Treasure + mandatory evolution (GDD §5 worked example)', () => {
    // Active lineage: Ace of Air (A♠). Reader sees Center 3 of Fire (3♣) and advises GOOD.
    // Left Event is 8 of Water (3 VP = Treasure). Claiming automatically evolves A♠ -> 3♣.
    let s = createGame(proto, 's1-treasure-evo', {
      startingElements: ['air', 'water'],
      overrideHands: [
        ['classic-water-04', 'classic-earth-05', 'classic-water-06'],
        ['classic-air-07', 'classic-fire-08', 'classic-air-09']
      ],
      // Days top order: [Turn 1 Event, Turn 1 Center, ...]
      overrideDaysTop: ['classic-water-08', 'classic-fire-03']
    });

    expect(s.phase).toBe('AWAITING_READING');
    expect(s.eventRevealed).toBe(false);
    expect(s.centerRevealed).toBe(false);

    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });

    expect(s.phase).toBe('AWAITING_EVENT_RESOLUTION');
    expect(s.eventRevealed).toBe(true);
    expect(s.centerRevealed).toBe(true);

    // Rejects unnecessary sacrifice on Treasure
    const badSac = dispatch(s, {
      type: 'ResolveEvent',
      playerId: 'p1',
      sacrificeCardIds: ['classic-water-04']
    });
    expect(badSac.ok).toBe(false);
    if (!badSac.ok) expect(badSac.error.code).toBe('UNEXPECTED_SACRIFICE');

    // Claim Treasure freely -> triggers mandatory evolution A♠ -> 3♣ and grants Reader bonus!
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });

    const p1 = s.players.find((p) => p.id === 'p1')!;
    const p2 = s.players.find((p) => p.id === 'p2')!;
    expect(p1.lineage.rank).toBe(3);
    expect(p1.lineage.element).toBe('fire');
    expect(p1.lineage.cardIds).toEqual(['classic-air-01', 'classic-fire-03']);
    expect(p2.pendingReaderBonuses).toHaveLength(1);
    expect(p2.pendingReaderBonuses[0]!.trigger).toBe('good_claimed');
    expect(s.veil).toContain('classic-water-08');
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('S2 — Barrier + sacrifice uses Left Event VP (2 VP), NOT Center VP (3 VP)', () => {
    // Active lineage: Ace of Air (1 VP), holding 2 of Water (1 VP).
    // Left Event: 4 of Air (2 VP Barrier). Center: 9 of Water (3 VP reward!).
    // Proves threshold comes strictly from Left Event (2 VP), not Center (3 VP).
    let s = createGame(proto, 's2-barrier-event-vp', {
      startingElements: ['air', 'water'],
      overrideHands: [
        ['classic-water-02', 'classic-earth-05'],
        ['classic-fire-06', 'classic-air-07']
      ],
      overrideDaysTop: ['classic-air-04', 'classic-water-09']
    });

    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });

    // 0 sacrifice -> only 1 VP from Ace -> fails 2-VP Barrier
    const tooLow = dispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });
    expect(tooLow.ok).toBe(false);
    if (!tooLow.ok) expect(tooLow.error.code).toBe('INSUFFICIENT_VP');

    // Sacrifice 2 of Water (1 VP) -> 1 + 1 = 2 VP >= 2 VP -> reconciles Barrier and claims 9 of Water (3 VP)!
    s = mustDispatch(s, {
      type: 'ResolveEvent',
      playerId: 'p1',
      sacrificeCardIds: ['classic-water-02']
    });

    const p1 = s.players.find((p) => p.id === 'p1')!;
    expect(p1.hand).toContain('classic-water-09');
    expect(p1.hand).not.toContain('classic-water-02');
    expect(s.veil).toContain('classic-water-02');
    expect(s.veil).toContain('classic-air-04');
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('S3 — Abandon withholds GOOD Reader bonus (creator ruling), next player claims freely OR declines to Veil', () => {
    const cleanOpts = {
      startingElements: ['air', 'water'] as const,
      overrideHands: [['classic-earth-08'], ['classic-fire-08']],
      overrideDaysTop: ['classic-air-04', 'classic-water-03', 'classic-earth-05', 'classic-fire-06']
    };

    let s = createGame(proto, 's3-abandon', cleanOpts);
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'AbandonCenter', playerId: 'p1' });

    // Creator ruling: GOOD -> PURSUE -> ABANDON withholds Reader bonus!
    const p2AfterAbandon = s.players.find((p) => p.id === 'p2')!;
    expect(p2AfterAbandon.pendingReaderBonuses).toHaveLength(0);
    expect(s.readingHistory[0]!.readerReward).toBe('withheld');
    expect(s.readingHistory[0]!.readerRewardReason).toBe('abandoned_before_claim');
    expect(s.centerAbandoned).toBe(true);
    expect(s.board.center).toEqual(['classic-water-03']);
    expect(s.veil).toContain('classic-air-04');

    // Advance to Player 2's turn -> enters AWAITING_ABANDONED_CHOICE
    const sTurn2 = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });
    expect(sTurn2.activePlayerId).toBe('p2');
    expect(sTurn2.phase).toBe('AWAITING_ABANDONED_CHOICE');

    // Branch A: Player 2 claims abandoned 3 of Water as free Treasure (forfeiting reading) -> evolves A♥ -> 3♥!
    const sClaimed = mustDispatch(sTurn2, { type: 'ClaimAbandonedCard', playerId: 'p2' });
    const p2Claimed = sClaimed.players.find((p) => p.id === 'p2')!;
    expect(p2Claimed.lineage.rank).toBe(3);
    expect(p2Claimed.lineage.cardIds).toEqual(['classic-water-01', 'classic-water-03']);
    expect(sClaimed.phase).toBe('READY_TO_END_TURN');
    expect(checkInvariants(sClaimed).ok).toBe(true);

    // Branch B: Player 2 declines abandoned 3 of Water -> moves to Veil, fresh concealed Center dealt for reading
    const sDeclined = mustDispatch(sTurn2, { type: 'DeclineAbandonedCard', playerId: 'p2' });
    expect(sDeclined.veil).toContain('classic-water-03');
    expect(sDeclined.centerAbandoned).toBe(false);
    expect(sDeclined.phase).toBe('AWAITING_READING');
    expect(sDeclined.centerRevealed).toBe(false);
    expect(sDeclined.board.center).toEqual(['classic-fire-06']);
    expect(checkInvariants(sDeclined).ok).toBe(true);
  });

  it('S4 — Trial requires > 1 effective VP AND elemental leverage (tests equal-fails & VP cap logging)', () => {
    // Left Event: 2 of Fire (1 VP Trial). Water beats Fire.
    let s = createGame(proto, 's4-trial', {
      startingElements: ['air', 'earth'],
      overrideHands: [
        ['classic-earth-04', 'classic-water-07'], // 4♦ = 2 VP (no advantage), 7♥ = 3 VP (beats Fire!)
        ['classic-fire-05']
      ],
      overrideDaysTop: ['classic-fire-02', 'classic-air-03']
    });

    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });

    // Sacrificing 4 of Earth gives 1 + 2 = 3 VP (> 1), BUT lacks Water advantage -> fails!
    const noAdv = dispatch(s, {
      type: 'ResolveEvent',
      playerId: 'p1',
      sacrificeCardIds: ['classic-earth-04']
    });
    expect(noAdv.ok).toBe(false);
    if (!noAdv.ok) expect(noAdv.error.code).toBe('ELEMENTAL_ADVANTAGE_REQUIRED');

    // Sacrificing 7 of Water (3 VP, beats Fire) -> raw 1 + 3 + 1 = 5 VP, capped at 3 VP (> 1) -> passes!
    s = mustDispatch(s, {
      type: 'ResolveEvent',
      playerId: 'p1',
      sacrificeCardIds: ['classic-water-07']
    });
    const trialEv = s.events.find((e) => e.type === 'TrialPassed')!;
    expect(trialEv).toBeDefined();
    const breakdown = trialEv.payload?.breakdown as {
      rawTotalVP: number;
      effectiveVP: number;
      wasCapped: boolean;
      hasElementalAdvantage: boolean;
    };
    expect(breakdown.rawTotalVP).toBe(5);
    expect(breakdown.effectiveVP).toBe(3);
    expect(breakdown.wasCapped).toBe(true);
    expect(breakdown.hasElementalAdvantage).toBe(true);

    // Equal-but-not-greater failure test: Water Ace (1 VP, has advantage) with trialAdvantageBonusVP=0 -> 1 is NOT > 1!
    const zeroBonusRuleset = cloneRulesetWithOverrides(proto, { trialAdvantageBonusVP: 0 });
    let sEq = createGame(zeroBonusRuleset, 's4-equal-fail', {
      startingElements: ['water', 'air'],
      overrideHands: [['classic-air-02'], ['classic-air-05']],
      overrideDaysTop: ['classic-fire-02', 'classic-earth-08']
    });
    sEq = mustDispatch(sEq, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    sEq = mustDispatch(sEq, { type: 'PursueCenter', playerId: 'p1' });
    const equalAttempt = dispatch(sEq, {
      type: 'ResolveEvent',
      playerId: 'p1',
      sacrificeCardIds: []
    });
    expect(equalAttempt.ok).toBe(false);
    if (!equalAttempt.ok) expect(equalAttempt.error.code).toBe('INSUFFICIENT_VP');
  });

  it('S5 — Reading independence across all 4 quadrants & zero hidden-card leakage', () => {
    // Deceptive BAD advice (Center 3 of Fire actually evolves Air Ace!), followed by DiscardCenter:
    // Reader STILL earns bonus because reward tracks being followed, not truthfulness!
    let s = createGame(proto, 's5-quadrants', {
      startingElements: ['air', 'water'],
      overrideHands: [['classic-earth-08'], ['classic-fire-08']],
      overrideDaysTop: ['classic-water-07', 'classic-fire-03']
    });

    // Privacy check before reveal: p1 sees NEITHER Center (3♣) NOR Left Event (7♥)
    const p1ViewBefore = projectView(s, { role: 'player', playerId: 'p1' });
    expect(p1ViewBefore.board.center[0]!.hidden).toBe(true);
    expect(p1ViewBefore.board.event[0]!.hidden).toBe(true);
    const p1LogBefore = formatEventsAsText(p1ViewBefore);
    expect(p1LogBefore).not.toContain('3 of Fire');
    expect(p1LogBefore).not.toContain('7 of Water');

    // Reader p2 CAN see Center (3♣) but still CANNOT see concealed Left Event (7♥)
    const p2ViewBefore = projectView(s, { role: 'player', playerId: 'p2' });
    expect(p2ViewBefore.board.center[0]!.hidden).toBe(false);
    expect(p2ViewBefore.board.event[0]!.hidden).toBe(true);

    // Reader gives deceptive BAD advice on 3♣
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'bad' });
    // Player 1 discards Center (following BAD advice)
    s = mustDispatch(s, { type: 'DiscardCenter', playerId: 'p1' });

    const rec = s.readingHistory[0]!;
    expect(rec.advice).toBe('bad');
    expect(rec.playerAction).toBe('discard');
    expect(rec.adviceFollowed).toBe(true);
    expect(rec.adviceTruthful).toBe(false);
    expect(rec.resolution).toBe('discarded');
    expect(rec.readerReward).toBe('granted');
    expect(s.players.find((p) => p.id === 'p2')!.pendingReaderBonuses).toHaveLength(1);
    // Unrevealed Left Event was NOT wasted on DiscardCenter — stays face-down for next turn!
    expect(s.board.event).toEqual(['classic-water-07']);
    expect(s.eventRevealed).toBe(false);
  });

  it('S6 — Complete 4-turn multi-player integration + export/replay hash consistency + 500-run batch', () => {
    const opts = {
      startingElements: ['air', 'water'] as const,
      overrideHands: [
        ['classic-earth-02', 'classic-water-05'],
        ['classic-fire-04', 'classic-earth-06']
      ],
      overrideDaysTop: [
        // Turn 1: Event 8♦ (Treasure), Center 3♣ (evolves p1 A♠ -> 3♣)
        'classic-earth-08',
        'classic-fire-03',
        // Turn 2: Event 4♠ (Barrier), Center 9♥ (p2 discards on BAD advice -> p1 earns bonus!)
        'classic-air-04',
        'classic-water-09',
        // Turn 3: Event stays 4♠ (unrevealed from T2!), Center 2♥ (p1 pursues, hits 4♠ Barrier, abandons -> p2 bonus withheld)
        'classic-water-02',
        // Turn 4: Event 7♣ (refilled), p2 claims abandoned 2♥ free -> evolves A♥ -> 2♥!
        'classic-fire-07'
      ]
    };

    let s = createGame(proto, 's6-multiturn', opts);

    // Turn 1 (p1): Honest GOOD -> Pursue -> Treasure 8♦ -> Claim 3♣ -> evolves A♠ -> 3♣
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });

    // Turn 2 (p2): Deceptive BAD -> Discard 9♥ to Veil -> p1 earns Reader bonus
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p1', advice: 'bad' });
    s = mustDispatch(s, { type: 'DiscardCenter', playerId: 'p2' });
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p2' });

    // Turn 3 (p1): Deceptive GOOD -> Pursue 2♥ -> Event 4♠ (2-VP Barrier) -> Abandon 2♥ -> p2 bonus withheld
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'AbandonCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });

    // Turn 4 (p2): Claim abandoned 2♥ as free Treasure -> evolves A♥ -> 2♥!
    expect(s.phase).toBe('AWAITING_ABANDONED_CHOICE');
    s = mustDispatch(s, { type: 'ClaimAbandonedCard', playerId: 'p2' });
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p2' });

    expect(s.players[0]!.lineage.rank).toBe(3);
    expect(s.players[1]!.lineage.rank).toBe(2);
    expect(s.players[0]!.pendingReaderBonuses).toHaveLength(1);
    expect(s.players[1]!.pendingReaderBonuses).toHaveLength(1); // T1 granted, T3 withheld on abandon!
    expect(checkInvariants(s).ok).toBe(true);

    // Export Admin bundle & replay from scratch -> exact final state hash match!
    const adminExport = buildExportBundle(s, { role: 'admin' });
    const replayed = replay(adminExport.seed, adminExport.ruleset, adminExport.commands!, opts);
    expect(replayed.ok).toBe(true);
    expect(replayed.finalState.stateHash).toBe(adminExport.finalStateHash);
    expect(replayed.finalState.stateHash).toBe(s.stateHash);

    // 500-run seeded simulation on Poker Prototype Milestone C
    const batch = runSimulationBatch({
      ruleset: proto,
      runs: 500,
      seedPrefix: 's6-mc-500',
      policy: 'bluffing-rival',
      verifyReplaySample: 30
    });
    expect(batch.invariantFailures).toBe(0);
    expect(batch.replayFailures).toBe(0);
    expect(batch.totalTreasures).toBeGreaterThan(0);
    expect(batch.totalBarriersPassed).toBeGreaterThan(0);
    expect(batch.totalTrialsPassed).toBeGreaterThan(0);
    expect(batch.totalAbandoned).toBeGreaterThan(0);
    expect(batch.totalAbandonedClaimedFree).toBeGreaterThan(0);
  });
});
