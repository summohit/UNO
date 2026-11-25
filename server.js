import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameHost } from './shared/host.js';
import { sanitizeRules } from './shared/engine.js';

const PORT = process.env.PORT || 4173;
const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 30_000;
const TURN_MS = Number(process.env.TURN_MS) || 30_000;
const EMPTY_ROOM_MS = Number(process.env.EMPTY_ROOM_MS) || 5 * 60_000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Only these paths are served; server code, package files, etc. are not.
const PUBLIC_PREFIXES = ['/src/', '/shared/', '/node_modules/three/build/', '/node_modules/gsap/'];

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  if (pathname === '/') pathname = '/index.html';

  const allowed = pathname === '/index.html' || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  const safePath = path.normalize(path.join(ROOT_DIR, pathname));
  if (!allowed || !safePath.startsWith(ROOT_DIR + path.sep)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(safePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(safePath).pipe(res);
  });
});

// ---------------------------------------------------------------------------
// Rooms
// room = { code, roomName, hostId, rules, started, seats: [seat|null x4], game, emptyTimer }
// seat = {
//   id        public id, shown to other players (hostId refers to it)
//   token     private reconnect token, only ever known by that player's browser
//   name, isBot,
//   away      true while a human seat is disconnected (bot may be covering)
//   ws, awayTimer
// }
// ---------------------------------------------------------------------------
const rooms = new Map();
const tokenToRoom = new Map(); // token -> room code
const BOT_NAMES = ['Ace (Bot)', 'Nova (Bot)', 'Apex (Bot)', 'Blaze (Bot)'];

const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const newId = () => crypto.randomBytes(6).toString('hex');
const isValidToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(t);

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return rooms.has(code) ? generateRoomCode() : code;
}

function send(ws, payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
}

const isHuman = (s) => s && s.token;
const isConnected = (s) => isHuman(s) && s.ws && s.ws.readyState === 1;

function publicRoom(room) {
  const players = [];
  room.seats.forEach((s, seat) => {
    if (!s) return;
    players.push({
      id: s.id,
      name: s.name,
      seat,
      isBot: s.isBot,
      away: Boolean(s.away),
      connected: s.isBot ? !s.away : isConnected(s),
    });
  });
  return { code: room.code, roomName: room.roomName, hostId: room.hostId, started: room.started, rules: room.rules, players };
}

function sendRoom(room, s, seat, type) {
  send(s.ws, { type, room: publicRoom(room), seat, you: s.id });
}

function broadcastRoom(room) {
  room.seats.forEach((s, seat) => {
    if (isConnected(s)) sendRoom(room, s, seat, 'room_updated');
  });
}

function seatOf(room, ws) {
  return room.seats.findIndex((s) => s && !s.isBot && s.token === ws.token);
}

function deleteRoom(room) {
  if (room.game) room.game.stop();
  clearTimeout(room.emptyTimer);
  room.seats.forEach((s) => {
    if (s) clearTimeout(s.awayTimer);
    if (isHuman(s)) tokenToRoom.delete(s.token);
  });
  rooms.delete(room.code);
}

/** Pick a connected human as host if the current host is gone; delete rooms nobody is in. */
function maintainRoom(room) {
  const connected = room.seats.filter(isConnected);
  const humans = room.seats.filter(isHuman);
  if (humans.length === 0) {
    deleteRoom(room);
    return false;
  }
  const host = room.seats.find((s) => s && s.id === room.hostId);
  if ((!host || !isConnected(host)) && connected.length > 0) {
    // Hand over only once the old host is really gone (grace expired or left).
    if (!host || !isHuman(host) || host.isBot) room.hostId = connected[0].id;
  }
  clearTimeout(room.emptyTimer);
  room.emptyTimer = null;
  if (connected.length === 0) {
    room.emptyTimer = setTimeout(() => rooms.has(room.code) && deleteRoom(room), EMPTY_ROOM_MS);
  }
  return true;
}

function gameRunning(room) {
  return Boolean(room.game && !room.game.engine.gameOver);
}

function startGame(room) {
  if (room.game) room.game.stop();
  room.started = true;
  const game = new GameHost({
    rules: room.rules,
    turnMs: TURN_MS,
    players: room.seats.map((s, seat) => ({
      name: s ? s.name : `Seat ${seat + 1}`,
      isBot: Boolean(s?.isBot),
      active: Boolean(s),
    })),
    send: (seat, payload) => {
      const s = room.seats[seat];
      if (isConnected(s)) send(s.ws, payload);
    },
  });
  room.game = game;
  room.seats.forEach((s, seat) => {
    if (isConnected(s)) sendRoom(room, s, seat, 'match_started');
  });
  game.start();
}

/** Remove a human from their seat for good (explicit leave or grace expired). */
function vacateSeat(room, seat) {
  const s = room.seats[seat];
  if (!s) return;
  clearTimeout(s.awayTimer);
  if (isHuman(s)) tokenToRoom.delete(s.token);

  if (gameRunning(room) && room.game.engine.players[seat].active) {
    const botName = `${s.name} (Bot)`.slice(0, 24);
    room.seats[seat] = { id: newId(), token: null, name: botName, isBot: true, away: false, ws: null };
    room.game.setBot(seat, true, botName);
  } else {
    room.seats[seat] = null;
  }
}

/** Connection dropped: keep the seat for a while so the player can come back. */
function markAway(room, seat) {
  const s = room.seats[seat];
  s.ws = null;
  s.away = true;
  if (gameRunning(room)) room.game.setAway(seat, true);
  clearTimeout(s.awayTimer);
  s.awayTimer = setTimeout(() => {
    if (!rooms.has(room.code) || room.seats[seat] !== s || !s.away) return;
    if (gameRunning(room)) {
      // A bot plays for them until they return; the seat stays theirs.
      s.isBot = true;
      room.game.setBot(seat, true);
    } else {
      vacateSeat(room, seat);
    }
    if (maintainRoom(room)) broadcastRoom(room);
  }, RECONNECT_GRACE_MS);
  if (maintainRoom(room)) broadcastRoom(room);
}

/** A returning player gets their seat back (and takes over from the bot). */
function reattach(ws, room, seat) {
  const s = room.seats[seat];
  clearTimeout(s.awayTimer);
  if (s.ws && s.ws !== ws) {
    send(s.ws, { type: 'session_replaced' });
    s.ws.roomCode = null;
  }
  s.ws = ws;
  s.away = false;
  ws.roomCode = room.code;
  const wasBot = s.isBot;
  s.isBot = false;

  maintainRoom(room);
  sendRoom(room, s, seat, 'room_joined');
  if (room.game && room.started) {
    if (gameRunning(room)) {
      room.game.engine.players[seat].away = false;
      if (wasBot) room.game.setBot(seat, false, s.name); // publishes to everyone
      else room.game.publish([{ type: 'player_back', seat }]);
    } else {
      room.game.sendView(seat);
    }
  }
  broadcastRoom(room);
}

function leaveRoom(ws) {
  const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
  ws.roomCode = null;
  if (!room) return;
  const seat = seatOf(room, ws);
  if (seat === -1) return;
  vacateSeat(room, seat);
  if (maintainRoom(room)) broadcastRoom(room);
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

function broadcastOnlineCount() {
  const msg = JSON.stringify({ type: 'online_count', count: wss.clients.size });
  wss.clients.forEach((c) => c.readyState === 1 && c.send(msg));
}

function newHumanSeat(ws, name) {
  return { id: newId(), token: ws.token, name, isBot: false, away: false, ws, awayTimer: null };
}

const handlers = {
  // Sent by the client right after connecting. Restores the player's seat if they had one.
  hello(ws, data) {
    if (!isValidToken(data.token)) return;
    ws.token = data.token;
    const room = rooms.get(tokenToRoom.get(ws.token));
    if (!room) {
      send(ws, { type: 'no_room' });
      return;
    }
    const seat = room.seats.findIndex((s) => isHuman(s) && s.token === ws.token);
    if (seat === -1) {
      tokenToRoom.delete(ws.token);
      send(ws, { type: 'no_room' });
      return;
    }
    reattach(ws, room, seat);
  },

  create_room(ws, data) {
    leaveRoom(ws);
    const room = {
      code: generateRoomCode(),
      roomName: cleanText(data.roomName, 24) || 'Card Arena Room',
      hostId: null,
      rules: sanitizeRules(data.rules),
      started: false,
      seats: [newHumanSeat(ws, cleanText(data.playerName, 18) || 'Host'), null, null, null],
      game: null,
      emptyTimer: null,
    };
    room.hostId = room.seats[0].id;
    rooms.set(room.code, room);
    tokenToRoom.set(ws.token, room.code);
    ws.roomCode = room.code;
    sendRoom(room, room.seats[0], 0, 'room_joined');
  },

  join_room(ws, data) {
    const query = cleanText(data.roomCode, 24);
    let room = rooms.get(query.toUpperCase());
    if (!room) {
      for (const r of rooms.values()) {
        if (r.roomName.toLowerCase() === query.toLowerCase()) {
          room = r;
          break;
        }
      }
    }
    if (!room) {
      send(ws, { type: 'room_error', message: `Room "${query}" was not found. Check the 6-character code.` });
      return;
    }

    // Already seated here (e.g. second tab or reconnect): just reattach.
    const mine = room.seats.findIndex((s) => isHuman(s) && s.token === ws.token);
    if (mine !== -1) {
      reattach(ws, room, mine);
      return;
    }
    leaveRoom(ws);

    const name = cleanText(data.playerName, 18) || 'Player';
    // Before the match: any free seat. During a match: a seat a bot is playing
    // (but not one being kept for a disconnected player).
    let seat = room.started ? -1 : room.seats.findIndex((s) => s === null);
    if (seat === -1) {
      seat = room.seats.findIndex(
        (s, i) => s && s.isBot && !isHuman(s) && (!gameRunning(room) || room.game.engine.players[i].active)
      );
    }
    if (seat === -1) {
      send(ws, { type: 'room_error', message: `Room "${room.roomName}" is full.` });
      return;
    }

    room.seats[seat] = newHumanSeat(ws, name);
    tokenToRoom.set(ws.token, room.code);
    ws.roomCode = room.code;
    maintainRoom(room);
    sendRoom(room, room.seats[seat], seat, 'room_joined');
    if (room.started && room.game) {
      if (gameRunning(room)) room.game.setBot(seat, false, name);
      else room.game.sendView(seat);
    }
    broadcastRoom(room);
  },

  leave_room(ws) {
    leaveRoom(ws);
  },

  toggle_bot(ws, data, room, seatIdx) {
    if (room.seats[seatIdx].id !== room.hostId || gameRunning(room)) return;
    const seat = Number(data.seat);
    if (!Number.isInteger(seat) || seat < 0 || seat > 3 || seat === seatIdx) return;
    const s = room.seats[seat];
    if (s === null) {
      room.seats[seat] = { id: newId(), token: null, name: BOT_NAMES[seat], isBot: true, away: false, ws: null };
    } else if (s.isBot && !isHuman(s)) {
      room.seats[seat] = null;
    }
    broadcastRoom(room);
  },

  update_rules(ws, data, room, seatIdx) {
    if (room.seats[seatIdx].id !== room.hostId) return;
    room.rules = sanitizeRules(data.rules); // takes effect next match
    broadcastRoom(room);
  },

  start_match(ws, data, room, seatIdx) {
    if (room.seats[seatIdx].id !== room.hostId) return;
    if (gameRunning(room)) return;
    // Seats kept for players who never came back are released before a new match.
    room.seats.forEach((s, i) => {
      if (isHuman(s) && s.isBot) vacateSeat(room, i);
    });
    if (room.seats.filter(Boolean).length < 2) {
      send(ws, { type: 'room_error', message: 'At least 2 players are needed. Wait for a friend or add a bot to an empty seat.' });
      return;
    }
    startGame(room);
  },

  action(ws, data, room, seatIdx) {
    if (!room.game) return;
    const action = {
      type: cleanText(data.action?.type, 12),
      cardId: Number(data.action?.cardId),
      color: cleanText(data.action?.color, 8),
      target: Number(data.action?.target),
    };
    room.game.handle(seatIdx, action); // seat comes from the server, never the client
  },

  emote(ws, data, room, seatIdx) {
    const now = Date.now();
    if (now - (ws.lastEmoteAt || 0) < 600) return;
    ws.lastEmoteAt = now;
    const payload = { type: 'room_emote', seat: seatIdx, playerName: room.seats[seatIdx].name, emote: cleanText(data.emote, 8) };
    room.seats.forEach((s) => isConnected(s) && send(s.ws, payload));
  },
};

const NO_ROOM_NEEDED = new Set(['hello', 'create_room', 'join_room', 'leave_room']);

wss.on('connection', (ws) => {
  ws.token = `anon_${crypto.randomBytes(12).toString('hex')}`; // replaced by hello
  ws.roomCode = null;
  ws.msgWindowStart = Date.now();
  ws.msgCount = 0;

  send(ws, { type: 'welcome', onlineCount: wss.clients.size });
  broadcastOnlineCount();

  ws.on('message', (raw) => {
    // Simple rate limit: 40 messages per 5 seconds.
    const now = Date.now();
    if (now - ws.msgWindowStart > 5000) {
      ws.msgWindowStart = now;
      ws.msgCount = 0;
    }
    if (++ws.msgCount > 40) return;

    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const handler = handlers[data?.type];
    if (!handler) return;
    try {
      if (NO_ROOM_NEEDED.has(data.type)) {
        handler(ws, data);
        return;
      }
      const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
      if (!room) return;
      const seatIdx = seatOf(room, ws);
      if (seatIdx === -1) return;
      handler(ws, data, room, seatIdx);
    } catch (err) {
      console.error('Handler error', data.type, err);
    }
  });

  ws.on('close', () => {
    const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
    if (room) {
      const seat = room.seats.findIndex((s) => isHuman(s) && s.ws === ws);
      if (seat !== -1) markAway(room, seat);
    }
    broadcastOnlineCount();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Card game server running at http://localhost:${PORT}`);
});
