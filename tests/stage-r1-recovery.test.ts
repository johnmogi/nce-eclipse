import { describe, expect, it } from 'vitest';
import {
  buildElementalCommand,
  getElementalTargetContext,
  selectBonusForElemental,
  toggleVeilTargetSelection
} from '../src/app/elementalTargeting.js';
import {
  checkInvariants,
  cloneRulesetWithOverrides,
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

describe('Stage R1 — First-Turn Reliability, Reject-Replace, 3-Slot Board, Anytime Reader Bonus & Earth Peek', () => {
  const classicR1 = RULESET_PRESETS['poker-proto-e']!;

  it('RD-01 + Clean Turn-1 Setup Invariant: eclipse-me-001 and 100 seeded new games guarantee 3 playable Minor cards per player, EMPTY Veil (0 cards), Minor Event & Center, and 3-slot Board', () => {
    const named = createGame(classicR1, 'eclipse-me-001');
    expect(named.status).toBe('playing');
    expect(named.veil).toHaveLength(0);
    expect(named.board.event).toHaveLength(1);
    expect(named.board.center).toHaveLength(1);
    expect(named.board.parallel).toHaveLength(1);
    expect(named.cards[named.board.event[0]!]!.family).toBe('classic-number');
    expect(named.cards[named.board.center[0]!]!.family).toBe('classic-number');
    expect(named.players[0]!.hand).toHaveLength(3);
    expect(named.players[1]!.hand).toHaveLength(3);
    expect(named.players[0]!.lineage.rank).toBe(1);
    expect(named.players[1]!.lineage.rank).toBe(1);
    expect(named.players[0]!.evolutionsCompleted).toBe(0);
    expect(named.players[1]!.evolutionsCompleted).toBe(0);
    expect(checkInvariants(named).ok).toBe(true);

    for (let i = 1; i <= 100; i++) {
      const s = createGame(classicR1, `r1-opening-hand-${i}`);
      expect(s.status).toBe('playing');
      expect(s.veil).toHaveLength(0);
      expect(s.board.event).toHaveLength(1);
      expect(s.board.center).toHaveLength(1);
      expect(s.board.parallel).toHaveLength(1);
      expect(s.cards[s.board.event[0]!]!.family).toBe('classic-number');
      expect(s.cards[s.board.center[0]!]!.family).toBe('classic-number');
      for (const p of s.players) {
        expect(p.hand).toHaveLength(3);
        expect(p.lineage.rank).toBe(1);
        expect(p.hand.every((id) => s.cards[id]!.family === 'classic-number')).toBe(true);
      }
      expect(checkInvariants(s).ok).toBe(true);
    }
  });

  it('RD-04 (AGREED): rejecting the read card sends Card 1 face-up to Veil, draws & flips replacement Card 2, AND flips Left Event into resolution', () => {
    let s = createGame(classicR1, 'r1-reject-replace', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        ['classic-water-05', 'classic-earth-06', 'classic-water-08'],
        ['classic-earth-09', 'classic-water-09', 'classic-air-09']
      ],
      overrideDaysTop: [
        'classic-earth-08', // T1 Left Event (8♦ = Treasure!)
        'classic-water-04', // T1 Center Card 1 (rejected -> Veil, grants p2 Water Reader Bonus on BAD)
        'classic-water-06', // T1 Right Parallel (3-slot Board)
        'classic-air-03',   // Replacement Card 2 drawn on reject! Evolves p1 A♠ -> 3♠!
        'classic-fire-07',
        'classic-earth-05'
      ]
    });

    s = mustDispatch(s, { type: 'AdvanceToReading', playerId: 'p1' });
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'bad' });
    expect(s.phase).toBe('AWAITING_READING_DECISION');

    // Player 1 rejects Card 1 (4♥) -> Veil, receives & flips Card 2 (3♠), and flips Left Event (8♦ Treasure)!
    s = mustDispatch(s, { type: 'DiscardCenter', playerId: 'p1' });

    expect(s.veil).toContain('classic-water-04');
    expect(s.board.center).toEqual(['classic-air-03']);
    expect(s.centerRevealed).toBe(true);
    expect(s.board.event).toEqual(['classic-earth-08']);
    expect(s.eventRevealed).toBe(true);
    expect(s.phase).toBe('AWAITING_EVENT_RESOLUTION');

    // Reader (p2) earned Water Reader Bonus from Card 1 (4♥) because p1 followed BAD advice!
    expect(s.players[1]!.pendingReaderBonuses).toHaveLength(1);
    expect(s.players[1]!.pendingReaderBonuses[0]!.sourceElement).toBe('water');
    expect(s.players[1]!.pendingReaderBonuses[0]!.status).toBe('available');

    // Player 1 now claims replacement 3♠ as Treasure -> mandatory evolution A♠ -> 3♠!
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });
    expect(s.players[0]!.lineage.rank).toBe(3);
    expect(s.phase).toBe('READY_TO_END_TURN');
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('RD-15 (AGREED): Turn 1 populates all 3 Board slots (Event, Center, Parallel), conceals Minor in Parallel, slides it to Center on Turn 2, and respects emptyChamberMode toggle', () => {
    let s = createGame(classicR1, 'r1-3-slot-board', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        ['classic-water-05', 'classic-earth-06', 'classic-water-08'],
        ['classic-earth-09', 'classic-water-09', 'classic-air-09']
      ],
      overrideDaysTop: [
        'classic-earth-08', // T1 Left Event (Treasure)
        'classic-water-04', // T1 Center
        'classic-fire-03',  // T1 Right Parallel (face-down Minor -> slides to T2 Center!)
        'classic-earth-07', // T2 Left Event
        'classic-water-06'  // T2 Right Parallel refill
      ]
    });

    // All 3 Board slots are populated on Turn 1!
    expect(s.board.event).toEqual(['classic-earth-08']);
    expect(s.board.center).toEqual(['classic-water-04']);
    expect(s.board.parallel).toEqual(['classic-fire-03']);

    // Player view conceals the Minor in Right Parallel; Admin view can inspect it!
    const p1View = projectView(s, { role: 'player', playerId: 'p1' });
    const adminView = projectView(s, { role: 'admin' });
    expect(p1View.board.parallel[0]?.hidden).toBe(true);
    expect(adminView.board.parallel[0]?.hidden).toBe(false);

    // Complete Turn 1 -> Turn 2 slides classic-fire-03 from Right Parallel into Center and refills Parallel!
    s = mustDispatch(s, { type: 'AdvanceToReading', playerId: 'p1' });
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });

    expect(s.turn).toBe(2);
    expect(s.board.center).toEqual(['classic-fire-03']);
    expect(s.board.parallel).toEqual(['classic-water-06']);
    expect(checkInvariants(s).ok).toBe(true);

    // Optional Empty Chamber Mode leaves Parallel vacant until a Major arrives
    const emptyChamber = cloneRulesetWithOverrides(classicR1, { emptyChamberMode: true });
    const sEmpty = createGame(emptyChamber, 'r1-empty-chamber', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        ['classic-water-05', 'classic-earth-06', 'classic-water-08'],
        ['classic-earth-09', 'classic-water-09', 'classic-air-09']
      ],
      overrideDaysTop: ['classic-earth-08', 'classic-water-04', 'classic-fire-03']
    });
    expect(sEmpty.board.event).toEqual(['classic-earth-08']);
    expect(sEmpty.board.center).toEqual(['classic-water-04']);
    expect(sEmpty.board.parallel).toHaveLength(0);
    expect(checkInvariants(sEmpty).ok).toBe(true);
  });

  it('RD-05: Reader Bonus is usable anytime during your turn (e.g. during AWAITING_READING_DECISION) without consuming your hand-card elemental action', () => {
    const r1Top = cloneRulesetWithOverrides(classicR1, { waterResurfaceDestination: 'top' });
    let s = createGame(r1Top, 'r1-anytime-bonus', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        ['classic-water-05', 'classic-earth-06', 'classic-water-08'],
        ['classic-earth-09', 'classic-water-09', 'classic-air-09']
      ],
      overrideDaysTop: [
        'classic-earth-08', // T1 Event
        'classic-water-04', // T1 Center (rejected -> Veil, p2 earns Water bonus)
        'classic-fire-09',  // T1 Parallel -> slides to T2 Center
        'classic-earth-07', // T1 Replacement Center (claimed by p1)
        'classic-air-07',   // T2 Event
        'classic-air-08',   // T2 Parallel
        'classic-water-07'  // Extra Days
      ],
      overrideVeil: ['classic-air-05']
    });

    // Turn 1: p1 rejects 4♥ -> p2 earns Water Tier 1 Reader Bonus!
    s = mustDispatch(s, { type: 'AdvanceToReading', playerId: 'p1' });
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'bad' });
    s = mustDispatch(s, { type: 'DiscardCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });

    // Turn 2 (p2): skips Elemental Prep -> receives Reading -> NOW decides to spend Water Reader Bonus DURING AWAITING_READING_DECISION!
    s = mustDispatch(s, { type: 'AdvanceToReading', playerId: 'p2' });
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p1', advice: 'good' });
    expect(s.phase).toBe('AWAITING_READING_DECISION');

    const p2View = projectView(s, { role: 'player', playerId: 'p2' });
    const p2 = p2View.players.find((p) => p.id === 'p2')!;
    expect(p2View.legalActions).toContain('UseReaderBonus');
    const waterBonus = p2.pendingReaderBonuses[0]!;

    let sel = selectBonusForElemental(waterBonus.id, p2View);
    const ctx = getElementalTargetContext(p2View, p2, sel);
    expect(ctx.activeElement).toBe('water');
    expect(ctx.eligibleZones.veil).toBe(true);
    sel = toggleVeilTargetSelection(sel, 'classic-air-05', ctx);
    const built = buildElementalCommand(p2View, sel, ctx);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    s = mustDispatch(s, built.command);
    expect(s.days[0]).toBe('classic-air-05');
    // Stays cleanly in AWAITING_READING_DECISION so player can finish their reading choice!
    expect(s.phase).toBe('AWAITING_READING_DECISION');
    expect(s.players[1]!.effectUsedThisTurn).toBe(false); // Free bonus did NOT eat normal elemental action!
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('RD-09: Earth private peek consumes card atomically, reveals Immediate Future ONLY to active caster, and commits exact deliberate order', () => {
    let s = createGame(classicR1, 'r1-earth-peek', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        ['classic-earth-07', 'classic-water-05', 'classic-water-08'], // 7♦ = 3 VP Earth
        ['classic-earth-09', 'classic-water-09', 'classic-earth-08']
      ],
      overrideDaysTop: [
        'classic-earth-06', // T1 Event
        'classic-water-04', // T1 Center
        'classic-fire-05',  // T1 Parallel
        'classic-air-02',   // Immediate Future #1
        'classic-air-03',   // Immediate Future #2
        'classic-water-07'  // Immediate Future #3
      ]
    });

    // Activate Earth private peek with 7♦ (3 VP)
    s = mustDispatch(s, {
      type: 'StartEarthPeek',
      playerId: 'p1',
      sourceCardId: 'classic-earth-07'
    });

    // 7♦ consumed atomically -> Veil before peek is revealed (zero peek-and-cancel exploit!)
    expect(s.phase).toBe('AWAITING_EARTH_REORDER');
    expect(s.veil).toContain('classic-earth-07');
    expect(s.players[0]!.hand).not.toContain('classic-earth-07');

    // Privacy check: p1 sees exact 3 Immediate Future cards; p2 gets cards: null!
    const p1View = projectView(s, { role: 'player', playerId: 'p1' });
    const p2View = projectView(s, { role: 'player', playerId: 'p2' });
    expect(p1View.pendingEarthReorder?.cards?.map((c) => c.id)).toEqual([
      'classic-air-02',
      'classic-air-03',
      'classic-water-07'
    ]);
    expect(p2View.pendingEarthReorder?.cards).toBeNull();

    // Commit exact deliberate permutation putting 7♥ on top (#1 Next Upcoming)
    s = mustDispatch(s, {
      type: 'CommitEarthReorder',
      playerId: 'p1',
      newOrder: ['classic-water-07', 'classic-air-03', 'classic-air-02']
    });

    expect(s.days.slice(0, 3)).toEqual(['classic-water-07', 'classic-air-03', 'classic-air-02']);
    expect(s.phase).toBe('AWAITING_READING');
    expect(s.pendingEarthReorder).toBeNull();
    expect(checkInvariants(s).ok).toBe(true);

    // Verify full deterministic replay & hash match
    const rep = replay(
      'r1-earth-peek',
      classicR1,
      s.commandHistory.map((r) => r.command),
      {
        startingElements: ['air', 'fire'],
        overrideHands: [
          ['classic-earth-07', 'classic-water-05', 'classic-water-08'],
          ['classic-earth-09', 'classic-water-09', 'classic-earth-08']
        ],
        overrideDaysTop: [
          'classic-earth-06',
          'classic-water-04',
          'classic-fire-05',
          'classic-air-02',
          'classic-air-03',
          'classic-water-07'
        ]
      }
    );
    expect(rep.ok).toBe(true);
    expect(rep.finalState.stateHash).toBe(s.stateHash);
  });

  it('Elemental Prep auto-skips ONLY when no legal elemental action exists (e.g., Water-only hand with empty Veil), and stays open when any legal action exists', () => {
    // Case A: p1 holds ONLY Water cards while Veil is empty -> NO legal elemental action -> auto-skips straight to AWAITING_READING!
    const sNoLegal = createGame(classicR1, 'r1-auto-skip-water-empty-veil', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        ['classic-water-04', 'classic-water-05', 'classic-water-06'],
        ['classic-earth-08', 'classic-earth-09', 'classic-air-08']
      ],
      overrideDaysTop: ['classic-earth-07', 'classic-air-05', 'classic-fire-06']
    });
    expect(sNoLegal.phase).toBe('AWAITING_READING');
    expect(sNoLegal.currentReading?.readerId).toBe('p2');
    expect(checkInvariants(sNoLegal).ok).toBe(true);

    // Case B: p1 holds ONLY Water cards while Veil has 1 card -> Water IS legal -> stays in AWAITING_ELEMENTAL_ACTION!
    const sWaterLegal = createGame(classicR1, 'r1-no-skip-water-with-veil', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        ['classic-water-04', 'classic-water-05', 'classic-water-06'],
        ['classic-earth-08', 'classic-earth-09', 'classic-air-08']
      ],
      overrideDaysTop: ['classic-earth-07', 'classic-air-05', 'classic-fire-06'],
      overrideVeil: ['classic-fire-04']
    });
    expect(sWaterLegal.phase).toBe('AWAITING_ELEMENTAL_ACTION');
    expect(checkInvariants(sWaterLegal).ok).toBe(true);
  });

  it('Earth private peek & reorder works across Board slots alone AND across Board + Immediate Future together (board_and_days) without leaking to opponent', () => {
    let s = createGame(classicR1, 'r1-earth-board-and-days', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        ['classic-earth-07', 'classic-water-05', 'classic-water-08'], // 7♦ = 3 VP Earth
        ['classic-earth-09', 'classic-water-09', 'classic-air-09']
      ],
      overrideDaysTop: [
        'classic-earth-06', // Board Event
        'classic-water-04', // Board Center
        'classic-fire-05',  // Board Parallel
        'classic-air-02',   // Immediate Future #1
        'classic-air-03',   // Immediate Future #2
        'classic-water-07'  // Immediate Future #3
      ]
    });

    // Target Board Center + Board Parallel + Immediate Future #1 (3 total = 3 VP Earth!)
    s = mustDispatch(s, {
      type: 'StartEarthPeek',
      playerId: 'p1',
      sourceCardId: 'classic-earth-07',
      targetBoardSlots: ['center', 'parallel'],
      daysCount: 1
    });

    expect(s.phase).toBe('AWAITING_EARTH_REORDER');
    const p1View = projectView(s, { role: 'player', playerId: 'p1' });
    const p2View = projectView(s, { role: 'player', playerId: 'p2' });
    expect(p1View.pendingEarthReorder?.boardSlots).toEqual(['center', 'parallel']);
    expect(p1View.pendingEarthReorder?.daysCount).toBe(1);
    expect(p1View.pendingEarthReorder?.cards?.map((c) => c.id)).toEqual([
      'classic-water-04',
      'classic-fire-05',
      'classic-air-02'
    ]);
    expect(p2View.pendingEarthReorder?.cards).toBeNull();

    // Put classic-air-02 (from Days #1!) directly into Center, classic-water-04 into Parallel, and classic-fire-05 onto top of Days!
    s = mustDispatch(s, {
      type: 'CommitEarthReorder',
      playerId: 'p1',
      newOrder: ['classic-air-02', 'classic-water-04', 'classic-fire-05']
    });

    expect(s.board.center).toEqual(['classic-air-02']);
    expect(s.board.parallel).toEqual(['classic-water-04']);
    expect(s.days[0]).toBe('classic-fire-05');
    expect(s.phase).toBe('AWAITING_READING');
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('RD-17 experimental setting: default maxElementalActionsPerTurn=1 enforces 1 hand action, while setting 2 allows chaining two hand effects before Reading', () => {
    const chain2 = cloneRulesetWithOverrides(classicR1, { maxElementalActionsPerTurn: 2 });
    let s = createGame(chain2, 'r1-experimental-chain-2', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        ['classic-fire-04', 'classic-air-05', 'classic-water-08'],
        ['classic-earth-09', 'classic-water-09', 'classic-air-09']
      ],
      overrideDaysTop: [
        'classic-earth-08',
        'classic-water-04',
        'classic-fire-05',
        'classic-air-06',
        'classic-water-07'
      ]
    });

    // Action 1: Fire burns 1 card from Immediate Future -> stays in AWAITING_ELEMENTAL_ACTION because limit=2!
    s = mustDispatch(s, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'fire',
      sourceCardId: 'classic-fire-04',
      targetZone: 'days',
      daysCount: 1
    });
    expect(s.phase).toBe('AWAITING_ELEMENTAL_ACTION');
    expect(s.players[0]!.elementalActionsUsedThisTurn).toBe(1);
    expect(s.players[0]!.effectUsedThisTurn).toBe(false);

    // Action 2: Air shuffles 1 card from Immediate Future -> hits limit=2 and advances to Reading!
    s = mustDispatch(s, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'air',
      sourceCardId: 'classic-air-05',
      targetZone: 'days',
      daysCount: 1
    });
    expect(s.players[0]!.elementalActionsUsedThisTurn).toBe(2);
    expect(s.players[0]!.effectUsedThisTurn).toBe(true);
    expect(s.phase).toBe('AWAITING_READING');
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('passes 500-run Stage R1 simulation gate with zero invariant or replay failures', () => {
    const batch = runSimulationBatch({
      ruleset: classicR1,
      runs: 500,
      seedPrefix: 'r1-gate-500',
      policy: 'bluffing-rival',
      verifyReplaySample: 30
    });
    expect(batch.invariantFailures).toBe(0);
    expect(batch.replayFailures).toBe(0);
  });
});
