// Reconnect / turn-timer check. Start the server with short timers first:
//   RECONNECT_GRACE_MS=1500 TURN_MS=2500 PORT=4199 node server.js
//   node tests/reconnect.check.mjs 4199
import WebSocket from 'ws';
import crypto from 'node:crypto';
const PORT = process.argv[2] || 4199;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failures++; };

function connect(token, log = []) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const c = { ws, token, log, view: null, room: null, seat: null, you: null, raw: [] };
  ws.on('message', (raw) => {
    c.raw.push(String(raw));
    const m = JSON.parse(raw);
    log.push(m.type);
    if (m.room) { c.room = m.room; c.seat = m.seat; c.you = m.you; }
    if (m.type === 'game_update') { c.view = m.view; c.events = (c.events || []).concat(m.events); }
    if (m.type === 'no_room') c.noRoom = true;
  });
  return new Promise((res) => ws.on('open', () => { ws.send(JSON.stringify({ type: 'hello', token })); res(c); }));
}
const send = (c, m) => c.ws.send(JSON.stringify(m));
const tok = () => crypto.randomBytes(16).toString('hex');

const tA = tok(), tB = tok();
let a = await connect(tA);
let b = await connect(tB);
send(a, { type: 'create_room', roomName: 'recon', playerName: 'Alice' });
await sleep(150);
const code = a.room.code;
send(b, { type: 'join_room', roomCode: code, playerName: 'Bob' });
await sleep(150);
check('no tokens leak in room data', !a.raw.concat(b.raw).some((r) => r.includes(tA) || r.includes(tB)));
send(a, { type: 'start_match' });
await sleep(400);
check('match started for both', Boolean(a.view && b.view));
const bHandBefore = JSON.stringify(b.view.players[b.seat].hand.map((c) => c.id).sort());

// 1. Quick reconnect within the grace period (e.g. page refresh)
b.ws.close();
await sleep(300);
check('others see Bob as away', a.view.players[b.seat].away === true);
b = await connect(tB);
await sleep(300);
check('Bob back in same seat', b.seat === 1 && b.room?.code === code);
check('Bob got his same hand back', b.view && JSON.stringify(b.view.players[1].hand.map((c) => c.id).sort()) === bHandBefore
  || (b.view && b.view.players[1].count !== JSON.parse(bHandBefore).length)); // hand may change if a timer fired
check('Bob not marked away after return', a.view.players[1].away === false);

// 2. Turn timer: whoever's turn it is does nothing; after TURN_MS they auto-draw.
const turnSeat = a.view.currentPlayer;
const cur = turnSeat === a.seat ? a : b;
const before = cur.view.players[turnSeat].count;
cur.events = [];
await sleep(3200);
check('turn timer fired (timeout event)', cur.events.some((e) => e.type === 'timeout' && e.seat === turnSeat));
check('timed-out player auto-drew', cur.events.some((e) => e.type === 'draw' && e.seat === turnSeat));
check('view carries turnMsLeft', typeof a.view.turnMsLeft === 'number' || a.view.gameOver);

// 3. Long disconnect: bot covers the seat, then Bob takes it back.
b.ws.close();
await sleep(2200);
check('bot covers Bob after grace', a.room.players.find((p) => p.seat === 1)?.isBot === true && a.view.players[1].isBot === true);
const aEventsBefore = (a.events || []).length;
await sleep(3000);
check('game keeps moving while Bob is away', (a.events || []).length > aEventsBefore || a.view.gameOver);
b = await connect(tB);
await sleep(400);
check('Bob reclaimed his seat from the bot', b.seat === 1 && a.view.players[1].isBot === false && a.room.players.find((p) => p.seat === 1)?.isBot === false);
check('Bob sees his own hand only', b.view.players[1].hand && b.view.players[0].hand === null);

// 4. Host disconnects past grace: Bob becomes host.
a.ws.close();
await sleep(2200);
check('host handed to Bob', b.room.hostId === b.you);

// 5. Explicit leave releases the seat; a later hello finds no room.
send(b, { type: 'leave_room' });
await sleep(200);
const b2 = await connect(tB);
await sleep(200);
check('after leaving, hello gets no_room', b2.log.includes('no_room'));

// 6. Room with no humans left is deleted (Alice's seat is bot-covered; her token can still return
//    until the empty-room timer; Bob left for good). Alice returns, leaves -> room gone.
a = await connect(tA);
await sleep(300);
check('Alice can still return to her seat', a.room?.code === code);
send(a, { type: 'leave_room' });
await sleep(200);
const c = await connect(tok());
send(c, { type: 'join_room', roomCode: code, playerName: 'Carl' });
await sleep(200);
check('room deleted after everyone left', c.log.includes('room_error'));

[a, b, b2, c].forEach((x) => x.ws.close());
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
