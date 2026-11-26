import type { Card, CardTier, Color, Element, Ruleset } from './types.js';

export interface ElementMeta {
  readonly element: Element;
  readonly label: string;
  readonly color: Color;
  readonly classicSuit: string;
  readonly suitSymbol: string;
  readonly beats: Element;
  readonly vulnerableTo: Element;
}

export const ELEMENTS: readonly Element[] = ['air', 'fire', 'water', 'earth'] as const;

export const ELEMENT_META: Readonly<Record<Element, ElementMeta>> = {
  air: {
    element: 'air',
    label: 'Air',
    color: 'black',
    classicSuit: 'Spades',
    suitSymbol: '♠',
    beats: 'water',
    vulnerableTo: 'earth'
  },
  fire: {
    element: 'fire',
    label: 'Fire',
    color: 'black',
    classicSuit: 'Clubs',
    suitSymbol: '♣',
    beats: 'earth',
    vulnerableTo: 'water'
  },
  water: {
    element: 'water',
    label: 'Water',
    color: 'red',
    classicSuit: 'Hearts',
    suitSymbol: '♥',
    beats: 'fire',
    vulnerableTo: 'air'
  },
  earth: {
    element: 'earth',
    label: 'Earth',
    color: 'red',
    classicSuit: 'Diamonds',
    suitSymbol: '♦',
    beats: 'air',
    vulnerableTo: 'fire'
  }
};

/** Agreed VP scale: 1–3 -> 1, 4–6 -> 2, 7–9 -> 3. */
export function rankToVP(rank: number): 0 | 1 | 2 | 3 {
  if (rank >= 1 && rank <= 3) return 1;
  if (rank >= 4 && rank <= 6) return 2;
  if (rank >= 7 && rank <= 9) return 3;
  return 0;
}

export function rankToTier(rank: number): CardTier {
  if (rank >= 1 && rank <= 3) return 'low';
  if (rank >= 4 && rank <= 6) return 'med';
  if (rank >= 7 && rank <= 9) return 'high';
  return 'court';
}

export function rankToName(rank: number): string {
  switch (rank) {
    case 1:
      return 'Ace';
    case 11:
      return 'Prince';
    case 12:
      return 'Queen';
    case 13:
      return 'King';
    default:
      return String(rank);
  }
}

export function rankToShort(rank: number): string {
  switch (rank) {
    case 1:
      return 'A';
    case 11:
      return 'J';
    case 12:
      return 'Q';
    case 13:
      return 'K';
    default:
      return String(rank);
  }
}

/** Agreed four-element advantage cycle: Water > Fire > Earth > Air > Water. */
export function elementBeats(attacker: Element, defender: Element): boolean {
  return ELEMENT_META[attacker].beats === defender;
}

export function getElementAdvantage(attacker: Element, defender: Element): -1 | 0 | 1 {
  if (ELEMENT_META[attacker].beats === defender) return 1;
  if (ELEMENT_META[defender].beats === attacker) return -1;
  return 0;
}

export function capEffectiveVP(rawVP: number, maxEffectiveVP: number): {
  rawVP: number;
  effectiveVP: number;
  wasCapped: boolean;
} {
  const effectiveVP = Math.min(rawVP, maxEffectiveVP);
  return { rawVP, effectiveVP, wasCapped: rawVP > maxEffectiveVP };
}

/** Build the card catalog strictly matching the active ruleset. */
export function buildCardCatalog(ruleset: Ruleset): Record<string, Card> {
  const catalog: Record<string, Card> = {};

  for (const element of ELEMENTS) {
    const meta = ELEMENT_META[element];
    for (let rank = 1; rank <= ruleset.maxMinorRank; rank++) {
      const id = `classic-${element}-${String(rank).padStart(2, '0')}`;
      catalog[id] = {
        id,
        family: 'classic-number',
        rank,
        label: `${rankToName(rank)} of ${meta.label}`,
        shortLabel: `${rankToShort(rank)}${meta.suitSymbol}`,
        element,
        color: meta.color,
        suitSymbol: meta.suitSymbol,
        vp: rankToVP(rank),
        tier: rankToTier(rank),
        backGroup: 'minor'
      };
    }

    if (ruleset.includeCourts) {
      const courts: readonly { rank: number; name: string; bonus: 1 | 2 | 3 }[] = [
        { rank: 11, name: 'prince', bonus: 1 },
        { rank: 12, name: 'queen', bonus: 2 },
        { rank: 13, name: 'king', bonus: 3 }
      ];
      for (const court of courts) {
        const id = `classic-${element}-${court.name}`;
        catalog[id] = {
          id,
          family: 'classic-court',
          rank: court.rank,
          label: `${rankToName(court.rank)} of ${meta.label}`,
          shortLabel: `${rankToShort(court.rank)}${meta.suitSymbol}`,
          element,
          color: meta.color,
          suitSymbol: meta.suitSymbol,
          vp: 0,
          tier: 'court',
          backGroup: 'major',
          courtBonus: court.bonus
        };
      }
    }
  }

  return catalog;
}
