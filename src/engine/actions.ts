import { ELEMENT_META } from './cards.js';
import {
  canActivateHandElementalInPhase,
  canSpendReaderBonusInPhase,
  computeElementalStrength,
  getAvailableReaderBonusesForTurn,
  hasRemainingHandElementalAction
} from './elemental-effects.js';
import { getActiveCourtAuraVP } from './majors.js';
import { evaluateReconciliation, eventCardToReality } from './reconciliation.js';
import type {
  Element,
  GameState,
  LegalActionDescriptor,
  Viewer
} from './types.js';

function describeElementEffect(element: Element, strength: number): string {
  if (element === 'earth') {
    if (strength <= 1) {
      return 'Tier 1 (1 card): Privately inspect #1 Next Upcoming in Deck of Days and optionally send it to the bottom — or move 1 Board card to Days. Rearranging 2+ cards requires Tier 2+.';
    }
    return `Tier ${strength} (${strength} cards): Privately inspect & deliberately reorder up to ${strength} cards across the Shared Board and/or the Immediate Future.`;
  }
  if (element === 'fire') {
    return `Tier ${strength}: Burn up to ${strength} card${strength === 1 ? '' : 's'} from the Shared Board and/or Immediate Future straight into the Veil.`;
  }
  if (element === 'air') {
    return `Tier ${strength}: Shuffle up to ${strength} card${strength === 1 ? '' : 's'} from the Shared Board and/or Deck of Days unpredictably.`;
  }
  return `Tier ${strength}: Resurface up to ${strength} card${strength === 1 ? '' : 's'} from the public Veil back into Deck of Days (cannot resurface its own activating card).`;
}

function getAllowedTargetLabels(element: Element, strength: number, state: GameState): string[] {
  if (element === 'water') {
    return state.veil.length > 0 ? ['The Veil'] : [];
  }
  const targets: string[] = [];
  if (state.board.event.length > 0) targets.push('Board · Event');
  if (state.board.center.length > 0) targets.push('Board · Center');
  if (state.board.parallel.length > 0) targets.push('Board · Parallel');
  if (element === 'fire' && state.days.length >= 1) {
    targets.push(`Immediate Future (up to ${Math.min(strength, state.days.length)})`);
  } else if ((element === 'air' || element === 'earth') && state.days.length >= 2) {
    targets.push(
      element === 'earth' && strength === 1
        ? 'Immediate Future (#1 Next Upcoming)'
        : `Immediate Future (top ${Math.min(strength, state.days.length)})`
    );
  }
  return targets;
}

/**
 * Engine-derived legal action descriptors (single source of truth for the UI).
 * Exposes exact labels, costs, strengths, targets, disabled reasons, and expiry warnings
 * without leaking hidden opponent cards or hidden Deck of Days order.
 */
export function buildActionDescriptors(
  state: GameState,
  viewer: Viewer
): LegalActionDescriptor[] {
  if (state.status !== 'playing' || state.phase === 'GAME_OVER') return [];

  const out: LegalActionDescriptor[] = [];
  const activePlayer = state.players[state.activePlayerIndex];
  const viewerIsActive =
    viewer.role === 'admin' || (viewer.role === 'player' && viewer.playerId === state.activePlayerId);

  // 1. Reader Phase
  if (state.phase === 'AWAITING_READING' && state.currentReading) {
    const canRead =
      viewer.role === 'admin' || viewer.playerId === state.currentReading.readerId;
    const recipient = state.players.find((p) => p.id === state.currentReading!.recipientId);
    out.push({
      id: 'reading-good',
      commandType: 'GiveReading',
      category: 'reading',
      label: 'Advise: GOOD',
      sourceLabel: 'Reader Role',
      effectSummary: `Tell ${recipient?.name ?? 'recipient'} the concealed Center card is GOOD (you may tell the truth or bluff).`,
      costLabel: '0 cost · Earns free Tier-1 Reader Bonus if followed & claimed',
      allowedTargets: ['Board · Center (Reader Peek)'],
      enabled: canRead,
      disabledReason: canRead ? undefined : 'Waiting for the designated Reader to advise.'
    });
    out.push({
      id: 'reading-bad',
      commandType: 'GiveReading',
      category: 'reading',
      label: 'Advise: BAD',
      sourceLabel: 'Reader Role',
      effectSummary: `Tell ${recipient?.name ?? 'recipient'} the concealed Center card is BAD (you may tell the truth or bluff).`,
      costLabel: '0 cost · Earns free Tier-1 Reader Bonus if followed & rejected',
      allowedTargets: ['Board · Center (Reader Peek)'],
      enabled: canRead,
      disabledReason: canRead ? undefined : 'Waiting for the designated Reader to advise.'
    });
    return out;
  }

  // 2. Trading Market Phase
  if (state.phase === 'AWAITING_MARKET' && state.market) {
    const market = state.market;
    const viewerPlayerId = viewer.role === 'player' ? viewer.playerId : state.activePlayerId;
    const viewerPlayer = state.players.find((p) => p.id === viewerPlayerId);
    const offersMade = market.offersMadeByPlayer[viewerPlayerId] ?? 0;

    if (market.activeOffer) {
      const offer = market.activeOffer;
      const isTarget = viewer.role === 'admin' || viewerPlayerId === offer.targetPlayerId;
      const isProposer = viewer.role === 'admin' || viewerPlayerId === offer.proposerId;
      out.push({
        id: `market-accept-${offer.id}`,
        commandType: 'AcceptTrade',
        category: 'market',
        label: offer.requestedCount === 0 ? 'Accept Gift' : 'Accept Trade',
        sourceLabel: 'Trading Market',
        effectSummary:
          offer.requestedCount === 0
            ? 'Receive offered card(s) into hand — mandatory evolution triggers immediately.'
            : `Exchange card(s) (${offer.requestedCount} returned) — mandatory evolution triggers immediately for both players.`,
        costLabel:
          offer.requestedCount === 0
            ? '0 cards (1-way gift)'
            : `${offer.requestedCount} card${offer.requestedCount === 1 ? '' : 's'} from your hand`,
        allowedTargets: ['Your Hand'],
        enabled: isTarget,
        disabledReason: isTarget ? undefined : 'Waiting for the other player to respond.'
      });
      out.push({
        id: `market-reject-${offer.id}`,
        commandType: 'RejectTrade',
        category: 'market',
        label: isProposer && !isTarget ? 'Withdraw Offer' : 'Decline Offer',
        sourceLabel: 'Trading Market',
        effectSummary: 'Decline or withdraw the pending trade offer cleanly.',
        costLabel: '0 cost',
        allowedTargets: [],
        enabled: isTarget || isProposer
      });
    } else {
      const canOffer =
        Boolean(viewerPlayer) &&
        viewerPlayer!.hand.length > 0 &&
        offersMade < market.maxOffersPerPlayer;
      out.push({
        id: 'market-propose',
        commandType: 'ProposeTrade',
        category: 'market',
        label: `Propose Trade or Gift (${offersMade}/${market.maxOffersPerPlayer} used)`,
        sourceLabel: 'Trading Market',
        effectSummary:
          'Offer 1+ card(s) from your hand as a 1-for-1 trade, multi-card trade, or 1-way gift. Evolution triggers immediately on completion.',
        costLabel: 'Selected hand card(s)',
        allowedTargets: ['Your Hand'],
        enabled: canOffer,
        disabledReason: !canOffer
          ? offersMade >= market.maxOffersPerPlayer
            ? `Offer limit reached (${market.maxOffersPerPlayer}/${market.maxOffersPerPlayer}) for this market window.`
            : 'No cards in hand to offer.'
          : undefined
      });
      out.push({
        id: 'market-close',
        commandType: 'CloseMarket',
        category: 'market',
        label: `Close Market & Begin Round ${state.round} →`,
        sourceLabel: 'Trading Market',
        effectSummary: 'Close the Trading Market and populate the Board for the next turn.',
        costLabel: '0 cost',
        allowedTargets: [],
        enabled: true
      });
    }
    return out;
  }

  // 3. Rank 7–9 Major Contention Phase
  if (state.phase === 'AWAITING_MAJOR_CONTENTION' && state.pendingMajorContention) {
    const pending = state.pendingMajorContention;
    const incumbent = state.cards[pending.incumbentCardId]!;
    const arriving = state.cards[pending.arrivingCardId]!;
    const canChoose = viewer.role === 'admin' || viewer.playerId === pending.playerId;

    out.push({
      id: `contention-evict-arriving-${arriving.id}`,
      commandType: 'ChooseMajorExit',
      category: 'major_contention',
      label: `Keep ${incumbent.shortLabel} · Send ${arriving.shortLabel} to Veil`,
      sourceLabel: `Rank ${activePlayer?.lineage.rank ?? 7} Major Mastery`,
      effectSummary: `Keep resident ${incumbent.label} (+${incumbent.courtBonus ?? 1} ${incumbent.element ?? ''}) in Parallel Dimension; arriving ${arriving.label} departs to the Veil.`,
      costLabel: '0 cost',
      allowedTargets: ['Board · Parallel'],
      enabled: canChoose
    });
    out.push({
      id: `contention-evict-incumbent-${incumbent.id}`,
      commandType: 'ChooseMajorExit',
      category: 'major_contention',
      label: `Welcome ${arriving.shortLabel} · Send ${incumbent.shortLabel} to Veil`,
      sourceLabel: `Rank ${activePlayer?.lineage.rank ?? 7} Major Mastery`,
      effectSummary: `Send resident ${incumbent.label} to the Veil; ${arriving.label} (+${arriving.courtBonus ?? 1} ${arriving.element ?? ''}) enters Parallel dormant until Turn ${state.turn + 1}.`,
      costLabel: '0 cost',
      allowedTargets: ['Board · Parallel'],
      enabled: canChoose
    });
    return out;
  }

  if (!activePlayer || !viewerIsActive) return out;

  const availBonuses = getAvailableReaderBonusesForTurn(activePlayer, state.turn, state.ruleset);
  const canSpendBonus =
    state.ruleset.features.elementalEffects &&
    canSpendReaderBonusInPhase(state.phase, state.ruleset) &&
    availBonuses.length > 0 &&
    (!state.ruleset.readerBonusConsumesTurnAction ||
      hasRemainingHandElementalAction(activePlayer, state.ruleset));

  // Primary phase actions
  if (state.phase === 'AWAITING_ABANDONED_CHOICE') {
    const abCard = state.board.center[0] ? state.cards[state.board.center[0]] : undefined;
    const skipsPrep = state.ruleset.abandonedClaimPolicy === 'free_no_prep';
    out.push({
      id: 'abandoned-claim',
      commandType: 'ClaimAbandonedCard',
      category: 'abandoned',
      label: skipsPrep
        ? `Claim ${abCard?.shortLabel ?? 'Abandoned Card'} Free (Skips Reading & Prep)`
        : `Claim ${abCard?.shortLabel ?? 'Abandoned Card'} Free`,
      sourceLabel: 'Abandoned Opportunity',
      effectSummary: skipsPrep
        ? `Take ${abCard?.label ?? 'abandoned card'} into hand freely (triggers evolution), forfeiting this turn's Reading and ordinary Elemental Prep. Earned Reader Bonuses remain usable.`
        : `Take ${abCard?.label ?? 'abandoned card'} into hand freely, forfeiting this turn's Reading.`,
      costLabel: skipsPrep ? 'Forfeits Reading & ordinary Prep' : 'Forfeits Reading',
      allowedTargets: ['Board · Center'],
      enabled: true
    });
    out.push({
      id: 'abandoned-decline',
      commandType: 'DeclineAbandonedCard',
      category: 'abandoned',
      label: 'Decline to Veil & Start Normal Turn',
      sourceLabel: 'Abandoned Opportunity',
      effectSummary: `Send ${abCard?.label ?? 'abandoned card'} to the Veil, deal a fresh concealed Center, and play your full turn (Elemental Prep → Reading → Encounter).`,
      costLabel: '0 cost',
      allowedTargets: ['Board · Center'],
      enabled: true
    });
  } else if (state.phase === 'AWAITING_ELEMENTAL_ACTION') {
    if (state.ruleset.elementalTiming === 'before_reading') {
      out.push({
        id: 'advance-to-reading',
        commandType: 'AdvanceToReading',
        category: 'turn',
        label: 'Proceed to Reading →',
        sourceLabel: 'Turn Flow',
        effectSummary: state.ruleset.allowRevealedBoardElemental
          ? 'Keep your ordinary Elemental Action for after Center + Event are revealed, and request your Reading now.'
          : 'Skip Pre-Reading Elemental Prep and proceed to your Reading.',
        costLabel: '0 cost',
        allowedTargets: [],
        enabled: true
      });
    } else {
      out.push({
        id: 'end-turn-from-post-elemental',
        commandType: 'EndTurn',
        category: 'turn',
        label: 'Finish Turn →',
        sourceLabel: 'Turn Flow',
        effectSummary: 'Pass play to the next player.',
        costLabel: '0 cost',
        allowedTargets: [],
        enabled: true,
        expiryWarning:
          availBonuses.length > 0
            ? `You have ${availBonuses.length} unused free Reader Bonus(es) that will expire when this turn ends!`
            : undefined
      });
    }
  } else if (state.phase === 'AWAITING_READING_DECISION' && state.currentReading?.advice) {
    out.push({
      id: 'pursue-center',
      commandType: 'PursueCenter',
      category: 'reading',
      label: state.ruleset.replaceCenterOnDiscard ? 'Accept & Flip Center' : 'Pursue Center Card',
      sourceLabel: `Reading (${state.currentReading.advice.toUpperCase()})`,
      effectSummary:
        'Flip the concealed Center and Left Event face-up to face the revealed Board encounter.',
      costLabel: '0 cost',
      allowedTargets: ['Board · Center', 'Board · Event'],
      enabled: true
    });
    out.push({
      id: 'discard-center',
      commandType: 'DiscardCenter',
      category: 'reading',
      label: state.ruleset.replaceCenterOnDiscard
        ? 'Reject to Veil & Draw Replacement'
        : 'Discard Center to Veil',
      sourceLabel: `Reading (${state.currentReading.advice.toUpperCase()})`,
      effectSummary: state.ruleset.replaceCenterOnDiscard
        ? 'Send the read Center card face-up to the Veil (revealing truthfulness), then draw & flip a fresh replacement Center + Left Event.'
        : 'Send the read Center card face-up to the Veil and end the encounter.',
      costLabel: '0 cost',
      allowedTargets: ['Board · Center'],
      enabled: true
    });
  } else if (
    state.phase === 'AWAITING_EVENT_RESOLUTION' &&
    state.board.event[0] &&
    state.board.center[0]
  ) {
    const evCard = state.cards[state.board.event[0]]!;
    const ctrCard = state.cards[state.board.center[0]]!;
    const reality = eventCardToReality(evCard);
    const auraVP = getActiveCourtAuraVP({
      player: activePlayer,
      board: state.board,
      majorPending: state.majorPending,
      cards: state.cards
    });
    const baseCheck = evaluateReconciliation({
      player: activePlayer,
      eventCard: evCard,
      centerCard: ctrCard,
      sacrificeCardIds: [],
      cards: state.cards,
      ruleset: state.ruleset,
      activeCourtAuraVP: auraVP
    });

    out.push({
      id: 'resolve-event',
      commandType: 'ResolveEvent',
      category: 'reconciliation',
      label:
        reality === 'treasure'
          ? `Claim ${ctrCard.shortLabel} (Treasure)`
          : reality === 'major_resonance'
            ? `Claim ${ctrCard.shortLabel} (Major Resonance)`
            : baseCheck.passes
              ? `Claim ${ctrCard.shortLabel} (No Sacrifice Needed)`
              : `Sacrifice & Claim ${ctrCard.shortLabel}`,
      sourceLabel:
        reality === 'major_resonance'
          ? `Major Resonance (${evCard.shortLabel})`
          : `${reality.toUpperCase()} (${evCard.shortLabel})`,
      effectSummary: baseCheck.requiredCondition,
      costLabel:
        reality === 'treasure' || reality === 'major_resonance' || baseCheck.passes
          ? '0 sacrifices needed'
          : 'Requires hand card sacrifice(s) → Veil',
      allowedTargets: ['Board · Center'],
      enabled: true
    });

    if (reality === 'barrier' || reality === 'trial') {
      out.push({
        id: 'abandon-center',
        commandType: 'AbandonCenter',
        category: 'reconciliation',
        label: `Leave ${ctrCard.shortLabel} for Next Player`,
        sourceLabel: 'Abandonment',
        effectSummary:
          'Abandon this obstacle: resolved Event goes to Veil; Center remains face-up for the next player to claim freely (skipping their Reading & Prep) or decline.',
        costLabel: 'Forfeits claiming Center',
        allowedTargets: ['Board · Center'],
        enabled: true
      });
    }
  } else if (state.phase === 'AWAITING_HAND_DISCARD') {
    out.push({
      id: 'discard-hand-card',
      commandType: 'DiscardHandCard',
      category: 'hand_discard',
      label: `Discard down to ${state.ruleset.maxHandSize} cards`,
      sourceLabel: 'Hand Limit',
      effectSummary: 'Click a card in your hand to send it to the Veil.',
      costLabel: '1 hand card → Veil',
      allowedTargets: ['Your Hand'],
      enabled: true
    });
  } else if (state.phase === 'READY_TO_END_TURN') {
    out.push({
      id: 'end-turn',
      commandType: 'EndTurn',
      category: 'turn',
      label: 'Finish Turn →',
      sourceLabel: 'Turn Flow',
      effectSummary: 'Complete your turn and pass play to the next player.',
      costLabel: '0 cost',
      allowedTargets: [],
      enabled: true,
      expiryWarning:
        availBonuses.length > 0
          ? `⚠ Finishing Turn ${state.turn} will expire your unused free Reader Bonus (${availBonuses
              .map((b) => `${b.sourceElement ? ELEMENT_META[b.sourceElement].label : 'Element'} Tier 1`)
              .join(', ')})!`
          : undefined
    });
  }

  // Ordinary Elemental Hand Action Descriptor (Pre-Reading OR Revealed-Board!)
  if (
    state.ruleset.features.elementalEffects &&
    canActivateHandElementalInPhase(state.phase, state.ruleset)
  ) {
    const hasBudget = hasRemainingHandElementalAction(activePlayer, state.ruleset);
    const hasCards = activePlayer.hand.length > 0;
    const maxStrength = activePlayer.hand.reduce((mx, id) => {
      const c = state.cards[id];
      return c ? Math.max(mx, computeElementalStrength(activePlayer, c, state.ruleset).strength) : mx;
    }, 0);

    out.push({
      id: 'ordinary-elemental-hand',
      commandType: 'UseElementalEffect',
      category: 'ordinary_elemental',
      label:
        state.phase === 'AWAITING_EVENT_RESOLUTION'
          ? 'Elemental Intervention (Hand Card)'
          : 'Elemental Prep (Hand Card)',
      sourceLabel: 'Ordinary Hand Action (1/turn)',
      effectSummary:
        'Play 1 elemental card from your hand to burn (Fire), shuffle (Air), privately peek & reorder (Earth), or resurface from Veil (Water).',
      costLabel: 'Consumes 1 hand card → Veil',
      strength: maxStrength > 0 ? maxStrength : undefined,
      allowedTargets: ['Shared Board', 'Immediate Future (Deck of Days)', 'The Veil (Water)'],
      enabled: hasBudget && hasCards,
      disabledReason: !hasBudget
        ? 'Ordinary elemental action already used this turn (max 1/turn).'
        : !hasCards
          ? 'No cards in hand.'
          : undefined
    });
  }

  // Free Reader Bonus Descriptors (explicitly explains Tier-1 strength & legal targets!)
  if (canSpendBonus) {
    for (const bonus of availBonuses) {
      if (!bonus.sourceElement) continue;
      const el = bonus.sourceElement;
      const meta = ELEMENT_META[el];
      const targets = getAllowedTargetLabels(el, 1, state);
      out.push({
        id: `reader-bonus-${bonus.id}`,
        commandType: el === 'earth' ? 'StartEarthPeek' : 'UseReaderBonus',
        category: 'reader_bonus',
        label: `★ Free ${meta.suitSymbol} ${meta.label} Tier-1 Reader Bonus`,
        sourceLabel: `Earned Turn ${bonus.earnedOnTurn} · Expires end of Turn ${state.turn}`,
        effectSummary: describeElementEffect(el, 1),
        costLabel: '0 hand cards (free bonus)',
        strength: 1,
        allowedTargets: targets,
        enabled: targets.length > 0,
        disabledReason:
          targets.length === 0
            ? el === 'water'
              ? 'The Veil is currently empty — nothing to resurface.'
              : 'Not enough cards on Board or Deck of Days to target.'
            : undefined,
        expiryWarning: `Expires at the end of Turn ${state.turn} if unused.`
      });
    }
  }

  return out;
}
