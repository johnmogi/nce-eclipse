import type {
  BoardTargetSlot,
  Card,
  Command,
  Element,
  ElementalTargetZone,
  PendingReaderBonus,
  ProjectedGameView,
  ProjectedPlayerView
} from '../engine/index.js';

export type EarthActionMode =
  | 'days_to_bottom'
  | 'days_reorder'
  | 'board_to_days_top'
  | 'board_to_days_bottom'
  | 'board_swap';

export interface ElementalSelectionState {
  readonly sourceKind: 'hand' | 'bonus' | null;
  readonly sourceCardId: string | null;
  readonly bonusId: string | null;
  readonly daysSelected: boolean;
  readonly daysCount: number;
  readonly boardSlots: readonly BoardTargetSlot[];
  readonly veilCardIds: readonly string[];
  readonly earthMode: EarthActionMode;
  readonly earthIndexOrder: readonly number[];
}

export const INITIAL_ELEMENTAL_SELECTION: ElementalSelectionState = {
  sourceKind: null,
  sourceCardId: null,
  bonusId: null,
  daysSelected: false,
  daysCount: 1,
  boardSlots: [],
  veilCardIds: [],
  earthMode: 'days_to_bottom',
  earthIndexOrder: [0, 1]
};

export interface ElementalTargetContext {
  readonly activeElement: Element | null;
  readonly sourceCard: Card | null;
  readonly bonus: PendingReaderBonus | null;
  readonly strength: number;
  readonly eligibleZones: {
    readonly days: boolean;
    readonly boardEvent: boolean;
    readonly boardCenter: boolean;
    readonly boardParallel: boolean;
    readonly veil: boolean;
  };
  readonly eligibleVeilCardIds: readonly string[];
  readonly canSwapBoard: boolean;
}

export function getElementalTargetContext(
  view: ProjectedGameView,
  activePlayer: ProjectedPlayerView,
  selection: ElementalSelectionState
): ElementalTargetContext {
  const emptyZones = {
    days: false,
    boardEvent: false,
    boardCenter: false,
    boardParallel: false,
    veil: false
  };
  if (view.phase !== 'AWAITING_ELEMENTAL_ACTION' || !view.ruleset.features.elementalEffects) {
    return {
      activeElement: null,
      sourceCard: null,
      bonus: null,
      strength: 0,
      eligibleZones: emptyZones,
      eligibleVeilCardIds: [],
      canSwapBoard: false
    };
  }

  let sourceCard: Card | null = null;
  let bonus: PendingReaderBonus | null = null;
  let activeElement: Element | null = null;
  let strength = 0;

  if (selection.sourceKind === 'bonus' && selection.bonusId) {
    bonus =
      activePlayer.pendingReaderBonuses.find(
        (b) =>
          b.id === selection.bonusId &&
          b.status === 'available' &&
          b.earnedOnTurn < view.turn &&
          Boolean(b.sourceElement)
      ) ?? null;
    if (bonus && bonus.sourceElement) {
      activeElement = bonus.sourceElement;
      strength = 1;
    }
  } else if (selection.sourceKind === 'hand' && selection.sourceCardId && activePlayer.hand) {
    sourceCard = activePlayer.hand.find((c) => c.id === selection.sourceCardId) ?? null;
    if (sourceCard && sourceCard.element && !activePlayer.effectUsedThisTurn) {
      activeElement = sourceCard.element;
      const nativeBonus =
        sourceCard.element === activePlayer.primaryElement
          ? view.ruleset.elementalNativePrimaryBonusVP
          : 0;
      strength = Math.max(1, Math.min(view.ruleset.maxEffectiveVP, sourceCard.vp + nativeBonus));
    }
  }

  if (!activeElement) {
    return {
      activeElement: null,
      sourceCard: null,
      bonus: null,
      strength: 0,
      eligibleZones: emptyZones,
      eligibleVeilCardIds: [],
      canSwapBoard: false
    };
  }

  const hasEvent = view.board.event.length > 0;
  const hasCenter = view.board.center.length > 0;
  const hasParallel = view.board.parallel.length > 0;

  // AGREED D1 rule: activating Water card is strictly excluded from eligible Veil targets
  const eligibleVeilCardIds =
    activeElement === 'water'
      ? view.veil.map((c) => c.id).filter((id) => id !== selection.sourceCardId)
      : [];

  if (activeElement === 'water') {
    return {
      activeElement,
      sourceCard,
      bonus,
      strength,
      eligibleZones: {
        days: false,
        boardEvent: false,
        boardCenter: false,
        boardParallel: false,
        veil: view.zoneAccess.canResurfaceFromVeil && eligibleVeilCardIds.length > 0
      },
      eligibleVeilCardIds: view.zoneAccess.canResurfaceFromVeil ? eligibleVeilCardIds : [],
      canSwapBoard: false
    };
  }

  if (activeElement === 'air') {
    return {
      activeElement,
      sourceCard,
      bonus,
      strength,
      eligibleZones: {
        days: view.zoneAccess.canManipulateDays && view.daysCount >= 2,
        boardEvent: hasEvent,
        boardCenter: hasCenter,
        boardParallel: hasParallel,
        veil: false
      },
      eligibleVeilCardIds: [],
      canSwapBoard: false
    };
  }

  if (activeElement === 'fire') {
    return {
      activeElement,
      sourceCard,
      bonus,
      strength,
      eligibleZones: {
        days: view.zoneAccess.canManipulateDays && view.daysCount >= 1,
        boardEvent: hasEvent,
        boardCenter: hasCenter,
        boardParallel: hasParallel,
        veil: false
      },
      eligibleVeilCardIds: [],
      canSwapBoard: false
    };
  }

  // Earth
  return {
    activeElement,
    sourceCard,
    bonus,
    strength,
    eligibleZones: {
      days: view.zoneAccess.canManipulateDays && view.daysCount >= 2,
      boardEvent: hasEvent,
      boardCenter: hasCenter,
      boardParallel: hasParallel,
      veil: false
    },
    eligibleVeilCardIds: [],
    canSwapBoard: strength >= 2 && hasEvent && hasCenter
  };
}

export function selectHandCardForElemental(
  cardId: string,
  view: ProjectedGameView,
  activePlayer: ProjectedPlayerView
): ElementalSelectionState {
  const card = activePlayer.hand?.find((c) => c.id === cardId) ?? null;
  if (!card || !card.element) return INITIAL_ELEMENTAL_SELECTION;

  const nativeBonus =
    card.element === activePlayer.primaryElement ? view.ruleset.elementalNativePrimaryBonusVP : 0;
  const strength = Math.max(1, Math.min(view.ruleset.maxEffectiveVP, card.vp + nativeBonus));
  const reorderLen = Math.min(strength, view.daysCount);

  return {
    sourceKind: 'hand',
    sourceCardId: cardId,
    bonusId: null,
    daysSelected: false,
    daysCount: Math.min(strength, Math.max(1, view.daysCount)),
    boardSlots: [],
    veilCardIds: [],
    earthMode: strength >= 2 && view.daysCount >= 2 ? 'days_reorder' : 'days_to_bottom',
    earthIndexOrder: Array.from({ length: Math.max(2, reorderLen) }, (_, idx) => idx)
  };
}

export function selectBonusForElemental(
  bonusId: string,
  view: ProjectedGameView
): ElementalSelectionState {
  return {
    sourceKind: 'bonus',
    sourceCardId: null,
    bonusId,
    daysSelected: false,
    daysCount: Math.min(1, Math.max(1, view.daysCount)),
    boardSlots: [],
    veilCardIds: [],
    earthMode: 'days_to_bottom',
    earthIndexOrder: [0, 1]
  };
}

export function toggleVeilTargetSelection(
  selection: ElementalSelectionState,
  cardId: string,
  ctx: ElementalTargetContext
): ElementalSelectionState {
  if (ctx.activeElement !== 'water') return selection;
  if (!ctx.eligibleVeilCardIds.includes(cardId)) return selection;
  if (selection.veilCardIds.includes(cardId)) {
    return {
      ...selection,
      veilCardIds: selection.veilCardIds.filter((id) => id !== cardId)
    };
  }
  if (selection.veilCardIds.length >= ctx.strength) return selection;
  return {
    ...selection,
    veilCardIds: [...selection.veilCardIds, cardId]
  };
}

export function toggleBoardSlotSelection(
  selection: ElementalSelectionState,
  slot: BoardTargetSlot,
  ctx: ElementalTargetContext
): ElementalSelectionState {
  if (!ctx.activeElement || ctx.activeElement === 'water') return selection;
  const eligible =
    slot === 'event'
      ? ctx.eligibleZones.boardEvent
      : slot === 'center'
        ? ctx.eligibleZones.boardCenter
        : ctx.eligibleZones.boardParallel;
  if (!eligible) return selection;

  const exists = selection.boardSlots.includes(slot);
  let nextSlots = exists
    ? selection.boardSlots.filter((s) => s !== slot)
    : [...selection.boardSlots, slot];

  // Respect exact strength cap across board + days
  if (!exists && nextSlots.length > ctx.strength) {
    return selection;
  }

  let nextDaysSelected = selection.daysSelected;
  let nextDaysCount = selection.daysCount;

  if (ctx.activeElement === 'earth') {
    // Earth board clicks switch cleanly into board reorder mode
    nextDaysSelected = false;
    const nextEarthMode: EarthActionMode =
      nextSlots.length === 2 && ctx.canSwapBoard ? 'board_swap' : 'board_to_days_top';
    return {
      ...selection,
      daysSelected: false,
      boardSlots: nextSlots,
      earthMode: nextSlots.length > 0 ? nextEarthMode : selection.earthMode
    };
  }

  // Air / Fire: keep combined boardSlots + daysCount <= strength
  if (nextDaysSelected) {
    const remaining = ctx.strength - nextSlots.length;
    if (remaining <= 0) {
      nextDaysSelected = false;
      nextDaysCount = 1;
    } else if (nextDaysCount > remaining) {
      nextDaysCount = remaining;
    }
  }

  return {
    ...selection,
    boardSlots: nextSlots,
    daysSelected: nextDaysSelected,
    daysCount: nextDaysCount
  };
}

export function toggleDaysZoneSelection(
  selection: ElementalSelectionState,
  ctx: ElementalTargetContext,
  daysAvailable: number
): ElementalSelectionState {
  if (!ctx.activeElement || !ctx.eligibleZones.days) return selection;

  if (ctx.activeElement === 'earth') {
    const nextSelected = !selection.daysSelected;
    const reorderLen = Math.min(ctx.strength, daysAvailable);
    const defaultOrder =
      reorderLen === 3 ? [1, 2, 0] : reorderLen === 2 ? [1, 0] : [0, 1];
    return {
      ...selection,
      daysSelected: nextSelected,
      boardSlots: nextSelected ? [] : selection.boardSlots,
      daysCount: 1,
      earthMode: ctx.strength >= 2 && daysAvailable >= 2 ? 'days_reorder' : 'days_to_bottom',
      earthIndexOrder: defaultOrder
    };
  }

  // Air / Fire
  if (selection.daysSelected) {
    return { ...selection, daysSelected: false };
  }

  const remaining = ctx.strength - selection.boardSlots.length;
  if (remaining <= 0) {
    // Switching directly to Days clears Board slots so click always feels responsive
    return {
      ...selection,
      boardSlots: [],
      daysSelected: true,
      daysCount: Math.min(ctx.strength, daysAvailable)
    };
  }

  return {
    ...selection,
    daysSelected: true,
    daysCount: Math.min(remaining, daysAvailable)
  };
}

export function moveEarthOrderSlot(
  order: readonly number[],
  fromIndex: number,
  direction: -1 | 1
): number[] {
  const toIndex = fromIndex + direction;
  if (toIndex < 0 || toIndex >= order.length) return [...order];
  const next = [...order];
  const tmp = next[fromIndex]!;
  next[fromIndex] = next[toIndex]!;
  next[toIndex] = tmp;
  return next;
}

export function buildElementalCommand(
  view: ProjectedGameView,
  selection: ElementalSelectionState,
  ctx: ElementalTargetContext
): { ok: true; command: Command; actionLabel: string } | { ok: false; reason: string } {
  if (!ctx.activeElement || !selection.sourceKind) {
    return { ok: false, reason: 'Select a card from your hand or a Reader Bonus first.' };
  }

  const element = ctx.activeElement;
  let targetZone: ElementalTargetZone;
  let extraPayload: {
    targetCardIds?: readonly string[];
    targetBoardSlots?: readonly BoardTargetSlot[];
    daysCount?: number;
    indexOrder?: readonly number[];
    placement?: 'top' | 'bottom';
  } = {};
  let summaryVerb = '';

  if (element === 'water') {
    if (selection.veilCardIds.length === 0) {
      return {
        ok: false,
        reason: `Click the Veil and select 1–${ctx.strength} face-up card(s) to resurface.`
      };
    }
    if (selection.sourceCardId && selection.veilCardIds.includes(selection.sourceCardId)) {
      return {
        ok: false,
        reason: 'Water cannot resurface its own activating card during the same action.'
      };
    }
    targetZone = 'veil';
    extraPayload = { targetCardIds: selection.veilCardIds };
    summaryVerb = `Resurface ${selection.veilCardIds.length} card${
      selection.veilCardIds.length === 1 ? '' : 's'
    } from Veil → Days`;
  } else if (element === 'air' || element === 'fire') {
    const hasBoard = selection.boardSlots.length > 0;
    const hasDays = selection.daysSelected && selection.daysCount >= 1;
    if (!hasBoard && !hasDays) {
      return {
        ok: false,
        reason:
          element === 'air'
            ? 'Click Deck of Days or an occupied Board card to shuffle.'
            : 'Click Deck of Days or an occupied Board card to burn to the Veil.'
      };
    }
    const total = selection.boardSlots.length + (hasDays ? selection.daysCount : 0);
    if (total > ctx.strength) {
      return {
        ok: false,
        reason: `Selected ${total} targets, exceeding strength ${ctx.strength}.`
      };
    }
    if (hasBoard && hasDays) {
      targetZone = 'board_and_days';
      extraPayload = { targetBoardSlots: selection.boardSlots, daysCount: selection.daysCount };
    } else if (hasBoard) {
      targetZone = 'board';
      extraPayload = { targetBoardSlots: selection.boardSlots };
    } else {
      targetZone = 'days';
      extraPayload = { daysCount: selection.daysCount };
    }
    const verb = element === 'air' ? 'Shuffle' : 'Burn';
    summaryVerb = `${verb} ${total} card${total === 1 ? '' : 's'}`;
  } else {
    // Earth
    if (selection.daysSelected) {
      targetZone = 'days';
      if (selection.earthMode === 'days_reorder' && ctx.strength >= 2) {
        if (selection.earthIndexOrder.length < 2 || selection.earthIndexOrder.length > ctx.strength) {
          return { ok: false, reason: `Arrange 2–${ctx.strength} top cards of Deck of Days.` };
        }
        extraPayload = { indexOrder: selection.earthIndexOrder };
        summaryVerb = `Reorder top ${selection.earthIndexOrder.length} cards of Days`;
      } else {
        if (view.daysCount < 2) {
          return { ok: false, reason: 'Deck of Days needs at least 2 cards to reposition.' };
        }
        extraPayload = { daysCount: 1, placement: 'bottom' };
        summaryVerb = 'Move top card of Days → Bottom';
      }
    } else if (selection.boardSlots.length > 0) {
      targetZone = 'board';
      if (selection.earthMode === 'board_swap') {
        if (!ctx.canSwapBoard) {
          return { ok: false, reason: 'Swapping Board slots requires Earth 2+ VP and both Event & Center occupied.' };
        }
        extraPayload = { targetBoardSlots: ['event', 'center'] };
        summaryVerb = 'Swap Left Event ↔ Center';
      } else {
        const placement = selection.earthMode === 'board_to_days_bottom' ? 'bottom' : 'top';
        extraPayload = { targetBoardSlots: selection.boardSlots, placement };
        summaryVerb = `Place ${selection.boardSlots.join(' + ')} → ${placement} of Days`;
      }
    } else {
      return {
        ok: false,
        reason: 'Click Deck of Days or an occupied Board card to reorder.'
      };
    }
  }

  if (selection.sourceKind === 'bonus' && ctx.bonus) {
    return {
      ok: true,
      command: {
        type: 'UseReaderBonus',
        playerId: view.activePlayerId,
        bonusId: ctx.bonus.id,
        targetZone,
        ...extraPayload
      },
      actionLabel: `${summaryVerb} (Free Reader Bonus)`
    };
  }

  if (selection.sourceKind === 'hand' && ctx.sourceCard) {
    return {
      ok: true,
      command: {
        type: 'UseElementalEffect',
        playerId: view.activePlayerId,
        element,
        sourceCardId: ctx.sourceCard.id,
        targetZone,
        ...extraPayload
      },
      actionLabel: `${summaryVerb} · Consume ${ctx.sourceCard.shortLabel} → Veil`
    };
  }

  return { ok: false, reason: 'Invalid elemental source selection.' };
}
