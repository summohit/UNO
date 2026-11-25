# 3D Card Arena

A 3D multiplayer card game for phones and desktop browsers. Built with Three.js and GSAP, with a Node.js + WebSocket server.

## Run

```bash
npm install
npm start          # http://localhost:4173
```

Set `PORT` to use another port.

## Test

```bash
npm test                                   # rules engine unit tests
node tests/multiplayer.check.mjs 4173      # two-player check against a running server
```

## How it works

The game rules live in one place, `shared/engine.js`, which has no 3D or browser code.

| Mode | Where the rules run |
|---|---|
| Multiplayer room | On the **server**. Each player only receives their own hand; actions are validated against the sender's real seat. |
| Solo vs bots | In the browser, using the same engine and `GameHost`. |

```
shared/engine.js   Rules: deck, turns, house rules, scoring, per-seat views
shared/host.js     Runs one match: bot turns, UNO-call timers, sends views
server.js          Static files + rooms over WebSocket (/ws)
src/game.js        Renders the views it receives and sends taps as actions
src/network.js     WebSocket client
src/main.js        Screens, dialogs, lobby, HUD
src/scene.js       Three.js table, cards, camera
```

The server only serves `index.html`, `src/`, `shared/` and the Three.js and GSAP files.

See [ROADMAP.md](ROADMAP.md) for planned work.
