# Roadmap: Bugs & Features

Status: ⬜ Todo · 🟨 In progress · ✅ Done
Priority: P0 = must fix before going public · P1 = important · P2 = nice to have

## Phase 0: Setup

| # | Item | Type | Priority | Files | Status |
|---|------|------|----------|-------|--------|
| 0.1 | `git init` + save the current code (after the UI work is finished) | Setup | P0 | - | ✅ |
| 0.2 | Fix `package.json` (`main` points to the missing `index.js`), add a README | Chore | P2 | package.json | ✅ |

## Phase 1: Server runs the game (multiplayer foundation)

| # | Item | Type | Priority | Files | Status |
|---|------|------|----------|-------|--------|
| 1.1 | Move the game rules into a shared module with no 3D/sound code (`shared/rules.js`) | Refactor | P0 | game.js, new shared/ | ✅ |
| 1.2 | Server runs the game; clients send only what they want to do | Feature | P0 | server.js, game.js, network.js | ✅ |
| 1.3 | **Bug:** every hand and the draw-pile order are sent to all players (console cheating) → send each player only their own hand | Security | P0 | game.js, server.js | ✅ |
| 1.4 | **Bug:** the server trusts the `seat` number the client sends → players can act for other seats | Security | P0 | server.js | ✅ |
| 1.5 | **Bug:** the game stalls when the host leaves (the new host doesn't have the game state) | Bug | P0 | server.js | ✅ |
| 1.6 | Server runs the bots (not the host's browser) | Feature | P0 | server.js | ✅ |
| 1.7 | **Bug:** a jump-in from another player doesn't check `isBusy` → it can cut into a move that's still animating | Bug | P1 | game.js | ✅ |
| 1.8 | Remove the BroadcastChannel fallback (it only works within one browser) | Cleanup | P2 | network.js | ✅ |

## Phase 2: Safety and stability

| # | Item | Type | Priority | Files | Status |
|---|------|------|----------|-------|--------|
| 2.1 | **Bug:** room names are inserted as raw HTML, so they can inject code into other players' pages → use `textContent` | Security | P0 | main.js | ✅ |
| 2.2 | Limit message size and rate (the `ws` default allows 100MB) | Security | P0 | server.js | ✅ |
| 2.3 | Only accept the known house-rule keys and value ranges in `update_rules` | Security | P1 | server.js | ✅ |
| 2.4 | **Bug:** the server serves `server.js`, `node_modules` and package files → serve only `index.html` + `src/` | Security | P1 | server.js | ✅ |
| 2.5 | **Bug:** the folder check uses `startsWith` (a sibling folder whose name starts with `uno-3d` passes it) | Security | P2 | server.js | ✅ |
| 2.6 | Join by code only (joining by room name lets strangers walk in) | Security | P1 | server.js, main.js | ⬜ |
| 2.7 | Remove the email field (collected and sent to everyone, never used) | Privacy | P1 | server.js, main.js, network.js | ✅ |
| 2.8 | Delete empty or inactive rooms after a few minutes | Stability | P1 | server.js | ✅ |

## Phase 3: Reconnecting and turn flow

| # | Item | Type | Priority | Files | Status |
|---|------|------|----------|-------|--------|
| 3.1 | Player token saved in the browser → get your seat back after a refresh or network drop | Feature | P0 | server.js, network.js | ✅ |
| 3.2 | A bot takes over a seat after about 30s away; the player can take it back on return | Feature | P1 | server.js | ✅ |
| 3.3 | Turn timer (20–30s, then draw automatically) | Feature | P1 | server.js, main.js | ✅ |

## Phase 4: Game rule bugs and gameplay

| # | Item | Type | Priority | Files | Status |
|---|------|------|----------|-------|--------|
| 4.1 | **Bug:** big stacks (+8/+12) lose cards when the draw pile runs out partway (the pile isn't refilled mid-draw) | Bug | P0 | game.js / rules | ✅ |
| 4.2 | **Bug:** a +2/Skip/Reverse turned up as the opening card has no effect | Bug | P1 | game.js / rules | ✅ |
| 4.3 | Let players catch someone who forgot to call UNO (not only the timer penalty) | Feature | P1 | rules, main.js | ✅ |
| 4.4 | Let the player choose who to swap with on a 7 (it currently picks automatically) | Feature | P1 | rules, index.html, main.js | ✅ |
| 4.5 | Bots always call UNO → give them a small chance to forget | Feature | P2 | rules | ✅ |
| 4.6 | Rematch vote + "play again with the same room" | Feature | P1 | server.js, main.js | ✅ |
| 4.7 | Running score across several rounds (to 500 points) | Feature | P2 | server.js, main.js | ✅ |
| 4.8 | **Bug:** campaign rewards are paid for multiplayer wins | Bug | P2 | main.js | ✅ |
| 4.9 | **Bug:** `unlockLevel` is never enforced (every level is open) | Bug | P2 | main.js | ⬜ |
| 4.10 | **Bug:** the bot name list contains "You" | Bug | P2 | server.js | ✅ |

## Phase 5: Chaos Mode (rules inspired by No Mercy; give it an original name)

| # | Item | Type | Priority | Files | Status |
|---|------|------|----------|-------|--------|
| 5.1 | Chaos Mode as a ruleset you can pick + toggle in the room rules | Feature | P1 | rules, index.html, main.js | ✅ |
| 5.2 | Chaos deck (140 cards) | Feature | P1 | rules | ✅ |
| 5.3 | +6 and +10 draw cards | Feature | P1 | rules, textures.js | ✅ |
| 5.4 | Reverse +4 | Feature | P1 | rules, textures.js | ✅ |
| 5.5 | Skip Everyone | Feature | P1 | rules, textures.js | ✅ |
| 5.6 | Discard All (one colour) | Feature | P1 | rules, textures.js | ✅ |
| 5.7 | Colour Roulette (flip cards until the chosen colour) + colour picker | Feature | P1 | rules, textures.js, main.js | ✅ |
| 5.8 | Stack any draw card of equal or higher value | Feature | P1 | rules | ✅ |
| 5.9 | Draw until you can play, always on | Feature | P1 | rules | ✅ |
| 5.10 | Elimination at 25+ cards + "Eliminated" seat state; last player left wins | Feature | P1 | rules, main.js, styles.css | ✅ |
| 5.11 | Bots that know when to stack and when to hold big cards | Feature | P2 | rules | ✅ |

## Phase 6: Bots

| # | Item | Type | Priority | Files | Status |
|---|------|------|----------|-------|--------|
| 6.1 | Smarter bots: hold wild +4s, go after players near UNO, pick swap targets | Feature | P2 | rules | ⬜ |
| 6.2 | Bot difficulty levels (Easy / Normal / Hard) | Feature | P2 | rules, main.js | ⬜ |

## Phase 7: Launch

| # | Item | Type | Priority | Files | Status |
|---|------|------|----------|-------|--------|
| 7.1 | **Rename and rebrand** (UNO is a Mattel trademark) | Legal | P0 | all text | ⬜ |
| 7.2 | Deploy to a host with WebSocket support (Render / Railway / Fly.io) over HTTPS (`wss://`) | Ops | P0 | - | ⬜ |
| 7.3 | PWA manifest + icons (install to the phone's home screen) | Feature | P1 | index.html, new manifest | ⬜ |
| 7.4 | Automated tests for the game rules | Quality | P1 | new tests/ | 🟨 |

## Later

| # | Item | Type | Priority |
|---|------|------|----------|
| 8.1 | Accounts + coins and XP stored on the server (anything saved in the browser can be faked) | Feature | P2 |
| 8.2 | Quick-play matchmaking queue | Feature | P2 |
| 8.3 | Text chat with moderation | Feature | P2 |
| 8.4 | Leaderboards | Feature | P2 |
