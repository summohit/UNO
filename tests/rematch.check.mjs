// Rematch vote + running score through the server: node tests/rematch.check.mjs <port>
import WebSocket from 'ws';
import crypto from 'node:crypto';
import { canPlayCard } from '../shared/engine.js';
const PORT = process.argv[2] || 4199;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failures++; };

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const c = { ws, view: null, room: null, matches: 0, caught: 0 };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.room) c.room = m.room;
    if (m.type === 'match_started') c.matches++;
    if (m.type !== 'game_update') return;
    c.view = m.view;
    m.events.forEach((e) => e.type === 'caught' && c.caught++);
    const v = m.view;
    if (v.gameOver) return;
    if (!v.players.some((p) => p.catchable)) c.lastCatch = null;
    // Catch anyone catchable (tests catching through the server)
    const prey = v.players.find((p) => p.catchable && p.seat !== v.seat);
    const key = prey ? `${prey.seat}:${v.players[prey.seat].count}:${m.events.length}` : null;
    if (prey && c.lastCatch !== prey.seat) c.lastCatch = prey.seat, ws.send(JSON.stringify({ type: 'action', action: { type: 'catch', target: prey.seat } }));
    const myTurnStarted = m.events.some((e) => (e.type === 'turn' && e.seat === v.seat) || e.type === 'start_card' || e.type === 'timeout');
    if (v.currentPlayer === v.seat && myTurnStarted) {
      const card = v.players[v.seat].hand.find((x) => canPlayCard(x, v));
      // Skip calling UNO until the first catch has happened, then play properly.
      if (card && v.players[v.seat].count === 2 && c.caught > 0) ws.send(JSON.stringify({ type: 'action', action: { type: 'uno' } }));
      setTimeout(() => ws.send(JSON.stringify({ type: 'action', action: card ? { type: 'play', cardId: card.id, color: 'red' } : { type: 'draw' } })), 15);
    }
  });
  return new Promise((res) => ws.on('open', () => { ws.send(JSON.stringify({ type: 'hello', token: crypto.randomBytes(16).toString('hex') })); res(c); }));
}
const send = (c, m) => c.ws.send(JSON.stringify(m));

const a = await client();
const b = await client();
send(a, { type: 'create_room', roomName: 'rematch', playerName: 'Alice' });
await sleep(150);
send(b, { type: 'join_room', roomCode: a.room.code, playerName: 'Bob' });
await sleep(150);
send(a, { type: 'start_match' });
for (let i = 0; i < 240 && !(a.view && a.view.gameOver); i++) await sleep(250);
check('first match finished', a.view?.gameOver === true);
const w = a.view.winner;
check('winner got round points on the scoreboard', a.view.scores[w] === a.view.points && a.view.points > 0);
check('someone got caught not calling UNO', a.caught > 0);

send(a, { type: 'rematch_vote' });
await sleep(200);
check('one vote does not start a match', a.matches === 1);
check('room shows Alice ready', a.room.players.find((p) => p.name === 'Alice')?.ready === true);
send(b, { type: 'rematch_vote' });
await sleep(400);
check('both ready starts the next match', a.matches === 2 && b.matches === 2 && a.view && !a.view.gameOver);
check('scores carried over', a.view.scores[w] > 0);
check('ready flags reset', a.room.players.every((p) => !p.ready));
a.ws.close(); b.ws.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
