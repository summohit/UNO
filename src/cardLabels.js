// One place for how each card value is named and shown in the UI.

export const WILD_VALUES = new Set(['wild', 'wild4', 'rev4', 'draw6', 'draw10', 'roulette']);

const SYMBOLS = {
  skip: '⊘',
  reverse: '⇄',
  draw2: '+2',
  wild: 'W',
  wild4: '+4',
  draw4c: '+4',
  skipall: '⊘⊘',
  discardall: '✕',
  rev4: '⇄4',
  draw6: '+6',
  draw10: '+10',
  roulette: '?',
};

const NAMES = {
  skip: 'Skip',
  reverse: 'Reverse',
  draw2: 'Draw +2',
  wild: 'Wild',
  wild4: 'Wild +4',
  draw4c: 'Draw +4',
  skipall: 'Skip Everyone',
  discardall: 'Discard All',
  rev4: 'Reverse +4',
  draw6: 'Wild +6',
  draw10: 'Wild +10',
  roulette: 'Colour Roulette',
};

export const CARD_RULE_TEXT = {
  skip: 'Skip: The next player in turn order loses their turn.',
  reverse: 'Reverse: Flips the play direction (acts as Skip in 2-player).',
  draw2: 'Draw +2: The next player draws 2 cards (or stacks another draw card).',
  wild: 'Wild: Playable on any turn to change the active color.',
  wild4: 'Wild Draw +4: Changes the color and the next player draws 4 cards.',
  draw4c: 'Draw +4 (Chaos): The next player draws 4, or stacks a +4 or bigger.',
  skipall: 'Skip Everyone (Chaos): Every other player is skipped, so you play again.',
  discardall: 'Discard All (Chaos): Also throws away every other card of this color in your hand.',
  rev4: 'Reverse +4 (Chaos): Flips the direction, then that next player draws 4 or stacks.',
  draw6: 'Wild +6 (Chaos): Pick a color; the next player draws 6 or stacks a +6/+10.',
  draw10: 'Wild +10 (Chaos): Pick a color; the next player draws 10 or stacks a +10.',
  roulette: 'Colour Roulette (Chaos): Pick a color; the next player flips cards until they hit it, keeps them all, and is skipped.',
};

export function cardSymbol(value) {
  return SYMBOLS[value] ?? String(value);
}

/** e.g. "Red 7", "Blue Skip Everyone", "Wild +10 → Green" */
export function cardFullName(card, activeColorLabel, colorLabel) {
  const name = NAMES[card.value] ?? card.value;
  if (WILD_VALUES.has(card.value)) return `${name} → ${activeColorLabel}`;
  return `${colorLabel} ${name}`;
}

export function isActionCard(card) {
  return card.color === 'wild' || !/^\d$/.test(card.value);
}
