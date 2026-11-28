import type { Ruleset, RuleStatus } from './types.js';

export const ENGINE_VERSION = '0.7.0-classic-mvp';

const INACTIVE_FUTURE_FEATURES = {
  readings: false,
  barriersAndTrials: false,
  elementalEffects: false,
  tradingMarket: false,
  majors: false,
  eclipse: false,
  triangulation: false,
  moonSunCycle: false,
  secondaryLineage: false,
  majorEffects: {}
} as const;

const READING_ONLY_FEATURES = {
  ...INACTIVE_FUTURE_FEATURES,
  readings: true
} as const;

const MILESTONE_C_FEATURES = {
  ...INACTIVE_FUTURE_FEATURES,
  readings: true,
  barriersAndTrials: true
} as const;

const MILESTONE_D1_FEATURES = {
  ...MILESTONE_C_FEATURES,
  elementalEffects: true
} as const;

const MILESTONE_E_FEATURES = {
  ...MILESTONE_D1_FEATURES,
  tradingMarket: true,
  majors: true,
  eclipse: true,
  triangulation: true
} as const;

const BASE_MC_DEFAULTS = {
  readerBonusPolicy: 'record_only' as const,
  readerBonusConsumesTurnAction: true,
  readerBonusAnytimeOnTurn: false,
  preventSetupEvolution: false,
  replaceCenterOnDiscard: false,
  emptyChamberMode: true,
  rotateEventOnCenterDiscard: false,
  elementalTiming: 'after_encounter' as const,
  allowRevealedBoardElemental: false,
  abandonedClaimPolicy: 'free_treasure_legacy' as const,
  maxElementalActionsPerTurn: 1 as const,
  elementalNativePrimaryBonusVP: 0,
  waterResurfaceDestination: 'shuffled' as const
};

const BASE_D1_DEFAULTS = {
  readerBonusPolicy: 'free_tier1_elemental_next_turn' as const,
  readerBonusConsumesTurnAction: true,
  readerBonusAnytimeOnTurn: false,
  preventSetupEvolution: false,
  replaceCenterOnDiscard: false,
  emptyChamberMode: true,
  rotateEventOnCenterDiscard: true,
  elementalTiming: 'after_encounter' as const,
  allowRevealedBoardElemental: false,
  abandonedClaimPolicy: 'free_treasure_legacy' as const,
  maxElementalActionsPerTurn: 1 as const,
  elementalNativePrimaryBonusVP: 0,
  waterResurfaceDestination: 'shuffled' as const
};

const BASE_E_DEFAULTS = {
  readerBonusPolicy: 'free_tier1_elemental_next_turn' as const,
  readerBonusConsumesTurnAction: false,
  readerBonusAnytimeOnTurn: true,
  preventSetupEvolution: true,
  replaceCenterOnDiscard: true,
  emptyChamberMode: false,
  rotateEventOnCenterDiscard: true,
  elementalTiming: 'before_reading' as const,
  allowRevealedBoardElemental: true,
  abandonedClaimPolicy: 'free_no_prep' as const,
  majorContentionEnabled: true,
  majorDefaultDeparture: 'lifo' as const,
  eclipseCardDisposition: 'both_to_veil' as const,
  maxElementalActionsPerTurn: 1 as const,
  elementalNativePrimaryBonusVP: 0,
  waterResurfaceDestination: 'shuffled' as const
};

export const RULESET_PRESETS: Readonly<Record<string, Ruleset>> = {
  'poker-proto-e': {
    id: 'poker-proto-e',
    version: '2.0.0',
    name: 'Classic Nexus Eclipse — Complete MVP (48 Cards · Courts, Contention, Eclipse, Triangulation & Market)',
    category: 'prototype',
    description:
      'Complete 48-card Bicycle/Poker Classic MVP (36 Minors + 12 Classic Court Major Proxies): Board-Set-First → Optional Elemental Prep → Reading → Revealed-Board Intervention, dedicated Parallel Court contention (LIFO / Rank 7-9 choice), visible Eclipse trophies, deliberate Earth Triangulation, and scheduled Trading Market every 2 rounds.',
    deckProfile: 'classic-48',
    maxMinorRank: 9,
    includeCourts: true,
    playerCount: 2,
    startingHandSize: 3,
    maxHandSize: 5,
    unusedAcesInDeck: false,
    maxEffectiveVP: 3,
    allowedEvolutionColors: 'same-color',
    maxEvolutionJump: 2,
    evolutionTieBreak: 'lowest-rank-same-element',
    readingTierHintsEnabled: false,
    readerBonusOnAbandon: false,
    ...BASE_E_DEFAULTS,
    trialTargetElement: 'event',
    trialRequireAdvantage: true,
    trialAdvantageBonusVP: 1,
    sacrificeDestination: 'veil',
    declinedAbandonedPolicy: 'send_to_veil',
    marketFrequencyRounds: 2,
    eclipseVictoryCount: 'players-plus-one',
    l11TargetRank: 0,
    stopOnTargetRank: false,
    boardOccupancyLimits: { event: 1, center: 1, parallel: 1 },
    features: MILESTONE_E_FEATURES
  },
  'poker-proto-e-quick': {
    id: 'poker-proto-e-quick',
    version: '2.0.0',
    name: 'Classic Nexus Eclipse — Quick Eclipse (1 Eclipse Wins)',
    category: 'prototype',
    description:
      '48-card Classic MVP tuned for fast playtesting: first Eclipse or deliberate Triangulation wins immediately, with full Court contention, Trading Market, and Board-first Elemental Prep.',
    deckProfile: 'classic-48',
    maxMinorRank: 9,
    includeCourts: true,
    playerCount: 2,
    startingHandSize: 3,
    maxHandSize: 5,
    unusedAcesInDeck: false,
    maxEffectiveVP: 3,
    allowedEvolutionColors: 'same-color',
    maxEvolutionJump: 2,
    evolutionTieBreak: 'lowest-rank-same-element',
    readingTierHintsEnabled: false,
    readerBonusOnAbandon: false,
    ...BASE_E_DEFAULTS,
    trialTargetElement: 'event',
    trialRequireAdvantage: true,
    trialAdvantageBonusVP: 1,
    sacrificeDestination: 'veil',
    declinedAbandonedPolicy: 'send_to_veil',
    marketFrequencyRounds: 2,
    eclipseVictoryCount: 1,
    l11TargetRank: 0,
    stopOnTargetRank: false,
    boardOccupancyLimits: { event: 1, center: 1, parallel: 1 },
    features: MILESTONE_E_FEATURES
  },
  'poker-proto-d1': {
    id: 'poker-proto-d1',
    version: '1.4.0',
    name: 'Poker Prototype — Milestone D1 (36 Minors · Full Loop + Elemental Effects)',
    category: 'prototype',
    description:
      'Integrated 2-player Poker Prototype with all 36 Minor cards (Ace–9) and complete D1 turn lifecycle: Abandoned Check → Concealed Reading → Pursue/Discard → Left Event Reality (Treasure/Barrier/Trial) → Mandatory Chained Evolution → Elemental Action Window (Air/Fire/Water/Earth consuming hand card → Veil) & provisional usable Reader Bonus.',
    deckProfile: 'classic-36',
    maxMinorRank: 9,
    includeCourts: false,
    playerCount: 2,
    startingHandSize: 3,
    maxHandSize: 5,
    unusedAcesInDeck: false,
    maxEffectiveVP: 3,
    allowedEvolutionColors: 'same-color',
    maxEvolutionJump: 2,
    evolutionTieBreak: 'lowest-rank-same-element',
    readingTierHintsEnabled: false,
    readerBonusOnAbandon: false,
    ...BASE_D1_DEFAULTS,
    trialTargetElement: 'event',
    trialRequireAdvantage: true,
    trialAdvantageBonusVP: 1,
    sacrificeDestination: 'veil',
    declinedAbandonedPolicy: 'send_to_veil',
    marketFrequencyRounds: 0,
    eclipseVictoryCount: 'players-plus-one',
    l11TargetRank: 0,
    stopOnTargetRank: false,
    boardOccupancyLimits: { event: 1, center: 1, parallel: 1 },
    features: MILESTONE_D1_FEATURES
  },
  'poker-proto-d1-hard': {
    id: 'poker-proto-d1-hard',
    version: '1.4.0',
    name: 'Poker Prototype — Milestone D1 Hard (+1 Same Element · Elemental Effects)',
    category: 'prototype',
    description:
      'Integrated 36-card Milestone D1 prototype with strict same-element +1 mandatory evolution and full Elemental Action Window.',
    deckProfile: 'classic-36',
    maxMinorRank: 9,
    includeCourts: false,
    playerCount: 2,
    startingHandSize: 3,
    maxHandSize: 5,
    unusedAcesInDeck: false,
    maxEffectiveVP: 3,
    allowedEvolutionColors: 'same-element',
    maxEvolutionJump: 1,
    evolutionTieBreak: 'lowest-rank-same-element',
    readingTierHintsEnabled: false,
    readerBonusOnAbandon: false,
    ...BASE_D1_DEFAULTS,
    trialTargetElement: 'event',
    trialRequireAdvantage: true,
    trialAdvantageBonusVP: 1,
    sacrificeDestination: 'veil',
    declinedAbandonedPolicy: 'send_to_veil',
    marketFrequencyRounds: 0,
    eclipseVictoryCount: 'players-plus-one',
    l11TargetRank: 0,
    stopOnTargetRank: false,
    boardOccupancyLimits: { event: 1, center: 1, parallel: 1 },
    features: MILESTONE_D1_FEATURES
  },
  'poker-proto-c': {
    id: 'poker-proto-c',
    version: '1.3.0',
    name: 'Poker Prototype — Milestone C Baseline (36 Minors · Reading + Event Loop)',
    category: 'prototype',
    description:
      'Preserved Milestone C baseline (36 Minor cards, Ace–9). Full Reading + Left Event Reality + Abandonment + Mandatory Chained Evolution without Elemental Action Window.',
    deckProfile: 'classic-36',
    maxMinorRank: 9,
    includeCourts: false,
    playerCount: 2,
    startingHandSize: 3,
    maxHandSize: 5,
    unusedAcesInDeck: false,
    maxEffectiveVP: 3,
    allowedEvolutionColors: 'same-color',
    maxEvolutionJump: 2,
    evolutionTieBreak: 'lowest-rank-same-element',
    readingTierHintsEnabled: false,
    readerBonusOnAbandon: false,
    ...BASE_MC_DEFAULTS,
    trialTargetElement: 'event',
    trialRequireAdvantage: true,
    trialAdvantageBonusVP: 1,
    sacrificeDestination: 'veil',
    declinedAbandonedPolicy: 'send_to_veil',
    marketFrequencyRounds: 0,
    eclipseVictoryCount: 'players-plus-one',
    l11TargetRank: 0,
    stopOnTargetRank: false,
    boardOccupancyLimits: { event: 1, center: 1, parallel: 1 },
    features: MILESTONE_C_FEATURES
  },
  'poker-proto-c-hard': {
    id: 'poker-proto-c-hard',
    version: '1.3.0',
    name: 'Poker Prototype — Milestone C Hard (+1 Same Element · 36 Minors)',
    category: 'prototype',
    description:
      'Preserved Milestone C 36-card Poker Prototype with strict same-element +1 mandatory evolution.',
    deckProfile: 'classic-36',
    maxMinorRank: 9,
    includeCourts: false,
    playerCount: 2,
    startingHandSize: 3,
    maxHandSize: 5,
    unusedAcesInDeck: false,
    maxEffectiveVP: 3,
    allowedEvolutionColors: 'same-element',
    maxEvolutionJump: 1,
    evolutionTieBreak: 'lowest-rank-same-element',
    readingTierHintsEnabled: false,
    readerBonusOnAbandon: false,
    ...BASE_MC_DEFAULTS,
    trialTargetElement: 'event',
    trialRequireAdvantage: true,
    trialAdvantageBonusVP: 1,
    sacrificeDestination: 'veil',
    declinedAbandonedPolicy: 'send_to_veil',
    marketFrequencyRounds: 0,
    eclipseVictoryCount: 'players-plus-one',
    l11TargetRank: 0,
    stopOnTargetRank: false,
    boardOccupancyLimits: { event: 1, center: 1, parallel: 1 },
    features: MILESTONE_C_FEATURES
  },
  'l1-3-events-tutorial': {
    id: 'l1-3-events-tutorial',
    version: '1.3.0',
    name: 'Tutorial 1.3 — Treasure, Barrier, Trial & Abandon (36 Minors)',
    category: 'tutorial',
    description:
      'Guided lesson teaching Left Event Realities (Treasure 7–9, Barrier 4–6, Trial 1–3), sacrificing hand cards, and abandoning Center for the next player. Ends on Rank 9 or Days exhaustion.',
    tutorialLevel: '1.3',
    deckProfile: 'classic-36',
    maxMinorRank: 9,
    includeCourts: false,
    playerCount: 2,
    startingHandSize: 3,
    maxHandSize: 5,
    unusedAcesInDeck: false,
    maxEffectiveVP: 3,
    allowedEvolutionColors: 'same-color',
    maxEvolutionJump: 2,
    evolutionTieBreak: 'lowest-rank-same-element',
    readingTierHintsEnabled: false,
    readerBonusOnAbandon: false,
    ...BASE_MC_DEFAULTS,
    trialTargetElement: 'event',
    trialRequireAdvantage: true,
    trialAdvantageBonusVP: 1,
    sacrificeDestination: 'veil',
    declinedAbandonedPolicy: 'send_to_veil',
    marketFrequencyRounds: 0,
    eclipseVictoryCount: 'players-plus-one',
    l11TargetRank: 9,
    stopOnTargetRank: true,
    boardOccupancyLimits: { event: 1, center: 1, parallel: 1 },
    features: MILESTONE_C_FEATURES
  },
  'l1-2-reading-basic': {
    id: 'l1-2-reading-basic',
    version: '1.2.1',
    name: 'Tutorial 1.2 — Concealed Readings Only (24 Cards · Ace–6)',
    category: 'tutorial',
    description:
      'Isolated reading lesson: Ace–6 deck (24 cards, no Left Event yet). Practice giving GOOD/BAD readings and choosing Pursue vs. Discard.',
    tutorialLevel: '1.2',
    deckProfile: 'classic-l1-1',
    maxMinorRank: 6,
    includeCourts: false,
    playerCount: 2,
    startingHandSize: 2,
    maxHandSize: 5,
    unusedAcesInDeck: false,
    maxEffectiveVP: 3,
    allowedEvolutionColors: 'same-color',
    maxEvolutionJump: 2,
    evolutionTieBreak: 'lowest-rank-same-element',
    readingTierHintsEnabled: false,
    readerBonusOnAbandon: false,
    ...BASE_MC_DEFAULTS,
    trialTargetElement: 'event',
    trialRequireAdvantage: true,
    trialAdvantageBonusVP: 1,
    sacrificeDestination: 'veil',
    declinedAbandonedPolicy: 'send_to_veil',
    marketFrequencyRounds: 0,
    eclipseVictoryCount: 'players-plus-one',
    l11TargetRank: 6,
    stopOnTargetRank: true,
    boardOccupancyLimits: { event: 1, center: 1, parallel: 1 },
    features: READING_ONLY_FEATURES
  },
  'l1-1-basic': {
    id: 'l1-1-basic',
    version: '1.1.0',
    name: 'Tutorial 1.1 — Mandatory Evolution Only (24 Cards · Ace–6)',
    category: 'tutorial',
    description:
      'Isolated forced-evolution lesson: Ace–6 deck (24 cards, open Center, no Readings or Events).',
    tutorialLevel: '1.1',
    deckProfile: 'classic-l1-1',
    maxMinorRank: 6,
    includeCourts: false,
    playerCount: 2,
    startingHandSize: 2,
    maxHandSize: 5,
    unusedAcesInDeck: false,
    maxEffectiveVP: 3,
    allowedEvolutionColors: 'same-color',
    maxEvolutionJump: 2,
    evolutionTieBreak: 'lowest-rank-same-element',
    readingTierHintsEnabled: false,
    readerBonusOnAbandon: false,
    ...BASE_MC_DEFAULTS,
    trialTargetElement: 'event',
    trialRequireAdvantage: true,
    trialAdvantageBonusVP: 1,
    sacrificeDestination: 'veil',
    declinedAbandonedPolicy: 'send_to_veil',
    marketFrequencyRounds: 0,
    eclipseVictoryCount: 'players-plus-one',
    l11TargetRank: 6,
    stopOnTargetRank: true,
    boardOccupancyLimits: { event: 1, center: 1, parallel: 1 },
    features: INACTIVE_FUTURE_FEATURES
  },
  'l1-1-hard': {
    id: 'l1-1-hard',
    version: '1.1.0',
    name: 'Tutorial 1.1 — Hard Evolution (+1 Same Element · Ace–6)',
    category: 'tutorial',
    description: 'Isolated strict evolution lesson: same element, +1 rank step only.',
    tutorialLevel: '1.1-hard',
    deckProfile: 'classic-l1-1',
    maxMinorRank: 6,
    includeCourts: false,
    playerCount: 2,
    startingHandSize: 2,
    maxHandSize: 5,
    unusedAcesInDeck: false,
    maxEffectiveVP: 3,
    allowedEvolutionColors: 'same-element',
    maxEvolutionJump: 1,
    evolutionTieBreak: 'lowest-rank-same-element',
    readingTierHintsEnabled: false,
    readerBonusOnAbandon: false,
    ...BASE_MC_DEFAULTS,
    trialTargetElement: 'event',
    trialRequireAdvantage: true,
    trialAdvantageBonusVP: 1,
    sacrificeDestination: 'veil',
    declinedAbandonedPolicy: 'send_to_veil',
    marketFrequencyRounds: 0,
    eclipseVictoryCount: 'players-plus-one',
    l11TargetRank: 6,
    stopOnTargetRank: true,
    boardOccupancyLimits: { event: 1, center: 1, parallel: 1 },
    features: INACTIVE_FUTURE_FEATURES
  }
};

export interface RuleAnnotation {
  readonly key: string;
  readonly label: string;
  readonly status: RuleStatus;
  readonly note: string;
}

export const RULE_ANNOTATIONS: readonly RuleAnnotation[] = [
  {
    key: 'eventThreshold',
    label: 'Left Event Sets Reality & Threshold (Never Center)',
    status: 'agreed',
    note: 'Left 7–9 (3 VP) = Treasure (free); 4–6 (2 VP) = Barrier (>= 2 VP); 1–3 (1 VP) = Trial (> 1 VP + advantage).'
  },
  {
    key: 'readingSemantics',
    label: 'Decoupled Reading: Advice ≠ Action ≠ Outcome',
    status: 'agreed',
    note: 'Reader advises GOOD/BAD; Active Player chooses PURSUE or DISCARD. BAD+DISCARD and GOOD+CLAIM grant Reader bonus; GOOD+ABANDON withholds it.'
  },
  {
    key: 'forcedEvolution',
    label: 'Mandatory Chained Personal Evolution',
    status: 'agreed',
    note: 'Eligible upward cards advance lineage automatically until exhausted.'
  },
  {
    key: 'elementalActivationCost',
    label: 'D1 — Elemental Activation Cost (Hand Card → Veil)',
    status: 'agreed',
    note: 'Activating Air/Fire/Water/Earth consumes the selected hand card into the Veil atomically, uses its original VP (1–3) with no silent VP+1 scaling, and counts toward the 1-action-per-turn limit.'
  },
  {
    key: 'waterSelfResurface',
    label: 'D1 — Water Cannot Self-Resurface Same Action',
    status: 'agreed',
    note: 'The consumed Water card is ineligible during the same resurfacing action; it becomes eligible on a subsequent separate action.'
  },
  {
    key: 'readerBonusSpending',
    label: 'D1 — Reader Bonus Spending Mechanism',
    status: 'provisional',
    note: 'Separate from hand-card activations. Configurable in Ruleset: record_only (MC) or free_tier1_elemental_next_turn (D1 default, expires if unused on Reader’s next turn).'
  },
  {
    key: 'waterDestination',
    label: 'D1 — Water Resurface Destination in Days',
    status: 'provisional',
    note: 'Configurable in Ruleset: shuffled into Deck of Days (default), placed on top, or placed on bottom.'
  },
  {
    key: 'rotateEventOnDiscard',
    label: 'D0 — Left Event Rotation on DiscardCenter',
    status: 'provisional',
    note: 'Configurable in Ruleset: true in D1 (unused Left Event rotates to Veil at turn cleanup); false in preserved MC baseline.'
  },
  {
    key: 'trialFormula',
    label: 'Trial Elemental Leverage Formula',
    status: 'provisional',
    note: 'Default: compares against Left Event element; Water>Fire>Earth>Air>Water grants +1 VP once (capped by maxEffectiveVP=3).'
  },
  {
    key: 'sacrificeDestination',
    label: 'Sacrificed Cards Destination',
    status: 'provisional',
    note: 'Routed to public Veil in test preset; logged explicitly.'
  },
  {
    key: 'declinedAbandoned',
    label: 'Declined Abandoned Center Disposition',
    status: 'provisional',
    note: 'If next player declines free Treasure claim of abandoned Center, it moves to Veil and a fresh concealed Center is dealt.'
  },
  {
    key: 'evolutionTieBreak',
    label: 'Simultaneous Evolution Tie-Breaker',
    status: 'provisional',
    note: 'Default: lowest legal rank first, preferring same element on ties.'
  },
  {
    key: 'triangulationPlacement',
    label: 'Multi-Major Contention & Triangulation',
    status: 'open',
    note: 'Array-backed board slots ready; Majors, Eclipse, and Moon/Sun remain inactive until Milestones E–F.'
  }
];

export function cloneRulesetWithOverrides(
  base: Ruleset,
  overrides: Partial<Omit<Ruleset, 'features' | 'boardOccupancyLimits'>> & {
    features?: Partial<Omit<Ruleset['features'], 'majorEffects'>>;
  }
): Ruleset {
  const { features: featureOverrides, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    boardOccupancyLimits: { ...base.boardOccupancyLimits },
    features: {
      ...base.features,
      ...(featureOverrides ?? {}),
      majorEffects: { ...base.features.majorEffects }
    }
  };
}
