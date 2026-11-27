import { getAvailableReaderBonusesForTurn } from './elemental-effects.js';
import { eventCardToReality } from './reconciliation.js';
import type {
  Card,
  Command,
  DeckComponentStatus,
  EventReality,
  GameEvent,
  GameState,
  ProjectedBoardSlotItem,
  ProjectedGameView,
  ProjectedPlayerView,
  ProjectedReadingView,
  Viewer
} from './types.js';

function mapCardIds(ids: readonly string[], cards: Readonly<Record<string, Card>>): Card[] {
  return ids.map((id) => {
    const c = cards[id];
    if (!c) throw new Error(`Card "${id}" missing from catalog`);
    return c;
  });
}

export function getLegalActionsForState(state: GameState, viewer: Viewer): Command['type'][] {
  if (state.status !== 'playing') return [];

  if (state.phase === 'AWAITING_READING') {
    if (!state.currentReading) return [];
    if (viewer.role === 'admin' || viewer.playerId === state.currentReading.readerId) {
      return ['GiveReading'];
    }
    return [];
  }

  if (viewer.role === 'player' && viewer.playerId !== state.activePlayerId) {
    return [];
  }

  const activePlayer = state.players[state.activePlayerIndex];

  switch (state.phase) {
    case 'AWAITING_ABANDONED_CHOICE':
      return ['ClaimAbandonedCard', 'DeclineAbandonedCard'];
    case 'AWAITING_READING_DECISION':
      return ['PursueCenter', 'DiscardCenter'];
    case 'AWAITING_EVENT_RESOLUTION': {
      const eventId = state.board.event[0];
      const eventCard = eventId ? state.cards[eventId] : undefined;
      const reality = eventCard ? eventCardToReality(eventCard) : 'treasure';
      return reality === 'treasure' ? ['ResolveEvent'] : ['ResolveEvent', 'AbandonCenter'];
    }
    case 'AWAITING_CENTER_DECISION':
      return state.board.center.length > 0 ? ['ClaimCenterCard', 'DiscardCenterCard'] : ['EndTurn'];
    case 'AWAITING_HAND_DISCARD':
      return ['DiscardHandCard'];
    case 'AWAITING_ELEMENTAL_ACTION': {
      const actions: Command['type'][] = [];
      if (activePlayer && state.ruleset.features.elementalEffects) {
        if (!activePlayer.effectUsedThisTurn && activePlayer.hand.length > 0) {
          actions.push('UseElementalEffect');
        }
        const availBonuses = getAvailableReaderBonusesForTurn(activePlayer, state.turn, state.ruleset);
        const canUseBonus =
          availBonuses.length > 0 &&
          (!state.ruleset.readerBonusConsumesTurnAction || !activePlayer.effectUsedThisTurn);
        if (canUseBonus) {
          actions.push('UseReaderBonus');
        }
      }
      actions.push('EndTurn');
      return actions;
    }
    case 'READY_TO_END_TURN':
      return ['EndTurn'];
    case 'GAME_OVER':
      return [];
  }
}

function projectEvents(events: readonly GameEvent[], viewer: Viewer, rulesetName: string): GameEvent[] {
  if (viewer.role === 'admin') {
    return [...events];
  }

  const out: GameEvent[] = [];
  for (const ev of events) {
    if (ev.visibility === 'admin_only') continue;
    if (ev.type === 'GameCreated') {
      // D0 Finding E: Strip deterministic seed from player event logs
      out.push({
        ...ev,
        summary: `Started ${rulesetName} (v${ev.rulesetVersion}).`,
        payload: {
          rulesetId: ev.payload?.rulesetId ?? null,
          rulesetVersion: ev.rulesetVersion
        }
      });
      continue;
    }
    if (ev.visibility === 'private_to_actor' && ev.actor !== viewer.playerId) {
      out.push({
        ...ev,
        affectedCardIds: [],
        summary: `${ev.actor} completed a private card movement (${ev.affectedCardIds.length} card${ev.affectedCardIds.length === 1 ? '' : 's'}).`,
        payload: { redacted: true, cardCount: ev.affectedCardIds.length }
      });
      continue;
    }
    out.push(ev);
  }
  return out;
}

function buildDeckComponents(
  state: GameState,
  viewer: Viewer,
  canInspectCenter: boolean
): DeckComponentStatus[] {
  const isAdmin = viewer.role === 'admin';
  const locationById = new Map<string, string>();

  state.veil.forEach((id) => locationById.set(id, 'Veil (Public Discard)'));
  state.board.parallel.forEach((id) => locationById.set(id, 'Board · Parallel'));

  state.board.event.forEach((id) => {
    if (state.eventRevealed) {
      locationById.set(id, 'Board · Event (Revealed)');
    } else if (isAdmin) {
      locationById.set(id, 'Board · Event (Concealed)');
    } else {
      locationById.set(id, 'Deck / Hidden');
    }
  });

  state.board.center.forEach((id) => {
    if (state.centerRevealed) {
      locationById.set(
        id,
        state.centerAbandoned ? 'Board · Center (Abandoned)' : 'Board · Center (Revealed)'
      );
    } else if (isAdmin) {
      locationById.set(id, 'Board · Center (Concealed)');
    } else if (canInspectCenter) {
      locationById.set(id, 'Board · Center (Reader Peek)');
    } else {
      locationById.set(id, 'Deck / Hidden');
    }
  });

  state.players.forEach((p) => {
    p.lineage.cardIds.forEach((id, idx) => {
      const top = idx === p.lineage.cardIds.length - 1;
      locationById.set(id, top ? `${p.name} Lineage (Active)` : `${p.name} Lineage (Stack)`);
    });
    p.hand.forEach((id) => {
      if (isAdmin) {
        locationById.set(id, `${p.name} Hand`);
      } else if (viewer.role === 'player' && viewer.playerId === p.id) {
        locationById.set(id, 'Your Hand');
      } else {
        locationById.set(id, 'Deck / Hidden');
      }
    });
  });

  state.days.forEach((id, idx) => {
    locationById.set(id, isAdmin ? `Deck of Days (#${idx + 1})` : 'Deck / Hidden');
  });

  state.reserve.forEach((id) => {
    locationById.set(id, isAdmin ? 'Reserve (Unused Ace)' : 'Unused Ace (Out of Play)');
  });

  return state.deckCardIds.map((id) => {
    const card = state.cards[id]!;
    return {
      card,
      knownLocation: locationById.get(id) ?? 'Unknown'
    };
  });
}

/**
 * Produces a strictly masked view for a specific player or full God Mode for admin.
 * Guarantees deterministic seed, concealed Center, concealed Left Event, private opponent hands,
 * and Days order never leak to unauthorized players.
 */
export function projectView(state: GameState, viewer: Viewer): ProjectedGameView {
  const isAdmin = viewer.role === 'admin';
  const isCurrentReader =
    viewer.role === 'player' && state.currentReading?.readerId === viewer.playerId;
  const canInspectCenter = state.centerRevealed || isAdmin || isCurrentReader;
  const canInspectEvent = state.eventRevealed || isAdmin;

  const topDaysId = state.days[0];
  const topDaysCard = topDaysId ? state.cards[topDaysId] : undefined;

  const eventItems: ProjectedBoardSlotItem[] = state.board.event.map((id) => {
    const card = state.cards[id]!;
    if (canInspectEvent) {
      return {
        hidden: false,
        card,
        privateToReader: !state.eventRevealed
      };
    }
    return {
      hidden: true,
      backGroup: card.backGroup,
      label: 'Event Modifier (Reveals on Pursue)'
    };
  });

  const centerItems: ProjectedBoardSlotItem[] = state.board.center.map((id) => {
    const card = state.cards[id]!;
    if (canInspectCenter) {
      return {
        hidden: false,
        card,
        privateToReader: !state.centerRevealed
      };
    }
    return {
      hidden: true,
      backGroup: card.backGroup,
      label: 'Concealed Center Card'
    };
  });

  const parallelItems: ProjectedBoardSlotItem[] = state.board.parallel.map((id) => ({
    hidden: false,
    card: state.cards[id]!
  }));

  let eventReality: EventReality | null = null;
  if (state.board.event.length > 0 && canInspectEvent) {
    eventReality = eventCardToReality(state.cards[state.board.event[0]!]!);
  }

  let currentReadingView: ProjectedReadingView | null = null;
  if (state.currentReading) {
    const reader = state.players.find((p) => p.id === state.currentReading!.readerId);
    const recipient = state.players.find((p) => p.id === state.currentReading!.recipientId);
    currentReadingView = {
      readerId: state.currentReading.readerId,
      readerName: reader?.name ?? state.currentReading.readerId,
      recipientId: state.currentReading.recipientId,
      recipientName: recipient?.name ?? state.currentReading.recipientId,
      advice: state.currentReading.advice,
      hints: state.currentReading.hints,
      playerAction: state.currentReading.playerAction,
      adviceFollowed: state.currentReading.adviceFollowed,
      resolution: state.currentReading.resolution,
      readerReward: state.currentReading.readerReward,
      canViewerInspectCenter: canInspectCenter,
      adviceTruthful: isAdmin || state.centerRevealed ? state.currentReading.adviceTruthful : null
    };
  }

  const players: ProjectedPlayerView[] = state.players.map((p) => {
    const canSeeHand = isAdmin || (viewer.role === 'player' && viewer.playerId === p.id);
    const topLineageId = p.lineage.cardIds[p.lineage.cardIds.length - 1]!;
    const topCard = state.cards[topLineageId]!;
    const availableCount = getAvailableReaderBonusesForTurn(p, state.turn, state.ruleset).length;

    return {
      id: p.id,
      name: p.name,
      primaryElement: p.primaryElement,
      lineage: {
        rank: p.lineage.rank,
        element: p.lineage.element,
        color: p.lineage.color,
        topCard,
        stackDepth: p.lineage.cardIds.length,
        cardIds: [...p.lineage.cardIds]
      },
      handCount: p.hand.length,
      hand: canSeeHand ? mapCardIds(p.hand, state.cards) : null,
      eclipseCount: p.eclipseCount,
      effectUsedThisTurn: p.effectUsedThisTurn,
      pendingReaderBonusCount: p.pendingReaderBonuses.filter(
        (b) => b.status === 'pending_spec' || b.status === 'available'
      ).length,
      availableReaderBonusCount: availableCount,
      pendingReaderBonuses: [...p.pendingReaderBonuses],
      evolutionsCompleted: p.evolutionsCompleted,
      maxChainLength: p.maxChainLength,
      turnsTaken: p.turnsTaken,
      isActive: p.id === state.activePlayerId,
      isCurrentReader: state.currentReading?.readerId === p.id
    };
  });

  return {
    viewer,
    engineVersion: state.engineVersion,
    ruleset: state.ruleset,
    seed: isAdmin ? state.seed : null,
    phase: state.phase,
    round: state.round,
    turn: state.turn,
    activePlayerId: state.activePlayerId,
    status: state.status,
    outcome: state.outcome,
    stateHash: state.stateHash,
    daysCount: state.days.length,
    daysTopBackGroup: topDaysCard ? topDaysCard.backGroup : null,
    daysCards: isAdmin ? mapCardIds(state.days, state.cards) : null,
    veil: mapCardIds(state.veil, state.cards),
    reserveCount: state.reserve.length,
    reserveCards: isAdmin ? mapCardIds(state.reserve, state.cards) : null,
    eventRevealed: state.eventRevealed,
    eventReality,
    centerRevealed: state.centerRevealed,
    centerAbandoned: state.centerAbandoned,
    abandonedByPlayerId: state.abandonedByPlayerId,
    currentReading: currentReadingView,
    readingHistory: [...state.readingHistory],
    board: {
      event: eventItems,
      center: centerItems,
      parallel: parallelItems
    },
    players,
    deckComponents: buildDeckComponents(state, viewer, canInspectCenter),
    legalActions: getLegalActionsForState(state, viewer),
    events: projectEvents(state.events, viewer, state.ruleset.name),
    commandCount: state.commandHistory.length
  };
}

export interface ExportBundle {
  readonly formatVersion: '1.0';
  readonly scope: 'admin' | 'player';
  readonly viewerPlayerId?: string;
  readonly exportedAt: string;
  readonly engineVersion: string;
  readonly seed: string | null;
  readonly ruleset: GameState['ruleset'];
  readonly finalStateHash: string;
  readonly commands?: readonly Command[];
  readonly events: readonly GameEvent[];
  readonly view: ProjectedGameView;
}

export function buildExportBundle(
  state: GameState,
  viewer: Viewer,
  exportedAt = new Date().toISOString()
): ExportBundle {
  const view = projectView(state, viewer);
  if (viewer.role === 'admin') {
    return {
      formatVersion: '1.0',
      scope: 'admin',
      exportedAt,
      engineVersion: state.engineVersion,
      seed: state.seed,
      ruleset: state.ruleset,
      finalStateHash: state.stateHash,
      commands: state.commandHistory.map((r) => r.command),
      events: view.events,
      view
    };
  }

  return {
    formatVersion: '1.0',
    scope: 'player',
    viewerPlayerId: viewer.playerId,
    exportedAt,
    engineVersion: state.engineVersion,
    seed: null,
    ruleset: state.ruleset,
    finalStateHash: state.stateHash,
    events: view.events,
    view
  };
}
