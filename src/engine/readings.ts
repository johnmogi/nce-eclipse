import { isEligibleEvolution } from './evolution.js';
import { makeEvent } from './event-helpers.js';
import type {
  Card,
  GameEvent,
  GamePhase,
  PendingReaderBonus,
  PlayerState,
  ReadingHints,
  ReadingRecord,
  Ruleset
} from './types.js';

export function isCardObjectivelyHelpful(
  recipient: PlayerState,
  card: Card,
  ruleset: Ruleset
): boolean {
  if (isEligibleEvolution(recipient.lineage, card, ruleset)) return true;
  if (card.family !== 'classic-number' || !card.color || !card.element) return false;
  if (card.rank <= recipient.lineage.rank) return false;
  if (ruleset.allowedEvolutionColors === 'same-element') {
    return card.element === recipient.lineage.element;
  }
  if (ruleset.allowedEvolutionColors === 'same-color') {
    return card.color === recipient.lineage.color;
  }
  return true;
}

export function computeReadingHints(
  recipient: PlayerState,
  centerCard: Card,
  ruleset: Ruleset
): ReadingHints | null {
  if (!ruleset.readingTierHintsEnabled) return null;
  if (recipient.lineage.rank <= 3) return null;
  if (recipient.lineage.rank <= 6) {
    return { color: centerCard.color };
  }
  return { color: centerCard.color, tier: centerCard.tier };
}

export function createReadingForTurn(
  players: readonly PlayerState[],
  activePlayerIndex: number,
  centerCard: Card,
  turn: number,
  round: number,
  ruleset: Ruleset
): ReadingRecord {
  const recipient = players[activePlayerIndex]!;
  const reader = players[(activePlayerIndex + 1) % players.length]!;
  return {
    turn,
    round,
    readerId: reader.id,
    recipientId: recipient.id,
    centerCardId: centerCard.id,
    advice: null,
    hints: null,
    playerAction: null,
    adviceFollowed: null,
    objectiveHelpful: isCardObjectivelyHelpful(recipient, centerCard, ruleset),
    adviceTruthful: null,
    resolution: 'pending',
    readerReward: 'pending',
    readerRewardReason: null
  };
}

export function finalizeReadingReward(params: {
  reading: ReadingRecord;
  resolution: 'claimed' | 'discarded' | 'abandoned';
  sourceCard: Card;
  activePlayerId: string;
  players: PlayerState[];
  readingHistory: ReadingRecord[];
  newEvents: GameEvent[];
  turn: number;
  round: number;
  phase: GamePhase;
  ruleset: Ruleset;
  nextSeq: () => number;
}): void {
  const {
    reading,
    resolution,
    sourceCard,
    activePlayerId,
    players,
    readingHistory,
    newEvents,
    turn,
    round,
    phase,
    ruleset,
    nextSeq
  } = params;

  const readerIdx = players.findIndex((p) => p.id === reading.readerId);
  const reader = readerIdx >= 0 ? players[readerIdx]! : null;

  let grant = false;
  let trigger: 'good_claimed' | 'bad_discarded' | 'good_abandoned' | null = null;
  let reason = 'advice_not_followed';

  if (reading.adviceFollowed) {
    if (reading.advice === 'bad' && resolution === 'discarded') {
      grant = true;
      trigger = 'bad_discarded';
      reason = 'followed_bad_advice_discarded';
    } else if (reading.advice === 'good' && resolution === 'claimed') {
      grant = true;
      trigger = 'good_claimed';
      reason = 'followed_good_advice_claimed';
    } else if (reading.advice === 'good' && resolution === 'abandoned') {
      if (ruleset.readerBonusOnAbandon) {
        grant = true;
        trigger = 'good_abandoned';
        reason = 'followed_good_advice_abandoned_override';
      } else {
        grant = false;
        reason = 'abandoned_before_claim';
      }
    }
  }

  const completedRecord: ReadingRecord = {
    ...reading,
    resolution,
    readerReward: grant ? 'granted' : 'withheld',
    readerRewardReason: reason
  };
  readingHistory.push(completedRecord);

  if (grant && reader && trigger) {
    const initialStatus =
      ruleset.readerBonusPolicy === 'record_only' ? 'pending_spec' : 'available';
    const bonus: PendingReaderBonus = {
      id: `rb-t${turn}-${reader.pendingReaderBonuses.length + 1}`,
      earnedOnTurn: turn,
      fromPlayerId: activePlayerId,
      sourceCardId: sourceCard.id,
      sourceElement: sourceCard.element,
      trigger,
      status: initialStatus
    };
    players[readerIdx] = {
      ...reader,
      pendingReaderBonuses: [...reader.pendingReaderBonuses, bonus]
    };
    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
        actor: reader.id,
        type: 'ReaderRewardGranted',
        affectedCardIds: [sourceCard.id],
        source: 'reading-resolution',
        reason,
        visibility: 'public',
        summary:
          initialStatus === 'available'
            ? `${reader.name} earned a Reader bonus (${sourceCard.element ?? 'neutral'} from ${sourceCard.label}, usable next turn; ${reason}).`
            : `${reader.name} earned a pending Reader elemental bonus (${sourceCard.element ?? 'neutral'} from ${sourceCard.label}; ${reason}).`,
        payload: { ...bonus, adviceTruthful: completedRecord.adviceTruthful }
      })
    );
  } else if (reader) {
    newEvents.push(
      makeEvent(nextSeq(), turn, round, phase, ruleset.version, {
        actor: reader.id,
        type: 'ReaderRewardWithheld',
        affectedCardIds: [sourceCard.id],
        source: 'reading-resolution',
        reason,
        visibility: 'public',
        summary: `${reader.name}'s Reader bonus was withheld (${reason}).`,
        payload: {
          readerId: reader.id,
          advice: completedRecord.advice,
          playerAction: completedRecord.playerAction,
          resolution,
          adviceFollowed: completedRecord.adviceFollowed,
          adviceTruthful: completedRecord.adviceTruthful
        }
      })
    );
  }
}
