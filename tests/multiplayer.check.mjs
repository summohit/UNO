// Integration check against a running server: node tests/multiplayer.check.mjs <port>
import WebSocket from 'ws';
import { canPlayCard } from '../shared/engine.js';
const PORT = process.argv[2] || 4199;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const c = { ws, name, view: null, room: null, seat: null, errors: [], leaks: 0, updates: 0 };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'room_joined' || m.type === 'room_updated' || m.type === 'match_started') { c.room = m.room; c.seat = m.seat; }
    if (m.type === 'action_error') c.errors.push(m.error);
    if (m.type === 'room_error') c.errors.push(m.message);
    if (m.type === 'game_update') {
      c.updates++;
      c.view = m.view;
      m.view.players.forEach((p) => { if (p.seat !== m.view.seat && p.hand) c.leaks++; });
      m.events.forEach((e) => { if (e.type === 'draw' && e.seat !== m.view.seat && e.cards) c.leaks++; });
      if (JSON.stringify(m).includes('drawPile')) c.leaks++;
      const v = m.view;
      if (!v.gameOver && v.currentPlayer === v.seat && !c.paused) {
        const me = v.players[v.seat];
        const card = me.hand.find((x) => canPlayCard(x, v));
        setTimeout(() => {
          if (me.count === 2 && card) send(c, { type: 'action', action: { type: 'uno' } });
          send(c, { type: 'action', action: card ? { type: 'play', cardId: card.id, color: 'red' } : { type: 'draw' } });
        }, 20);
      }
    }
  });
  return new Promise((res) => ws.on('open', () => res(c)));
}
const send = (c, m) => c.ws.send(JSON.stringify(m));

const a = await client('Alice');
const b = await client('Bob');
send(a, { type: 'create_room', roomName: '<img src=x onerror=alert(1)>', playerName: 'Alice' });
await sleep(150);
send(b, { type: 'join_room', roomCode: a.room.code, playerName: 'Bob' });
await sleep(150);
send(b, { type: 'start_match' }); // guest may not start
send(b, { type: 'toggle_bot', seat: 2 }); // guest may not add bots
await sleep(100);
console.log('guest could start?', Boolean(a.view), '| players after guest toggle:', a.room.players.length);
send(a, { type: 'toggle_bot', seat: 2 });
await sleep(100);
send(a, { type: 'start_match' });
await sleep(300);
console.log('started, seats:', a.room.players.map((p) => `${p.seat}:${p.name}${p.isBot ? '(bot)' : ''}`).join(', '));

// Forged seat: Bob tries to act for Alice's seat by sending seat=0.
b.paused = true;
const before = JSON.stringify(a.view.players.map((p) => p.count));
send(b, { type: 'action', seat: 0, action: { type: 'draw' } });
await sleep(150);
console.log('forged seat changed nothing for Alice?', JSON.stringify(a.view.players[0].count) === JSON.stringify(JSON.parse(before)[0]));
b.paused = false;
if (b.view && b.view.currentPlayer === b.seat) send(b, { type: 'action', action: { type: 'draw' } });

// Let it play for a bit, then the host (Alice) disconnects mid-game.
await sleep(4000);
console.log('mid-game: updates A/B', a.updates, b.updates, 'gameOver', b.view.gameOver);
a.ws.close();
await sleep(300);
console.log('after host left: host is Bob?', b.room.hostId !== undefined && b.room.players.find((p) => p.seat === 0)?.isBot, b.room.players.map((p) => `${p.seat}:${p.name}`).join(', '));
for (let i = 0; i < 120 && !b.view.gameOver; i++) await sleep(500);
console.log('game finished after host left?', b.view.gameOver, 'winner seat', b.view.winner, 'points', b.view.points);
console.log('hidden-card leaks seen:', a.leaks + b.leaks);
console.log('errors:', [...new Set([...a.errors, ...b.errors])]);

// Rematch by new host
send(b, { type: 'start_match' });
await sleep(400);
console.log('rematch started for Bob?', b.view && !b.view.gameOver, 'Bob seat', b.seat);
b.ws.close();
process.exit(0);
