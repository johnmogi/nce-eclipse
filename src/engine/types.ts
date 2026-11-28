export type Element = 'air' | 'fire' | 'water' | 'earth';
export type Color = 'black' | 'red';
export type RuleStatus = 'agreed' | 'provisional' | 'open';
export type CardFamily = 'classic-number' | 'classic-court' | 'sun-major' | 'moon-major';
export type CardTier = 'low' | 'med' | 'high' | 'court' | 'major';
export type BackGroup = 'minor' | 'major' | 'sun-major' | 'moon-major';
export type EventReality = 'treasure' | 'barrier' | 'trial' | 'major_resonance';

export type Zone =
  | 'days'
  | 'veil'
  | 'event'
  | 'center'
  | 'parallel'
  | 'hand'
  | 'lineage'
  | 'champion'
  | 'reserve';

export type ElementalTargetZone = 'days' | 'board' | 'board_and_days' | 'veil';
export type BoardTargetSlot = 'event' | 'center' | 'parallel';
export type WaterResurfaceDestination = 'shuffled' | 'top' | 'bottom';
export type ReaderBonusPolicy = 'record_only' | 'free_tier1_elemental_next_turn';
export type ElementalTimingPolicy = 'after_encounter' | 'before_reading';
export type ElementalActionsPerTurnPolicy = 1 | 2 | 3 | 'unlimited';
export type AbandonedClaimPolicy = 'free_treasure_legacy' | 'free_no_prep';
export type MajorDeparturePolicy = 'lifo' | 'fifo';
export type EclipseCardDisposition = 'both_to_veil' | 'keep_one_beside_ace' | 'keep_pair_beside_ace';

export type EvolutionColorPolicy = 'same-color' | 'same-element' | 'any';
export type EvolutionTieBreakPolicy =
  | 'lowest-rank-same-element'
  | 'lowest-rank-first'
  | 'highest-jump-first';

export type GamePhase =
  | 'AWAITING_ABANDONED_CHOICE'
  | 'AWAITING_READING'
  | 'AWAITING_READING_DECISION'
  | 'AWAITING_EVENT_RESOLUTION'
  | 'AWAITING_CENTER_DECISION'
  | 'AWAITING_HAND_DISCARD'
  | 'AWAITING_ELEMENTAL_ACTION'
  | 'AWAITING_EARTH_REORDER'
  | 'AWAITING_MAJOR_CONTENTION'
  | 'AWAITING_MARKET'
  | 'READY_TO_END_TURN'
  | 'GAME_OVER';

export type ReadingAdvice = 'good' | 'bad';
export type ReadingPlayerAction = 'pursue' | 'discard';
export type ReadingResolution = 'pending' | 'claimed' | 'discarded' | 'abandoned';
export type ReaderRewardStatus = 'pending' | 'granted' | 'withheld';

export interface Card {
  readonly id: string;
  readonly family: CardFamily;
  readonly rank: number; // 1..9 minor; 11=Prince(J), 12=Queen, 13=King classic court; 0..9 custom major
  readonly label: string;
  readonly shortLabel: string;
  readonly element?: Element;
  readonly color?: Color;
  readonly suitSymbol?: string;
  readonly vp: 0 | 1 | 2 | 3;
  readonly tier: CardTier;
  readonly backGroup: BackGroup;
  readonly courtBonus?: 1 | 2 | 3;
}

export interface BoardOccupancyLimits {
  readonly event: number;
  readonly center: number;
  readonly parallel: number;
}

export interface FeatureFlags {
  readonly readings: boolean;
  readonly barriersAndTrials: boolean;
  readonly elementalEffects: boolean;
  readonly tradingMarket: boolean;
  readonly majors: boolean;
  readonly eclipse: boolean;
  readonly triangulation: boolean;
  readonly moonSunCycle: boolean;
  readonly secondaryLineage: boolean;
  readonly majorEffects: Readonly<Record<string, boolean>>;
}

export interface Ruleset {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly category: 'prototype' | 'tutorial';
  readonly description: string;
  readonly tutorialLevel?: string;
  readonly deckProfile: 'classic-l1-1' | 'classic-36' | 'classic-48';
  readonly maxMinorRank: number; // 6 for 1.1/1.2 tutorials, 9 for 1.3 & Poker Prototype
  readonly includeCourts: boolean;
  readonly playerCount: number;
  readonly startingHandSize: number;
  readonly maxHandSize: number;
  readonly unusedAcesInDeck: boolean;
  readonly maxEffectiveVP: number;
  readonly allowedEvolutionColors: EvolutionColorPolicy;
  readonly maxEvolutionJump: number;
  readonly evolutionTieBreak: EvolutionTieBreakPolicy;
  readonly readingTierHintsEnabled: boolean; // Canonical v0.2 default: false
  readonly readerBonusOnAbandon: boolean; // Creator ruling: false (GOOD requires claim; BAD+DISCARD grants)
  readonly readerBonusPolicy: ReaderBonusPolicy; // Provisional in D1: record_only (MC) | free_tier1_elemental_next_turn (D1)
  readonly readerBonusConsumesTurnAction: boolean; // true in D1 baseline | false in R1+ (free extra bonus action)
  readonly readerBonusAnytimeOnTurn?: boolean; // R1: true lets player spend earned Reader Bonus across active phases of their turn
  readonly preventSetupEvolution?: boolean; // R1 RD-01: true guarantees 3 playable starting hand cards at Turn 1
  readonly replaceCenterOnDiscard?: boolean; // R1 RD-04 AGREED: true draws & flips replacement Center + Left Event on reject
  readonly emptyChamberMode?: boolean; // R1 RD-15 AGREED: false fills all 3 Board slots on Turn 1; true leaves Parallel vacant until Major
  readonly rotateEventOnCenterDiscard: boolean; // Provisional: false (MC baseline) | true (D1 cleanup rotation)
  readonly elementalTiming: ElementalTimingPolicy; // 'after_encounter' (D1 baseline) | 'before_reading' (E default)
  readonly allowRevealedBoardElemental?: boolean; // R1.1: true allows 1 ordinary hand elemental action either before Reading OR after Center+Event reveal
  readonly abandonedClaimPolicy?: AbandonedClaimPolicy; // R1.1 AB-1: 'free_no_prep' checks Abandoned BEFORE Elemental Prep and skips both Reading & Prep when claimed
  readonly maxElementalActionsPerTurn?: ElementalActionsPerTurnPolicy; // Baseline: 1; chaining (2/3/unlimited) on hold as experimental setting
  readonly elementalNativePrimaryBonusVP: number; // Provisional: 0 (uses exact card VP 1/2/3 by default)
  readonly waterResurfaceDestination: WaterResurfaceDestination; // Provisional: 'shuffled' | 'top' | 'bottom'
  readonly trialTargetElement: 'event' | 'center'; // Provisional default: 'event' (Left Event defines obstacle)
  readonly trialRequireAdvantage: boolean; // Provisional default: true
  readonly trialAdvantageBonusVP: number; // Provisional default: 1 (applied once, subject to maxEffectiveVP cap)
  readonly sacrificeDestination: 'veil'; // Provisional test preset
  readonly declinedAbandonedPolicy: 'send_to_veil'; // Explicit disposition when next player declines abandoned card
  readonly marketFrequencyRounds: number;
  readonly eclipseVictoryCount: number | 'players-plus-one';
  readonly majorContentionEnabled?: boolean; // Classic MVP R2: dedicated Parallel + contention/LIFO + Rank 7-9 choice (no auto-overflow)
  readonly majorDefaultDeparture?: MajorDeparturePolicy; // Default 'lifo' (arriving exits; incumbent stays)
  readonly eclipseCardDisposition?: EclipseCardDisposition; // Default 'both_to_veil' + persistent trophy beside Ace
  readonly l11TargetRank: number; // 0 = play until Days exhausted
  readonly stopOnTargetRank: boolean;
  readonly boardOccupancyLimits: BoardOccupancyLimits;
  readonly features: FeatureFlags;
}

export interface LineageState {
  readonly rank: number;
  readonly element: Element;
  readonly color: Color;
  readonly cardIds: readonly string[];
}

export type ReaderBonusStatus = 'pending_spec' | 'available' | 'consumed' | 'expired';

export interface PendingReaderBonus {
  readonly id: string;
  readonly earnedOnTurn: number;
  readonly fromPlayerId: string;
  readonly sourceCardId: string;
  readonly sourceElement?: Element;
  readonly trigger: 'good_claimed' | 'bad_discarded' | 'good_abandoned';
  readonly status: ReaderBonusStatus;
  readonly consumedOnTurn?: number;
  readonly expiredOnTurn?: number;
}

export interface EclipseTrophy {
  readonly id: string;
  readonly rank: number;
  readonly label: string;
  readonly shortLabel: string;
  readonly bonusVP: 1 | 2 | 3;
  readonly cardIds: readonly [string, string];
  readonly keptCardIds: readonly string[]; // Empty when 'both_to_veil'; 1 or 2 cardIds when physical Court(s) stay beside Ace
  readonly earnedOnTurn: number;
}

export interface PlayerState {
  readonly id: string;
  readonly name: string;
  readonly primaryElement: Element;
  readonly lineage: LineageState;
  readonly hand: readonly string[];
  readonly championCardId?: string;
  readonly eclipseCount: number;
  readonly eclipseBonusVP: number; // Persistent Court/Champion VP bonus from completed Eclipses
  readonly eclipseTrophies?: readonly EclipseTrophy[];
  readonly effectUsedThisTurn: boolean;
  readonly elementalActionsUsedThisTurn?: number;
  readonly secondaryElement?: Element; // Reserved, inactive in D1
  readonly pendingReaderBonuses: readonly PendingReaderBonus[];
  readonly evolutionsCompleted: number;
  readonly maxChainLength: number;
  readonly turnsTaken: number;
}

export interface BoardState {
  readonly event: readonly string[];
  readonly center: readonly string[];
  readonly parallel: readonly string[];
}

export interface ReadingHints {
  readonly color?: Color;
  readonly tier?: CardTier;
}

export interface ReadingRecord {
  readonly turn: number;
  readonly round: number;
  readonly readerId: string;
  readonly recipientId: string;
  readonly centerCardId: string;
  readonly advice: ReadingAdvice | null;
  readonly hints: ReadingHints | null;
  readonly playerAction: ReadingPlayerAction | null;
  readonly adviceFollowed: boolean | null;
  readonly objectiveHelpful: boolean;
  readonly adviceTruthful: boolean | null;
  readonly resolution: ReadingResolution;
  readonly readerReward: ReaderRewardStatus;
  readonly readerRewardReason: string | null;
}

export interface ReconciliationBreakdown {
  readonly reality: EventReality;
  readonly eventCardId: string;
  readonly eventVP: number;
  readonly eventElement?: Element;
  readonly targetElement?: Element;
  readonly lineageVP: number;
  readonly sacrificedCardIds: readonly string[];
  readonly sacrificedVP: number;
  readonly hasElementalAdvantage: boolean;
  readonly advantageModifierVP: number;
  readonly cappedBaseVP?: number;
  readonly activeCourtAuraVP?: number;
  readonly persistentEclipseBonusVP?: number;
  readonly rawTotalVP: number;
  readonly effectiveVP: number;
  readonly wasCapped: boolean;
  readonly capLimit: number;
  readonly requiredCondition: string;
  readonly passes: boolean;
  readonly failureReason?: string;
}

export interface MajorPendingEntry {
  readonly cardId: string;
  readonly dormantUntilTurn: number;
}

export type MajorContentionResumeContext =
  | 'populate_event'
  | 'populate_center_reading'
  | 'populate_center_pre_elemental'
  | 'populate_parallel'
  | 'discard_replacement'
  | 'revealed_event_replacement';

export interface PendingMajorContentionState {
  readonly playerId: string;
  readonly incumbentCardId: string;
  readonly arrivingCardId: string;
  readonly source: string;
  readonly resumeContext: MajorContentionResumeContext;
  readonly deferReadingForPreElemental?: boolean;
}

export interface ProjectedMajorContentionView {
  readonly playerId: string;
  readonly incumbentCard: Card;
  readonly arrivingCard: Card;
  readonly incumbentDormant: boolean;
  readonly reason: string;
}

export interface MarketOffer {
  readonly id: string;
  readonly proposerId: string;
  readonly targetPlayerId: string;
  readonly offerCardIds: readonly string[];
  readonly requestCardIds: readonly string[];
  readonly requestedCount: number; // 0 = 1-way gift; >=1 with empty requestCardIds = privacy-safe counter-card trade!
  readonly status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  readonly createdOnTurn: number;
}

export interface MarketState {
  readonly openedAfterRound: number;
  readonly activeOffer: MarketOffer | null;
  readonly offersMadeByPlayer: Readonly<Record<string, number>>;
  readonly maxOffersPerPlayer: number;
  readonly completedTrades: number;
  readonly passedPlayerIds: readonly string[];
}

export interface ProjectedMarketOfferView {
  readonly id: string;
  readonly proposerId: string;
  readonly proposerName: string;
  readonly targetPlayerId: string;
  readonly targetPlayerName: string;
  readonly offerCards: readonly Card[];
  readonly requestCards: readonly Card[];
  readonly requestedCount: number;
  readonly status: MarketOffer['status'];
}

export interface ProjectedMarketView {
  readonly openedAfterRound: number;
  readonly activeOffer: ProjectedMarketOfferView | null;
  readonly offersMadeByPlayer: Readonly<Record<string, number>>;
  readonly maxOffersPerPlayer: number;
  readonly completedTrades: number;
  readonly passedPlayerIds: readonly string[];
}

export type ActionDescriptorCategory =
  | 'ordinary_elemental'
  | 'reader_bonus'
  | 'reading'
  | 'reconciliation'
  | 'abandoned'
  | 'major_contention'
  | 'market'
  | 'hand_discard'
  | 'turn';

export interface LegalActionDescriptor {
  readonly id: string;
  readonly commandType: Command['type'];
  readonly category: ActionDescriptorCategory;
  readonly label: string;
  readonly sourceLabel: string;
  readonly effectSummary: string;
  readonly costLabel: string;
  readonly strength?: number;
  readonly allowedTargets: readonly string[];
  readonly enabled: boolean;
  readonly disabledReason?: string;
  readonly expiryWarning?: string;
}

export interface ActiveEffectEntry {
  readonly effectId: string;
  readonly sourceCardId: string;
  readonly expiresOn: string;
}

export interface ConnectionEntry {
  readonly playerIds: readonly string[];
  readonly sourceCardId: string;
}

export interface EntropyState {
  readonly active: boolean;
  readonly cycleIndex: number;
  readonly turnsRemaining?: number;
}

export type EventVisibility = 'public' | 'private_to_actor' | 'admin_only';

export type GameEventType =
  | 'GameCreated'
  | 'CardMoved'
  | 'TurnStarted'
  | 'ReadingGiven'
  | 'CenterPursued'
  | 'CenterDiscarded'
  | 'EventRevealed'
  | 'TreasureClaimed'
  | 'BarrierReconciled'
  | 'TrialPassed'
  | 'CenterAbandoned'
  | 'AbandonedCardClaimed'
  | 'AbandonedCardDeclined'
  | 'ReaderRewardGranted'
  | 'ReaderRewardWithheld'
  | 'ReaderBonusConsumed'
  | 'ReaderBonusExpired'
  | 'ElementalEffectActivated'
  | 'ElementalEffectResolved'
  | 'EarthPeekStarted'
  | 'MajorArrived'
  | 'MajorActivated'
  | 'MajorContentionPaused'
  | 'MajorContentionResolved'
  | 'EclipseFormed'
  | 'TriangulationCompleted'
  | 'MarketOpened'
  | 'TradeProposed'
  | 'TradeAccepted'
  | 'TradeRejected'
  | 'MarketClosed'
  | 'CenterClaimed'
  | 'LineageEvolved'
  | 'EvolutionChainCompleted'
  | 'HandCardDiscarded'
  | 'TurnFinished'
  | 'CommandRejected'
  | 'GameCompleted';

export interface GameEvent {
  readonly seq: number;
  readonly turn: number;
  readonly round: number;
  readonly phase: GamePhase;
  readonly actor: string;
  readonly type: GameEventType;
  readonly affectedCardIds: readonly string[];
  readonly source: string;
  readonly reason: string;
  readonly rulesetVersion: string;
  readonly visibility: EventVisibility;
  readonly summary: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface ValidationError {
  readonly code:
    | 'GAME_OVER'
    | 'INVALID_PLAYER'
    | 'NOT_ACTIVE_PLAYER'
    | 'NOT_READER_PLAYER'
    | 'INVALID_PHASE'
    | 'INVALID_CARD'
    | 'CARD_NOT_IN_HAND'
    | 'DUPLICATE_SACRIFICE'
    | 'NO_CENTER_CARD'
    | 'NO_ABANDONED_CARD'
    | 'INSUFFICIENT_VP'
    | 'ELEMENTAL_ADVANTAGE_REQUIRED'
    | 'CANNOT_ABANDON_TREASURE'
    | 'UNEXPECTED_SACRIFICE'
    | 'HAND_LIMIT_EXCEEDED'
    | 'EFFECT_ALREADY_USED_THIS_TURN'
    | 'ELEMENT_MISMATCH'
    | 'INVALID_TARGET_ZONE'
    | 'INVALID_TARGET_SELECTION'
    | 'INSUFFICIENT_TARGET_CARDS'
    | 'WATER_SELF_RESURFACE_FORBIDDEN'
    | 'INVALID_REORDER_SPEC'
    | 'NO_AVAILABLE_READER_BONUS'
    | 'READER_BONUS_NOT_READY'
    | 'COURT_CANNOT_OCCUPY_CENTER_WITHOUT_COMBO'
    | 'INVALID_MAJOR_CONTENTION_CHOICE'
    | 'INVALID_TRADE_OFFER'
    | 'MARKET_OFFER_LIMIT_REACHED'
    | 'FEATURE_DISABLED'
    | 'INVARIANT_VIOLATION';
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface ElementalEffectPayload {
  readonly targetZone: ElementalTargetZone;
  readonly targetCardIds?: readonly string[];
  readonly targetBoardSlots?: readonly BoardTargetSlot[];
  readonly daysCount?: number;
  readonly newOrder?: readonly string[];
  readonly indexOrder?: readonly number[];
  readonly placement?: 'top' | 'bottom';
}

export type Command =
  // Milestone C active commands
  | { readonly type: 'ClaimAbandonedCard'; readonly playerId: string }
  | { readonly type: 'DeclineAbandonedCard'; readonly playerId: string }
  | { readonly type: 'GiveReading'; readonly playerId: string; readonly advice: ReadingAdvice }
  | { readonly type: 'PursueCenter'; readonly playerId: string }
  | { readonly type: 'DiscardCenter'; readonly playerId: string }
  | { readonly type: 'ResolveEvent'; readonly playerId: string; readonly sacrificeCardIds: readonly string[] }
  | { readonly type: 'AbandonCenter'; readonly playerId: string }
  // Level 1.1 open-center sandbox commands
  | { readonly type: 'ClaimCenterCard'; readonly playerId: string }
  | { readonly type: 'DiscardCenterCard'; readonly playerId: string }
  // Hand & turn management
  | { readonly type: 'AdvanceToReading'; readonly playerId: string }
  | { readonly type: 'DiscardHandCard'; readonly playerId: string; readonly cardId: string }
  | { readonly type: 'EndTurn'; readonly playerId: string }
  // Milestone D1: Elemental hand effects (AGREED cost: consumes hand card -> Veil) & provisional Reader Bonus
  | ({
      readonly type: 'UseElementalEffect';
      readonly playerId: string;
      readonly element: Element;
      readonly sourceCardId: string;
    } & ElementalEffectPayload)
  | ({
      readonly type: 'UseReaderBonus';
      readonly playerId: string;
      readonly bonusId: string;
    } & ElementalEffectPayload)
  // Stage R1 RD-09: Cheat-proof private Earth Peek & Deliberate Reorder across Board and/or Immediate Future
  | {
      readonly type: 'StartEarthPeek';
      readonly playerId: string;
      readonly sourceCardId?: string;
      readonly bonusId?: string;
      readonly targetBoardSlots?: readonly BoardTargetSlot[];
      readonly daysCount?: number;
    }
  | {
      readonly type: 'CommitEarthReorder';
      readonly playerId: string;
      readonly newOrder?: readonly string[];
      readonly moveTopToBottom?: boolean;
    }
  // Classic MVP R2/R3 commands (Trading Market & Rank 7-9 Major Contention)
  | {
      readonly type: 'ProposeTrade';
      readonly playerId: string;
      readonly targetPlayerId: string;
      readonly offerCardIds?: readonly string[];
      readonly requestCardIds?: readonly string[];
      readonly requestedCount?: number;
    }
  | {
      readonly type: 'AcceptTrade';
      readonly playerId: string;
      readonly offerId: string;
      readonly counterCardIds?: readonly string[];
    }
  | { readonly type: 'RejectTrade'; readonly playerId: string; readonly offerId: string }
  | { readonly type: 'CloseMarket'; readonly playerId: string }
  | { readonly type: 'ChooseMajorExit'; readonly playerId: string; readonly cardId: string }
  // Reserved R5 future command
  | { readonly type: 'ResolveEntropy'; readonly playerId: string };

export interface CommandRecord {
  readonly index: number;
  readonly command: Command;
  readonly stateHashBefore: string;
  readonly stateHashAfter: string;
  readonly eventSeqStart: number;
  readonly eventSeqEnd: number;
}

export interface RejectedCommandRecord {
  readonly atTurn: number;
  readonly command: Command;
  readonly error: ValidationError;
}

export interface GameOutcome {
  readonly reason: 'target_rank_reached' | 'days_exhausted' | 'eclipse_victory' | 'triangulation_victory';
  readonly winnerIds: readonly string[];
  readonly highestRank: number;
  readonly summary: string;
}

export interface PendingEarthReorderState {
  readonly playerId: string;
  readonly sourceCommand: 'UseElementalEffect' | 'UseReaderBonus';
  readonly sourceCardId: string | null;
  readonly bonusId: string | null;
  readonly strength: number;
  readonly boardSlots: readonly BoardTargetSlot[];
  readonly daysCount: number;
  readonly peekedCardIds: readonly string[];
  readonly returnPhase: GamePhase;
}

export interface ProjectedEarthReorderView {
  readonly playerId: string;
  readonly strength: number;
  readonly boardSlots: readonly BoardTargetSlot[];
  readonly daysCount: number;
  readonly count: number;
  readonly cards: readonly Card[] | null; // Private to active caster (and Admin); null for opponents
}

export interface GameState {
  readonly engineVersion: string;
  readonly ruleset: Ruleset;
  readonly seed: string;
  readonly rngState: number;
  readonly cards: Readonly<Record<string, Card>>;
  readonly deckCardIds: readonly string[];
  readonly phase: GamePhase;
  readonly round: number;
  readonly turn: number;
  readonly activePlayerIndex: number;
  readonly activePlayerId: string;
  readonly days: readonly string[];
  readonly veil: readonly string[];
  readonly reserve: readonly string[];
  readonly board: BoardState;
  readonly eventRevealed: boolean;
  readonly centerRevealed: boolean;
  readonly centerAbandoned: boolean;
  readonly abandonedByPlayerId: string | null;
  readonly discardedCenterThisTurn: boolean;
  readonly currentReading: ReadingRecord | null;
  readonly readingHistory: readonly ReadingRecord[];
  readonly pendingEarthReorder?: PendingEarthReorderState | null;
  readonly pendingMajorContention?: PendingMajorContentionState | null;
  readonly market?: MarketState | null;
  readonly majorPending: readonly MajorPendingEntry[];
  readonly players: readonly PlayerState[];
  readonly activeEffects: readonly ActiveEffectEntry[];
  readonly connections: readonly ConnectionEntry[];
  readonly entropy: EntropyState;
  readonly status: 'playing' | 'completed';
  readonly outcome?: GameOutcome;
  readonly commandHistory: readonly CommandRecord[];
  readonly rejectedCommands: readonly RejectedCommandRecord[];
  readonly events: readonly GameEvent[];
  readonly stateHash: string;
}

export interface DispatchSuccess {
  readonly ok: true;
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly commandRecord: CommandRecord;
}

export interface DispatchFailure {
  readonly ok: false;
  readonly state: GameState;
  readonly error: ValidationError;
}

export type DispatchResult = DispatchSuccess | DispatchFailure;

export type Viewer =
  | { readonly role: 'admin' }
  | { readonly role: 'player'; readonly playerId: string };

export type ProjectedBoardSlotItem =
  | { readonly hidden: false; readonly card: Card; readonly privateToReader?: boolean }
  | { readonly hidden: true; readonly backGroup: BackGroup; readonly label: string };

export interface ProjectedReadingView {
  readonly readerId: string;
  readonly readerName: string;
  readonly recipientId: string;
  readonly recipientName: string;
  readonly advice: ReadingAdvice | null;
  readonly hints: ReadingHints | null;
  readonly playerAction: ReadingPlayerAction | null;
  readonly adviceFollowed: boolean | null;
  readonly resolution: ReadingResolution;
  readonly readerReward: ReaderRewardStatus;
  readonly canViewerInspectCenter: boolean;
  readonly adviceTruthful: boolean | null; // Admin-only until Center is revealed
}

export interface ProjectedPlayerView {
  readonly id: string;
  readonly name: string;
  readonly primaryElement: Element;
  readonly lineage: {
    readonly rank: number;
    readonly element: Element;
    readonly color: Color;
    readonly primaryAceCard: Card;
    readonly topCard: Card;
    readonly stackDepth: number;
    readonly cardIds: readonly string[];
  };
  readonly handCount: number;
  readonly hand: readonly Card[] | null;
  readonly eclipseCount: number;
  readonly eclipseBonusVP: number;
  readonly eclipseTrophies: readonly EclipseTrophy[];
  readonly activeCourtAuraVP: number;
  readonly effectUsedThisTurn: boolean;
  readonly elementalActionsUsedThisTurn: number;
  readonly pendingReaderBonusCount: number;
  readonly availableReaderBonusCount: number;
  readonly pendingReaderBonuses: readonly PendingReaderBonus[];
  readonly evolutionsCompleted: number;
  readonly maxChainLength: number;
  readonly turnsTaken: number;
  readonly isActive: boolean;
  readonly isCurrentReader: boolean;
}

export interface DeckComponentStatus {
  readonly card: Card;
  readonly knownLocation: string;
}

export type ZoneVisibilityMode = 'full' | 'top_only' | 'hidden';

export interface ZoneVisibilityState {
  readonly days: ZoneVisibilityMode;
  readonly veil: ZoneVisibilityMode;
}

export interface ZoneAccessState {
  readonly canInspectDays: boolean;
  readonly canManipulateDays: boolean;
  readonly canInspectVeil: boolean;
  readonly canResurfaceFromVeil: boolean;
}

export type ProjectedOrderedZoneItem =
  | {
      readonly position: number;
      readonly hidden: false;
      readonly card: Card;
      readonly backGroup: BackGroup;
      readonly movementHistory: readonly string[];
    }
  | {
      readonly position: number;
      readonly hidden: true;
      readonly backGroup: BackGroup;
      readonly label: string;
    };

export interface ProjectedGameView {
  readonly viewer: Viewer;
  readonly engineVersion: string;
  readonly ruleset: Ruleset;
  readonly seed: string | null; // Masked to null for player views; populated only for Admin
  readonly phase: GamePhase;
  readonly round: number;
  readonly turn: number;
  readonly activePlayerId: string;
  readonly status: 'playing' | 'completed';
  readonly outcome?: GameOutcome;
  readonly stateHash: string;
  readonly daysCount: number;
  readonly daysTopBackGroup: BackGroup | null;
  readonly daysCards: readonly Card[] | null;
  readonly veil: readonly Card[];
  readonly zoneVisibility: ZoneVisibilityState;
  readonly zoneAccess: ZoneAccessState;
  readonly daysBrowserItems: readonly ProjectedOrderedZoneItem[];
  readonly veilBrowserItems: readonly ProjectedOrderedZoneItem[];
  readonly reserveCount: number;
  readonly reserveCards: readonly Card[] | null;
  readonly eventRevealed: boolean;
  readonly eventReality: EventReality | null;
  readonly centerRevealed: boolean;
  readonly centerAbandoned: boolean;
  readonly abandonedByPlayerId: string | null;
  readonly currentReading: ProjectedReadingView | null;
  readonly readingHistory: readonly ReadingRecord[];
  readonly pendingEarthReorder: ProjectedEarthReorderView | null;
  readonly pendingMajorContention: ProjectedMajorContentionView | null;
  readonly market: ProjectedMarketView | null;
  readonly dormantMajorCardIds: readonly string[];
  readonly board: {
    readonly event: readonly ProjectedBoardSlotItem[];
    readonly center: readonly ProjectedBoardSlotItem[];
    readonly parallel: readonly ProjectedBoardSlotItem[];
  };
  readonly players: readonly ProjectedPlayerView[];
  readonly deckComponents: readonly DeckComponentStatus[];
  readonly legalActions: readonly Command['type'][];
  readonly actionDescriptors: readonly LegalActionDescriptor[];
  readonly events: readonly GameEvent[];
  readonly commandCount: number;
}

export interface CreateGameOptions {
  readonly playerNames?: readonly string[];
  readonly startingElements?: readonly Element[];
  /** Deterministic override for scenario tests: explicit starting hands per player index */
  readonly overrideHands?: readonly (readonly string[])[];
  /** Deterministic override for scenario tests: cards placed at the top of Days (index 0 drawn first) */
  readonly overrideDaysTop?: readonly string[];
  /** Deterministic override for scenario tests: cards pre-placed into the public Veil */
  readonly overrideVeil?: readonly string[];
}
