import { capEffectiveVP, elementBeats, rankToVP } from './cards.js';
import type {
  Card,
  EventReality,
  PlayerState,
  ReconciliationBreakdown,
  Ruleset
} from './types.js';

/**
 * Maps Left Event card strictly to Reality:
 * - Classic Court anchored deliberately in Event (via Earth): 'major_resonance' (NEVER implicit Minor 'treasure' — fixes R2-BUG-01!)
 * - 3 VP (7–9) -> Treasure
 * - 2 VP (4–6) -> Barrier
 * - 1 VP (1–3) -> Trial
 */
export function eventCardToReality(eventCard: Card): EventReality {
  if (
    eventCard.family === 'classic-court' ||
    eventCard.family === 'sun-major' ||
    eventCard.family === 'moon-major'
  ) {
    return 'major_resonance';
  }
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
  activeCourtAuraVP?: number;
}): ReconciliationBreakdown {
  const {
    player,
    eventCard,
    centerCard,
    sacrificeCardIds,
    cards,
    ruleset,
    activeCourtAuraVP = 0
  } = params;
  const reality = eventCardToReality(eventCard);
  const lineageRankVP = rankToVP(player.lineage.rank);
  const persistentEclipseBonusVP = player.eclipseBonusVP ?? 0;
  const lineageTopId = player.lineage.cardIds[player.lineage.cardIds.length - 1]!;
  const lineageTopCard = cards[lineageTopId]!;
  const sacrificedCards = sacrificeCardIds
    .map((id) => cards[id])
    .filter((c): c is Card => c !== undefined);
  const sacrificedVP = sacrificedCards.reduce((sum, c) => sum + c.vp, 0);

  if (reality === 'treasure' || reality === 'major_resonance') {
    const baseCap = capEffectiveVP(lineageRankVP, ruleset.maxEffectiveVP);
    const totalVP = baseCap.effectiveVP + activeCourtAuraVP + persistentEclipseBonusVP;
    const passes = sacrificeCardIds.length === 0;
    const requiredCondition =
      reality === 'major_resonance'
        ? `Major Resonance (${eventCard.label} anchored in Event) — claim Center cleanly without Minor obstacle`
        : 'Treasure (Event 3 VP) — claim Center freely (no sacrifice)';
    return {
      reality,
      eventCardId: eventCard.id,
      eventVP: eventCard.vp,
      eventElement: eventCard.element,
      lineageVP: lineageRankVP,
      sacrificedCardIds: sacrificeCardIds,
      sacrificedVP,
      hasElementalAdvantage: false,
      advantageModifierVP: 0,
      cappedBaseVP: baseCap.effectiveVP,
      activeCourtAuraVP,
      persistentEclipseBonusVP,
      rawTotalVP: lineageRankVP + activeCourtAuraVP + persistentEclipseBonusVP,
      effectiveVP: totalVP,
      wasCapped: baseCap.wasCapped,
      capLimit: ruleset.maxEffectiveVP,
      requiredCondition,
      passes,
      failureReason: passes
        ? undefined
        : reality === 'major_resonance'
          ? 'Do not sacrifice cards under Major Resonance.'
          : 'Do not sacrifice cards on a Treasure event.'
    };
  }

  if (reality === 'barrier') {
    // RD-08: Base card/lineage VP is capped at maxEffectiveVP (3); active Court aura & persistent Eclipse VP add outside the base cap!
    const rawBaseVP = lineageRankVP + sacrificedVP;
    const baseCap = capEffectiveVP(rawBaseVP, ruleset.maxEffectiveVP);
    const totalEffectiveVP = baseCap.effectiveVP + activeCourtAuraVP + persistentEclipseBonusVP;
    const passes = totalEffectiveVP >= eventCard.vp;
    return {
      reality,
      eventCardId: eventCard.id,
      eventVP: eventCard.vp,
      eventElement: eventCard.element,
      lineageVP: lineageRankVP,
      sacrificedCardIds: sacrificeCardIds,
      sacrificedVP,
      hasElementalAdvantage: false,
      advantageModifierVP: 0,
      cappedBaseVP: baseCap.effectiveVP,
      activeCourtAuraVP,
      persistentEclipseBonusVP,
      rawTotalVP: rawBaseVP + activeCourtAuraVP + persistentEclipseBonusVP,
      effectiveVP: totalEffectiveVP,
      wasCapped: baseCap.wasCapped,
      capLimit: ruleset.maxEffectiveVP,
      requiredCondition: `Barrier (Event ${eventCard.vp} VP) — reach at least ${eventCard.vp} effective VP`,
      passes,
      failureReason: passes
        ? undefined
        : `Need at least ${eventCard.vp} effective VP (current: ${totalEffectiveVP} VP).`
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
  const advantageModifierVP = hasElementalAdvantage ? ruleset.trialAdvantageBonusVP : 0;
  const rawBaseVP = lineageRankVP + sacrificedVP + advantageModifierVP;
  const baseCap = capEffectiveVP(rawBaseVP, ruleset.maxEffectiveVP);
  const totalEffectiveVP = baseCap.effectiveVP + activeCourtAuraVP + persistentEclipseBonusVP;

  const advantageMet = !ruleset.trialRequireAdvantage || hasElementalAdvantage;
  const vpExceeded = totalEffectiveVP > eventCard.vp;
  const passes = advantageMet && vpExceeded;

  let failureReason: string | undefined;
  if (!advantageMet) {
    failureReason = `Trial requires an element beating ${targetElement ?? 'unknown'} (Water > Fire > Earth > Air > Water).`;
  } else if (!vpExceeded) {
    failureReason = `Trial requires strictly more than ${eventCard.vp} effective VP (current: ${totalEffectiveVP} VP; equal fails).`;
  }

  return {
    reality,
    eventCardId: eventCard.id,
    eventVP: eventCard.vp,
    eventElement: eventCard.element,
    targetElement,
    lineageVP: lineageRankVP,
    sacrificedCardIds: sacrificeCardIds,
    sacrificedVP,
    hasElementalAdvantage,
    advantageModifierVP,
    cappedBaseVP: baseCap.effectiveVP,
    activeCourtAuraVP,
    persistentEclipseBonusVP,
    rawTotalVP: rawBaseVP + activeCourtAuraVP + persistentEclipseBonusVP,
    effectiveVP: totalEffectiveVP,
    wasCapped: baseCap.wasCapped,
    capLimit: ruleset.maxEffectiveVP,
    requiredCondition: `Trial (Event ${eventCard.vp} VP) — effective VP > ${eventCard.vp} AND element beating ${targetElement ?? 'target'}`,
    passes,
    failureReason
  };
}
