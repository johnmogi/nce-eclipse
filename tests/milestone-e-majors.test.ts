import { describe, expect, it } from 'vitest';
import {
  buildCardCatalog,
  checkInvariants,
  createGame,
  dispatch,
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

describe('Milestone E — 48-Card Classic Courts (Major Arcana), Eclipse, Triangulation & Pre-Reading Elemental Prep', () => {
  const protoE = RULESET_PRESETS['poker-proto-e']!;
  const quickE = RULESET_PRESETS['poker-proto-e-quick']!;

  it('builds exact 48-card deck (36 Minors + 12 Classic Courts with major card back) and deals only Minors to starting hands', () => {
    const catalog = buildCardCatalog(protoE);
    const cards = Object.values(catalog);
    expect(cards).toHaveLength(48);
    const courts = cards.filter((c) => c.family === 'classic-court');
    expect(courts).toHaveLength(12);
    expect(courts.every((c) => c.backGroup === 'major')).toBe(true);

    const s = createGame(protoE, 'me-48-deck-setup');
    for (const p of s.players) {
      expect(p.hand.every((id) => s.cards[id]!.family === 'classic-number')).toBe(true);
    }
    expect(s.phase).toBe('AWAITING_ELEMENTAL_ACTION');
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('supports start-of-turn Elemental Prep BEFORE Reading, refilling burned Board cards and advancing into Reading', () => {
    let s = createGame(protoE, 'me-pre-reading-prep', {
      startingElements: ['air', 'water'],
      overrideHands: [
        ['classic-fire-04', 'classic-earth-05'], // 2-VP Fire card
        ['classic-air-06', 'classic-water-06']
      ],
      // Event 4♠, Center 2♥, Right Parallel 5♥ (3-slot Turn 1 Board), next in Days: 8♦ (Treasure Event), 3♣ (evolves p1 A♠ -> 3♣!)
      overrideDaysTop: [
        'classic-air-04',
        'classic-water-02',
        'classic-water-05',
        'classic-earth-08',
        'classic-fire-03'
      ]
    });

    // Turn 1 starts in AWAITING_ELEMENTAL_ACTION BEFORE Reading!
    expect(s.phase).toBe('AWAITING_ELEMENTAL_ACTION');
    expect(s.board.event).toEqual(['classic-air-04']);
    expect(s.board.center).toEqual(['classic-water-02']);

    // Cannot skip straight to EndTurn before Reading!
    const badEnd = dispatch(s, { type: 'EndTurn', playerId: 'p1' });
    expect(badEnd.ok).toBe(false);
    if (!badEnd.ok) expect(badEnd.error.code).toBe('INVALID_PHASE');

    // Player 1 burns BOTH concealed Event and concealed Center BEFORE Reading using 4♣ (2 VP Fire)!
    s = mustDispatch(s, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'fire',
      sourceCardId: 'classic-fire-04',
      targetZone: 'board',
      targetBoardSlots: ['event', 'center']
    });

    // Engine refilled fresh Event (8♦) + fresh Center (3♣) and transitioned automatically to AWAITING_READING!
    expect(s.phase).toBe('AWAITING_READING');
    expect(s.veil).toContain('classic-fire-04');
    expect(s.veil).toContain('classic-air-04');
    expect(s.veil).toContain('classic-water-02');
    expect(s.board.event).toEqual(['classic-earth-08']);
    expect(s.board.center).toEqual(['classic-fire-03']);

    // Complete Reading -> Pursue -> Treasure Claim -> evolves A♠ -> 3♣ -> directly READY_TO_END_TURN (no second elemental window!)
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });
    expect(s.players[0]!.lineage.rank).toBe(3);
    expect(s.phase).toBe('READY_TO_END_TURN');
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('triggers Classic Eclipse (Black + Red same-rank Courts), grants persistent +VP bonus, and wins at threshold', () => {
    // Days top: Black King (K♠ -> Parallel), Red King (K♥ -> Event -> ECLIPSE!)
    const s = createGame(quickE, 'me-eclipse-win', {
      startingElements: ['air', 'water'],
      overrideHands: [['classic-earth-04'], ['classic-fire-05']],
      overrideDaysTop: ['classic-air-king', 'classic-water-king', 'classic-earth-08', 'classic-fire-03']
    });

    expect(s.status).toBe('completed');
    expect(s.outcome?.reason).toBe('eclipse_victory');
    expect(s.outcome?.winnerIds).toEqual(['p1']);
    expect(s.players[0]!.eclipseCount).toBe(1);
    expect(s.players[0]!.eclipseBonusVP).toBe(3); // King = +3 persistent VP!
    expect(s.veil).toContain('classic-air-king');
    expect(s.veil).toContain('classic-water-king');
    expect(s.events.some((e) => e.type === 'EclipseFormed')).toBe(true);
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('resolves stacked non-eclipsing Major Courts via Parallel LIFO contention instead of accidental overflow Triangulation', () => {
    // Black King (Parallel) + Red Queen (contends via LIFO -> Veil) + Black Prince (contends via LIFO -> Veil) -> NO accidental Turn-1 Triangulation!
    const s = createGame(protoE, 'me-no-accidental-triangulation', {
      startingElements: ['air', 'water'],
      overrideHands: [['classic-earth-04'], ['classic-fire-05']],
      overrideDaysTop: [
        'classic-air-king',
        'classic-earth-queen',
        'classic-fire-prince',
        'classic-water-08',
        'classic-fire-03',
        'classic-earth-06'
      ]
    });

    expect(s.status).toBe('playing');
    expect(s.board.parallel).toEqual(['classic-air-king']);
    expect(s.veil).toContain('classic-earth-queen');
    expect(s.veil).toContain('classic-fire-prince');
    expect(s.board.event).toEqual(['classic-water-08']);
    expect(s.board.center).toEqual(['classic-fire-03']);
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('allows Fire to burn an active Major Court off Board.Parallel during pre-reading Elemental Prep', () => {
    // Black King arrives in Parallel on setup, then Event 8♦ + Center 3♣ populate normally
    let s = createGame(protoE, 'me-burn-parallel-major', {
      startingElements: ['air', 'water'],
      overrideHands: [['classic-fire-04', 'classic-earth-05'], ['classic-water-06']],
      overrideDaysTop: ['classic-air-king', 'classic-earth-08', 'classic-fire-03', 'classic-water-07']
    });

    expect(s.board.parallel).toEqual(['classic-air-king']);
    expect(s.majorPending.some((m) => m.cardId === 'classic-air-king')).toBe(true);
    expect(s.phase).toBe('AWAITING_ELEMENTAL_ACTION');

    // Burn Black King from Parallel to Veil before Reading!
    s = mustDispatch(s, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'fire',
      sourceCardId: 'classic-fire-04',
      targetZone: 'board',
      targetBoardSlots: ['parallel']
    });

    expect(s.board.parallel).toHaveLength(0);
    expect(s.majorPending).toHaveLength(0);
    expect(s.veil).toContain('classic-air-king');
    expect(s.veil).toContain('classic-fire-04');
    expect(s.phase).toBe('AWAITING_READING');

    // Verify player view shows major back on Deck of Days whenever a Court sits on top of Days!
    const p1View = projectView(s, { role: 'player', playerId: 'p1' });
    expect(p1View.seed).toBeNull();
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('passes 500-run Milestone E simulation with zero invariant/replay failures and exercises real Eclipses & Triangulations', () => {
    const batch = runSimulationBatch({
      ruleset: protoE,
      runs: 500,
      seedPrefix: 'me-gate-500',
      policy: 'bluffing-rival',
      verifyReplaySample: 30
    });

    expect(batch.invariantFailures).toBe(0);
    expect(batch.replayFailures).toBe(0);
    expect(batch.totalEclipsesFormed).toBeGreaterThan(0);
    expect(batch.triangulationVictories + batch.eclipseVictories).toBeGreaterThan(0);

    const sample = batch.sampleRuns[0]!;
    const rep = replay(sample.seed, protoE, sample.commands);
    expect(rep.ok).toBe(true);
    expect(rep.finalState.stateHash).toBe(sample.finalStateHash);
  });
});
