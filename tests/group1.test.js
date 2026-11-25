import test from 'node:test';
import assert from 'node:assert/strict';
import { UnoEngine } from '../shared/engine.js';

const seats = (bots = [false, true, true, true]) =>
  [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isBot: bots[i], active: true }));
const card = (id, color, value) => ({ id, color, value });

function oneCardLeft(opts = {}) {
  const e = new UnoEngine({ rules: {}, players: seats(opts.bots), ...opts });
  e.start();
  e.players[0].hand = [card(901, 'red', '5'), card(902, 'blue', '7')];
  e.currentPlayer = 0;
  e.activeColor = 'red';
  e.activeValue = '1';
  e.pendingDrawStack = 0;
  return e;
}

test('a player who forgets UNO can be caught out of turn', () => {
  const e = oneCardLeft();
  const res = e.act(0, { type: 'play', cardId: 901 });
  assert.ok(res.events.some((ev) => ev.type === 'uno_window' && ev.seat === 0));
  assert.equal(e.viewFor(2).players[0].catchable, true);
  const c = e.act(2, { type: 'catch', target: 0 }); // seat 2 is not the current player
  assert.ok(c.ok);
  assert.ok(c.events.some((ev) => ev.type === 'caught' && ev.seat === 0 && ev.by === 2));
  assert.equal(e.players[0].hand.length, 3);
  assert.equal(e.act(3, { type: 'catch', target: 0 }).error, 'nothing_to_catch');
});

test('calling UNO first makes you safe', () => {
  const e = oneCardLeft();
  e.act(0, { type: 'uno' });
  e.act(0, { type: 'play', cardId: 901 });
  assert.equal(e.act(1, { type: 'catch', target: 0 }).error, 'nothing_to_catch');
});

test('calling UNO late, before being caught, also makes you safe', () => {
  const e = oneCardLeft();
  e.act(0, { type: 'play', cardId: 901 });
  assert.ok(e.act(0, { type: 'uno' }).ok);
  assert.equal(e.act(1, { type: 'catch', target: 0 }).error, 'nothing_to_catch');
});

test('cannot catch yourself or someone with more cards', () => {
  const e = oneCardLeft();
  assert.equal(e.act(1, { type: 'catch', target: 0 }).error, 'nothing_to_catch'); // still 2 cards
  e.act(0, { type: 'play', cardId: 901 });
  assert.equal(e.act(0, { type: 'catch', target: 0 }).error, 'nothing_to_catch');
});

test('bots sometimes forget UNO and can be caught', () => {
  const forgets = oneCardLeft({ bots: [true, true, true, true], botForgetChance: 1 });
  const r1 = forgets.act(0, { type: 'play', cardId: 901 });
  assert.ok(r1.events.some((ev) => ev.type === 'uno_window'));
  assert.ok(forgets.act(1, { type: 'catch', target: 0 }).ok);

  const remembers = oneCardLeft({ bots: [true, true, true, true], botForgetChance: 0 });
  const r2 = remembers.act(0, { type: 'play', cardId: 901 });
  assert.ok(r2.events.some((ev) => ev.type === 'uno'));
});

test('running score adds up across rounds and crowns a champion at 500', () => {
  const scores = [0, 0, 0, 0];
  const e1 = oneCardLeft({ scores });
  e1.players[0].hand = [card(901, 'red', '5')];
  e1.players[1].hand = [card(950, 'wild', 'wild4'), card(951, 'blue', '9')]; // 50 + 9
  const r = e1.act(0, { type: 'play', cardId: 901 });
  const win = r.events.find((ev) => ev.type === 'win');
  assert.ok(win.points >= 59);
  assert.equal(scores[0], win.points);
  assert.equal(win.champion, null);

  scores[0] = 490;
  const e2 = oneCardLeft({ scores });
  e2.players[0].hand = [card(901, 'red', '5')];
  const r2 = e2.act(0, { type: 'play', cardId: 901 });
  assert.equal(r2.events.find((ev) => ev.type === 'win').champion, 0);
  assert.equal(e2.viewFor(1).champion, 0);
  assert.ok(e2.viewFor(1).scores[0] >= 500);
});
