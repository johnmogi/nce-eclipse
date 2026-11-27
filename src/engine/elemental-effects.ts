import { ELEMENT_META } from './cards.js';
import { makeEvent } from './event-helpers.js';
import { isMajorCard } from './majors.js';
import { deterministicShuffle } from './rng.js';
import type {
  BoardTargetSlot,
  Card,
  Element,
  ElementalEffectPayload,
  GameEvent,
  GamePhase,
  PendingReaderBonus,
  PlayerState,
  Ruleset,
  ValidationError
} from './types.js';

export interface ElementalMutableContext {
  readonly cards: Readonly<Record<string, Card>>;
  readonly ruleset: Ruleset;
  readonly turn: number;
  readonly round: number;
  readonly phase: GamePhase;
  readonly activePlayerIndex: number;
  readonly players: PlayerState[];
  days: string[];
  veil: string[];
  boardEvent: string[];
  boardCenter: string[];
  boardParallel: string[];
  majorPending: { readonly cardId: string; readonly dormantUntilTurn: number }[];
  eventRevealed: boolean;
  centerRevealed: boolean;
  centerAbandoned: boolean;
  abandonedByPlayerId: string | null;
  rngState: number;
  readonly newEvents: GameEvent[];
  readonly nextSeq: () => number;
}

export interface ElementalStrengthResult {
  readonly baseVP: number;
  readonly nativeBonusVP: number;
  readonly strength: number;
}

export function computeElementalStrength(
  player: PlayerState,
  card: Card,
  ruleset: Ruleset
): ElementalStrengthResult {
  const baseVP = card.vp;
  const nativeBonusVP =
    card.element && card.element === player.primaryElement
      ? ruleset.elementalNativePrimaryBonusVP
      : 0;
  const strength = Math.max(1, Math.min(ruleset.maxEffectiveVP, baseVP + nativeBonusVP));
  return { baseVP, nativeBonusVP, strength };
}

export function canSpendReaderBonusInPhase(phase: GamePhase, ruleset: Ruleset): boolean {
  if (phase === 'AWAITING_ELEMENTAL_ACTION') return true;
  if (!ruleset.readerBonusAnytimeOnTurn) return false;
  return (
    phase === 'AWAITING_ABANDONED_CHOICE' ||
    phase === 'AWAITING_READING_DECISION' ||
    phase === 'READY_TO_END_TURN'
  );
}

export function getAvailableReaderBonusesForTurn(
  player: PlayerState,
  currentTurn: number,
  ruleset: Ruleset
): readonly PendingReaderBonus[] {
  if (ruleset.readerBonusPolicy === 'record_only') return [];
  return player.pendingReaderBonuses.filter(
    (b) => b.status === 'available' && b.earnedOnTurn < currentTurn
  );
}

function elementHasLegalTarget(
  element: Element,
  zones: {
    readonly daysCount: number;
    readonly veilCount: number;
    readonly boardOccupiedCount: number;
  }
): boolean {
  if (element === 'water') {
    return zones.veilCount > 0;
  }
  if (element === 'fire') {
    return zones.daysCount >= 1 || zones.boardOccupiedCount > 0;
  }
  // Air & Earth
  return zones.daysCount >= 2 || zones.boardOccupiedCount > 0;
}

/**
 * Returns true iff the active player has at least ONE legal elemental action
 * (either a hand card with a legal zone target, or an available Reader Bonus with a legal target).
 * Used to auto-skip pre-reading AWAITING_ELEMENTAL_ACTION ONLY when no legal action exists.
 */
export function hasAnyLegalElementalAction(params: {
  player: PlayerState;
  cards: Readonly<Record<string, Card>>;
  turn: number;
  ruleset: Ruleset;
  daysCount: number;
  veilCount: number;
  boardOccupiedCount: number;
}): boolean {
  const { player, cards, turn, ruleset, daysCount, veilCount, boardOccupiedCount } = params;
  if (!ruleset.features.elementalEffects) return false;

  const zones = { daysCount, veilCount, boardOccupiedCount };

  if (!player.effectUsedThisTurn) {
    for (const cardId of player.hand) {
      const card = cards[cardId];
      if (card?.element && elementHasLegalTarget(card.element, zones)) {
        return true;
      }
    }
  }

  if (!ruleset.readerBonusConsumesTurnAction || !player.effectUsedThisTurn) {
    const bonuses = getAvailableReaderBonusesForTurn(player, turn, ruleset);
    for (const bonus of bonuses) {
      if (bonus.sourceElement && elementHasLegalTarget(bonus.sourceElement, zones)) {
        return true;
      }
    }
  }

  return false;
}

interface ValidatedAirPlan {
  readonly kind: 'air';
  readonly boardSlots: BoardTargetSlot[];
  readonly daysCount: number;
}

interface ValidatedFirePlan {
  readonly kind: 'fire';
  readonly boardSlots: BoardTargetSlot[];
  readonly daysCount: number;
}

interface ValidatedWaterPlan {
  readonly kind: 'water';
  readonly targetCardIds: string[];
}

interface ValidatedEarthPlan {
  readonly kind: 'earth';
  readonly mode: 'days_to_bottom' | 'days_reorder' | 'board_to_days' | 'board_swap' | 'board_and_days_reorder';
  readonly boardSlots: BoardTargetSlot[];
  readonly daysCount: number;
  readonly orderedCardIds?: string[];
  readonly placement?: 'top' | 'bottom';
}

type ValidatedPlan = ValidatedAirPlan | ValidatedFirePlan | ValidatedWaterPlan | ValidatedEarthPlan;

function resolveSelectedBoardSlots(
  payload: ElementalEffectPayload,
  boardEvent: readonly string[],
  boardCenter: readonly string[],
  boardParallel: readonly string[]
): { ok: true; slots: BoardTargetSlot[] } | { ok: false; error: ValidationError } {
  if (payload.targetBoardSlots && payload.targetBoardSlots.length > 0) {
    const unique: BoardTargetSlot[] = [];
    for (const slot of payload.targetBoardSlots) {
      if (slot !== 'event' && slot !== 'center' && slot !== 'parallel') {
        return {
          ok: false,
          error: { code: 'INVALID_TARGET_SELECTION', message: `Unsupported board slot "${String(slot)}".` }
        };
      }
      if (unique.includes(slot)) {
        return {
          ok: false,
          error: { code: 'INVALID_TARGET_SELECTION', message: `Duplicate board slot "${slot}".` }
        };
      }
      if (slot === 'event' && boardEvent.length === 0) {
        return {
          ok: false,
          error: { code: 'INSUFFICIENT_TARGET_CARDS', message: 'Left Event slot is empty.' }
        };
      }
      if (slot === 'center' && boardCenter.length === 0) {
        return {
          ok: false,
          error: { code: 'INSUFFICIENT_TARGET_CARDS', message: 'Center slot is empty.' }
        };
      }
      if (slot === 'parallel' && boardParallel.length === 0) {
        return {
          ok: false,
          error: { code: 'INSUFFICIENT_TARGET_CARDS', message: 'Right Parallel slot is empty.' }
        };
      }
      unique.push(slot);
    }
    return { ok: true, slots: unique };
  }

  if (payload.targetCardIds && payload.targetCardIds.length > 0) {
    const unique: BoardTargetSlot[] = [];
    for (const id of payload.targetCardIds) {
      if (boardEvent[0] === id) {
        if (unique.includes('event')) {
          return {
            ok: false,
            error: { code: 'INVALID_TARGET_SELECTION', message: `Duplicate board target "${id}".` }
          };
        }
        unique.push('event');
      } else if (boardCenter[0] === id) {
        if (unique.includes('center')) {
          return {
            ok: false,
            error: { code: 'INVALID_TARGET_SELECTION', message: `Duplicate board target "${id}".` }
          };
        }
        unique.push('center');
      } else if (boardParallel[0] === id) {
        if (unique.includes('parallel')) {
          return {
            ok: false,
            error: { code: 'INVALID_TARGET_SELECTION', message: `Duplicate board target "${id}".` }
          };
        }
        unique.push('parallel');
      } else {
        return {
          ok: false,
          error: {
            code: 'INVALID_TARGET_SELECTION',
            message: `Card "${id}" is not currently on the Board (Event/Center/Parallel).`
          }
        };
      }
    }
    return { ok: true, slots: unique };
  }

  return { ok: true, slots: [] };
}

function isExactCardPermutation(expected: readonly string[], candidate: readonly string[]): boolean {
  if (expected.length !== candidate.length) return false;
  const expectedSet = new Set(expected);
  const seen = new Set<string>();
  for (const id of candidate) {
    if (!expectedSet.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return seen.size === expected.length;
}

function isExactIndexPermutation(length: number, candidate: readonly number[]): boolean {
  if (candidate.length !== length) return false;
  const seen = new Set<number>();
  for (const idx of candidate) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= length || seen.has(idx)) return false;
    seen.add(idx);
  }
  return seen.size === length;
}

function validateElementalPlan(params: {
  element: Element;
  strength: number;
  payload: ElementalEffectPayload;
  excludedVeilCardId: string | null;
  days: readonly string[];
  veil: readonly string[];
  boardEvent: readonly string[];
  boardCenter: readonly string[];
  boardParallel: readonly string[];
}): { ok: true; plan: ValidatedPlan } | { ok: false; error: ValidationError } {
  const { element, strength, payload, excludedVeilCardId, days, veil, boardEvent, boardCenter, boardParallel } = params;

  if (element === 'water') {
    if (payload.targetZone !== 'veil') {
      return {
        ok: false,
        error: {
          code: 'INVALID_TARGET_ZONE',
          message: 'Water (Resurface) must target the Veil ("veil").'
        }
      };
    }
    const targets = payload.targetCardIds ?? [];
    if (targets.length === 0) {
      return {
        ok: false,
        error: {
          code: 'INVALID_TARGET_SELECTION',
          message: 'Water (Resurface) requires selecting at least 1 card from the Veil.'
        }
      };
    }
    if (targets.length > strength) {
      return {
        ok: false,
        error: {
          code: 'INVALID_TARGET_SELECTION',
          message: `Water strength is ${strength}, but ${targets.length} Veil cards were selected.`
        }
      };
    }
    const seen = new Set<string>();
    for (const id of targets) {
      if (excludedVeilCardId && id === excludedVeilCardId) {
        return {
          ok: false,
          error: {
            code: 'WATER_SELF_RESURFACE_FORBIDDEN',
            message: `Water cannot resurface its own activating card "${id}" during the same action.`
          }
        };
      }
      if (seen.has(id)) {
        return {
          ok: false,
          error: {
            code: 'INVALID_TARGET_SELECTION',
            message: `Duplicate Veil card "${id}" in Water resurface selection.`
          }
        };
      }
      seen.add(id);
      if (!veil.includes(id)) {
        return {
          ok: false,
          error: {
            code: 'INVALID_TARGET_SELECTION',
            message: `Card "${id}" is not currently in the Veil.`
          }
        };
      }
    }
    return { ok: true, plan: { kind: 'water', targetCardIds: [...targets] } };
  }

  // Air, Fire, Earth target Board and/or Days
  if (
    payload.targetZone !== 'days' &&
    payload.targetZone !== 'board' &&
    payload.targetZone !== 'board_and_days'
  ) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TARGET_ZONE',
        message: `${ELEMENT_META[element].label} targets "days", "board", or "board_and_days" (got "${payload.targetZone}").`
      }
    };
  }

  if (element === 'air' || element === 'fire') {
    const slotRes =
      payload.targetZone === 'days'
        ? { ok: true as const, slots: [] as BoardTargetSlot[] }
        : resolveSelectedBoardSlots(payload, boardEvent, boardCenter, boardParallel);
    if (!slotRes.ok) return slotRes;
    const boardSlots = slotRes.slots;

    if (payload.targetZone === 'board') {
      if (boardSlots.length === 0) {
        return {
          ok: false,
          error: {
            code: 'INVALID_TARGET_SELECTION',
            message: `${ELEMENT_META[element].label} on "board" requires at least 1 occupied Board slot.`
          }
        };
      }
      if ((payload.daysCount ?? 0) > 0) {
        return {
          ok: false,
          error: {
            code: 'INVALID_TARGET_SELECTION',
            message: 'Use targetZone "board_and_days" to affect both Board and Deck of Days.'
          }
        };
      }
      if (boardSlots.length > strength) {
        return {
          ok: false,
          error: {
            code: 'INVALID_TARGET_SELECTION',
            message: `${ELEMENT_META[element].label} strength is ${strength}, but ${boardSlots.length} Board cards were targeted.`
          }
        };
      }
      return {
        ok: true,
        plan: { kind: element, boardSlots, daysCount: 0 }
      };
    }

    if (payload.targetZone === 'days') {
      if (payload.targetBoardSlots && payload.targetBoardSlots.length > 0) {
        return {
          ok: false,
          error: {
            code: 'INVALID_TARGET_SELECTION',
            message: 'Use targetZone "board_and_days" when selecting Board slots alongside Days.'
          }
        };
      }
      const requestedDays =
        payload.daysCount ??
        (payload.targetCardIds && payload.targetCardIds.length > 0
          ? payload.targetCardIds.length
          : Math.min(strength, days.length));

      if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > strength) {
        return {
          ok: false,
          error: {
            code: 'INVALID_TARGET_SELECTION',
            message: `${ELEMENT_META[element].label} daysCount must be between 1 and ${strength} (got ${requestedDays}).`
          }
        };
      }
      if (days.length < requestedDays) {
        return {
          ok: false,
          error: {
            code: 'INSUFFICIENT_TARGET_CARDS',
            message: `Deck of Days only has ${days.length} card(s), fewer than requested ${requestedDays}.`
          }
        };
      }
      if (element === 'air' && days.length < 2) {
        return {
          ok: false,
          error: {
            code: 'INSUFFICIENT_TARGET_CARDS',
            message: 'Air (Shuffle) on Deck of Days requires at least 2 cards in Days.'
          }
        };
      }
      return {
        ok: true,
        plan: { kind: element, boardSlots: [], daysCount: requestedDays }
      };
    }

    // board_and_days
    const requestedDays = payload.daysCount ?? 0;
    if (boardSlots.length === 0 || requestedDays < 1) {
      return {
        ok: false,
        error: {
          code: 'INVALID_TARGET_SELECTION',
          message: 'targetZone "board_and_days" requires at least 1 Board slot and daysCount >= 1.'
        }
      };
    }
    if (boardSlots.length + requestedDays > strength) {
      return {
        ok: false,
        error: {
          code: 'INVALID_TARGET_SELECTION',
          message: `Combined targets (${boardSlots.length} Board + ${requestedDays} Days) exceed strength ${strength}.`
        }
      };
    }
    if (days.length < requestedDays) {
      return {
        ok: false,
        error: {
          code: 'INSUFFICIENT_TARGET_CARDS',
          message: `Deck of Days only has ${days.length} card(s), fewer than requested ${requestedDays}.`
        }
      };
    }
    return {
      ok: true,
      plan: { kind: element, boardSlots, daysCount: requestedDays }
    };
  }

  // Earth (Reorder)
  if (payload.targetZone === 'days') {
    if (payload.newOrder && payload.newOrder.length > 0) {
      const count = payload.newOrder.length;
      if (count < 2 || count > strength) {
        return {
          ok: false,
          error: {
            code: 'INVALID_REORDER_SPEC',
            message: `Earth newOrder length (${count}) must be between 2 and strength ${strength}.`
          }
        };
      }
      if (days.length < count) {
        return {
          ok: false,
          error: {
            code: 'INSUFFICIENT_TARGET_CARDS',
            message: `Deck of Days only has ${days.length} card(s), fewer than ${count}.`
          }
        };
      }
      const topSlice = days.slice(0, count);
      if (!isExactCardPermutation(topSlice, payload.newOrder)) {
        return {
          ok: false,
          error: {
            code: 'INVALID_REORDER_SPEC',
            message: 'Earth newOrder must be an exact permutation of the top cards of Deck of Days.'
          }
        };
      }
      return {
        ok: true,
        plan: {
          kind: 'earth',
          mode: 'days_reorder',
          boardSlots: [],
          daysCount: count,
          orderedCardIds: [...payload.newOrder]
        }
      };
    }

    if (payload.indexOrder && payload.indexOrder.length > 0) {
      const count = payload.indexOrder.length;
      if (count < 2 || count > strength) {
        return {
          ok: false,
          error: {
            code: 'INVALID_REORDER_SPEC',
            message: `Earth indexOrder length (${count}) must be between 2 and strength ${strength}.`
          }
        };
      }
      if (days.length < count) {
        return {
          ok: false,
          error: {
            code: 'INSUFFICIENT_TARGET_CARDS',
            message: `Deck of Days only has ${days.length} card(s), fewer than ${count}.`
          }
        };
      }
      if (!isExactIndexPermutation(count, payload.indexOrder)) {
        return {
          ok: false,
          error: {
            code: 'INVALID_REORDER_SPEC',
            message: `Earth indexOrder must be a valid permutation of 0..${count - 1}.`
          }
        };
      }
      const topSlice = days.slice(0, count);
      const orderedCardIds = payload.indexOrder.map((idx) => topSlice[idx]!);
      return {
        ok: true,
        plan: {
          kind: 'earth',
          mode: 'days_reorder',
          boardSlots: [],
          daysCount: count,
          orderedCardIds
        }
      };
    }

    // 1-VP (or explicit bottom reposition): move top `count` cards to bottom of Days
    if (payload.placement === 'bottom' || strength === 1) {
      const count = payload.daysCount ?? 1;
      if (!Number.isInteger(count) || count < 1 || count > strength) {
        return {
          ok: false,
          error: {
            code: 'INVALID_REORDER_SPEC',
            message: `Earth daysCount (${count}) must be between 1 and strength ${strength}.`
          }
        };
      }
      if (days.length <= count) {
        return {
          ok: false,
          error: {
            code: 'INSUFFICIENT_TARGET_CARDS',
            message: `Deck of Days needs more than ${count} card(s) to reposition top cards to bottom.`
          }
        };
      }
      return {
        ok: true,
        plan: {
          kind: 'earth',
          mode: 'days_to_bottom',
          boardSlots: [],
          daysCount: count,
          placement: 'bottom'
        }
      };
    }

    return {
      ok: false,
      error: {
        code: 'INVALID_REORDER_SPEC',
        message: 'Earth on "days" requires newOrder, indexOrder, or placement="bottom".'
      }
    };
  }

  if (payload.targetZone === 'board') {
    const slotRes = resolveSelectedBoardSlots(payload, boardEvent, boardCenter, boardParallel);
    if (!slotRes.ok) return slotRes;
    const boardSlots = slotRes.slots;

    if (payload.placement === 'top' || payload.placement === 'bottom') {
      if (boardSlots.length < 1 || boardSlots.length > strength) {
        return {
          ok: false,
          error: {
            code: 'INVALID_TARGET_SELECTION',
            message: `Select 1..${strength} occupied Board slot(s) to reposition to Days.`
          }
        };
      }
      return {
        ok: true,
        plan: {
          kind: 'earth',
          mode: 'board_to_days',
          boardSlots,
          daysCount: 0,
          placement: payload.placement
        }
      };
    }

    // Default board reorder = swap Event & Center (requires strength >= 2 and both occupied)
    if (strength < 2) {
      return {
        ok: false,
        error: {
          code: 'INVALID_REORDER_SPEC',
          message: 'Swapping two Board slots requires Earth strength >= 2 (or specify placement="top"|"bottom" for 1-VP Board reposition).'
        }
      };
    }
    if (boardEvent.length === 0 || boardCenter.length === 0) {
      return {
        ok: false,
        error: {
          code: 'INSUFFICIENT_TARGET_CARDS',
          message: 'Swapping Board slots requires both Left Event and Center to be occupied.'
        }
      };
    }
    return {
      ok: true,
      plan: {
        kind: 'earth',
        mode: 'board_swap',
        boardSlots: ['event', 'center'],
        daysCount: 0
      }
    };
  }

  // Earth board_and_days
  const slotRes = resolveSelectedBoardSlots(payload, boardEvent, boardCenter, boardParallel);
  if (!slotRes.ok) return slotRes;
  const boardSlots = slotRes.slots;
  const daysCount = payload.daysCount ?? 0;

  if (boardSlots.length < 1 || daysCount < 1) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TARGET_SELECTION',
        message: 'Earth on "board_and_days" requires at least 1 Board slot and daysCount >= 1.'
      }
    };
  }
  const total = boardSlots.length + daysCount;
  if (total > strength) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TARGET_SELECTION',
        message: `Combined Earth targets (${total}) exceed strength ${strength}.`
      }
    };
  }
  if (days.length < daysCount) {
    return {
      ok: false,
      error: {
        code: 'INSUFFICIENT_TARGET_CARDS',
        message: `Deck of Days only has ${days.length} card(s), fewer than ${daysCount}.`
      }
    };
  }

  const currentBoardIds = boardSlots.map((slot) =>
    slot === 'event' ? boardEvent[0]! : slot === 'center' ? boardCenter[0]! : boardParallel[0]!
  );
  const currentDaysIds = days.slice(0, daysCount);
  const currentCombined = [...currentBoardIds, ...currentDaysIds];

  let orderedCardIds: string[];
  if (payload.newOrder && payload.newOrder.length > 0) {
    if (!isExactCardPermutation(currentCombined, payload.newOrder)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_REORDER_SPEC',
          message: 'Earth newOrder must be an exact permutation of the targeted Board and Days cards.'
        }
      };
    }
    orderedCardIds = [...payload.newOrder];
  } else if (payload.indexOrder && payload.indexOrder.length > 0) {
    if (!isExactIndexPermutation(currentCombined.length, payload.indexOrder)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_REORDER_SPEC',
          message: `Earth indexOrder must be a valid permutation of 0..${currentCombined.length - 1}.`
        }
      };
    }
    orderedCardIds = payload.indexOrder.map((idx) => currentCombined[idx]!);
  } else {
    return {
      ok: false,
      error: {
        code: 'INVALID_REORDER_SPEC',
        message: 'Earth on "board_and_days" requires newOrder or indexOrder.'
      }
    };
  }

  return {
    ok: true,
    plan: {
      kind: 'earth',
      mode: 'board_and_days_reorder',
      boardSlots,
      daysCount,
      orderedCardIds
    }
  };
}

function executeValidatedPlan(
  ctx: ElementalMutableContext,
  plan: ValidatedPlan,
  meta: {
    actor: PlayerState;
    sourceCommand: 'UseElementalEffect' | 'UseReaderBonus';
    element: Element;
    strength: number;
    sourceCardId: string | null;
    bonusId: string | null;
  }
): void {
  const { cards, ruleset, turn, round, phase, newEvents, nextSeq } = ctx;
  const { actor, sourceCommand, element, strength } = meta;

  const popBoardSlot = (slot: BoardTargetSlot): { cardId: string; wasPublic: boolean } => {
    if (slot === 'event') {
      const cardId = ctx.boardEvent.shift()!;
      const wasPublic = ctx.eventRevealed;
      ctx.eventRevealed = false;
      ctx.majorPending = ctx.majorPending.filter((p) => p.cardId !== cardId);
      return { cardId, wasPublic };
    }
    if (slot === 'parallel') {
      const cardId = ctx.boardParallel.shift()!;
      ctx.majorPending = ctx.majorPending.filter((p) => p.cardId !== cardId);
      return { cardId, wasPublic: isMajorCard(cards[cardId]) };
    }
    const cardId = ctx.boardCenter.shift()!;
    const wasPublic = ctx.centerRevealed;
    ctx.centerRevealed = false;
    ctx.centerAbandoned = false;
    ctx.abandonedByPlayerId = null;
    ctx.majorPending = ctx.majorPending.filter((p) => p.cardId !== cardId);
    return { cardId, wasPublic };
  };

  if (plan.kind === 'air') {
    const movedFromBoard: { slot: BoardTargetSlot; cardId: string; wasPublic: boolean }[] = [];
    for (const slot of plan.boardSlots) {
      const popped = popBoardSlot(slot);
      movedFromBoard.push({ slot, ...popped });
      ctx.days.unshift(popped.cardId);
    }

    const shuffled = deterministicShuffle(ctx.days, ctx.rngState);
    ctx.days = shuffled.shuffled;
    ctx.rngState = shuffled.nextState;

    for (const moved of movedFromBoard) {
      const card = cards[moved.cardId]!;
      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
          actor: actor.id,
          type: 'CardMoved',
          affectedCardIds: moved.wasPublic ? [moved.cardId] : [],
          source: sourceCommand,
          reason: 'air-shuffle-board-to-days',
          visibility: 'public',
          summary: moved.wasPublic
            ? `${actor.name} shuffled ${card.label} from Board (${moved.slot}) into Deck of Days.`
            : `${actor.name} shuffled concealed Board (${moved.slot}) card into Deck of Days.`,
          payload: { from: moved.slot, to: 'days', concealed: !moved.wasPublic }
        })
      );
      if (!moved.wasPublic) {
        newEvents.push(
          makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
            actor: actor.id,
            type: 'CardMoved',
            affectedCardIds: [moved.cardId],
            source: sourceCommand,
            reason: 'air-shuffle-board-to-days-admin',
            visibility: 'admin_only',
            summary: `[Admin] Air shuffled concealed ${card.label} from Board (${moved.slot}) into Days.`,
            payload: { from: moved.slot, to: 'days', cardId: moved.cardId }
          })
        );
      }
    }

    const parts: string[] = [];
    if (movedFromBoard.length > 0) parts.push(`${movedFromBoard.length} Board card(s)`);
    if (plan.daysCount > 0) parts.push(`${plan.daysCount} Days card(s)`);

    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
        actor: actor.id,
        type: 'ElementalEffectResolved',
        affectedCardIds: [],
        source: sourceCommand,
        reason: 'air-shuffle',
        visibility: 'public',
        summary: `${actor.name} resolved Air (Shuffle · strength ${strength}): shuffled ${parts.join(' + ')} unpredictably into Deck of Days (${ctx.days.length} cards).`,
        payload: {
          element,
          strength,
          boardSlots: plan.boardSlots,
          daysCount: plan.daysCount,
          sourceCardId: meta.sourceCardId,
          bonusId: meta.bonusId
        }
      })
    );
    return;
  }

  if (plan.kind === 'fire') {
    const burnedIds: string[] = [];
    for (const slot of plan.boardSlots) {
      const popped = popBoardSlot(slot);
      burnedIds.push(popped.cardId);
      ctx.veil.push(popped.cardId);
      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
          actor: actor.id,
          type: 'CardMoved',
          affectedCardIds: [popped.cardId],
          source: sourceCommand,
          reason: 'fire-burn-board-to-veil',
          visibility: 'public',
          summary: `${actor.name} burned ${cards[popped.cardId]!.label} from Board (${slot}) into the Veil.`,
          payload: { from: slot, to: 'veil' }
        })
      );
    }

    if (plan.daysCount > 0) {
      const burnedFromDays = ctx.days.splice(0, plan.daysCount);
      for (const id of burnedFromDays) {
        burnedIds.push(id);
        ctx.veil.push(id);
      }
      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
          actor: actor.id,
          type: 'CardMoved',
          affectedCardIds: burnedFromDays,
          source: sourceCommand,
          reason: 'fire-burn-days-to-veil',
          visibility: 'public',
          summary: `${actor.name} burned ${burnedFromDays.map((id) => cards[id]!.label).join(', ')} from Deck of Days into the Veil.`,
          payload: { from: 'days', to: 'veil', count: burnedFromDays.length }
        })
      );
    }

    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
        actor: actor.id,
        type: 'ElementalEffectResolved',
        affectedCardIds: burnedIds,
        source: sourceCommand,
        reason: 'fire-burn',
        visibility: 'public',
        summary: `${actor.name} resolved Fire (Burn · strength ${strength}): sent ${burnedIds.map((id) => cards[id]!.label).join(', ')} to the Veil.`,
        payload: {
          element,
          strength,
          burnedCardIds: burnedIds,
          boardSlots: plan.boardSlots,
          daysCount: plan.daysCount,
          sourceCardId: meta.sourceCardId,
          bonusId: meta.bonusId
        }
      })
    );
    return;
  }

  if (plan.kind === 'water') {
    const selectedSet = new Set(plan.targetCardIds);
    ctx.veil = ctx.veil.filter((id) => !selectedSet.has(id));

    if (ruleset.waterResurfaceDestination === 'top') {
      ctx.days = [...plan.targetCardIds, ...ctx.days];
    } else if (ruleset.waterResurfaceDestination === 'bottom') {
      ctx.days = [...ctx.days, ...plan.targetCardIds];
    } else {
      const combined = [...ctx.days, ...plan.targetCardIds];
      const shuffled = deterministicShuffle(combined, ctx.rngState);
      ctx.days = shuffled.shuffled;
      ctx.rngState = shuffled.nextState;
    }

    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
        actor: actor.id,
        type: 'CardMoved',
        affectedCardIds: plan.targetCardIds,
        source: sourceCommand,
        reason: `water-resurface-${ruleset.waterResurfaceDestination}`,
        visibility: 'public',
        summary: `${actor.name} resurfaced ${plan.targetCardIds.map((id) => cards[id]!.label).join(', ')} from the Veil into Deck of Days (${ruleset.waterResurfaceDestination}).`,
        payload: {
          from: 'veil',
          to: 'days',
          destination: ruleset.waterResurfaceDestination
        }
      })
    );

    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
        actor: actor.id,
        type: 'ElementalEffectResolved',
        affectedCardIds: plan.targetCardIds,
        source: sourceCommand,
        reason: 'water-resurface',
        visibility: 'public',
        summary: `${actor.name} resolved Water (Resurface · strength ${strength}): returned ${plan.targetCardIds.length} card(s) from Veil to Deck of Days (${ruleset.waterResurfaceDestination}).`,
        payload: {
          element,
          strength,
          resurfacedCardIds: plan.targetCardIds,
          destination: ruleset.waterResurfaceDestination,
          sourceCardId: meta.sourceCardId,
          bonusId: meta.bonusId
        }
      })
    );
    return;
  }

  // Earth (Reorder)
  if (plan.mode === 'days_to_bottom') {
    const moved = ctx.days.splice(0, plan.daysCount);
    ctx.days.push(...moved);
    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
        actor: actor.id,
        type: 'CardMoved',
        affectedCardIds: [],
        source: sourceCommand,
        reason: 'earth-reposition-days-to-bottom',
        visibility: 'public',
        summary: `${actor.name} deliberately moved the top ${plan.daysCount} card(s) of Deck of Days to the bottom.`,
        payload: { from: 'days', to: 'days', placement: 'bottom', count: plan.daysCount }
      })
    );
    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
        actor: actor.id,
        type: 'CardMoved',
        affectedCardIds: moved,
        source: sourceCommand,
        reason: 'earth-reposition-days-to-bottom-admin',
        visibility: 'admin_only',
        summary: `[Admin] Earth moved ${moved.map((id) => cards[id]!.label).join(', ')} to bottom of Days.`,
        payload: { cardIds: moved, placement: 'bottom' }
      })
    );
  } else if (plan.mode === 'days_reorder' && plan.orderedCardIds) {
    ctx.days = [...plan.orderedCardIds, ...ctx.days.slice(plan.daysCount)];
    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
        actor: actor.id,
        type: 'CardMoved',
        affectedCardIds: [],
        source: sourceCommand,
        reason: 'earth-reorder-days',
        visibility: 'public',
        summary: `${actor.name} deliberately reordered the top ${plan.daysCount} cards of Deck of Days.`,
        payload: { zone: 'days', count: plan.daysCount }
      })
    );
    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
        actor: actor.id,
        type: 'CardMoved',
        affectedCardIds: plan.orderedCardIds,
        source: sourceCommand,
        reason: 'earth-reorder-days-admin',
        visibility: 'admin_only',
        summary: `[Admin] Earth reordered top ${plan.daysCount} of Days to: ${plan.orderedCardIds.map((id) => cards[id]!.label).join(' → ')}.`,
        payload: { newOrder: plan.orderedCardIds }
      })
    );
  } else if (plan.mode === 'board_to_days') {
    const movedIds: string[] = [];
    for (const slot of plan.boardSlots) {
      const popped = popBoardSlot(slot);
      movedIds.push(popped.cardId);
      if (plan.placement === 'top') {
        ctx.days.unshift(popped.cardId);
      } else {
        ctx.days.push(popped.cardId);
      }
      newEvents.push(
        makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
          actor: actor.id,
          type: 'CardMoved',
          affectedCardIds: popped.wasPublic ? [popped.cardId] : [],
          source: sourceCommand,
          reason: `earth-reposition-board-to-days-${plan.placement}`,
          visibility: 'public',
          summary: popped.wasPublic
            ? `${actor.name} placed ${cards[popped.cardId]!.label} from Board (${slot}) onto ${plan.placement} of Deck of Days.`
            : `${actor.name} placed concealed Board (${slot}) card onto ${plan.placement} of Deck of Days.`,
          payload: { from: slot, to: 'days', placement: plan.placement }
        })
      );
    }
  } else if (plan.mode === 'board_swap') {
    const evId = ctx.boardEvent[0]!;
    const ctrId = ctx.boardCenter[0]!;
    const oldEvRev = ctx.eventRevealed;
    const oldCtrRev = ctx.centerRevealed;
    ctx.boardEvent = [ctrId];
    ctx.boardCenter = [evId];
    ctx.eventRevealed = oldCtrRev;
    ctx.centerRevealed = oldEvRev;
    ctx.centerAbandoned = false;
    ctx.abandonedByPlayerId = null;

    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
        actor: actor.id,
        type: 'CardMoved',
        affectedCardIds: oldEvRev && oldCtrRev ? [evId, ctrId] : [],
        source: sourceCommand,
        reason: 'earth-swap-board-slots',
        visibility: 'public',
        summary: `${actor.name} swapped the Left Event and Center Board slots.`,
        payload: { swapped: ['event', 'center'] }
      })
    );
    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
        actor: actor.id,
        type: 'CardMoved',
        affectedCardIds: [evId, ctrId],
        source: sourceCommand,
        reason: 'earth-swap-board-slots-admin',
        visibility: 'admin_only',
        summary: `[Admin] Earth swapped Event (${cards[evId]!.label}) ↔ Center (${cards[ctrId]!.label}).`,
        payload: { newEventCardId: ctrId, newCenterCardId: evId }
      })
    );
  } else if (plan.mode === 'board_and_days_reorder' && plan.orderedCardIds) {
    const boardCount = plan.boardSlots.length;
    const newBoardCards = plan.orderedCardIds.slice(0, boardCount);
    const newDaysTop = plan.orderedCardIds.slice(boardCount);

    plan.boardSlots.forEach((slot, idx) => {
      if (slot === 'event') {
        ctx.boardEvent = [newBoardCards[idx]!];
        ctx.eventRevealed = false;
      } else if (slot === 'parallel') {
        ctx.boardParallel = [newBoardCards[idx]!];
      } else {
        ctx.boardCenter = [newBoardCards[idx]!];
        ctx.centerRevealed = false;
        ctx.centerAbandoned = false;
        ctx.abandonedByPlayerId = null;
      }
    });
    ctx.days = [...newDaysTop, ...ctx.days.slice(plan.daysCount)];

    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
        actor: actor.id,
        type: 'CardMoved',
        affectedCardIds: [],
        source: sourceCommand,
        reason: 'earth-reorder-board-and-days',
        visibility: 'public',
        summary: `${actor.name} deliberately reordered ${plan.boardSlots.length} Board slot(s) and top ${plan.daysCount} Days card(s).`,
        payload: { boardSlots: plan.boardSlots, daysCount: plan.daysCount }
      })
    );
    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
        actor: actor.id,
        type: 'CardMoved',
        affectedCardIds: plan.orderedCardIds,
        source: sourceCommand,
        reason: 'earth-reorder-board-and-days-admin',
        visibility: 'admin_only',
        summary: `[Admin] Earth reordered Board+Days to: ${plan.orderedCardIds.map((id) => cards[id]!.label).join(' → ')}.`,
        payload: { newOrder: plan.orderedCardIds }
      })
    );
  }

  newEvents.push(
    makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
      actor: actor.id,
      type: 'ElementalEffectResolved',
      affectedCardIds: [],
      source: sourceCommand,
      reason: `earth-${plan.mode}`,
      visibility: 'public',
      summary: `${actor.name} resolved Earth (Reorder · strength ${strength}, mode ${plan.mode}).`,
      payload: {
        element,
        strength,
        mode: plan.mode,
        sourceCardId: meta.sourceCardId,
        bonusId: meta.bonusId
      }
    })
  );
}

/**
 * Validates and executes a physical hand-card Elemental Activation (D1 AGREED rule):
 * - Validates EVERYTHING before mutating state.
 * - Consumes `sourceCardId` from hand -> Veil atomically.
 * - Uses the consumed card's original VP (1-3) for effect strength.
 * - Excludes `sourceCardId` from eligible Water resurfacing targets.
 * - Counts toward the 1-elemental-action-per-turn limit.
 */
export function validateAndExecuteElementalEffect(
  ctx: ElementalMutableContext,
  command: {
    readonly playerId: string;
    readonly element: Element;
    readonly sourceCardId: string;
  } & ElementalEffectPayload
): { ok: true } | { ok: false; error: ValidationError } {
  const activePlayer = ctx.players[ctx.activePlayerIndex]!;

  if (activePlayer.effectUsedThisTurn) {
    return {
      ok: false,
      error: {
        code: 'EFFECT_ALREADY_USED_THIS_TURN',
        message: `${activePlayer.name} has already used an elemental action this turn (max 1 per turn).`
      }
    };
  }

  if (ctx.phase !== 'AWAITING_ELEMENTAL_ACTION') {
    return {
      ok: false,
      error: {
        code: 'INVALID_PHASE',
        message: `Elemental hand effects can only be activated during AWAITING_ELEMENTAL_ACTION (current: ${ctx.phase}).`
      }
    };
  }

  if (!activePlayer.hand.includes(command.sourceCardId)) {
    return {
      ok: false,
      error: {
        code: 'CARD_NOT_IN_HAND',
        message: `Card "${command.sourceCardId}" is not in ${activePlayer.id}'s hand.`
      }
    };
  }

  const sourceCard = ctx.cards[command.sourceCardId];
  if (!sourceCard || !sourceCard.element) {
    return {
      ok: false,
      error: {
        code: 'INVALID_CARD',
        message: `Card "${command.sourceCardId}" is not a valid elemental card.`
      }
    };
  }

  if (sourceCard.element !== command.element) {
    return {
      ok: false,
      error: {
        code: 'ELEMENT_MISMATCH',
        message: `Card ${sourceCard.label} is ${sourceCard.element}, not ${command.element}.`
      }
    };
  }

  const { baseVP, nativeBonusVP, strength } = computeElementalStrength(
    activePlayer,
    sourceCard,
    ctx.ruleset
  );

  // Validate ENTIRE target specification BEFORE consuming sourceCardId!
  const planRes = validateElementalPlan({
    element: command.element,
    strength,
    payload: command,
    excludedVeilCardId: command.sourceCardId,
    days: ctx.days,
    veil: ctx.veil,
    boardEvent: ctx.boardEvent,
    boardCenter: ctx.boardCenter,
    boardParallel: ctx.boardParallel
  });

  if (!planRes.ok) {
    return planRes;
  }

  // ---- Atomic mutation starts here (all validation passed) ----
  const updatedHand = activePlayer.hand.filter((id) => id !== command.sourceCardId);
  ctx.players[ctx.activePlayerIndex] = {
    ...activePlayer,
    hand: updatedHand,
    effectUsedThisTurn: true
  };
  ctx.veil.push(command.sourceCardId);

  ctx.newEvents.push(
    makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
      actor: activePlayer.id,
      type: 'ElementalEffectActivated',
      affectedCardIds: [command.sourceCardId],
      source: 'UseElementalEffect',
      reason: `activate-${command.element}`,
      visibility: 'public',
      summary: `${activePlayer.name} activated ${ELEMENT_META[command.element].label} (${ELEMENT_META[command.element].suitSymbol}) using ${sourceCard.label} (${baseVP} VP${nativeBonusVP > 0 ? ` + ${nativeBonusVP} native` : ''} → strength ${strength}).`,
      payload: {
        element: command.element,
        sourceCardId: command.sourceCardId,
        baseVP,
        nativeBonusVP,
        strength,
        targetZone: command.targetZone
      }
    })
  );

  ctx.newEvents.push(
    makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
      actor: activePlayer.id,
      type: 'CardMoved',
      affectedCardIds: [command.sourceCardId],
      source: 'UseElementalEffect',
      reason: 'elemental-activation-cost',
      visibility: 'public',
      summary: `${sourceCard.label} consumed from ${activePlayer.name}'s hand into the Veil.`,
      payload: { from: 'hand', to: 'veil' }
    })
  );

  executeValidatedPlan(ctx, planRes.plan, {
    actor: ctx.players[ctx.activePlayerIndex]!,
    sourceCommand: 'UseElementalEffect',
    element: command.element,
    strength,
    sourceCardId: command.sourceCardId,
    bonusId: null
  });

  return { ok: true };
}

/**
 * Provisional D1 Reader Bonus consumption (strictly separate from physical hand-card activation):
 * - Does NOT consume any card from hand.
 * - Resolves a Tier 1 (1 VP) elemental effect of the bonus's sourceElement.
 * - Usable only on a turn AFTER earnedOnTurn; expires if unused at end of that turn.
 */
export function validateAndExecuteReaderBonus(
  ctx: ElementalMutableContext,
  command: {
    readonly playerId: string;
    readonly bonusId: string;
  } & ElementalEffectPayload
): { ok: true } | { ok: false; error: ValidationError } {
  const activePlayer = ctx.players[ctx.activePlayerIndex]!;

  if (ctx.ruleset.readerBonusPolicy === 'record_only') {
    return {
      ok: false,
      error: {
        code: 'FEATURE_DISABLED',
        message: 'Reader bonus spending is disabled in this ruleset (readerBonusPolicy = record_only).'
      }
    };
  }

  if (ctx.ruleset.readerBonusConsumesTurnAction && activePlayer.effectUsedThisTurn) {
    return {
      ok: false,
      error: {
        code: 'EFFECT_ALREADY_USED_THIS_TURN',
        message: `${activePlayer.name} has already used their elemental action for this turn.`
      }
    };
  }

  if (!canSpendReaderBonusInPhase(ctx.phase, ctx.ruleset)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_PHASE',
        message: `Reader bonuses cannot be spent during phase ${ctx.phase}.`
      }
    };
  }

  const bonusIndex = activePlayer.pendingReaderBonuses.findIndex((b) => b.id === command.bonusId);
  if (bonusIndex === -1) {
    return {
      ok: false,
      error: {
        code: 'NO_AVAILABLE_READER_BONUS',
        message: `Reader bonus "${command.bonusId}" not found for ${activePlayer.id}.`
      }
    };
  }

  const bonus = activePlayer.pendingReaderBonuses[bonusIndex]!;
  if (bonus.status !== 'available') {
    return {
      ok: false,
      error: {
        code: 'NO_AVAILABLE_READER_BONUS',
        message: `Reader bonus "${bonus.id}" is not available (status: ${bonus.status}).`
      }
    };
  }

  if (bonus.earnedOnTurn >= ctx.turn) {
    return {
      ok: false,
      error: {
        code: 'READER_BONUS_NOT_READY',
        message: `Reader bonus "${bonus.id}" earned on Turn ${bonus.earnedOnTurn} can only be spent starting on your next turn.`
      }
    };
  }

  if (!bonus.sourceElement) {
    return {
      ok: false,
      error: {
        code: 'ELEMENT_MISMATCH',
        message: `Reader bonus "${bonus.id}" has no associated element.`
      }
    };
  }

  const strength = 1; // Provisional D1 Tier 1 free elemental action
  const planRes = validateElementalPlan({
    element: bonus.sourceElement,
    strength,
    payload: command,
    excludedVeilCardId: null,
    days: ctx.days,
    veil: ctx.veil,
    boardEvent: ctx.boardEvent,
    boardCenter: ctx.boardCenter,
    boardParallel: ctx.boardParallel
  });

  if (!planRes.ok) {
    return planRes;
  }

  // ---- Atomic mutation ----
  const updatedBonuses = activePlayer.pendingReaderBonuses.map((b, idx) =>
    idx === bonusIndex
      ? {
          ...b,
          status: 'consumed' as const,
          consumedOnTurn: ctx.turn
        }
      : b
  );

  ctx.players[ctx.activePlayerIndex] = {
    ...activePlayer,
    pendingReaderBonuses: updatedBonuses,
    effectUsedThisTurn: ctx.ruleset.readerBonusConsumesTurnAction
      ? true
      : activePlayer.effectUsedThisTurn
  };

  ctx.newEvents.push(
    makeEvent(ctx.nextSeq(), ctx.turn, ctx.round, ctx.phase, ctx.ruleset.version, {
      actor: activePlayer.id,
      type: 'ReaderBonusConsumed',
      affectedCardIds: [bonus.sourceCardId],
      source: 'UseReaderBonus',
      reason: ctx.ruleset.readerBonusPolicy,
      visibility: 'public',
      summary: `${activePlayer.name} spent Reader Bonus (${ELEMENT_META[bonus.sourceElement].label} Tier 1 · no hand card consumed).`,
      payload: {
        bonusId: bonus.id,
        element: bonus.sourceElement,
        strength,
        policy: ctx.ruleset.readerBonusPolicy
      }
    })
  );

  executeValidatedPlan(ctx, planRes.plan, {
    actor: ctx.players[ctx.activePlayerIndex]!,
    sourceCommand: 'UseReaderBonus',
    element: bonus.sourceElement,
    strength,
    sourceCardId: null,
    bonusId: bonus.id
  });

  return { ok: true };
}

export function expireUnusedReaderBonuses(params: {
  player: PlayerState;
  currentTurn: number;
  round: number;
  phase: GamePhase;
  ruleset: Ruleset;
  newEvents: GameEvent[];
  nextSeq: () => number;
}): PlayerState {
  const { player, currentTurn, round, phase, ruleset, newEvents, nextSeq } = params;
  if (ruleset.readerBonusPolicy === 'record_only') return player;

  let changed = false;
  const updatedBonuses = player.pendingReaderBonuses.map((b) => {
    if (b.status === 'available' && b.earnedOnTurn < currentTurn) {
      changed = true;
      newEvents.push(
        makeEvent(nextSeq(), currentTurn, round, phase, ruleset.version, {
          actor: player.id,
          type: 'ReaderBonusExpired',
          affectedCardIds: [b.sourceCardId],
          source: 'EndTurn',
          reason: 'unused-on-next-turn',
          visibility: 'public',
          summary: `${player.name}'s unused Reader Bonus (${b.sourceElement ?? 'neutral'}, earned Turn ${b.earnedOnTurn}) expired at end of Turn ${currentTurn}.`,
          payload: { bonusId: b.id, earnedOnTurn: b.earnedOnTurn, expiredOnTurn: currentTurn }
        })
      );
      return {
        ...b,
        status: 'expired' as const,
        expiredOnTurn: currentTurn
      };
    }
    return b;
  });

  return changed ? { ...player, pendingReaderBonuses: updatedBonuses } : player;
}
