import { describe, expect, it } from 'vitest';
import {
  buildElementalCommand,
  getElementalTargetContext,
  moveEarthOrderSlot,
  selectBonusForElemental,
  selectHandCardForElemental,
  toggleBoardSlotSelection,
  toggleDaysZoneSelection,
  toggleVeilTargetSelection
} from '../src/app/elementalTargeting.js';
import {
  checkInvariants,
  cloneRulesetWithOverrides,
  createGame,
  dispatch,
  projectView,
  RULESET_PRESETS,
  type Command,
  type GameState
} from '../src/engine/index.js';

function mustDispatch(state: GameState, cmd: Command): GameState {
  const res = dispatch(state, cmd);
  if (!res.ok) {
    throw new Error(`Expected ${cmd.type} to succeed, got ${res.error.code}: ${res.error.message}`);
  }
  return res.state;
}

describe('Milestone D1.1 — Direct Card-to-Zone Elemental UI Targeting', () => {
  const d1 = RULESET_PRESETS['poker-proto-d1']!;

  it('Acceptance walkthrough: Reading -> Encounter -> click Water hand card -> select Veil card -> resurface to Days -> EndTurn (zero dropdowns, player-safe view)', () => {
    const ruleset = cloneRulesetWithOverrides(d1, { waterResurfaceDestination: 'top' });
    let s = createGame(ruleset, 'd11-water-walkthrough', {
      startingElements: ['air', 'water'],
      overrideHands: [
        ['classic-water-06', 'classic-earth-04'], // 6♥ = 2 VP Water
        ['classic-fire-05', 'classic-air-05']
      ],
      overrideDaysTop: ['classic-water-08', 'classic-air-09', 'classic-fire-02', 'classic-earth-03'],
      overrideVeil: ['classic-fire-07', 'classic-earth-05']
    });

    // 1. Complete concealed reading and encounter
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });
    expect(s.phase).toBe('AWAITING_ELEMENTAL_ACTION');

    // Operate strictly on masked Player 1 view (no Inspector / Admin God Mode!)
    const p1View = projectView(s, { role: 'player', playerId: 'p1' });
    const p1 = p1View.players.find((p) => p.id === 'p1')!;
    expect(p1View.seed).toBeNull();
    expect(p1View.daysCards).toBeNull();

    // 2. Click Six of Water (6♥) in hand
    let sel = selectHandCardForElemental('classic-water-06', p1View, p1);
    let ctx = getElementalTargetContext(p1View, p1, sel);
    expect(ctx.activeElement).toBe('water');
    expect(ctx.strength).toBe(2);
    expect(ctx.eligibleZones).toEqual({
      days: false,
      boardEvent: false,
      boardCenter: false,
      boardParallel: false,
      veil: true
    });
    // Activating Water card cannot be in eligible Veil targets
    expect(ctx.eligibleVeilCardIds).not.toContain('classic-water-06');
    expect(ctx.eligibleVeilCardIds).toContain('classic-fire-07');
    expect(ctx.eligibleVeilCardIds).toContain('classic-earth-05');

    // Before selecting a Veil card, confirmation is blocked cleanly
    expect(buildElementalCommand(p1View, sel, ctx).ok).toBe(false);

    // 3. Click 2 cards directly in the Veil (capped at strength 2)
    sel = toggleVeilTargetSelection(sel, 'classic-fire-07', ctx);
    sel = toggleVeilTargetSelection(sel, 'classic-earth-05', ctx);
    // Attempting to select a 3rd card beyond strength 2 is ignored by UI helper
    sel = toggleVeilTargetSelection(sel, 'classic-water-08', ctx);
    expect(sel.veilCardIds).toEqual(['classic-fire-07', 'classic-earth-05']);

    // 4. Confirm action -> UI builds legal UseElementalEffect command -> engine accepts cleanly!
    const built = buildElementalCommand(p1View, sel, ctx);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    s = mustDispatch(s, built.command);
    expect(s.veil).toContain('classic-water-06');
    expect(s.players[0]!.hand).not.toContain('classic-water-06');
    expect(s.days.slice(0, 2)).toEqual(['classic-fire-07', 'classic-earth-05']);

    // 5. Finish turn cleanly
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });
    expect(s.turn).toBe(2);
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('Air, Fire, and Earth direct zone targeting produce strictly legal engine commands without leaking hidden Days cards', () => {
    let s = createGame(d1, 'd11-all-elements-ui', {
      startingElements: ['air', 'water'],
      overrideHands: [
        ['classic-air-05', 'classic-fire-04', 'classic-earth-07'], // 2 VP Air, 2 VP Fire, 3 VP Earth
        ['classic-fire-06', 'classic-air-06']
      ],
      // Turn 1: Event 4♠ (Barrier) abandoned -> Center 9♥ stays face-up on Board!
      overrideDaysTop: ['classic-air-04', 'classic-water-09', 'classic-fire-02', 'classic-earth-03', 'classic-water-04']
    });

    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'AbandonCenter', playerId: 'p1' });
    expect(s.phase).toBe('AWAITING_ELEMENTAL_ACTION');

    const p1View = projectView(s, { role: 'player', playerId: 'p1' });
    const p1 = p1View.players.find((p) => p.id === 'p1')!;

    // AIR: click Air card -> click Abandoned Center slot on Board -> legal shuffle!
    let airSel = selectHandCardForElemental('classic-air-05', p1View, p1);
    const airCtx = getElementalTargetContext(p1View, p1, airSel);
    expect(airCtx.eligibleZones.boardCenter).toBe(true);
    expect(airCtx.eligibleZones.days).toBe(true);
    airSel = toggleBoardSlotSelection(airSel, 'center', airCtx);
    const airBuilt = buildElementalCommand(p1View, airSel, airCtx);
    expect(airBuilt.ok).toBe(true);
    if (airBuilt.ok) {
      const sAir = mustDispatch(s, airBuilt.command);
      expect(sAir.veil).toContain('classic-air-05');
      expect(sAir.board.center).toHaveLength(0);
      expect(checkInvariants(sAir).ok).toBe(true);
    }

    // FIRE: click Fire card -> click Board Center + click Deck of Days -> burns both cleanly!
    let fireSel = selectHandCardForElemental('classic-fire-04', p1View, p1);
    const fireCtx = getElementalTargetContext(p1View, p1, fireSel);
    fireSel = toggleBoardSlotSelection(fireSel, 'center', fireCtx);
    fireSel = toggleDaysZoneSelection(fireSel, fireCtx, p1View.daysCount);
    expect(fireSel.boardSlots).toEqual(['center']);
    expect(fireSel.daysSelected).toBe(true);
    expect(fireSel.daysCount).toBe(1); // 2 VP total = 1 Board + 1 Days
    const fireBuilt = buildElementalCommand(p1View, fireSel, fireCtx);
    expect(fireBuilt.ok).toBe(true);
    if (fireBuilt.ok) {
      const sFire = mustDispatch(s, fireBuilt.command);
      expect(sFire.veil).toContain('classic-fire-04');
      expect(sFire.veil).toContain('classic-water-09');
      expect(sFire.veil).toContain('classic-fire-02');
      expect(checkInvariants(sFire).ok).toBe(true);
    }

    // EARTH: click 3-VP Earth card -> click Deck of Days -> shift card slots with arrows -> legal reorder!
    let earthSel = selectHandCardForElemental('classic-earth-07', p1View, p1);
    const earthCtx = getElementalTargetContext(p1View, p1, earthSel);
    earthSel = toggleDaysZoneSelection(earthSel, earthCtx, p1View.daysCount);
    expect(earthSel.earthMode).toBe('days_reorder');
    const shiftedOrder = moveEarthOrderSlot(earthSel.earthIndexOrder, 0, 1);
    earthSel = { ...earthSel, earthIndexOrder: shiftedOrder };
    const earthBuilt = buildElementalCommand(p1View, earthSel, earthCtx);
    expect(earthBuilt.ok).toBe(true);
    if (earthBuilt.ok) {
      const sEarth = mustDispatch(s, earthBuilt.command);
      expect(sEarth.veil).toContain('classic-earth-07');
      expect(checkInvariants(sEarth).ok).toBe(true);
    }
  });

  it('Reader Bonus UI selection targets cleanly at Tier 1 without consuming any hand card', () => {
    let s = createGame(d1, 'd11-bonus-ui', {
      startingElements: ['air', 'water'],
      overrideHands: [
        ['classic-earth-04'],
        ['classic-air-05', 'classic-earth-06']
      ],
      overrideDaysTop: ['classic-earth-08', 'classic-fire-03', 'classic-earth-09', 'classic-air-02', 'classic-water-04']
    });

    // Turn 1: p1 follows GOOD -> claims 3♣ -> p2 earns Fire Reader Bonus
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });

    // Turn 2: p2 enters AWAITING_ELEMENTAL_ACTION
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p1', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p2' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p2', sacrificeCardIds: [] });

    const p2View = projectView(s, { role: 'player', playerId: 'p2' });
    const p2 = p2View.players.find((p) => p.id === 'p2')!;
    const bonusId = p2.pendingReaderBonuses[0]!.id;

    let sel = selectBonusForElemental(bonusId, p2View);
    const ctx = getElementalTargetContext(p2View, p2, sel);
    expect(ctx.activeElement).toBe('fire');
    expect(ctx.strength).toBe(1);
    sel = toggleDaysZoneSelection(sel, ctx, p2View.daysCount);
    const built = buildElementalCommand(p2View, sel, ctx);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const handBefore = [...s.players[1]!.hand];
    const sAfter = mustDispatch(s, built.command);
    expect(sAfter.players[1]!.hand).toEqual(handBefore);
    expect(sAfter.players[1]!.pendingReaderBonuses[0]!.status).toBe('consumed');
    expect(checkInvariants(sAfter).ok).toBe(true);
  });

  it('Milestone E pre-reading Water Reader Bonus activates cleanly even when active player hand is empty (0 cards)', () => {
    const me = cloneRulesetWithOverrides(RULESET_PRESETS['poker-proto-e']!, {
      waterResurfaceDestination: 'top'
    });
    let s = createGame(me, 'me-empty-hand-water-bonus', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        // All 3 starting cards immediately chain-evolve A♠ -> 3♠ -> 4♠ -> 6♣, leaving p1 hand empty (0)!
        ['classic-air-03', 'classic-air-04', 'classic-fire-06'],
        ['classic-earth-09', 'classic-water-09', 'classic-earth-08']
      ],
      overrideDaysTop: [
        'classic-fire-07', // T1 Event (Treasure)
        'classic-fire-08', // T1 Center (evolves p1 6♣ -> 8♣, hand stays 0!)
        'classic-earth-07', // T2 Event (Treasure)
        'classic-water-07', // T2 Center (p2 discards/claims -> p1 earns Water Reader Bonus)
        'classic-air-07', // T3 Event
        'classic-water-06' // T3 Center
      ],
      overrideVeil: ['classic-earth-05']
    });

    // Confirm p1 starts with 0 cards in hand because all 3 starting cards evolved!
    expect(s.players[0]!.hand).toEqual([]);
    expect(s.players[0]!.evolutionsCompleted).toBe(3);

    // Turn 1 (p1): skip prep -> Reading -> Pursue -> Resolve Treasure (8♣ evolves -> hand still 0!) -> EndTurn
    s = mustDispatch(s, { type: 'AdvanceToReading', playerId: 'p1' });
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });
    expect(s.players[0]!.hand).toEqual([]);
    expect(s.players[0]!.evolutionsCompleted).toBe(4);

    // Turn 2 (p2): skip prep -> p1 advises GOOD -> p2 pursues & claims 7♥ -> p1 earns Water Reader Bonus!
    s = mustDispatch(s, { type: 'AdvanceToReading', playerId: 'p2' });
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p1', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p2' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p2', sacrificeCardIds: [] });
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p2' });

    // Turn 3 (p1): AWAITING_ELEMENTAL_ACTION with empty hand + Water Tier 1 Reader Bonus ready!
    expect(s.turn).toBe(3);
    expect(s.activePlayerId).toBe('p1');
    expect(s.phase).toBe('AWAITING_ELEMENTAL_ACTION');
    expect(s.players[0]!.hand).toEqual([]);

    const p1View = projectView(s, { role: 'player', playerId: 'p1' });
    const p1 = p1View.players.find((p) => p.id === 'p1')!;
    expect(p1.hand).toEqual([]);
    expect(p1.availableReaderBonusCount).toBe(1);

    const waterBonus = p1.pendingReaderBonuses.find(
      (b) => b.status === 'available' && b.earnedOnTurn < p1View.turn
    )!;
    expect(waterBonus.sourceElement).toBe('water');

    let sel = selectBonusForElemental(waterBonus.id, p1View);
    const ctx = getElementalTargetContext(p1View, p1, sel);
    expect(ctx.activeElement).toBe('water');
    expect(ctx.strength).toBe(1);
    expect(ctx.eligibleZones.veil).toBe(true);
    expect(ctx.eligibleVeilCardIds).toContain('classic-earth-05');

    sel = toggleVeilTargetSelection(sel, 'classic-earth-05', ctx);
    const built = buildElementalCommand(p1View, sel, ctx);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const sAfter = mustDispatch(s, built.command);
    expect(sAfter.days[0]).toBe('classic-earth-05');
    expect(sAfter.players[0]!.hand).toEqual([]);
    expect(sAfter.players[0]!.pendingReaderBonuses.find((b) => b.id === waterBonus.id)?.status).toBe('consumed');
    expect(checkInvariants(sAfter).ok).toBe(true);
  });
});
