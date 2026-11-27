import { capEffectiveVP, elementBeats, rankToVP } from './cards.js';
import type {
  Card,
  EventReality,
  PlayerState,
  ReconciliationBreakdown,
  Ruleset
} from './types.js';

/**
 * Maps Left Event card VP strictly to Reality:
 * 3 VP (7–9) -> Treasure
 * 2 VP (4–6) -> Barrier
 * 1 VP (1–3) -> Trial
 */
export function eventCardToReality(eventCard: Card): EventReality {
  // Classic Court occupying Left Event acts as an open Treasure channel while standing on the Board
  if (eventCard.family === 'classic-court') return 'treasure';
  if (eventCard.vp >= 3) return 'treasure';
  if (eventCard.vp === 2) return 'barrier';
  return 'trial';
}

export function evaluateReconciliation(params: {
  player: PlayerState;
  eventCard: Card;
  centerCard: Card;
  sacrificeCardIds: readonly string[];
  cards: Readonly<Record<string, Card>>;
  ruleset: Ruleset;
}): ReconciliationBreakdown {
  const { player, eventCard, centerCard, sacrificeCardIds, cards, ruleset } = params;
  const reality = eventCardToReality(eventCard);
  const lineageVP = rankToVP(player.lineage.rank) + (player.eclipseBonusVP ?? 0);
  const lineageTopId = player.lineage.cardIds[player.lineage.cardIds.length - 1]!;
  const lineageTopCard = cards[lineageTopId]!;
  const sacrificedCards = sacrificeCardIds
    .map((id) => cards[id])
    .filter((c): c is Card => c !== undefined);
  const sacrificedVP = sacrificedCards.reduce((sum, c) => sum + c.vp, 0);

  if (reality === 'treasure') {
    const cap = capEffectiveVP(lineageVP, ruleset.maxEffectiveVP);
    const passes = sacrificeCardIds.length === 0;
    return {
      reality,
      eventCardId: eventCard.id,
      eventVP: eventCard.vp,
      eventElement: eventCard.element,
      lineageVP,
      sacrificedCardIds: sacrificeCardIds,
      sacrificedVP,
      hasElementalAdvantage: false,
      advantageModifierVP: 0,
      rawTotalVP: lineageVP,
      effectiveVP: cap.effectiveVP,
      wasCapped: cap.wasCapped,
      capLimit: ruleset.maxEffectiveVP,
      requiredCondition: 'Treasure (Event 3 VP) — claim Center freely (no sacrifice)',
      passes,
      failureReason: passes ? undefined : 'Do not sacrifice cards on a Treasure event.'
    };
  }

  if (reality === 'barrier') {
    const rawTotalVP = lineageVP + sacrificedVP;
    const cap = capEffectiveVP(rawTotalVP, ruleset.maxEffectiveVP);
    const passes = cap.effectiveVP >= eventCard.vp;
    return {
      reality,
      eventCardId: eventCard.id,
      eventVP: eventCard.vp,
      eventElement: eventCard.element,
      lineageVP,
      sacrificedCardIds: sacrificeCardIds,
      sacrificedVP,
      hasElementalAdvantage: false,
      advantageModifierVP: 0,
      rawTotalVP,
      effectiveVP: cap.effectiveVP,
      wasCapped: cap.wasCapped,
      capLimit: ruleset.maxEffectiveVP,
      requiredCondition: `Barrier (Event ${eventCard.vp} VP) — reach at least ${eventCard.vp} effective VP`,
      passes,
      failureReason: passes
        ? undefined
        : `Need at least ${eventCard.vp} effective VP (current: ${cap.effectiveVP} VP).`
    };
  }

  // Trial (Event 1 VP): strictly exceed Event VP (> 1) + elemental leverage
  const targetElement =
    ruleset.trialTargetElement === 'event' ? eventCard.element : centerCard.element;
  const participating: Card[] = [lineageTopCard, ...sacrificedCards];
  const hasElementalAdvantage = Boolean(
    targetElement &&
      participating.some((c) => c.element !== undefined && elementBeats(c.element, targetElement))
  );
  // Provisional advantage modifier applies ONCE (never double-counted), then capped by maxEffectiveVP
  const advantageModifierVP = hasElementalAdvantage ? ruleset.trialAdvantageBonusVP : 0;
  const rawTotalVP = lineageVP + sacrificedVP + advantageModifierVP;
  const cap = capEffectiveVP(rawTotalVP, ruleset.maxEffectiveVP);

  const advantageMet = !ruleset.trialRequireAdvantage || hasElementalAdvantage;
  const vpExceeded = cap.effectiveVP > eventCard.vp;
  const passes = advantageMet && vpExceeded;

  let failureReason: string | undefined;
  if (!advantageMet) {
    failureReason = `Trial requires an element beating ${targetElement ?? 'unknown'} (Water > Fire > Earth > Air > Water).`;
  } else if (!vpExceeded) {
    failureReason = `Trial requires strictly more than ${eventCard.vp} effective VP (current: ${cap.effectiveVP} VP; equal fails).`;
  }

  return {
    reality,
    eventCardId: eventCard.id,
    eventVP: eventCard.vp,
    eventElement: eventCard.element,
    targetElement,
    lineageVP,
    sacrificedCardIds: sacrificeCardIds,
    sacrificedVP,
    hasElementalAdvantage,
    advantageModifierVP,
    rawTotalVP,
    effectiveVP: cap.effectiveVP,
    wasCapped: cap.wasCapped,
    capLimit: ruleset.maxEffectiveVP,
    requiredCondition: `Trial (Event ${eventCard.vp} VP) — effective VP > ${eventCard.vp} AND element beating ${targetElement ?? 'target'}`,
    passes,
    failureReason
  };
}
