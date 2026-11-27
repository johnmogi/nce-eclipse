import { describe, expect, it } from 'vitest';
import {
  buildElementalCommand,
  getElementalTargetContext,
  selectHandCardForElemental,
  toggleVeilTargetSelection
} from '../src/app/elementalTargeting.js';
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

function mustDispatch(state: GameState, cmd: Command): GameState {
  const res = dispatch(state, cmd);
  if (!res.ok) {
    throw new Error(`Expected ${cmd.type} to succeed, got ${res.error.code}: ${res.error.message}`);
  }
  return res.state;
}

describe('Milestone D1.3 — Ordered Deck of Days & Veil Browsers + Visibility/Access Architecture', () => {
  const d1 = RULESET_PRESETS['poker-proto-d1']!;

  it('Admin God Mode browses EVERY card in Deck of Days in exact draw order (top to bottom) and is strictly read-only', () => {
    const state = createGame(d1, 'd13-admin-days', {
      overrideDaysTop: ['classic-water-08', 'classic-fire-03', 'classic-air-07', 'classic-earth-08', 'classic-fire-06']
    });
    const hashBefore = state.stateHash;

    const adminView = projectView(state, { role: 'admin' });
    expect(adminView.zoneVisibility).toEqual({ days: 'full', veil: 'full' });
    expect(adminView.daysBrowserItems).toHaveLength(state.days.length);

    // Every single remaining card in Days matches exact position #1..#N top-to-bottom
    adminView.daysBrowserItems.forEach((item, idx) => {
      expect(item.position).toBe(idx + 1);
      expect(item.hidden).toBe(false);
      if (!item.hidden) {
        expect(item.card.id).toBe(state.days[idx]);
        expect(item.backGroup).toBe(state.cards[state.days[idx]!]!.backGroup);
        expect(item.movementHistory.length).toBeGreaterThan(0);
      }
    });

    // Read-only guarantee: projecting full browser view never mutates state hash or invariants
    expect(state.stateHash).toBe(hashBefore);
    expect(checkInvariants(state).ok).toBe(true);
  });

  it('Player Deck of Days browser strictly protects hidden card identities and draw order while exposing card backs', () => {
    const state = createGame(d1, 'd13-player-days-masked');
    const p1View = projectView(state, { role: 'player', playerId: 'p1' });

    expect(p1View.zoneVisibility).toEqual({ days: 'hidden', veil: 'full' });
    expect(p1View.zoneAccess).toEqual({
      canInspectDays: true,
      canManipulateDays: true,
      canInspectVeil: true,
      canResurfaceFromVeil: true
    });
    expect(p1View.daysCards).toBeNull();
    expect(p1View.daysBrowserItems).toHaveLength(state.days.length);

    // Every single Days browser item for Player is masked with hidden: true and backGroup only
    for (const item of p1View.daysBrowserItems) {
      expect(item.hidden).toBe(true);
      expect(item.backGroup).toBe('minor');
    }

    // Verify zero hidden Days card IDs or labels leak into daysBrowserItems
    const serialized = JSON.stringify(p1View.daysBrowserItems);
    for (const hiddenId of state.days) {
      expect(serialized).not.toContain(hiddenId);
      expect(serialized).not.toContain(state.cards[hiddenId]!.label);
    }
  });

  it('Veil Browser orders complete discard history newest-to-oldest with movement reasons and supports Water selection without self-resurface', () => {
    let s = createGame(d1, 'd13-veil-browser', {
      startingElements: ['air', 'water'],
      overrideHands: [
        ['classic-water-06', 'classic-earth-04'], // 6♥ = 2 VP Water
        ['classic-fire-05', 'classic-air-05']
      ],
      overrideDaysTop: ['classic-water-08', 'classic-air-09', 'classic-fire-02', 'classic-earth-03'],
      overrideVeil: ['classic-earth-02', 'classic-fire-07'] // oldest -> newest
    });

    // Turn 1: Claim Treasure 9♠ -> Left Event 8♥ moves to Veil (becomes newest / Top!)
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });

    const p1View = projectView(s, { role: 'player', playerId: 'p1' });
    expect(p1View.veilBrowserItems).toHaveLength(3);
    // Ordered newest discard first (#1 = Top = 8♥, #2 = 7♣, #3 = 2♦)
    const orderedIds = p1View.veilBrowserItems.map((i) => (i.hidden ? 'hidden' : i.card.id));
    expect(orderedIds).toEqual(['classic-water-08', 'classic-fire-07', 'classic-earth-02']);
    expect(p1View.veilBrowserItems[0]!.position).toBe(1);
    if (!p1View.veilBrowserItems[0]!.hidden) {
      expect(p1View.veilBrowserItems[0]!.movementHistory.some((h) => h.includes('event-treasure-resolved'))).toBe(true);
    }

    // Select 6♥ Water from hand -> select 2 cards directly from Veil Browser -> confirm -> replay matches!
    const p1 = p1View.players.find((p) => p.id === 'p1')!;
    let sel = selectHandCardForElemental('classic-water-06', p1View, p1);
    const ctx = getElementalTargetContext(p1View, p1, sel);
    expect(ctx.eligibleVeilCardIds).not.toContain('classic-water-06');
    sel = toggleVeilTargetSelection(sel, 'classic-water-08', ctx);
    sel = toggleVeilTargetSelection(sel, 'classic-fire-07', ctx);

    const built = buildElementalCommand(p1View, sel, ctx);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    s = mustDispatch(s, built.command);
    expect(s.veil).toContain('classic-water-06');
    expect(s.veil).not.toContain('classic-water-08');
    expect(s.veil).not.toContain('classic-fire-07');

    // Deterministic replay check
    const rep = replay(
      'd13-veil-browser',
      d1,
      s.commandHistory.map((r) => r.command),
      {
        startingElements: ['air', 'water'],
        overrideHands: [
          ['classic-water-06', 'classic-earth-04'],
          ['classic-fire-05', 'classic-air-05']
        ],
        overrideDaysTop: ['classic-water-08', 'classic-air-09', 'classic-fire-02', 'classic-earth-03'],
        overrideVeil: ['classic-earth-02', 'classic-fire-07']
      }
    );
    expect(rep.ok).toBe(true);
    expect(rep.finalState.stateHash).toBe(s.stateHash);
  });

  it('separates visibility from accessibility cleanly for future Moon Reflection and Garden Gates while keeping Admin full', () => {
    const baseState = createGame(d1, 'd13-visibility-vs-access', {
      overrideVeil: ['classic-earth-02', 'classic-fire-07']
    });

    // Future Moon Reflection active effect: alters player visibility (Days top visible, Veil deeper hidden)
    // WITHOUT removing Water's underlying Veil accessibility, and WITHOUT reducing Admin God Mode!
    const reflectionState: GameState = {
      ...baseState,
      activeEffects: [{ effectId: 'moon_reflection', sourceCardId: 'future-moon-reflection', expiresOn: 'next_turn' }]
    };

    const p1Refl = projectView(reflectionState, { role: 'player', playerId: 'p1' });
    const adminRefl = projectView(reflectionState, { role: 'admin' });

    expect(p1Refl.zoneVisibility).toEqual({ days: 'top_only', veil: 'top_only' });
    expect(p1Refl.zoneAccess.canResurfaceFromVeil).toBe(true);
    expect(p1Refl.daysBrowserItems[0]!.hidden).toBe(false);
    expect(p1Refl.daysBrowserItems[1]!.hidden).toBe(true);
    expect(p1Refl.veilBrowserItems[0]!.hidden).toBe(false);
    expect(p1Refl.veilBrowserItems[1]!.hidden).toBe(true);

    // Admin keeps full visibility even under Reflection
    expect(adminRefl.zoneVisibility).toEqual({ days: 'full', veil: 'full' });
    expect(adminRefl.daysBrowserItems.every((i) => !i.hidden)).toBe(true);
    expect(adminRefl.veilBrowserItems.every((i) => !i.hidden)).toBe(true);

    // Future Garden Gates active effect: restricts accessibility independently of visibility!
    const gatesState: GameState = {
      ...baseState,
      activeEffects: [{ effectId: 'garden_gates', sourceCardId: 'future-garden-gates', expiresOn: 'next_turn' }]
    };
    const p1Gates = projectView(gatesState, { role: 'player', playerId: 'p1' });
    expect(p1Gates.zoneVisibility).toEqual({ days: 'hidden', veil: 'full' });
    expect(p1Gates.zoneAccess.canResurfaceFromVeil).toBe(false);
    expect(p1Gates.zoneAccess.canManipulateDays).toBe(false);
  });

  it('confirms D2 Trading remains disabled in D1.3 presets', () => {
    expect(d1.features.tradingMarket).toBe(false);
    expect(d1.marketFrequencyRounds).toBe(0);
    const s = createGame(d1, 'd13-trading-disabled');
    const tradeRes = dispatch(s, { type: 'ProposeTrade', playerId: 'p1', targetPlayerId: 'p2' });
    expect(tradeRes.ok).toBe(false);
    if (!tradeRes.ok) expect(tradeRes.error.code).toBe('FEATURE_DISABLED');
  });
});
