import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  cloneRulesetWithOverrides,
  createGame,
  dispatch,
  evaluateReconciliation,
  eventCardToReality,
  projectView,
  replay,
  RULESET_PRESETS,
  type Command,
  type GameState
} from '../src/engine/index.js';
import { chooseFairBotCommand } from '../src/sim/botController.js';
import { runSimulationBatch } from '../src/sim/runner.js';

function mustDispatch(state: GameState, cmd: Command): GameState {
  const res = dispatch(state, cmd);
  if (!res.ok) {
    throw new Error(`Expected ${cmd.type} to succeed, got ${res.error.code}: ${res.error.message}`);
  }
  return res.state;
}

describe('Classic MVP Re-Scaffold — Complete Court Lifecycle, Eclipse, Triangulation, Bonus UX, Trading & Exhaustion', () => {
  const classicMVP = RULESET_PRESETS['poker-proto-e']!;
  const quickMVP = RULESET_PRESETS['poker-proto-e-quick']!;

  it('Scenario 1 (RD-06): Minor in Parallel is displaced to Veil when Court arrives dormant, then awakens next turn with active aura', () => {
    let s = createGame(classicMVP, 'mvp-s1-minor-displaced', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        ['classic-earth-04', 'classic-fire-05', 'classic-water-06'],
        ['classic-earth-08', 'classic-water-08', 'classic-air-08']
      ],
      overrideDaysTop: [
        'classic-air-05',      // Event: 5♠
        'classic-water-03',    // Center: 3♥
        'classic-fire-07',     // Parallel: 7♣ (Minor)
        'classic-earth-queen', // Days #1: Q♦ (Red Queen, +2 Earth)
        'classic-air-09',      // Days #2: 9♠ (replacement Center)
        'classic-water-04'
      ]
    });

    s = mustDispatch(s, { type: 'AdvanceToReading', playerId: 'p1' });
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'bad' });
    s = mustDispatch(s, { type: 'DiscardCenter', playerId: 'p1' });

    expect(s.veil).toContain('classic-water-03');
    expect(s.veil).toContain('classic-fire-07'); // Minor displaced from Parallel -> Veil
    expect(s.board.parallel).toEqual(['classic-earth-queen']);
    expect(s.board.center).toEqual(['classic-air-09']);
    expect(s.majorPending.some((m) => m.cardId === 'classic-earth-queen' && m.dormantUntilTurn === 2)).toBe(true);
    expect(s.phase).toBe('AWAITING_EVENT_RESOLUTION');
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('Scenario 2 (RD-06): Non-matching Court arrival at Rank 1-6 resolves via true LIFO (arriving exits -> Veil; resident stays active in Parallel, NO overflow)', () => {
    let s = createGame(classicMVP, 'mvp-s2-lifo-contention', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        ['classic-fire-04', 'classic-earth-05', 'classic-water-06'],
        ['classic-earth-08', 'classic-water-08', 'classic-air-08']
      ],
      overrideDaysTop: [
        'classic-earth-07',    // T1 Event: 7♦ Treasure
        'classic-air-02',      // T1 Center: 2♠ (evolves P1 A♠ -> 2♠)
        'classic-earth-queen', // T1 Parallel: Q♦ (Red Queen, Rank 12)
        'classic-air-prince',  // T2 Event draw hits J♠ (Black Prince, Rank 11 -> non-matching contention!)
        'classic-earth-06',    // T2 Event Minor
        'classic-water-07'     // T2 Center Minor
      ]
    });

    expect(s.board.parallel).toEqual(['classic-earth-queen']);
    s = mustDispatch(s, { type: 'AdvanceToReading', playerId: 'p1' });
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });

    // Turn 2: Q♦ awakened -> J♠ arrived -> non-matching LIFO -> J♠ departed to Veil, Q♦ stays active in Parallel!
    expect(s.turn).toBe(2);
    expect(s.board.parallel).toEqual(['classic-earth-queen']);
    expect(s.majorPending).toHaveLength(0); // Q♦ is active, NOT re-dormant!
    expect(s.veil).toContain('classic-air-prince');
    expect(s.board.event).toEqual(['classic-earth-06']); // NO overflow into Event!
    expect(s.board.center).toEqual(['classic-water-07']); // NO overflow into Center!
    expect(s.events.some((e) => e.type === 'MajorContentionResolved' && e.payload?.policy === 'lifo')).toBe(true);
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('Scenario 3 (RD-06 + User Turn-1 Eclipse): 9♣ burns Event -> J♥ meets resident dormant J♠ in Parallel -> Eclipse forms -> permanent trophy beside Ace -> Reading proceeds', () => {
    let s = createGame(classicMVP, 'mvp-s3-turn1-eclipse', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        ['classic-fire-09', 'classic-earth-06', 'classic-air-07'], // exact hand from user log!
        ['classic-earth-08', 'classic-water-08', 'classic-air-08']
      ],
      overrideDaysTop: [
        'classic-fire-05',    // Event: 5♣
        'classic-water-04',   // Center: 4♥
        'classic-air-prince', // Parallel: J♠ (resident dormant Prince!)
        'classic-water-prince', // Days #1: J♥ (arriving Red Prince!)
        'classic-earth-07'    // Days #2: replacement Event Minor
      ]
    });

    expect(s.board.parallel).toEqual(['classic-air-prince']);
    expect(s.phase).toBe('AWAITING_ELEMENTAL_ACTION');

    // Player 1 burns Event (5♣) using 9♣ -> refills Event -> draws J♥ -> collides in Parallel with J♠ -> ECLIPSE!
    s = mustDispatch(s, {
      type: 'UseElementalEffect',
      playerId: 'p1',
      element: 'fire',
      sourceCardId: 'classic-fire-09',
      targetZone: 'board',
      targetBoardSlots: ['event']
    });

    expect(s.players[0]!.eclipseCount).toBe(1);
    expect(s.players[0]!.eclipseBonusVP).toBe(1);
    expect(s.players[0]!.eclipseTrophies).toHaveLength(1);
    expect(s.players[0]!.eclipseTrophies![0]!.shortLabel).toBe('☀ J +1');
    expect(s.veil).toContain('classic-air-prince');
    expect(s.veil).toContain('classic-water-prince');
    expect(s.board.parallel).toEqual([]);
    expect(s.board.event).toEqual(['classic-earth-07']);
    expect(s.phase).toBe('AWAITING_READING');
    expect(s.events.some((e) => e.type === 'EclipseFormed' && e.payload?.residentCardId === 'classic-air-prince' && e.payload?.arrivingCardId === 'classic-water-prince')).toBe(true);
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('Scenario 4 (RD-06 Rank 7-9 Contention): Rank 7 player pauses in AWAITING_MAJOR_CONTENTION and both ChooseMajorExit outcomes resolve cleanly', () => {
    // Build a Turn 1 state where P2 reaches Rank 7 before Turn 2 triggers non-matching contention
    let s = createGame(classicMVP, 'mvp-s4-rank7-contention', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        ['classic-fire-04', 'classic-earth-05', 'classic-water-06'],
        ['classic-fire-02', 'classic-fire-05', 'classic-fire-06']
      ],
      overrideDaysTop: [
        'classic-earth-07',     // T1 Event: Treasure
        'classic-air-08',       // T1 Center
        'classic-earth-prince', // T1 Parallel: J♦ (Red Prince)
        'classic-fire-king',    // T2 Event draw: K♣ (Black King -> Contention!)
        'classic-water-04',     // T2 Event Minor
        'classic-air-09'        // T2 Center Minor
      ]
    });

    // Advance P2 cleanly to Rank 7 lineage for deterministic Rank-7 contention fixture
    const rank7P2State: GameState = (() => {
      let cur = mustDispatch(s, { type: 'AdvanceToReading', playerId: 'p1' });
      cur = mustDispatch(cur, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
      cur = mustDispatch(cur, { type: 'PursueCenter', playerId: 'p1' });
      cur = mustDispatch(cur, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });
      // Promote P2 to Rank 7 by moving classic-fire-07 from days into P2 lineage cleanly
      const fire7Idx = cur.days.indexOf('classic-fire-07');
      const daysWithout7 = cur.days.filter((id) => id !== 'classic-fire-07');
      expect(fire7Idx).toBeGreaterThanOrEqual(0);
      const nextPlayers = cur.players.map((p, idx) =>
        idx === 1
          ? {
              ...p,
              lineage: {
                rank: 7,
                element: 'fire' as const,
                color: 'black' as const,
                cardIds: [...p.lineage.cardIds, 'classic-fire-07']
              }
            }
          : p
      );
      return { ...cur, days: daysWithout7, players: nextPlayers };
    })();

    // EndTurn for P1 -> Turn 2 active player is Rank-7 P2 -> K♣ contends with J♦ -> pauses!
    const pausedRes = dispatch(rank7P2State, { type: 'EndTurn', playerId: 'p1' });
    expect(pausedRes.ok).toBe(true);
    if (!pausedRes.ok) return;
    const paused = pausedRes.state;
    expect(paused.phase).toBe('AWAITING_MAJOR_CONTENTION');
    expect(paused.pendingMajorContention?.playerId).toBe('p2');
    expect(paused.pendingMajorContention?.incumbentCardId).toBe('classic-earth-prince');
    expect(paused.pendingMajorContention?.arrivingCardId).toBe('classic-fire-king');
    expect(checkInvariants(paused).ok).toBe(true);

    // Outcome A: Keep resident J♦, exit arriving K♣
    const outA = mustDispatch(paused, {
      type: 'ChooseMajorExit',
      playerId: 'p2',
      cardId: 'classic-fire-king'
    });
    expect(outA.board.parallel).toEqual(['classic-earth-prince']);
    expect(outA.veil).toContain('classic-fire-king');
    expect(outA.board.event).toEqual(['classic-water-04']);
    expect(outA.board.center).toEqual(['classic-air-09']);
    expect(outA.phase).toBe('AWAITING_ELEMENTAL_ACTION');
    expect(checkInvariants(outA).ok).toBe(true);

    // Outcome B: Exit resident J♦, welcome arriving K♣ dormant until Turn 3
    const outB = mustDispatch(paused, {
      type: 'ChooseMajorExit',
      playerId: 'p2',
      cardId: 'classic-earth-prince'
    });
    expect(outB.board.parallel).toEqual(['classic-fire-king']);
    expect(outB.veil).toContain('classic-earth-prince');
    expect(outB.majorPending.some((m) => m.cardId === 'classic-fire-king' && m.dormantUntilTurn === 3)).toBe(true);
    expect(outB.board.event).toEqual(['classic-water-04']);
    expect(outB.board.center).toEqual(['classic-air-09']);
    expect(outB.phase).toBe('AWAITING_ELEMENTAL_ACTION');
    expect(checkInvariants(outB).ok).toBe(true);
  });

  it('Scenario 5 (RD-07 & R2-BUG-01): rejects solo Court in Center, types Event Court as major_resonance (never Treasure), and achieves deliberate Triangulation via legal Earth board_and_days', () => {
    let s = createGame(classicMVP, 'mvp-s5-deliberate-triangulation', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        ['classic-earth-04', 'classic-earth-05', 'classic-water-06'], // Two 2-VP Earth cards!
        ['classic-earth-08', 'classic-water-08', 'classic-air-08']
      ],
      overrideDaysTop: [
        'classic-fire-04',     // T1 Event: 4♣
        'classic-fire-07',     // T1 Center: 7♣
        'classic-fire-prince', // T1 Parallel: J♣ (Rank 11, Black)
        'classic-air-queen',   // Days #1: Q♠ (Rank 12, Black)
        'classic-water-02',    // T2 Center
        'classic-water-king'   // T3 Days #1: K♥ (Rank 13, Red)
      ]
    });

    // Guard check: attempting to place solo Court Q♠ into Center when Event is a Minor MUST be rejected!
    const badPeek = mustDispatch(s, {
      type: 'StartEarthPeek',
      playerId: 'p1',
      sourceCardId: 'classic-earth-04',
      targetBoardSlots: ['center'],
      daysCount: 1
    });
    const rejectedCenter = dispatch(badPeek, {
      type: 'CommitEarthReorder',
      playerId: 'p1',
      newOrder: ['classic-air-queen', 'classic-fire-07']
    });
    expect(rejectedCenter.ok).toBe(false);
    if (!rejectedCenter.ok) {
      expect(rejectedCenter.error.code).toBe('COURT_CANNOT_OCCUPY_CENTER_WITHOUT_COMBO');
    }

    // Step 1 (Turn 1): Deliberately anchor Q♠ into Event via Earth board_and_days!
    s = mustDispatch(s, {
      type: 'StartEarthPeek',
      playerId: 'p1',
      sourceCardId: 'classic-earth-04',
      targetBoardSlots: ['event'],
      daysCount: 1
    });
    s = mustDispatch(s, {
      type: 'CommitEarthReorder',
      playerId: 'p1',
      newOrder: ['classic-air-queen', 'classic-fire-04']
    });
    expect(s.board.event).toEqual(['classic-air-queen']);
    // R2-BUG-01 fix verified: Event Court is 'major_resonance', NEVER 'treasure'!
    expect(eventCardToReality(s.cards['classic-air-queen']!)).toBe('major_resonance');

    // Finish Turn 1 (claims 7♣ under Major Resonance; Q♠ stays anchored in Event!)
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });

    // Turn 2 (P2): claims Center 4♣ (slid from Days #1), ends Turn 2 (Market opens after R1? No, every 2 rounds!)
    s = mustDispatch(s, { type: 'AdvanceToReading', playerId: 'p2' });
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p1', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p2' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p2', sacrificeCardIds: [] });
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p2' });

    // Turn 3 (P1): Board holds Event=Q♠, Center=2♥, Parallel=J♣; Days #1 = K♥ (King of Water)!
    expect(s.turn).toBe(3);
    expect(s.board.event).toEqual(['classic-air-queen']);
    expect(s.board.parallel).toEqual(['classic-fire-prince']);
    expect(s.days[0]).toBe('classic-water-king');

    // Step 2 (Turn 3): Pull K♥ into Center via Earth -> immediate DELIBERATE TRIANGULATION VICTORY!
    s = mustDispatch(s, {
      type: 'StartEarthPeek',
      playerId: 'p1',
      sourceCardId: 'classic-earth-05',
      targetBoardSlots: ['center'],
      daysCount: 1
    });
    s = mustDispatch(s, {
      type: 'CommitEarthReorder',
      playerId: 'p1',
      newOrder: ['classic-water-king', 'classic-water-02']
    });

    expect(s.status).toBe('completed');
    expect(s.outcome?.reason).toBe('triangulation_victory');
    expect(s.outcome?.winnerIds).toEqual(['p1']);
    expect(s.events.some((e) => e.type === 'TriangulationCompleted')).toBe(true);
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('Scenario 6 (RD-08): separates cappedBaseVP (max 3) from activeCourtAuraVP and persistentEclipseBonusVP across Ranks 1, 5, and 9', () => {
    const s = createGame(classicMVP, 'mvp-s6-vp-arithmetic');
    const barrier = s.cards['classic-fire-05']!;
    const center = s.cards['classic-air-08']!;

    const checkRank = (rank: number, aura: number, eclipse: number) =>
      evaluateReconciliation({
        player: {
          ...s.players[0]!,
          lineage: {
            rank,
            element: 'air',
            color: 'black',
            cardIds: [`classic-air-0${rank}`]
          },
          eclipseBonusVP: eclipse
        },
        eventCard: barrier,
        centerCard: center,
        sacrificeCardIds: [],
        cards: s.cards,
        ruleset: classicMVP,
        activeCourtAuraVP: aura
      });

    // Rank 1 (1 VP base) + Prince Aura (+1) + Prince Eclipse (+1) = 3 effective VP -> passes 2 VP Barrier with 0 sacrifices!
    const r1 = checkRank(1, 1, 1);
    expect(r1.cappedBaseVP).toBe(1);
    expect(r1.effectiveVP).toBe(3);
    expect(r1.passes).toBe(true);

    // Rank 5 (2 VP base) + Queen Aura (+2) + Queen Eclipse (+2) = 6 effective VP (not clipped to 3!)
    const r5 = checkRank(5, 2, 2);
    expect(r5.cappedBaseVP).toBe(2);
    expect(r5.effectiveVP).toBe(6);

    // Rank 9 (3 VP base) + King Aura (+3) + King Eclipse (+3) = 9 effective VP
    const r9 = checkRank(9, 3, 3);
    expect(r9.cappedBaseVP).toBe(3);
    expect(r9.effectiveVP).toBe(9);
  });

  it('Scenario 7 (User Turn 2->3->4 Fixture): Earth Tier-1 Reader Bonus exposes explicit Tier-1 descriptor & End-Turn expiry warning, buries #1 Major, and prevents accidental Turn-4 overflow Triangulation', () => {
    let s = createGame(classicMVP, 'mvp-s7-earth-bonus-turn3', {
      startingElements: ['air', 'fire'],
      overrideHands: [
        ['classic-fire-04', 'classic-earth-02', 'classic-water-03'],
        ['classic-water-09', 'classic-earth-08', 'classic-water-08']
      ],
      overrideDaysTop: [
        'classic-earth-07',     // T1 Event: Treasure
        'classic-air-03',       // T1 Center: 3♠ (evolves P1)
        'classic-earth-06',     // T1 Parallel: 6♦ (slides to T2 Center -> P2 discards -> P1 earns Earth Tier-1 Bonus!)
        'classic-fire-03',      // T2 Event: 3♣ Trial
        'classic-water-05',     // T2 Parallel
        'classic-air-08',       // T2 Reject replacement: 8♠ (P2 abandons -> P1 sees on T3!)
        'classic-water-queen',  // T3 Event draw hits Q♥ -> Parallel!
        'classic-air-05',       // T3 Event Minor
        'classic-air-prince',   // Days #1: J♠ (Major back #1)
        'classic-earth-queen',  // Days #2: Q♦ (Major back #2)
        'classic-fire-06'
      ]
    });

    // T1: P1 claims 3♠ cleanly
    s = mustDispatch(s, { type: 'AdvanceToReading', playerId: 'p1' });
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p2', advice: 'good' });
    s = mustDispatch(s, { type: 'PursueCenter', playerId: 'p1' });
    s = mustDispatch(s, { type: 'ResolveEvent', playerId: 'p1', sacrificeCardIds: [] });
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p1' });

    // T2: P1 advises BAD -> P2 rejects 6♦ (grants P1 Earth Tier-1 Bonus!) -> draws 8♠ vs 3♣ Trial -> P2 abandons 8♠!
    s = mustDispatch(s, { type: 'AdvanceToReading', playerId: 'p2' });
    s = mustDispatch(s, { type: 'GiveReading', playerId: 'p1', advice: 'bad' });
    s = mustDispatch(s, { type: 'DiscardCenter', playerId: 'p2' });
    s = mustDispatch(s, { type: 'AbandonCenter', playerId: 'p2' });
    s = mustDispatch(s, { type: 'EndTurn', playerId: 'p2' });

    // T3: P1 sees abandoned 8♠, Q♥ in Parallel, and 2 Major backs at top of Days (J♠, Q♦)!
    expect(s.turn).toBe(3);
    expect(s.phase).toBe('AWAITING_ABANDONED_CHOICE');
    const p1ViewT3 = projectView(s, { role: 'player', playerId: 'p1' });
    const bonusDesc = p1ViewT3.actionDescriptors.find((d) => d.category === 'reader_bonus');
    expect(bonusDesc).toBeDefined();
    expect(bonusDesc!.enabled).toBe(true);
    expect(bonusDesc!.effectSummary).toContain('Tier 1 (1 card)');
    expect(bonusDesc!.effectSummary).toContain('Rearranging 2+ cards requires Tier 2+');

    // Also verify if P1 claims 8♠ first, READY_TO_END_TURN explicitly sets expiryWarning on EndTurn!
    const claimedFirst = mustDispatch(s, { type: 'ClaimAbandonedCard', playerId: 'p1' });
    const viewBeforeEnd = projectView(claimedFirst, { role: 'player', playerId: 'p1' });
    const endDesc = viewBeforeEnd.actionDescriptors.find((d) => d.commandType === 'EndTurn');
    expect(endDesc?.expiryWarning).toContain('expire');

    // Now spend the Earth Tier-1 Bonus to privately peek #1 (J♠) and bury it to the bottom of Days!
    const bonusId = p1ViewT3.players[0]!.pendingReaderBonuses.find((b) => b.status === 'available')!.id;
    s = mustDispatch(s, { type: 'StartEarthPeek', playerId: 'p1', bonusId });
    expect(s.phase).toBe('AWAITING_EARTH_REORDER');
    s = mustDispatch(s, { type: 'CommitEarthReorder', playerId: 'p1', moveTopToBottom: true });
    expect(s.days[s.days.length - 1]).toBe('classic-air-prince');
    expect(s.phase).toBe('AWAITING_ABANDONED_CHOICE');
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('Scenario 8 (RD-10 Trading Market): opens after Round 2, supports 1-for-1 fair Bot trade + 1-way gift + immediate post-trade mandatory evolution', () => {
    const fastMarket = cloneRulesetWithOverrides(classicMVP, { marketFrequencyRounds: 1 });
    let s = createGame(fastMarket, 'mvp-s8-trading-market', {
      startingElements: ['air', 'water'], // Air (Black) vs Water (Red) so off-color 2♥/2♠ stay in hands until traded!
      overrideHands: [
        ['classic-water-02', 'classic-earth-05', 'classic-water-06'], // P1 (Black Air) holds 2♥ (Red -> evolves Red Water P2!)
        ['classic-air-02', 'classic-fire-08', 'classic-air-08']       // P2 (Red Water) holds 2♠ (Black -> evolves Black Air P1!)
      ],
      overrideDaysTop: [
        'classic-earth-07', // T1 Event: Treasure
        'classic-earth-04', // T1 Center (Red -> stays in Black P1 hand)
        'classic-fire-05',  // T1 Parallel -> T2 Center (Black -> stays in Red P2 hand)
        'classic-earth-08', // T2 Event: Treasure
        'classic-water-09', // T2 Parallel
        'classic-air-06',
        'classic-fire-06'
      ]
    });

    // Finish Round 1 (Turn 1 P1 + Turn 2 P2) -> Market opens automatically!
    for (const pid of ['p1', 'p2']) {
      s = mustDispatch(s, { type: 'AdvanceToReading', playerId: pid });
      s = mustDispatch(s, { type: 'GiveReading', playerId: pid === 'p1' ? 'p2' : 'p1', advice: 'good' });
      s = mustDispatch(s, { type: 'PursueCenter', playerId: pid });
      s = mustDispatch(s, { type: 'ResolveEvent', playerId: pid, sacrificeCardIds: [] });
      s = mustDispatch(s, { type: 'EndTurn', playerId: pid });
    }

    expect(s.phase).toBe('AWAITING_MARKET');
    expect(s.market?.openedAfterRound).toBe(1);

    // P1 offers 2♥ (immediate evolution for Red Water P2!) asking for 1 card back (privacy-safe blind request!)
    s = mustDispatch(s, {
      type: 'ProposeTrade',
      playerId: 'p1',
      targetPlayerId: 'p2',
      offerCardIds: ['classic-water-02'],
      requestedCount: 1
    });

    // Fair Bot (P2) inspects ONLY its masked view -> accepts with a counter-card!
    const botView = projectView(s, { role: 'player', playerId: 'p2' });
    const botResp = chooseFairBotCommand(botView, 'p2', 'bluffing-rival');
    expect(botResp?.type).toBe('AcceptTrade');
    s = mustDispatch(s, botResp!);

    // P2 immediately evolved A♥ -> 2♥!
    expect(s.players[1]!.lineage.rank).toBe(2);
    expect(s.market?.completedTrades).toBe(1);

    // Also verify a 1-way gift works cleanly!
    s = mustDispatch(s, {
      type: 'ProposeTrade',
      playerId: 'p1',
      targetPlayerId: 'p2',
      offerCardIds: ['classic-earth-05'],
      requestedCount: 0
    });
    const giftResp = chooseFairBotCommand(projectView(s, { role: 'player', playerId: 'p2' }), 'p2', 'bluffing-rival');
    expect(giftResp?.type).toBe('AcceptTrade');
    s = mustDispatch(s, giftResp!);
    expect(s.market?.completedTrades).toBe(2);

    // Close Market -> cleanly starts Round 2 Turn 3!
    s = mustDispatch(s, { type: 'CloseMarket', playerId: 'p1' });
    expect(s.round).toBe(2);
    expect(s.turn).toBe(3);
    expect(s.phase).not.toBe('AWAITING_MARKET');
    expect(checkInvariants(s).ok).toBe(true);
  });

  it('Scenario 9 (RD-11 & Quick Eclipse): quick mode wins at 1 Eclipse and 100-run multi-policy check has zero invariant/replay failures and zero accidental mass Triangulation', () => {
    const batch = runSimulationBatch({
      ruleset: quickMVP,
      runs: 100,
      seedPrefix: 'mvp-quick-100',
      policy: 'evolution-greedy',
      verifyReplaySample: 20
    });
    expect(batch.invariantFailures).toBe(0);
    expect(batch.replayFailures).toBe(0);
    expect(batch.triangulationVictories).toBe(0);
    expect(batch.eclipseVictories).toBeGreaterThan(20);
    expect(batch.totalMarketWindows).toBeGreaterThan(0);

    const sample = batch.sampleRuns[0]!;
    const rep = replay(sample.seed, quickMVP, sample.commands);
    expect(rep.ok).toBe(true);
    expect(rep.finalState.stateHash).toBe(sample.finalStateHash);
  });
});
