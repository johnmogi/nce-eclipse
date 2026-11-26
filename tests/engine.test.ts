import { describe, expect, it } from 'vitest';
import {
  buildCardCatalog,
  buildExportBundle,
  capEffectiveVP,
  checkInvariants,
  cloneRulesetWithOverrides,
  createGame,
  dispatch,
  elementBeats,
  formatEventsAsText,
  getElementAdvantage,
  projectView,
  rankToVP,
  replay,
  resolveMandatoryEvolutionChain,
  RULESET_PRESETS
} from '../src/engine/index.js';
import { runSimulationBatch, runSingleSimulation } from '../src/sim/runner.js';

describe('Nexus Central Engine — Card Vocabulary & VP Scale', () => {
  it('maps ranks 1-9 to agreed 1/2/3 VP tiers', () => {
    expect([1, 2, 3].map(rankToVP)).toEqual([1, 1, 1]);
    expect([4, 5, 6].map(rankToVP)).toEqual([2, 2, 2]);
    expect([7, 8, 9].map(rankToVP)).toEqual([3, 3, 3]);
  });

  it('implements agreed advantage ring Water > Fire > Earth > Air > Water and zero for undefined pairings', () => {
    expect(elementBeats('water', 'fire')).toBe(true);
    expect(elementBeats('fire', 'earth')).toBe(true);
    expect(elementBeats('earth', 'air')).toBe(true);
    expect(elementBeats('air', 'water')).toBe(true);
    // Undefined opposing pairs yield 0 advantage
    expect(getElementAdvantage('air', 'fire')).toBe(0);
    expect(getElementAdvantage('water', 'earth')).toBe(0);
  });

  it('enforces configurable effective VP cap and logs cap state', () => {
    expect(capEffectiveVP(2, 3)).toEqual({ rawVP: 2, effectiveVP: 2, wasCapped: false });
    expect(capEffectiveVP(5, 3)).toEqual({ rawVP: 5, effectiveVP: 3, wasCapped: true });
  });

  it('builds exact 24-card Ace-6 deck for Level 1.1 with no courts', () => {
    const catalog = buildCardCatalog(RULESET_PRESETS['l1-1-basic']!);
    expect(Object.keys(catalog)).toHaveLength(24);
    expect(Object.values(catalog).every((c) => c.family === 'classic-number' && c.rank <= 6)).toBe(true);
  });
});

describe('Nexus Central Engine — Mandatory Personal Evolution & Tie-Breaking', () => {
  it('forces multi-step chained evolution across same-color +1/+2 cards', () => {
    const ruleset = RULESET_PRESETS['l1-1-basic']!;
    const catalog = buildCardCatalog(ruleset);

    const player = {
      id: 'p1',
      name: 'Player 1',
      primaryElement: 'air' as const,
      lineage: {
        rank: 1,
        element: 'air' as const,
        color: 'black' as const,
        cardIds: ['classic-air-01']
      },
      hand: ['classic-fire-03', 'classic-air-05', 'classic-fire-06', 'classic-water-02'],
      eclipseCount: 0,
      effectUsedThisTurn: false,
      pendingReaderBonuses: [],
      evolutionsCompleted: 0,
      maxChainLength: 0,
      turnsTaken: 0
    };

    const res = resolveMandatoryEvolutionChain(player, catalog, ruleset);
    expect(res.steps.map((s) => s.toCard.id)).toEqual([
      'classic-fire-03',
      'classic-air-05',
      'classic-fire-06'
    ]);
    expect(res.player.lineage.rank).toBe(6);
    expect(res.player.lineage.element).toBe('fire');
    expect(res.player.hand).toEqual(['classic-water-02']);
    expect(res.player.evolutionsCompleted).toBe(3);
    expect(res.player.maxChainLength).toBe(3);
  });

  it('preserves lowest-rank-same-element tie-breaker so 1 -> 2 -> 3 consumes both steps', () => {
    const ruleset = RULESET_PRESETS['l1-1-basic']!;
    const catalog = buildCardCatalog(ruleset);

    const player = {
      id: 'p1',
      name: 'Player 1',
      primaryElement: 'air' as const,
      lineage: {
        rank: 1,
        element: 'air' as const,
        color: 'black' as const,
        cardIds: ['classic-air-01']
      },
      hand: ['classic-fire-03', 'classic-air-02', 'classic-fire-02'],
      eclipseCount: 0,
      effectUsedThisTurn: false,
      pendingReaderBonuses: [],
      evolutionsCompleted: 0,
      maxChainLength: 0,
      turnsTaken: 0
    };

    const res = resolveMandatoryEvolutionChain(player, catalog, ruleset);
    expect(res.steps[0]!.toCard.id).toBe('classic-air-02');
    expect(res.steps[0]!.tieBreakApplied).toBe(true);
    expect(res.steps[1]!.toCard.id).toBe('classic-fire-03');
    expect(res.player.lineage.rank).toBe(3);
    expect(res.player.hand).toEqual(['classic-fire-02']);
  });

  it('respects highest-jump-first tie-breaker toggle when configured', () => {
    const ruleset = cloneRulesetWithOverrides(RULESET_PRESETS['l1-1-basic']!, {
      evolutionTieBreak: 'highest-jump-first'
    });
    const catalog = buildCardCatalog(ruleset);

    const player = {
      id: 'p1',
      name: 'Player 1',
      primaryElement: 'air' as const,
      lineage: {
        rank: 1,
        element: 'air' as const,
        color: 'black' as const,
        cardIds: ['classic-air-01']
      },
      hand: ['classic-air-02', 'classic-fire-03'],
      eclipseCount: 0,
      effectUsedThisTurn: false,
      pendingReaderBonuses: [],
      evolutionsCompleted: 0,
      maxChainLength: 0,
      turnsTaken: 0
    };

    const res = resolveMandatoryEvolutionChain(player, catalog, ruleset);
    expect(res.steps.map((s) => s.toCard.id)).toEqual(['classic-fire-03']);
    expect(res.player.hand).toEqual(['classic-air-02']);
  });

  it('enforces strict same-element +1 only in Hard Mode', () => {
    const ruleset = RULESET_PRESETS['l1-1-hard']!;
    const catalog = buildCardCatalog(ruleset);

    const player = {
      id: 'p1',
      name: 'Player 1',
      primaryElement: 'air' as const,
      lineage: {
        rank: 1,
        element: 'air' as const,
        color: 'black' as const,
        cardIds: ['classic-air-01']
      },
      hand: ['classic-fire-02', 'classic-air-03'],
      eclipseCount: 0,
      effectUsedThisTurn: false,
      pendingReaderBonuses: [],
      evolutionsCompleted: 0,
      maxChainLength: 0,
      turnsTaken: 0
    };

    const res = resolveMandatoryEvolutionChain(player, catalog, ruleset);
    expect(res.steps).toHaveLength(0);
    expect(res.player.lineage.rank).toBe(1);
  });
});

describe('Nexus Central Engine — State Machine, Invariants, Visibility & Replay', () => {
  it('maintains card conservation and deterministic state hashes across replay', () => {
    const ruleset = RULESET_PRESETS['l1-1-basic']!;
    const run = runSingleSimulation(ruleset, 'deterministic-seed-42', 'evolution-greedy', {
      verifyReplay: true
    });

    expect(run.invariantOk).toBe(true);
    expect(run.replayVerified).toBe(true);

    const replayed = replay('deterministic-seed-42', ruleset, run.commands);
    expect(replayed.ok).toBe(true);
    expect(replayed.finalState.stateHash).toBe(run.finalStateHash);

    // Every single snapshot in replay satisfies invariants and matches recorded command hash
    for (let i = 0; i < replayed.snapshots.length; i++) {
      const snap = replayed.snapshots[i]!;
      expect(checkInvariants(snap.state).ok).toBe(true);
      if (i > 0) {
        const rec = replayed.finalState.commandHistory[i - 1]!;
        expect(snap.stateHash).toBe(rec.stateHashAfter);
      }
    }
  });

  it('strictly masks hidden opponent hands and Days order in player views and player exports', () => {
    const ruleset = RULESET_PRESETS['l1-1-basic']!;
    const state = createGame(ruleset, 'privacy-test-seed');

    const p1View = projectView(state, { role: 'player', playerId: 'p1' });
    const adminView = projectView(state, { role: 'admin' });

    expect(p1View.daysCards).toBeNull();
    expect(p1View.reserveCards).toBeNull();
    expect(adminView.daysCards).not.toBeNull();

    const p1Self = p1View.players.find((p) => p.id === 'p1')!;
    const p2FromP1 = p1View.players.find((p) => p.id === 'p2')!;
    expect(p1Self.hand).not.toBeNull();
    expect(p2FromP1.hand).toBeNull();

    // Ensure opponent's private hand card IDs and labels are redacted from p1's events, TXT log, and deckComponents
    const p2HandIds = state.players.find((p) => p.id === 'p2')!.hand;
    const p1Export = buildExportBundle(state, { role: 'player', playerId: 'p1' });
    const p1TextLog = formatEventsAsText(p1View);
    expect(p1Export.commands).toBeUndefined();
    const serializedEvents = JSON.stringify(p1Export.events);
    for (const secretCardId of p2HandIds) {
      expect(serializedEvents).not.toContain(secretCardId);
      expect(p1TextLog).not.toContain(state.cards[secretCardId]!.label);
      const entry = p1Export.view.deckComponents.find((d) => d.card.id === secretCardId)!;
      expect(entry.knownLocation).toBe('Deck / Hidden');
    }
  });

  it('rejects inactive feature-flagged commands without mutating canonical state hash', () => {
    const ruleset = RULESET_PRESETS['l1-1-basic']!;
    const state = createGame(ruleset, 'feature-gate-seed');
    const hashBefore = state.stateHash;

    const res = dispatch(state, { type: 'GiveReading', playerId: 'p1', advice: 'good' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('FEATURE_DISABLED');
      expect(res.state.stateHash).toBe(hashBefore);
      expect(res.state.rejectedCommands).toHaveLength(1);
    }

    // Wrong active player rejected cleanly
    const wrongTurn = dispatch(state, { type: 'ClaimCenterCard', playerId: 'p2' });
    expect(wrongTurn.ok).toBe(false);
    if (!wrongTurn.ok) {
      expect(wrongTurn.error.code).toBe('NOT_ACTIVE_PLAYER');
      expect(wrongTurn.state.stateHash).toBe(hashBefore);
    }
  });

  it('passes 100-run seeded batch simulation with zero invariant or replay failures', () => {
    const summary = runSimulationBatch({
      ruleset: RULESET_PRESETS['l1-1-basic']!,
      runs: 100,
      seedPrefix: 'ci-regression',
      policy: 'evolution-greedy',
      verifyReplaySample: 30
    });

    expect(summary.runs).toBe(100);
    expect(summary.invariantFailures).toBe(0);
    expect(summary.replayFailures).toBe(0);
    expect(summary.avgEvolutionsPerGame).toBeGreaterThan(0);
  });
});

describe('Nexus Central Engine — Level 1.2 Concealed Readings, Bluffs & Deck Components', () => {
  it('conceals Center card from active player while letting designated Reader and Admin inspect it', () => {
    const ruleset = RULESET_PRESETS['l1-2-reading-basic']!;
    const state = createGame(ruleset, 'reading-privacy-seed');

    expect(state.phase).toBe('AWAITING_READING');
    expect(state.centerRevealed).toBe(false);
    const secretCenterId = state.board.center[0]!;
    const secretCenterLabel = state.cards[secretCenterId]!.label;

    const p1View = projectView(state, { role: 'player', playerId: 'p1' });
    const p2View = projectView(state, { role: 'player', playerId: 'p2' });
    const adminView = projectView(state, { role: 'admin' });

    // Active player (p1) MUST see Center as hidden and must NOT see its ID/label anywhere
    expect(p1View.board.center[0]!.hidden).toBe(true);
    expect(p1View.legalActions).toEqual([]);
    const p1Text = formatEventsAsText(p1View);
    expect(p1Text).not.toContain(secretCenterLabel);
    const p1DeckEntry = p1View.deckComponents.find((d) => d.card.id === secretCenterId)!;
    expect(p1DeckEntry.knownLocation).toBe('Deck / Hidden');

    // Reader (p2) and Admin CAN see the Center card privately
    expect(p2View.board.center[0]!.hidden).toBe(false);
    expect(p2View.legalActions).toEqual(['GiveReading']);
    expect(adminView.board.center[0]!.hidden).toBe(false);

    // Active player (p1) cannot issue GiveReading for themselves
    const selfRead = dispatch(state, { type: 'GiveReading', playerId: 'p1', advice: 'good' });
    expect(selfRead.ok).toBe(false);
    if (!selfRead.ok) {
      expect(selfRead.error.code).toBe('NOT_READER_PLAYER');
    }
  });

  it('awards pending Reader bonus when active player follows BAD advice (sending Center to Veil)', () => {
    const ruleset = RULESET_PRESETS['l1-2-reading-basic']!;
    const s0 = createGame(ruleset, 'reading-bad-follow-seed');
    const centerId = s0.board.center[0]!;

    const s1Res = dispatch(s0, { type: 'GiveReading', playerId: 'p2', advice: 'bad' });
    expect(s1Res.ok).toBe(true);
    if (!s1Res.ok) return;
    expect(s1Res.state.phase).toBe('AWAITING_READING_DECISION');

    // Center stays hidden to p1 even after reading is delivered
    const p1DuringDecision = projectView(s1Res.state, { role: 'player', playerId: 'p1' });
    expect(p1DuringDecision.board.center[0]!.hidden).toBe(true);
    expect(p1DuringDecision.currentReading?.advice).toBe('bad');

    // p1 chooses DiscardCenter (following BAD advice) -> Center goes to Veil AND p2 earns pending Reader bonus!
    const s2Res = dispatch(s1Res.state, { type: 'DiscardCenter', playerId: 'p1' });
    expect(s2Res.ok).toBe(true);
    if (!s2Res.ok) return;
    expect(s2Res.state.veil).toContain(centerId);
    const p2 = s2Res.state.players.find((p) => p.id === 'p2')!;
    expect(p2.pendingReaderBonuses).toHaveLength(1);
    expect(p2.pendingReaderBonuses[0]!.sourceCardId).toBe(centerId);
    expect(p2.pendingReaderBonuses[0]!.trigger).toBe('bad_discarded');
  });

  it('grants NO Reader bonus when pursuing despite BAD advice and exposes full Deck Components list', () => {
    const ruleset = RULESET_PRESETS['l1-2-reading-basic']!;
    const s0 = createGame(ruleset, 'reading-reject-seed');
    const centerId = s0.board.center[0]!;

    const s1Res = dispatch(s0, { type: 'GiveReading', playerId: 'p2', advice: 'bad' });
    expect(s1Res.ok).toBe(true);
    if (!s1Res.ok) return;

    // p1 pursues despite BAD advice -> reveals & claims Center, NO bonus for p2
    const s2Res = dispatch(s1Res.state, { type: 'PursueCenter', playerId: 'p1' });
    expect(s2Res.ok).toBe(true);
    if (!s2Res.ok) return;
    const p2 = s2Res.state.players.find((p) => p.id === 'p2')!;
    expect(p2.pendingReaderBonuses).toHaveLength(0);

    const p1View = projectView(s2Res.state, { role: 'player', playerId: 'p1' });
    expect(p1View.deckComponents).toHaveLength(24);
    const claimedEntry = p1View.deckComponents.find((d) => d.card.id === centerId)!;
    expect(['Your Hand', 'Player 1 Lineage (Active)', 'Player 1 Lineage (Stack)']).toContain(
      claimedEntry.knownLocation
    );
  });

  it('passes 200-run Level 1.2 batch simulation with bluffing-rival and zero invariant/replay failures', () => {
    const summary = runSimulationBatch({
      ruleset: RULESET_PRESETS['l1-2-reading-basic']!,
      runs: 200,
      seedPrefix: 'ci-l12-bluff',
      policy: 'bluffing-rival',
      verifyReplaySample: 30
    });

    expect(summary.runs).toBe(200);
    expect(summary.invariantFailures).toBe(0);
    expect(summary.replayFailures).toBe(0);
    expect(summary.totalReadings).toBeGreaterThan(200);
    expect(summary.deceptionPct).toBeGreaterThan(0);
  });
});
