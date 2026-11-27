import { isEligibleEvolution } from '../engine/evolution.js';
import { dispatch } from '../engine/reducer.js';
import { evaluateReconciliation, eventCardToReality } from '../engine/reconciliation.js';
import type {
  Card,
  Command,
  Element,
  ElementalEffectPayload,
  GameState,
  PlayerState,
  ProjectedGameView,
  ProjectedPlayerView,
  ReadingAdvice,
  Ruleset
} from '../engine/types.js';
import { projectView } from '../engine/visibility.js';
import type { AgentPolicyId } from './agents.js';

export type PlayControlMode = 'human-vs-bot' | 'hotseat' | 'auto-sim';

export interface HumanVsBotConfig {
  readonly mode: PlayControlMode;
  readonly humanPlayerId: string;
  readonly botPolicy: AgentPolicyId;
  readonly fastTestAutoHumanReading: boolean;
}

export const DEFAULT_HUMAN_VS_BOT_CONFIG: HumanVsBotConfig = {
  mode: 'human-vs-bot',
  humanPlayerId: 'p1',
  botPolicy: 'bluffing-rival',
  fastTestAutoHumanReading: false
};

function cardMatchesFutureLineage(
  player: ProjectedPlayerView,
  card: Card,
  ruleset: Ruleset
): boolean {
  if (card.family !== 'classic-number' || !card.color || !card.element) return false;
  if (card.rank <= player.lineage.rank) return false;
  if (ruleset.allowedEvolutionColors === 'same-element') {
    return card.element === player.lineage.element;
  }
  if (ruleset.allowedEvolutionColors === 'same-color') {
    return card.color === player.lineage.color;
  }
  return true;
}

function isCardHelpfulForProjectedPlayer(
  player: ProjectedPlayerView,
  card: Card,
  ruleset: Ruleset
): boolean {
  if (
    isEligibleEvolution(
      {
        rank: player.lineage.rank,
        element: player.lineage.element,
        color: player.lineage.color,
        cardIds: player.lineage.cardIds
      },
      card,
      ruleset
    )
  ) {
    return true;
  }
  return cardMatchesFutureLineage(player, card, ruleset);
}

function toEvalPlayer(p: ProjectedPlayerView): PlayerState {
  return {
    id: p.id,
    name: p.name,
    primaryElement: p.primaryElement,
    lineage: {
      rank: p.lineage.rank,
      element: p.lineage.element,
      color: p.lineage.color,
      cardIds: p.lineage.cardIds
    },
    hand: p.hand ? p.hand.map((c) => c.id) : [],
    eclipseCount: p.eclipseCount,
    effectUsedThisTurn: p.effectUsedThisTurn,
    pendingReaderBonuses: p.pendingReaderBonuses,
    evolutionsCompleted: p.evolutionsCompleted,
    maxChainLength: p.maxChainLength,
    turnsTaken: p.turnsTaken
  };
}

function findCheapestLegalSacrificeFromView(
  view: ProjectedGameView,
  bot: ProjectedPlayerView,
  eventCard: Card,
  centerCard: Card
): string[] | null {
  const handCards = bot.hand ?? [];
  const catalogSubset: Record<string, Card> = {
    [eventCard.id]: eventCard,
    [centerCard.id]: centerCard,
    [bot.lineage.topCard.id]: bot.lineage.topCard
  };
  for (const c of handCards) catalogSubset[c.id] = c;

  const evalPlayer = toEvalPlayer(bot);

  const zero = evaluateReconciliation({
    player: evalPlayer,
    eventCard,
    centerCard,
    sacrificeCardIds: [],
    cards: catalogSubset,
    ruleset: view.ruleset
  });
  if (zero.passes) return [];

  const sortedHand = [...handCards].sort((a, b) => {
    const keepA = cardMatchesFutureLineage(bot, a, view.ruleset) ? 10 : 0;
    const keepB = cardMatchesFutureLineage(bot, b, view.ruleset) ? 10 : 0;
    if (keepA !== keepB) return keepA - keepB;
    if (a.vp !== b.vp) return a.vp - b.vp;
    return a.id.localeCompare(b.id);
  });

  for (const card of sortedHand) {
    const check = evaluateReconciliation({
      player: evalPlayer,
      eventCard,
      centerCard,
      sacrificeCardIds: [card.id],
      cards: catalogSubset,
      ruleset: view.ruleset
    });
    if (check.passes) return [card.id];
  }

  for (let i = 0; i < sortedHand.length; i++) {
    for (let j = i + 1; j < sortedHand.length; j++) {
      const pair = [sortedHand[i]!.id, sortedHand[j]!.id];
      const check = evaluateReconciliation({
        player: evalPlayer,
        eventCard,
        centerCard,
        sacrificeCardIds: pair,
        cards: catalogSubset,
        ruleset: view.ruleset
      });
      if (check.passes) return pair;
    }
  }

  return null;
}

function chooseFairReaderAdvice(
  view: ProjectedGameView,
  bot: ProjectedPlayerView,
  policy: AgentPolicyId
): ReadingAdvice {
  const reading = view.currentReading;
  const centerSlot = view.board.center[0];
  // Strictly uses ONLY the Reader's authorized view of Center!
  if (!reading || !centerSlot || centerSlot.hidden) return 'good';

  const card = centerSlot.card;
  const recipient = view.players.find((p) => p.id === reading.recipientId);
  if (!recipient) return 'good';

  const evolvesNow = isEligibleEvolution(
    {
      rank: recipient.lineage.rank,
      element: recipient.lineage.element,
      color: recipient.lineage.color,
      cardIds: recipient.lineage.cardIds
    },
    card,
    view.ruleset
  );
  const helpful = isCardHelpfulForProjectedPlayer(recipient, card, view.ruleset);

  if (policy === 'bluffing-rival') {
    if (evolvesNow && recipient.lineage.rank >= bot.lineage.rank) {
      return 'bad';
    }
    if (!helpful && view.turn % 2 === 0) {
      return 'good';
    }
    return helpful ? 'good' : 'bad';
  }

  return helpful ? 'good' : 'bad';
}

function buildFairElementalPayload(
  view: ProjectedGameView,
  bot: ProjectedPlayerView,
  element: Element,
  strength: number,
  excludedVeilCardId: string | null
): ElementalEffectPayload | null {
  if (element === 'water') {
    const eligibleVeil = view.veil.filter((c) => c.id !== excludedVeilCardId);
    if (eligibleVeil.length === 0) return null;
    const ranked = [...eligibleVeil].sort((a, b) => {
      const scoreA = cardMatchesFutureLineage(bot, a, view.ruleset) ? 10 : 0;
      const scoreB = cardMatchesFutureLineage(bot, b, view.ruleset) ? 10 : 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return b.id.localeCompare(a.id);
    });
    const selected = ranked.slice(0, Math.min(strength, ranked.length)).map((c) => c.id);
    return { targetZone: 'veil', targetCardIds: selected };
  }

  if (element === 'fire') {
    if (view.centerAbandoned && view.board.center.length > 0) {
      return { targetZone: 'board', targetBoardSlots: ['center'] };
    }
    if (view.daysCount >= 4) {
      const count = Math.min(strength, view.daysCount - 2);
      if (count >= 1) return { targetZone: 'days', daysCount: count };
    }
    return null;
  }

  if (element === 'air') {
    if (view.centerAbandoned && view.board.center.length > 0) {
      return { targetZone: 'board', targetBoardSlots: ['center'] };
    }
    if (view.daysCount >= 2) {
      return { targetZone: 'days', daysCount: Math.min(strength, view.daysCount) };
    }
    return null;
  }

  // Earth: strictly blind structural reorder using ONLY daysCount (never reads hidden daysCards!)
  if (strength >= 2 && view.daysCount >= 2) {
    const count = Math.min(strength, view.daysCount);
    return { targetZone: 'days', indexOrder: count === 3 ? [1, 2, 0] : [1, 0] };
  }
  if (view.daysCount >= 2) {
    return { targetZone: 'days', daysCount: 1, placement: 'bottom' };
  }
  return null;
}

/**
 * Fairness-guaranteed bot decision function.
 * Accepts ONLY a masked `ProjectedGameView` for `{ role: 'player', playerId: botPlayerId }`.
 * It is structurally impossible for this function to inspect hidden Days order, concealed Center
 * when active, concealed Left Event, seed, or the opponent's private hand.
 */
export function chooseFairBotCommand(
  view: ProjectedGameView,
  botPlayerId: string,
  policy: AgentPolicyId
): Command | null {
  if (view.status !== 'playing') return null;
  if (view.viewer.role !== 'player' || view.viewer.playerId !== botPlayerId) {
    throw new Error(
      `Bot fairness violation: chooseFairBotCommand requires a masked player view for "${botPlayerId}".`
    );
  }

  const bot = view.players.find((p) => p.id === botPlayerId);
  if (!bot) return null;

  // 1. Reader role
  if (view.phase === 'AWAITING_READING') {
    if (view.currentReading?.readerId !== botPlayerId) return null;
    return {
      type: 'GiveReading',
      playerId: botPlayerId,
      advice: chooseFairReaderAdvice(view, bot, policy)
    };
  }

  // All remaining phases require bot to be the active player
  if (view.activePlayerId !== botPlayerId) return null;

  if (view.phase === 'AWAITING_ABANDONED_CHOICE') {
    const centerSlot = view.board.center[0];
    if (!centerSlot || centerSlot.hidden) return { type: 'DeclineAbandonedCard', playerId: botPlayerId };
    const helpful = isCardHelpfulForProjectedPlayer(bot, centerSlot.card, view.ruleset);
    if (policy === 'always-claim' || helpful || bot.handCount <= 2) {
      return { type: 'ClaimAbandonedCard', playerId: botPlayerId };
    }
    return { type: 'DeclineAbandonedCard', playerId: botPlayerId };
  }

  if (view.phase === 'AWAITING_READING_DECISION' && view.currentReading?.advice) {
    const advice = view.currentReading.advice;
    const hints = view.currentReading.hints;

    if (policy === 'always-claim') {
      return { type: 'PursueCenter', playerId: botPlayerId };
    }
    if (
      hints?.color &&
      view.ruleset.allowedEvolutionColors === 'same-color' &&
      hints.color !== bot.lineage.color
    ) {
      return { type: 'DiscardCenter', playerId: botPlayerId };
    }
    if (policy === 'bluffing-rival') {
      const priorDeceptions = view.readingHistory.filter(
        (r) => r.recipientId === botPlayerId && r.adviceTruthful === false
      ).length;
      if (priorDeceptions > 0 && view.turn % 3 === 0) {
        return advice === 'good'
          ? { type: 'DiscardCenter', playerId: botPlayerId }
          : { type: 'PursueCenter', playerId: botPlayerId };
      }
    }
    return advice === 'good'
      ? { type: 'PursueCenter', playerId: botPlayerId }
      : { type: 'DiscardCenter', playerId: botPlayerId };
  }

  if (view.phase === 'AWAITING_EVENT_RESOLUTION') {
    const evSlot = view.board.event[0];
    const centerSlot = view.board.center[0];
    if (!evSlot || evSlot.hidden || !centerSlot || centerSlot.hidden) {
      return { type: 'EndTurn', playerId: botPlayerId };
    }
    const reality = eventCardToReality(evSlot.card);
    if (reality === 'treasure') {
      return { type: 'ResolveEvent', playerId: botPlayerId, sacrificeCardIds: [] };
    }
    const sac = findCheapestLegalSacrificeFromView(view, bot, evSlot.card, centerSlot.card);
    if (sac === null) {
      return { type: 'AbandonCenter', playerId: botPlayerId };
    }
    const evolvesNow = isEligibleEvolution(
      {
        rank: bot.lineage.rank,
        element: bot.lineage.element,
        color: bot.lineage.color,
        cardIds: bot.lineage.cardIds
      },
      centerSlot.card,
      view.ruleset
    );
    const futureUseful = cardMatchesFutureLineage(bot, centerSlot.card, view.ruleset);
    if (sac.length === 0 || evolvesNow || futureUseful || policy === 'always-claim') {
      return { type: 'ResolveEvent', playerId: botPlayerId, sacrificeCardIds: sac };
    }
    return { type: 'AbandonCenter', playerId: botPlayerId };
  }

  if (view.phase === 'AWAITING_HAND_DISCARD') {
    const handCards = bot.hand ?? [];
    if (handCards.length === 0) return { type: 'EndTurn', playerId: botPlayerId };
    const scored = handCards.map((card) => {
      const useful = cardMatchesFutureLineage(bot, card, view.ruleset) ? 10 : 0;
      const rankGap =
        card.rank > bot.lineage.rank ? Math.max(0, 6 - (card.rank - bot.lineage.rank)) : -5;
      return { id: card.id, score: useful + rankGap };
    });
    scored.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
    return { type: 'DiscardHandCard', playerId: botPlayerId, cardId: scored[0]!.id };
  }

  if (view.phase === 'AWAITING_ELEMENTAL_ACTION') {
    // 1. Spend an available provisional Reader Bonus (0 hand cards consumed)
    const availableBonuses = bot.pendingReaderBonuses.filter(
      (b) => b.status === 'available' && b.earnedOnTurn < view.turn && Boolean(b.sourceElement)
    );
    if (
      availableBonuses.length > 0 &&
      (!view.ruleset.readerBonusConsumesTurnAction || !bot.effectUsedThisTurn)
    ) {
      for (const bonus of availableBonuses) {
        const payload = buildFairElementalPayload(view, bot, bonus.sourceElement!, 1, null);
        if (payload) {
          return {
            type: 'UseReaderBonus',
            playerId: botPlayerId,
            bonusId: bonus.id,
            ...payload
          };
        }
      }
    }

    // 2. Consider activating an expendable hand card
    const handCards = bot.hand ?? [];
    if (!bot.effectUsedThisTurn && handCards.length >= 2) {
      const candidates = [...handCards]
        .filter((c) => Boolean(c.element))
        .sort((a, b) => {
          const keepA = cardMatchesFutureLineage(bot, a, view.ruleset) ? 1 : 0;
          const keepB = cardMatchesFutureLineage(bot, b, view.ruleset) ? 1 : 0;
          if (keepA !== keepB) return keepA - keepB;
          return a.vp - b.vp || a.id.localeCompare(b.id);
        });

      for (const card of candidates) {
        const keep = cardMatchesFutureLineage(bot, card, view.ruleset);
        if (keep && handCards.length < view.ruleset.maxHandSize) continue;
        const el = card.element!;
        const nativeBonus =
          el === bot.primaryElement ? view.ruleset.elementalNativePrimaryBonusVP : 0;
        const strength = Math.max(1, Math.min(view.ruleset.maxEffectiveVP, card.vp + nativeBonus));
        const payload = buildFairElementalPayload(view, bot, el, strength, card.id);
        if (payload) {
          return {
            type: 'UseElementalEffect',
            playerId: botPlayerId,
            element: el,
            sourceCardId: card.id,
            ...payload
          };
        }
      }
    }

    return { type: 'EndTurn', playerId: botPlayerId };
  }

  if (view.phase === 'AWAITING_CENTER_DECISION') {
    const centerSlot = view.board.center[0];
    if (!centerSlot || centerSlot.hidden) return { type: 'EndTurn', playerId: botPlayerId };
    const card = centerSlot.card;
    const evolvesNow = isEligibleEvolution(
      {
        rank: bot.lineage.rank,
        element: bot.lineage.element,
        color: bot.lineage.color,
        cardIds: bot.lineage.cardIds
      },
      card,
      view.ruleset
    );
    const helpsFuture = cardMatchesFutureLineage(bot, card, view.ruleset);
    if (policy === 'always-claim' || evolvesNow || helpsFuture || bot.handCount < view.ruleset.maxHandSize - 1) {
      return { type: 'ClaimCenterCard', playerId: botPlayerId };
    }
    return { type: 'DiscardCenterCard', playerId: botPlayerId };
  }

  if (view.phase === 'READY_TO_END_TURN') {
    return { type: 'EndTurn', playerId: botPlayerId };
  }

  return null;
}

/**
 * Determines which player (if any) should be automated right now under the active control mode.
 *
 * In `human-vs-bot`:
 * - NEVER automates Human (`humanPlayerId`) encounter, reconciliation, elemental, discard, or EndTurn decisions!
 * - Automates Bot (`!= humanPlayerId`) for BOTH its Reader role and its entire Active turn.
 * - Pauses when Human (`humanPlayerId`) is the designated Reader for Bot, unless `fastTestAutoHumanReading` is enabled.
 */
export function getAutomatedActorId(
  state: GameState,
  config: HumanVsBotConfig
): string | null {
  if (state.status !== 'playing' || state.phase === 'GAME_OVER') return null;

  if (config.mode === 'hotseat') {
    return null;
  }

  const requiredActorId =
    state.phase === 'AWAITING_READING' && state.currentReading
      ? state.currentReading.readerId
      : state.activePlayerId;

  if (config.mode === 'auto-sim') {
    return requiredActorId;
  }

  // Human vs Bot mode
  if (requiredActorId !== config.humanPlayerId) {
    return requiredActorId;
  }

  // Optional Fast Test toggle automates ONLY Human's reading role for Bot — NEVER Human's own turn!
  if (
    state.phase === 'AWAITING_READING' &&
    config.fastTestAutoHumanReading &&
    state.activePlayerId !== config.humanPlayerId
  ) {
    return requiredActorId;
  }

  return null;
}

/**
 * Executes a single fair, role-masked automated command if an automated actor is up right now.
 * Returns `null` when control belongs to the Human player.
 */
export function runOneAutomatedStep(
  state: GameState,
  config: HumanVsBotConfig
): { state: GameState; command: Command; actorId: string } | null {
  const actorId = getAutomatedActorId(state, config);
  if (!actorId) return null;

  const maskedView = projectView(state, { role: 'player', playerId: actorId });
  const command = chooseFairBotCommand(maskedView, actorId, config.botPolicy);
  if (!command) return null;

  const res = dispatch(state, command);
  if (!res.ok) {
    throw new Error(
      `Fair bot (${actorId}) produced illegal command ${command.type}: ${res.error.code} — ${res.error.message}`
    );
  }

  return { state: res.state, command, actorId };
}

/**
 * Advances all pending automated bot steps (e.g., initial Bot reading at game start, or Bot's full turn)
 * until the Human player has a decision or the game ends.
 */
export function advanceAutomatedStepsUntilHumanTurn(
  initialState: GameState,
  config: HumanVsBotConfig,
  maxSteps = 40
): { state: GameState; executed: { actorId: string; command: Command }[] } {
  let current = initialState;
  const executed: { actorId: string; command: Command }[] = [];

  for (let i = 0; i < maxSteps; i++) {
    const step = runOneAutomatedStep(current, config);
    if (!step) break;
    current = step.state;
    executed.push({ actorId: step.actorId, command: step.command });
  }

  return { state: current, executed };
}
