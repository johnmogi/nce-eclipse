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
  type CreateGameOptions,
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

/**
 * Helper to advance Turn 1 quickly through Reading -> Pursue -> Treasure Claim
 * into AWAITING_ELEMENTAL_ACTION for Player 1 without consuming any hand cards.
 */
function setupElementalWindow(
  seed: string,
  p1Hand: readonly string[],
  extraOpts: Partial<CreateGameOptions> = {},
  ruleset = RULESET_PRESETS['poker-proto-d1']!
): GameState {
  const opts: CreateGameOptions = {
    startingElements: ['air', 'water'],
    overrideHands: [p1Hand, ['classic-fire-06', 'classic-earth-06']],
    // Turn 1 Left Event: 8♥ (Treasure = free claim), Center: 9♠ (black rank 9; won't evolve A♠ rank 1!)
    overrideDaysTop: [
      'classic-water-08',
      'classic-air-09',
      ...(extraOpts.overrideDaysTop ?? ['classic-fire-02', 'classic-earth-03', 'classic-air-04', 'classic-water-05'])
    ],
    overrideVeil: extraOpts.overrideVeil ?? []
  };
  let s = createGame(ruleset, seed, opts);
  s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
  s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
  s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });
  expect(s.phase).toBe('AWAITING_ELEMENTAL_ACTION');
  return s;
}

describe('Milestone D0 — Audit Privacy Fix & Event Rotation Policy', () => {
  it('masks deterministic seed from player projections, player exports, and player event logs', () => {
    const secretSeed = 'super-secret-seed-98765';
    const state = createGame(RULESET_PRESETS['poker-proto-d1']!, secretSeed);

    const p1View = projectView(state, { role: 'player', playerId: 'p1' });
    const adminView = projectView(state, { role: 'admin' });
    const p1Export = buildExportBundle(state, { role: 'player', playerId: 'p1' });
    const adminExport = buildExportBundle(state, { role: 'admin' });
    const p1Text = formatEventsAsText(p1View);

    expect(p1View.seed).toBeNull();
    expect(p1Export.seed).toBeNull();
    expect(JSON.stringify(p1Export)).not.toContain(secretSeed);
    expect(p1Text).not.toContain(secretSeed);

    expect(adminView.seed).toBe(secretSeed);
    expect(adminExport.seed).toBe(secretSeed);
  });

  it('rotates unused concealed Left Event to Veil on DiscardCenter when rotateEventOnCenterDiscard=true', () => {
    const d1 = RULESET_PRESETS['poker-proto-d1']!;
    expect(d1.rotateEventOnCenterDiscard).toBe(true);

    let s = createGame(d1, 'd0-event-rotate', {
      startingElements: ['air', 'water'],
      overrideHands: [['classic-earth-04'], ['classic-fire-05']],
      overrideDaysTop: ['classic-water-07', 'classic-fire-03', 'classic-earth-08', 'classic-air-06']
    });

    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'bad' });
    s = mustDispatch(s, { type: 'DiscardCenter', playerId: 'p1' });
    // Still in AWAITING_ELEMENTAL_ACTION; Left Event 7♥ hasn't rotated until EndTurn cleanup
    expect(s.phase).toBe('AWAITING_ELEMENTAL_ACTION');
    expect(s.board.event).toEqual(['classic-water-07']);

    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });
    // After EndTurn, unused Left Event 7♥ rotated to Veil and Turn 2 drew fresh Event 8♦!
    expect(s.veil).toContain('classic-water-07');
    expect(s.board.event).toEqual(['classic-earth-08']);
    expect(s.board.center).toEqual(['classic-air-06']);
    expect(checkInvariants(s).ok).toBe(true);
  });
});

describe('Milestone D1 — Agreed Elemental Activation Cost & Water Self-Resurface Prohibition', () => {
  const d1 = RULESET_PRESETS['poker-proto-d1']!;

  it('Air (Shuffle) consumes exactly 1 Air hand card -> Veil, uses original VP, and shuffles deterministically', () => {
    const s0 = setupElementalWindow('d1-air-cost', ['classic-air-05', 'classic-earth-04']);
    const handBefore = [...s0.players[0]!.hand];
    const rngBefore = s0.rngState;

    // Attempting 3 cards with a 2-VP Air card (5♠) MUST fail (no silent VP+1 scaling!)
    const overStrength = dispatch(s0, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'air',
      sourceCardId: 'classic-air-05',
      targetZone: 'days',
      daysCount: 3
    });
    expect(overStrength.ok).toBe(false);
    if (!overStrength.ok) {
      expect(overStrength.error.code).toBe('INVALID_TARGET_SELECTION');
      expect(overStrength.state.stateHash).toBe(s0.stateHash);
      expect(overStrength.state.players[0]!.hand).toEqual(handBefore);
    }

    // Valid 2-VP Air activation consumes 5♠ -> Veil
    const s1 = mustDispatch(s0, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'air',
      sourceCardId: 'classic-air-05',
      targetZone: 'days',
      daysCount: 2
    });

    expect(s1.players[0]!.hand).not.toContain('classic-air-05');
    expect(s1.players[0]!.hand).toHaveLength(handBefore.length - 1);
    expect(s1.veil).toContain('classic-air-05');
    expect(s1.rngState).not.toBe(rngBefore);
    expect(s1.phase).toBe('READY_TO_END_TURN');
    expect(s1.events.some((e) => e.type === 'ElementalEffectActivated')).toBe(true);
    expect(
      s1.events.some(
        (e) =>
          e.type === 'CardMoved' &&
          e.reason === 'elemental-activation-cost' &&
          e.affectedCardIds.includes('classic-air-05')
      )
    ).toBe(true);
    expect(s1.events.some((e) => e.type === 'ElementalEffectResolved')).toBe(true);
    expect(checkInvariants(s1).ok).toBe(true);
  });

  it('Fire (Burn) consumes exactly 1 Fire hand card -> Veil and burns up to original VP cards to Veil', () => {
    const s0 = setupElementalWindow(
      'd1-fire-cost',
      ['classic-fire-05', 'classic-earth-04'], // 5♣ = 2 VP
      { overrideDaysTop: ['classic-water-02', 'classic-earth-03', 'classic-air-04'] }
    );
    const handBefore = [...s0.players[0]!.hand];

    // 2-VP Fire card cannot burn 3 cards
    const tooMany = dispatch(s0, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'fire',
      sourceCardId: 'classic-fire-05',
      targetZone: 'days',
      daysCount: 3
    });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.state.stateHash).toBe(s0.stateHash);

    const s1 = mustDispatch(s0, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'fire',
      sourceCardId: 'classic-fire-05',
      targetZone: 'days',
      daysCount: 2
    });

    expect(s1.players[0]!.hand).not.toContain('classic-fire-05');
    expect(s1.players[0]!.hand).toHaveLength(handBefore.length - 1);
    expect(s1.veil).toContain('classic-fire-05');
    expect(s1.veil).toContain('classic-water-02');
    expect(s1.veil).toContain('classic-earth-03');
    expect(s1.days[0]).toBe('classic-air-04');
    expect(checkInvariants(s1).ok).toBe(true);
  });

  it('Water (Resurface) consumes 1 Water card -> Veil and STRICTLY forbids self-resurfacing in the same action (AGREED regression test)', () => {
    const topDestRuleset = cloneRulesetWithOverrides(d1, { waterResurfaceDestination: 'top' });
    const s0 = setupElementalWindow(
      'd1-water-self-resurface',
      ['classic-water-05', 'classic-water-02'], // 5♥ = 2 VP, 2♥ = 1 VP
      {
        overrideVeil: ['classic-earth-04', 'classic-fire-07'],
        overrideDaysTop: [
          // Next turn (Turn 2) Event + Center + Turn 3 Event + Center
          'classic-earth-08',
          'classic-fire-04',
          'classic-earth-07',
          'classic-air-06'
        ]
      },
      topDestRuleset
    );

    const hashBefore = s0.stateHash;
    const handBefore = [...s0.players[0]!.hand];
    const veilBefore = [...s0.veil];

    // REGRESSION: Attempting to select the activating Water card (5♥) itself MUST be rejected without consuming anything!
    const selfAttempt = dispatch(s0, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'water',
      sourceCardId: 'classic-water-05',
      targetZone: 'veil',
      targetCardIds: ['classic-water-05']
    });
    expect(selfAttempt.ok).toBe(false);
    if (!selfAttempt.ok) {
      expect(selfAttempt.error.code).toBe('WATER_SELF_RESURFACE_FORBIDDEN');
      expect(selfAttempt.state.stateHash).toBe(hashBefore);
      expect(selfAttempt.state.players[0]!.hand).toEqual(handBefore);
      expect(selfAttempt.state.veil).toEqual(veilBefore);
    }

    // Even mixing a valid Veil card + the activating Water card MUST be rejected atomically!
    const mixedSelfAttempt = dispatch(s0, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'water',
      sourceCardId: 'classic-water-05',
      targetZone: 'veil',
      targetCardIds: ['classic-earth-04', 'classic-water-05']
    });
    expect(mixedSelfAttempt.ok).toBe(false);
    if (!mixedSelfAttempt.ok) {
      expect(mixedSelfAttempt.error.code).toBe('WATER_SELF_RESURFACE_FORBIDDEN');
      expect(mixedSelfAttempt.state.stateHash).toBe(hashBefore);
      expect(mixedSelfAttempt.state.players[0]!.hand).toEqual(handBefore);
    }

    // Valid Water activation: consumes 5♥ (2 VP) -> Veil, resurfaces 2 pre-existing Veil cards -> top of Days
    let s = mustDispatch(s0, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'water',
      sourceCardId: 'classic-water-05',
      targetZone: 'veil',
      targetCardIds: ['classic-earth-04', 'classic-fire-07']
    });
    expect(s.players[0]!.hand).not.toContain('classic-water-05');
    expect(s.veil).toContain('classic-water-05');
    expect(s.veil).not.toContain('classic-earth-04');
    expect(s.veil).not.toContain('classic-fire-07');
    expect(s.days.slice(0, 2)).toEqual(['classic-earth-04', 'classic-fire-07']);

    // Advance through Turn 2 (p2) to Turn 3 (p1) so p1 can execute a SUBSEQUENT separate Water action
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p1', advice: 'bad' });
    s = mustDispatch(s, { type: 'DiscardCenter', playerId: 'p2' });
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p2' });

    // Turn 3 (p1): Discard Center to enter AWAITING_ELEMENTAL_ACTION cleanly
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'bad' });
    s = mustDispatch(s, { type: 'DiscardCenter', playerId: 'p1' });
    expect(s.phase).toBe('AWAITING_ELEMENTAL_ACTION');
    expect(s.veil).toContain('classic-water-05');

    // Now on a subsequent separate action, 2♥ CAN legally resurface 5♥ from the Veil!
    s = mustDispatch(s, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'water',
      sourceCardId: 'classic-water-02',
      targetZone: 'veil',
      targetCardIds: ['classic-water-05']
    });
    expect(s.veil).toContain('classic-water-02');
    expect(s.veil).not.toContain('classic-water-05');
    expect(s.days[0]).toBe('classic-water-05');
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('Earth (Reorder) consumes 1 Earth hand card -> Veil and uses exact original VP without VP+1 scaling', () => {
    const s0 = setupElementalWindow(
      'd1-earth-cost',
      ['classic-earth-02', 'classic-earth-07'], // 2♦ = 1 VP, 7♦ = 3 VP
      { overrideDaysTop: ['classic-fire-02', 'classic-air-04', 'classic-water-05', 'classic-fire-08'] }
    );

    // 1-VP Earth (2♦) MUST NOT allow reordering 2 cards (no silent VP+1 scaling!)
    const noVpPlusOne = dispatch(s0, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'earth',
      sourceCardId: 'classic-earth-02',
      targetZone: 'days',
      indexOrder: [1, 0]
    });
    expect(noVpPlusOne.ok).toBe(false);
    if (!noVpPlusOne.ok) {
      expect(noVpPlusOne.error.code).toBe('INVALID_REORDER_SPEC');
      expect(noVpPlusOne.state.stateHash).toBe(s0.stateHash);
    }

    // Valid 1-VP Earth: deliberately moves top 1 card of Days to bottom
    const topBefore = s0.days[0]!;
    const s1 = mustDispatch(s0, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'earth',
      sourceCardId: 'classic-earth-02',
      targetZone: 'days',
      daysCount: 1,
      placement: 'bottom'
    });
    expect(s1.players[0]!.hand).not.toContain('classic-earth-02');
    expect(s1.veil).toContain('classic-earth-02');
    expect(s1.days[s1.days.length - 1]).toBe(topBefore);
    expect(s1.days[0]).toBe('classic-air-04');

    // Valid 3-VP Earth on fresh branch: deliberately reorders top 3 cards with exact newOrder
    const s3 = mustDispatch(s0, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'earth',
      sourceCardId: 'classic-earth-07',
      targetZone: 'days',
      newOrder: ['classic-water-05', 'classic-fire-02', 'classic-air-04']
    });
    expect(s3.veil).toContain('classic-earth-07');
    expect(s3.days.slice(0, 3)).toEqual(['classic-water-05', 'classic-fire-02', 'classic-air-04']);
    expect(checkInvariants(s3).ok).toBe(true);
  });

  it('rejects a second ordinary elemental hand effect in the same turn without consuming cards', () => {
    const s0 = setupElementalWindow('d1-one-per-turn', ['classic-fire-04', 'classic-air-05']);

    const s1 = mustDispatch(s0, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'fire',
      sourceCardId: 'classic-fire-04',
      targetZone: 'days',
      daysCount: 1
    });

    const hashAfterFirst = s1.stateHash;
    const second = dispatch(s1, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'air',
      sourceCardId: 'classic-air-05',
      targetZone: 'days',
      daysCount: 1
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('EFFECT_ALREADY_USED_THIS_TURN');
      expect(second.state.stateHash).toBe(hashAfterFirst);
      expect(second.state.players[0]!.hand).toContain('classic-air-05');
    }
  });

  it('rejects invalid activations (element mismatch, wrong zone, not in hand) without mutating state hash', () => {
    const s0 = setupElementalWindow('d1-invalid-no-consume', ['classic-air-05']);
    const hashBefore = s0.stateHash;

    const mismatch = dispatch(s0, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'fire',
      sourceCardId: 'classic-air-05',
      targetZone: 'days',
      daysCount: 1
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.error.code).toBe('ELEMENT_MISMATCH');
      expect(mismatch.state.stateHash).toBe(hashBefore);
    }

    const badZone = dispatch(s0, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'air',
      sourceCardId: 'classic-air-05',
      targetZone: 'veil'
    });
    expect(badZone.ok).toBe(false);
    if (!badZone.ok) {
      expect(badZone.error.code).toBe('INVALID_TARGET_ZONE');
      expect(badZone.state.stateHash).toBe(hashBefore);
    }

    const notInHand = dispatch(s0, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'fire',
      sourceCardId: 'classic-fire-06',
      targetZone: 'days',
      daysCount: 1
    });
    expect(notInHand.ok).toBe(false);
    if (!notInHand.ok) {
      expect(notInHand.error.code).toBe('CARD_NOT_IN_HAND');
      expect(notInHand.state.stateHash).toBe(hashBefore);
    }
  });

  it('claiming Center and mandatory evolution NEVER force an elemental discard or consume unrelated cards', () => {
    let s = createGame(d1, 'd1-claim-no-forced-discard', {
      startingElements: ['air', 'water'],
      overrideHands: [
        ['classic-water-04', 'classic-earth-05'], // unrelated red cards
        ['classic-fire-07', 'classic-air-08']
      ],
      // Event 9♥ (Treasure), Center 3♣ (evolves p1 A♠ -> 3♣!)
      overrideDaysTop: ['classic-water-09', 'classic-fire-03']
    });

    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });

    // Mandatory evolution consumed ONLY 3♣; unrelated hand cards remain untouched!
    expect(s.players[0]!.lineage.rank).toBe(3);
    expect(s.players[0]!.hand).toEqual(['classic-water-04', 'classic-earth-05']);
    expect(s.phase).toBe('AWAITING_ELEMENTAL_ACTION');

    // Player can EndTurn cleanly without discarding any hand card!
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });
    expect(s.players[0]!.hand).toEqual(['classic-water-04', 'classic-earth-05']);
    expect(s.turn).toBe(2);
    expect(checkInvariants(s).ok).toBe(true);
  });
});

describe('Milestone D1 — Provisional Reader Bonus Spending, Expiry & Full Simulation Gate', () => {
  const d1 = RULESET_PRESETS['poker-proto-d1']!;

  it('earns Reader Bonus on Turn 1, spends it free on Reader Turn 2 (0 hand cards consumed), and expires unused bonuses', () => {
    let s = createGame(d1, 'd1-reader-bonus', {
      startingElements: ['air', 'water'],
      overrideHands: [
        ['classic-earth-04', 'classic-water-06'],
        ['classic-air-05', 'classic-earth-07']
      ],
      // Turn 1: Event 8♦ (Treasure), Center 3♣ (Fire -> p2 earns Fire Reader bonus!)
      // Turn 2: Event 9♦ (Treasure), Center 2♠ (p2 claims, spends Fire Reader bonus free!)
      overrideDaysTop: ['classic-earth-08', 'classic-fire-03', 'classic-earth-09', 'classic-air-02', 'classic-water-04']
    });

    // Turn 1 (p1): follows GOOD -> claims 3♣ -> p2 earns available Fire Reader bonus
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });

    const bonus = s.players[1]!.pendingReaderBonuses[0]!;
    expect(bonus.status).toBe('available');
    expect(bonus.sourceElement).toBe('fire');

    // Turn 2 (p2): enters AWAITING_ELEMENTAL_ACTION after Treasure claim
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p1', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p2' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p2', sacrificeCardIds: [] });
    expect(s.phase).toBe('AWAITING_ELEMENTAL_ACTION');

    // Branch A: Spend Reader Bonus (burns 1 Days card to Veil with ZERO hand cards consumed!)
    const p2HandBefore = [...s.players[1]!.hand];
    const sSpent = mustDispatch(s, {
      type: 'UseReaderBonus',
      playerId: 'p2',
      bonusId: bonus.id,
      targetZone: 'days',
      daysCount: 1
    });
    expect(sSpent.players[1]!.hand).toEqual(p2HandBefore);
    expect(sSpent.players[1]!.pendingReaderBonuses[0]!.status).toBe('consumed');
    expect(sSpent.veil).toContain('classic-water-04');
    expect(sSpent.events.some((e) => e.type === 'ReaderBonusConsumed')).toBe(true);
    expect(checkInvariants(sSpent).ok).toBe(true);

    // Branch B: Skip spending Reader Bonus -> expires cleanly on EndTurn (no hoarding!)
    const sExpired = mustDispatch(s, { type: 'EndTurn', playerId: 'p2' });
    expect(sExpired.players[1]!.pendingReaderBonuses[0]!.status).toBe('expired');
    expect(sExpired.events.some((e) => e.type === 'ReaderBonusExpired')).toBe(true);
    expect(checkInvariants(sExpired).ok).toBe(true);
  });

  it('passes 500-run seeded D1 simulation with zero invariant/replay failures and exercises all 4 elements + Reader Bonuses', () => {
    const batch = runSimulationBatch({
      ruleset: d1,
      runs: 500,
      seedPrefix: 'd1-gate-500',
      policy: 'bluffing-rival',
      verifyReplaySample: 30
    });

    expect(batch.invariantFailures).toBe(0);
    expect(batch.replayFailures).toBe(0);
    expect(batch.totalAirEffects).toBeGreaterThan(0);
    expect(batch.totalFireEffects).toBeGreaterThan(0);
    expect(batch.totalWaterEffects).toBeGreaterThan(0);
    expect(batch.totalEarthEffects).toBeGreaterThan(0);
    expect(batch.totalReaderBonusesConsumed).toBeGreaterThan(0);

    // Verify deterministic replay of a full D1 run reproduces exact final state hash
    const sample = batch.sampleRuns[0]!;
    const rep = replay(sample.seed, d1, sample.commands);
    expect(rep.ok).toBe(true);
    expect(rep.finalState.stateHash).toBe(sample.finalStateHash);
  });
});
