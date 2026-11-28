import { applyEvolutionWithEvents, makeEvent } from './event-helpers.js';
import type {
  Card,
  GameEvent,
  GamePhase,
  MarketOffer,
  MarketState,
  PlayerState,
  Ruleset,
  ValidationError
} from './types.js';

export const DEFAULT_MAX_OFFERS_PER_PLAYER = 2;

export function shouldOpenMarketAfterRound(completedRound: number, ruleset: Ruleset): boolean {
  return (
    ruleset.features.tradingMarket &&
    ruleset.marketFrequencyRounds > 0 &&
    completedRound > 0 &&
    completedRound % ruleset.marketFrequencyRounds === 0
  );
}

export function createMarketState(
  completedRound: number,
  players: readonly PlayerState[],
  maxOffersPerPlayer = DEFAULT_MAX_OFFERS_PER_PLAYER
): MarketState {
  const offersMadeByPlayer: Record<string, number> = {};
  for (const p of players) {
    offersMadeByPlayer[p.id] = 0;
  }
  return {
    openedAfterRound: completedRound,
    activeOffer: null,
    offersMadeByPlayer,
    maxOffersPerPlayer,
    completedTrades: 0,
    passedPlayerIds: []
  };
}

export interface TradingMutableContext {
  readonly cards: Readonly<Record<string, Card>>;
  readonly ruleset: Ruleset;
  readonly turn: number;
  readonly round: number;
  readonly phase: GamePhase;
  readonly players: PlayerState[];
  market: MarketState | null;
  readonly newEvents: GameEvent[];
  readonly nextSeq: () => number;
}

export function validateAndExecuteProposeTrade(
  ctx: TradingMutableContext,
  command: {
    readonly playerId: string;
    readonly targetPlayerId: string;
    readonly offerCardIds?: readonly string[];
    readonly requestCardIds?: readonly string[];
    readonly requestedCount?: number;
  }
): { ok: true } | { ok: false; error: ValidationError } {
  if (!ctx.ruleset.features.tradingMarket) {
    return {
      ok: false,
      error: { code: 'FEATURE_DISABLED', message: 'Trading Market is disabled in this ruleset.' }
    };
  }
  if (ctx.phase !== 'AWAITING_MARKET' || !ctx.market) {
    return {
      ok: false,
      error: { code: 'INVALID_PHASE', message: 'Trades can only be proposed while the Trading Market is open.' }
    };
  }
  if (ctx.market.activeOffer) {
    return {
      ok: false,
      error: { code: 'INVALID_TRADE_OFFER', message: 'Resolve the current pending trade offer first.' }
    };
  }

  const proposer = ctx.players.find((p) => p.id === command.playerId);
  const target = ctx.players.find((p) => p.id === command.targetPlayerId);
  if (!proposer || !target || proposer.id === target.id) {
    return {
      ok: false,
      error: { code: 'INVALID_PLAYER', message: 'Trade requires two distinct valid players.' }
    };
  }

  const madeCount = ctx.market.offersMadeByPlayer[proposer.id] ?? 0;
  if (madeCount >= ctx.market.maxOffersPerPlayer) {
    return {
      ok: false,
      error: {
        code: 'MARKET_OFFER_LIMIT_REACHED',
        message: `${proposer.name} has already reached the limit of ${ctx.market.maxOffersPerPlayer} trade offers in this market window.`
      }
    };
  }

  const offerCardIds = [...(command.offerCardIds ?? [])];
  const requestCardIds = [...(command.requestCardIds ?? [])];
  const requestedCount =
    requestCardIds.length > 0
      ? requestCardIds.length
      : Math.max(0, Math.floor(command.requestedCount ?? 0));

  if (offerCardIds.length === 0 && requestCardIds.length === 0) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TRADE_OFFER',
        message: 'A trade offer must include at least 1 offered card (or requested card).'
      }
    };
  }

  if (new Set(offerCardIds).size !== offerCardIds.length) {
    return {
      ok: false,
      error: { code: 'INVALID_TRADE_OFFER', message: 'Duplicate cards in offerCardIds.' }
    };
  }
  if (new Set(requestCardIds).size !== requestCardIds.length) {
    return {
      ok: false,
      error: { code: 'INVALID_TRADE_OFFER', message: 'Duplicate cards in requestCardIds.' }
    };
  }

  for (const id of offerCardIds) {
    if (!proposer.hand.includes(id)) {
      return {
        ok: false,
        error: {
          code: 'CARD_NOT_IN_HAND',
          message: `Offered card "${id}" is not in ${proposer.name}'s hand.`
        }
      };
    }
  }
  for (const id of requestCardIds) {
    if (!target.hand.includes(id)) {
      return {
        ok: false,
        error: {
          code: 'CARD_NOT_IN_HAND',
          message: `Requested card "${id}" is not in ${target.name}'s hand.`
        }
      };
    }
  }
  if (requestedCount > target.hand.length) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TRADE_OFFER',
        message: `${target.name} only holds ${target.hand.length} card(s), fewer than requested (${requestedCount}).`
      }
    };
  }

  const offer: MarketOffer = {
    id: `trade-r${ctx.market.openedAfterRound}-${madeCount + 1}-${proposer.id}`,
    proposerId: proposer.id,
    targetPlayerId: target.id,
    offerCardIds,
    requestCardIds,
    requestedCount,
    status: 'pending',
    createdOnTurn: ctx.turn
  };

  ctx.market = {
    ...ctx.market,
    activeOffer: offer,
    offersMadeByPlayer: {
      ...ctx.market.offersMadeByPlayer,
      [proposer.id]: madeCount + 1
    },
    passedPlayerIds: ctx.market.passedPlayerIds.filter((id) => id !== proposer.id && id !== target.id)
  };

  const offerLabels = offerCardIds.map((id) => ctx.cards[id]!.shortLabel).join(', ');
  const reqDesc =
    requestCardIds.length > 0
      ? `for ${requestCardIds.map((id) => ctx.cards[id]!.shortLabel).join(', ')}`
      : requestedCount === 0
        ? 'as a 1-way gift'
        : `asking for ${requestedCount} card${requestedCount === 1 ? '' : 's'} in return`;

  ctx.newEvents.push(
    makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
      actor: proposer.id,
      type: 'TradeProposed',
      affectedCardIds: [...offerCardIds, ...requestCardIds],
      source: 'ProposeTrade',
      reason: requestedCount === 0 ? 'gift-offer' : 'trade-offer',
      visibility: 'public',
      summary: `${proposer.name} proposed to ${target.name}: offering ${offerLabels || 'nothing'} ${reqDesc}.`,
      payload: {
        offerId: offer.id,
        proposerId: proposer.id,
        targetPlayerId: target.id,
        offerCardIds,
        requestCardIds,
        requestedCount
      }
    })
  );

  return { ok: true };
}

export function validateAndExecuteAcceptTrade(
  ctx: TradingMutableContext,
  command: {
    readonly playerId: string;
    readonly offerId: string;
    readonly counterCardIds?: readonly string[];
  }
): { ok: true } | { ok: false; error: ValidationError } {
  if (!ctx.ruleset.features.tradingMarket) {
    return {
      ok: false,
      error: { code: 'FEATURE_DISABLED', message: 'Trading Market is disabled in this ruleset.' }
    };
  }
  if (ctx.phase !== 'AWAITING_MARKET' || !ctx.market || !ctx.market.activeOffer) {
    return {
      ok: false,
      error: { code: 'INVALID_PHASE', message: 'There is no pending trade offer to accept.' }
    };
  }

  const offer = ctx.market.activeOffer;
  if (offer.id !== command.offerId) {
    return {
      ok: false,
      error: { code: 'INVALID_TRADE_OFFER', message: `Unknown trade offer "${command.offerId}".` }
    };
  }
  if (offer.targetPlayerId !== command.playerId) {
    return {
      ok: false,
      error: {
        code: 'INVALID_PLAYER',
        message: `Only ${offer.targetPlayerId} can accept trade offer "${offer.id}".`
      }
    };
  }

  const proposerIdx = ctx.players.findIndex((p) => p.id === offer.proposerId);
  const targetIdx = ctx.players.findIndex((p) => p.id === offer.targetPlayerId);
  if (proposerIdx < 0 || targetIdx < 0) {
    return {
      ok: false,
      error: { code: 'INVALID_PLAYER', message: 'Trade participant missing.' }
    };
  }

  const proposer = ctx.players[proposerIdx]!;
  const target = ctx.players[targetIdx]!;

  // Determine exact cards target gives to proposer (explicit requestCardIds OR privacy-safe counterCardIds)
  const targetGivesIds =
    offer.requestCardIds.length > 0
      ? [...offer.requestCardIds]
      : [...(command.counterCardIds ?? [])];

  if (targetGivesIds.length !== offer.requestedCount) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TRADE_OFFER',
        message: `This offer requires ${offer.requestedCount} card(s) in return (received ${targetGivesIds.length}).`
      }
    };
  }
  if (new Set(targetGivesIds).size !== targetGivesIds.length) {
    return {
      ok: false,
      error: { code: 'INVALID_TRADE_OFFER', message: 'Duplicate cards in counterCardIds.' }
    };
  }
  for (const id of offer.offerCardIds) {
    if (!proposer.hand.includes(id)) {
      return {
        ok: false,
        error: { code: 'CARD_NOT_IN_HAND', message: `Offered card "${id}" is no longer in proposer's hand.` }
      };
    }
  }
  for (const id of targetGivesIds) {
    if (!target.hand.includes(id)) {
      return {
        ok: false,
        error: { code: 'CARD_NOT_IN_HAND', message: `Counter card "${id}" is not in ${target.name}'s hand.` }
      };
    }
  }

  // ---- Atomic swap + mandatory chained evolution for BOTH participants! ----
  const offerSet = new Set(offer.offerCardIds);
  const targetGivesSet = new Set(targetGivesIds);

  const nextProposerRaw: PlayerState = {
    ...proposer,
    hand: [...proposer.hand.filter((id) => !offerSet.has(id)), ...targetGivesIds]
  };
  const nextTargetRaw: PlayerState = {
    ...target,
    hand: [...target.hand.filter((id) => !targetGivesSet.has(id)), ...offer.offerCardIds]
  };

  ctx.players[proposerIdx] = nextProposerRaw;
  ctx.players[targetIdx] = nextTargetRaw;

  const giveSummary = offer.offerCardIds.map((id) => ctx.cards[id]!.shortLabel).join(', ') || 'nothing';
  const recvSummary = targetGivesIds.map((id) => ctx.cards[id]!.shortLabel).join(', ') || 'nothing (gift)';

  ctx.newEvents.push(
    makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
      actor: target.id,
      type: 'TradeAccepted',
      affectedCardIds: [...offer.offerCardIds, ...targetGivesIds],
      source: 'AcceptTrade',
      reason: targetGivesIds.length === 0 ? 'gift-accepted' : 'trade-accepted',
      visibility: 'public',
      summary: `Trade Completed! ${proposer.name} gave ${giveSummary} ↔ ${target.name} gave ${recvSummary}.`,
      payload: {
        offerId: offer.id,
        proposerId: proposer.id,
        targetPlayerId: target.id,
        proposerGave: offer.offerCardIds,
        targetGave: targetGivesIds
      }
    })
  );

  // Immediately run mandatory chained evolution for BOTH players!
  const evoProposer = applyEvolutionWithEvents(ctx.players[proposerIdx]!, ctx.cards, ctx.ruleset, {
    turn: ctx.turn,
    round: ctx.round,
    phase: ctx.phase,
    source: 'AcceptTrade',
    nextSeq: ctx.nextSeq
  });
  ctx.players[proposerIdx] = evoProposer.player;
  ctx.newEvents.push(...evoProposer.events);

  const evoTarget = applyEvolutionWithEvents(ctx.players[targetIdx]!, ctx.cards, ctx.ruleset, {
    turn: ctx.turn,
    round: ctx.round,
    phase: ctx.phase,
    source: 'AcceptTrade',
    nextSeq: ctx.nextSeq
  });
  ctx.players[targetIdx] = evoTarget.player;
  ctx.newEvents.push(...evoTarget.events);

  ctx.market = {
    ...ctx.market,
    activeOffer: null,
    completedTrades: ctx.market.completedTrades + 1
  };

  return { ok: true };
}

export function validateAndExecuteRejectTrade(
  ctx: TradingMutableContext,
  command: { readonly playerId: string; readonly offerId: string }
): { ok: true } | { ok: false; error: ValidationError } {
  if (!ctx.ruleset.features.tradingMarket) {
    return {
      ok: false,
      error: { code: 'FEATURE_DISABLED', message: 'Trading Market is disabled in this ruleset.' }
    };
  }
  if (ctx.phase !== 'AWAITING_MARKET' || !ctx.market || !ctx.market.activeOffer) {
    return {
      ok: false,
      error: { code: 'INVALID_PHASE', message: 'There is no pending trade offer to reject.' }
    };
  }

  const offer = ctx.market.activeOffer;
  if (offer.id !== command.offerId) {
    return {
      ok: false,
      error: { code: 'INVALID_TRADE_OFFER', message: `Unknown trade offer "${command.offerId}".` }
    };
  }
  if (offer.targetPlayerId !== command.playerId && offer.proposerId !== command.playerId) {
    return {
      ok: false,
      error: { code: 'INVALID_PLAYER', message: 'Only a trade participant can reject or withdraw this offer.' }
    };
  }

  const actor = ctx.players.find((p) => p.id === command.playerId)!;
  const withdrew = offer.proposerId === command.playerId;

  ctx.market = {
    ...ctx.market,
    activeOffer: null
  };

  ctx.newEvents.push(
    makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
      actor: actor.id,
      type: 'TradeRejected',
      affectedCardIds: [],
      source: 'RejectTrade',
      reason: withdrew ? 'offer-withdrawn' : 'offer-declined',
      visibility: 'public',
      summary: withdrew
        ? `${actor.name} withdrew trade offer ${offer.id}.`
        : `${actor.name} declined trade offer ${offer.id}.`,
      payload: { offerId: offer.id, withdrew }
    })
  );

  return { ok: true };
}
