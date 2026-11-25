import test from 'node:test';
import assert from 'node:assert/strict';
import { UnoEngine, buildDeck, canPlayCard, effectiveRules } from '../shared/engine.js';

const seats = (n = 4) => [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isBot: true, active: i < n }));
const total = (e) => e.drawPile.length + e.discardPile.length + e.players.reduce((s, p) => s + p.hand.length, 0);
const chaos = (n = 4, extra = {}) => {
  const e = new UnoEngine({ rules: { mode: 'chaos', ...extra }, players: seats(n) });
  e.start();
  return e;
};
const card = (id, color, value) => ({ id, color, value });

test('chaos deck has 140 cards and no plain wilds', () => {
  const d = buildDeck(Math.random, 'chaos');
  assert.equal(d.length, 140);
  assert.ok(!d.some((c) => c.value === 'wild' || c.value === 'wild4'));
  for (const v of ['draw4c', 'skipall', 'discardall', 'rev4', 'draw6', 'draw10', 'roulette']) {
    assert.ok(d.some((c) => c.value === v), v);
  }
});

test('chaos forces stacking, draw-until-playable, 7-0 and elimination', () => {
  const r = effectiveRules({ mode: 'chaos', stacking: false, drawUntilPlayable: false, sevenZeroSwap: false });
  assert.deepEqual([r.stacking, r.drawUntilPlayable, r.sevenZeroSwap, r.eliminationAt], [true, true, true, 25]);
});

test('random chaos bot games finish and never lose cards', () => {
  let eliminations = 0;
  for (const n of [2, 3, 4]) {
    for (let k = 0; k < 60; k++) {
      const e = chaos(n);
      for (let i = 0; i < 6000 && !e.gameOver; i++) {
        const s = e.currentPlayer;
        const res = e.act(s, e.botAction(s));
        assert.ok(res.ok, res.error);
        for (const ev of res.events) {
          if (ev.type === 'uno_window') e.penalizeMissedUno(ev.seat);
          if (ev.type === 'eliminated') eliminations++;
        }
        assert.equal(total(e), 140);
        assert.ok(e.players.every((p) => !p.active || p.hand.length < 25 || e.gameOver));
      }
      assert.ok(e.gameOver);
      assert.ok(e.players[e.winner].active);
    }
  }
  assert.ok(eliminations > 0, 'some games should eliminate a player');
});

test('stack only with an equal or bigger draw card', () => {
  const state = { activeColor: 'red', activeValue: 'draw6', pendingDrawStack: 6, rules: { mode: 'chaos' } };
  assert.equal(canPlayCard(card(1, 'blue', 'draw4c'), state), false);
  assert.equal(canPlayCard(card(2, 'wild', 'draw6'), state), true);
  assert.equal(canPlayCard(card(3, 'wild', 'draw10'), state), true);
  assert.equal(canPlayCard(card(4, 'red', '5'), state), false);
});

function rig(e, seat, hand) {
  e.players[seat].hand = hand;
  e.currentPlayer = seat;
  e.activeColor = 'red';
  e.activeValue = '5';
  e.pendingDrawStack = 0;
}

test('skip everyone gives the same player another turn', () => {
  const e = chaos(4);
  rig(e, 0, [card(901, 'red', 'skipall'), card(902, 'blue', '1')]);
  e.act(0, { type: 'play', cardId: 901 });
  assert.equal(e.currentPlayer, 0);
});

test('discard all throws away every card of that colour', () => {
  const e = chaos(4);
  rig(e, 0, [card(901, 'red', 'discardall'), card(902, 'red', '1'), card(903, 'red', '9'), card(904, 'blue', '1')]);
  const res = e.act(0, { type: 'play', cardId: 901 });
  assert.deepEqual(e.players[0].hand.map((c) => c.id), [904]);
  assert.ok(res.events.some((ev) => ev.type === 'discard_all' && ev.count === 2));
  assert.equal(e.discardPile.at(-1).id, 901, 'played card stays on top');
});

test('discard all can win the game', () => {
  const e = chaos(4);
  rig(e, 0, [card(901, 'red', 'discardall'), card(902, 'red', '1')]);
  e.act(0, { type: 'play', cardId: 901 });
  assert.equal(e.gameOver, true);
  assert.equal(e.winner, 0);
});

test('colour roulette: next player draws until the colour and is skipped', () => {
  const e = chaos(4);
  rig(e, 0, [card(901, 'wild', 'roulette'), card(902, 'blue', '1')]);
  e.drawPile.push(card(990, 'green', '2'), card(991, 'yellow', '3'), card(992, 'blue', '4'));
  // drawPile pops from the end: blue 4 comes first
  const before = e.players[1].hand.length;
  const res = e.act(0, { type: 'play', cardId: 901, color: 'yellow' });
  assert.equal(e.players[1].hand.length, before + 2); // blue 4, then yellow 3
  assert.ok(res.events.some((ev) => ev.type === 'roulette' && ev.count === 2));
  assert.equal(e.currentPlayer, 2);
});

test('reverse +4 reverses and starts a stack', () => {
  const e = chaos(4);
  rig(e, 0, [card(901, 'wild', 'rev4'), card(902, 'blue', '1')]);
  e.act(0, { type: 'play', cardId: 901, color: 'green' });
  assert.equal(e.direction, -1);
  assert.equal(e.pendingDrawStack, 4);
  assert.equal(e.currentPlayer, 3);
});

test('reaching 25 cards eliminates; last player standing wins', () => {
  const e = chaos(2);
  rig(e, 0, [card(901, 'red', '1'), card(902, 'blue', '2')]);
  e.players[1].hand = Array.from({ length: 20 }, (_, i) => card(800 + i, 'green', '1'));
  e.currentPlayer = 1;
  e.pendingDrawStack = 10;
  e.activeValue = 'draw10';
  const res = e.act(1, { type: 'draw' });
  assert.ok(res.events.some((ev) => ev.type === 'eliminated' && ev.seat === 1));
  assert.equal(e.players[1].hand.length, 0);
  assert.equal(e.gameOver, true);
  assert.equal(e.winner, 0);
});

test('player chooses the 7-swap target', () => {
  const e = new UnoEngine({ rules: { sevenZeroSwap: true }, players: seats(4) });
  e.start();
  rig(e, 0, [card(901, 'red', '7'), card(902, 'blue', '1')]);
  const target2Hand = e.players[2].hand.map((c) => c.id);
  e.act(0, { type: 'play', cardId: 901, target: 2 });
  assert.deepEqual(e.players[0].hand.map((c) => c.id), target2Hand);
  assert.deepEqual(e.players[2].hand.map((c) => c.id), [902]);
});
