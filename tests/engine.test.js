import test from 'node:test';
import assert from 'node:assert/strict';
import { UnoEngine, redactEvents, sanitizeRules } from '../shared/engine.js';

const seats = (n = 4) =>
  [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isBot: true, active: i < n }));

function total(e) {
  return e.drawPile.length + e.discardPile.length + e.players.reduce((s, p) => s + p.hand.length, 0);
}

function playOut(rules, n, maxTurns = 5000) {
  const e = new UnoEngine({ rules, players: seats(n) });
  e.start();
  for (let i = 0; i < maxTurns && !e.gameOver; i++) {
    const seat = e.currentPlayer;
    const res = e.act(seat, e.botAction(seat));
    assert.ok(res.ok, res.error);
    for (const ev of res.events) if (ev.type === 'uno_window') e.act((ev.seat + 1) % 4 === ev.seat ? 0 : [0,1,2,3].find((x) => x !== ev.seat && e.players[x].active), { type: 'catch', target: ev.seat });
    assert.equal(total(e), 108, 'card count must stay 108');
  }
  assert.ok(e.gameOver, "game should finish");
  return e;
}

test('random bot games finish and never lose cards', () => {
  const variants = [
    {},
    { stacking: false },
    { sevenZeroSwap: true, drawUntilPlayable: true },
    { stacking: true, jumpIn: true, startingHandSize: 10, unoPenaltyCards: 4 },
  ];
  for (const rules of variants) {
    for (const n of [2, 3, 4]) {
      for (let k = 0; k < 40; k++) playOut(rules, n);
    }
  }
});

test('rejects acting out of turn and cards not in hand', () => {
  const e = new UnoEngine({ rules: {}, players: seats(4) });
  e.start();
  const other = (e.currentPlayer + 1) % 4;
  assert.equal(e.act(other, { type: 'draw' }).error, 'not_your_turn');
  assert.equal(e.act(e.currentPlayer, { type: 'play', cardId: 9999 }).error, 'card_not_in_hand');
  const foreign = e.players[other].hand[0];
  assert.equal(e.act(e.currentPlayer, { type: 'play', cardId: foreign.id }).error, 'card_not_in_hand');
});

test('views hide other hands and redact draw events', () => {
  const e = new UnoEngine({ rules: {}, players: seats(4) });
  e.start();
  const v = e.viewFor(1);
  assert.ok(Array.isArray(v.players[1].hand));
  for (const s of [0, 2, 3]) assert.equal(v.players[s].hand, null);
  assert.equal(JSON.stringify(v).includes('drawPile'), false);
  const evs = redactEvents([{ type: 'draw', seat: 0, count: 1, cards: [{ id: 1 }] }], 1);
  assert.equal(evs[0].cards, undefined);
});

test('stacked draw refills the pile mid-draw', () => {
  const e = new UnoEngine({ rules: {}, players: seats(2) });
  e.start();
  // Move most of the draw pile onto the discard pile under the top card.
  const top = e.discardPile.pop();
  e.discardPile.push(...e.drawPile.splice(0, e.drawPile.length - 2), top);
  e.pendingDrawStack = 8;
  const seat = e.currentPlayer;
  const before = e.players[seat].hand.length;
  e.act(seat, { type: 'draw' });
  assert.equal(e.players[seat].hand.length, before + 8);
  assert.equal(total(e), 108);
});

test('sanitizeRules drops unknown keys and bad values', () => {
  const r = sanitizeRules({ stacking: 'yes', startingHandSize: 999, evil: 1, unoPenaltyCards: 4 });
  assert.equal(r.stacking, true);
  assert.equal(r.startingHandSize, 7);
  assert.equal(r.unoPenaltyCards, 4);
  assert.equal('evil' in r, false);
});
