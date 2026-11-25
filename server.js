import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameHost } from './shared/host.js';
import { sanitizeRules } from './shared/engine.js';

const PORT = process.env.PORT || 4173;
const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));

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
const PUBLIC_PREFIXES = [
  '/src/',
  '/shared/',
  '/node_modules/three/build/',
  '/node_modules/gsap/',
];

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
// room = { code, roomName, hostId, rules, started, seats: [seat|null x4], game: GameHost|null }
// seat = { clientId, name, isBot, ws }
// ---------------------------------------------------------------------------
const rooms = new Map();
const BOT_NAMES = ['Ace (Bot)', 'Nova (Bot)', 'Apex (Bot)', 'Blaze (Bot)'];

const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateRoomCode() : code;
}

function send(ws, payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function publicRoom(room) {
  const players = [];
  room.seats.forEach((s, seat) => {
    if (!s) return;
    players.push({
      id: s.clientId,
      name: s.name,
      seat,
      isBot: s.isBot,
      connected: s.isBot || Boolean(s.ws && s.ws.readyState === 1),
    });
  });
  return {
    code: room.code,
    roomName: room.roomName,
    hostId: room.hostId,
    started: room.started,
    rules: room.rules,
    players,
  };
}

function broadcastRoom(room) {
  const info = publicRoom(room);
  room.seats.forEach((s, seat) => {
    if (s && !s.isBot) send(s.ws, { type: 'room_updated', room: info, seat });
  });
}

function seatOf(room, clientId) {
  return room.seats.findIndex((s) => s && !s.isBot && s.clientId === clientId);
}

function startGame(room) {
  if (room.game) room.game.stop();
  room.started = true;
  const game = new GameHost({
    rules: room.rules,
    players: room.seats.map((s, seat) => ({
      name: s ? s.name : `Seat ${seat + 1}`,
      isBot: Boolean(s?.isBot),
      active: Boolean(s),
    })),
    send: (seat, payload) => {
      const s = room.seats[seat];
      if (s && !s.isBot) send(s.ws, payload);
    },
  });
  room.game = game;
  room.seats.forEach((s, seat) => {
    if (s && !s.isBot) send(s.ws, { type: 'match_started', room: publicRoom(room), seat });
  });
  game.start();
}

function handleLeave(ws) {
  const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
  ws.roomCode = null;
  if (!room) return;
  const seat = seatOf(room, ws.clientId);
  if (seat === -1) return;

  const leaving = room.seats[seat];
  const humansLeft = room.seats.filter((s, i) => s && !s.isBot && i !== seat).length;

  if (humansLeft === 0) {
    if (room.game) room.game.stop();
    rooms.delete(room.code);
    return;
  }

  if (room.started && room.game && !room.game.engine.gameOver) {
    // Keep the match going: a bot takes over the seat.
    const botName = `${leaving.name} (Bot)`.slice(0, 24);
    room.seats[seat] = { clientId: `bot_${seat}`, name: botName, isBot: true, ws: null };
    room.game.setBot(seat, true, botName);
  } else {
    room.seats[seat] = null;
  }

  if (room.hostId === ws.clientId) {
    room.hostId = room.seats.find((s) => s && !s.isBot).clientId;
  }
  broadcastRoom(room);
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

function broadcastOnlineCount() {
  const msg = JSON.stringify({ type: 'online_count', count: wss.clients.size });
  wss.clients.forEach((c) => c.readyState === 1 && c.send(msg));
}

const handlers = {
  create_room(ws, data) {
    handleLeave(ws);
    const room = {
      code: generateRoomCode(),
      roomName: cleanText(data.roomName, 24) || 'Card Arena Room',
      hostId: ws.clientId,
      rules: sanitizeRules(data.rules),
      started: false,
      seats: [
        { clientId: ws.clientId, name: cleanText(data.playerName, 18) || 'Host', isBot: false, ws },
        null,
        null,
        null,
      ],
      game: null,
    };
    rooms.set(room.code, room);
    ws.roomCode = room.code;
    send(ws, { type: 'room_joined', room: publicRoom(room), seat: 0 });
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
    if (ws.roomCode === room.code) return;
    handleLeave(ws);

    const name = cleanText(data.playerName, 18) || 'Player';
    // Free seat before the match; during a match, take over a bot seat.
    let seat = room.started ? -1 : room.seats.findIndex((s) => s === null);
    if (seat === -1) seat = room.seats.findIndex((s, i) => s && s.isBot && (!room.started || room.game?.engine.players[i].active));
    if (seat === -1) {
      send(ws, { type: 'room_error', message: `Room "${room.roomName}" is full.` });
      return;
    }

    room.seats[seat] = { clientId: ws.clientId, name, isBot: false, ws };
    ws.roomCode = room.code;
    send(ws, { type: 'room_joined', room: publicRoom(room), seat });

    if (room.started && room.game) {
      room.game.setBot(seat, false, name);
    }
    broadcastRoom(room);
  },

  leave_room(ws) {
    handleLeave(ws);
  },

  toggle_bot(ws, data, room) {
    if (room.hostId !== ws.clientId || room.started) return;
    const seat = Number(data.seat);
    if (!Number.isInteger(seat) || seat < 1 || seat > 3) return;
    const s = room.seats[seat];
    if (s === null) {
      room.seats[seat] = { clientId: `bot_${seat}`, name: BOT_NAMES[seat], isBot: true, ws: null };
    } else if (s.isBot) {
      room.seats[seat] = null;
    }
    broadcastRoom(room);
  },

  update_rules(ws, data, room) {
    if (room.hostId !== ws.clientId) return;
    room.rules = sanitizeRules(data.rules); // takes effect next match
    broadcastRoom(room);
  },

  start_match(ws, data, room) {
    if (room.hostId !== ws.clientId) return;
    if (room.game && !room.game.engine.gameOver) return; // already running
    if (room.seats.filter(Boolean).length < 2) {
      send(ws, {
        type: 'room_error',
        message: 'At least 2 players are needed. Wait for a friend or add a bot to an empty seat.',
      });
      return;
    }
    startGame(room);
  },

  action(ws, data, room) {
    if (!room.game) return;
    const seat = seatOf(room, ws.clientId); // never trust a seat number from the client
    if (seat === -1) return;
    const action = {
      type: cleanText(data.action?.type, 12),
      cardId: Number(data.action?.cardId),
      color: cleanText(data.action?.color, 8),
    };
    room.game.handle(seat, action);
  },

  emote(ws, data, room) {
    const seat = seatOf(room, ws.clientId);
    if (seat === -1) return;
    const now = Date.now();
    if (now - (ws.lastEmoteAt || 0) < 600) return;
    ws.lastEmoteAt = now;
    const payload = { type: 'room_emote', seat, playerName: room.seats[seat].name, emote: cleanText(data.emote, 8) };
    room.seats.forEach((s) => s && !s.isBot && send(s.ws, payload));
  },
};

wss.on('connection', (ws) => {
  ws.clientId = `p_${Math.random().toString(36).slice(2, 12)}`;
  ws.roomCode = null;
  ws.msgWindowStart = Date.now();
  ws.msgCount = 0;

  send(ws, { type: 'welcome', clientId: ws.clientId, onlineCount: wss.clients.size });
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
    if (data.type === 'create_room' || data.type === 'join_room') {
      handler(ws, data);
      return;
    }
    const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
    if (!room) return;
    try {
      handler(ws, data, room);
    } catch (err) {
      console.error('Handler error', data.type, err);
    }
  });

  ws.on('close', () => {
    handleLeave(ws);
    broadcastOnlineCount();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Card game server running at http://localhost:${PORT}`);
});
