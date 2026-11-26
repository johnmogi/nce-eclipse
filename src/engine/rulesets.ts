import type { Ruleset, RuleStatus } from './types.js';

export const ENGINE_VERSION = '0.3.0-mc';

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

export const RULESET_PRESETS: Readonly<Record<string, Ruleset>> = {
  'poker-proto-c': {
    id: 'poker-proto-c',
    version: '1.3.0',
    name: 'Poker Prototype — Milestone C (36 Minors · Full Reading + Event Loop)',
    category: 'prototype',
    description:
      'Integrated 2-player Poker Prototype using all 36 Minor cards (Ace–9, no Courts/Majors yet). Full turn journey: Abandoned Check → Concealed Reading (Good/Bad) → Pursue or Discard → Left Event Reality (Treasure 3 VP / Barrier 2 VP / Trial 1 VP) → Reconciliation or Abandon → Mandatory Chained Evolution.',
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
    trialTargetElement: 'event',
    trialRequireAdvantage: true,
    trialAdvantageBonusVP: 1,
    sacrificeDestination: 'veil',
    declinedAbandonedPolicy: 'send_to_veil',
    marketFrequencyRounds: 0,
    eclipseVictoryCount: 'players-plus-one',
    l11TargetRank: 0, // Play full Deck of Days to test complete game arc
    stopOnTargetRank: false,
    boardOccupancyLimits: { event: 1, center: 1, parallel: 1 },
    features: MILESTONE_C_FEATURES
  },
  'poker-proto-c-hard': {
    id: 'poker-proto-c-hard',
    version: '1.3.0',
    name: 'Poker Prototype — Hard Evolution (+1 Same Element · 36 Minors)',
    category: 'prototype',
    description:
      'Integrated 36-card Poker Prototype with strict same-element +1 mandatory evolution.',
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
