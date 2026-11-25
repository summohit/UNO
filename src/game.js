// Client-side game: renders the state the game host sends and forwards the
// player's taps as actions. All rules run in shared/engine.js, either on the
// server (rooms) or in a local GameHost (solo vs bots).
import * as THREE from 'three';
import { gsap } from 'gsap';
import { COLOR_PALETTE } from './textures.js';
import { sound } from './audio.js';
import { DEFAULT_RULES as ENGINE_DEFAULT_RULES, canPlayCard } from '../shared/engine.js';
import { GameHost } from '../shared/host.js';

export const DEFAULT_RULES = { ...ENGINE_DEFAULT_RULES };

export const CAMPAIGN_LEVELS = [
  {
    level: 1,
    title: 'Level 1: Rookie Lounge',
    subtitle: 'Classic 7-card rules • Standard +2 penalty',
    rewardCoins: 150,
    rewardXp: 100,
    unlockLevel: 1,
    rules: { stacking: false, drawUntilPlayable: false, sevenZeroSwap: false, jumpIn: false, unoPenaltyCards: 2, startingHandSize: 7 },
  },
  {
    level: 2,
    title: 'Level 2: Cyber Neon Club',
    subtitle: 'Stacking (+2 on +2, +4 on +4) enabled!',
    rewardCoins: 300,
    rewardXp: 200,
    unlockLevel: 1,
    rules: { stacking: true, drawUntilPlayable: false, sevenZeroSwap: false, jumpIn: false, unoPenaltyCards: 2, startingHandSize: 7 },
  },
  {
    level: 3,
    title: 'Level 3: Chaos Gold Vault',
    subtitle: '7–0 Hand Swap & Rotate + Stacking active!',
    rewardCoins: 600,
    rewardXp: 350,
    unlockLevel: 2,
    rules: { stacking: true, drawUntilPlayable: false, sevenZeroSwap: true, jumpIn: false, unoPenaltyCards: 2, startingHandSize: 7 },
  },
  {
    level: 4,
    title: 'Level 4: Obsidian Blitz Arena',
    subtitle: '5-Card High-Speed Blitz + Out-of-Turn Jump-In!',
    rewardCoins: 1200,
    rewardXp: 500,
    unlockLevel: 3,
    rules: { stacking: true, drawUntilPlayable: false, sevenZeroSwap: false, jumpIn: true, unoPenaltyCards: 2, startingHandSize: 5 },
  },
  {
    level: 5,
    title: 'Level 5: Grandmaster Galaxy',
    subtitle: 'All House Rules + Draw-To-Match + Hardcore +4 Penalty',
    rewardCoins: 2500,
    rewardXp: 1000,
    unlockLevel: 4,
    rules: { stacking: true, drawUntilPlayable: true, sevenZeroSwap: true, jumpIn: true, unoPenaltyCards: 4, startingHandSize: 7 },
  },
];

const SOLO_BOT_NAMES = ['', 'Nova (Bot)', 'Apex (Bot)', 'Blaze (Bot)'];
const MAX_DECK_MESHES = 30;
const SLOT_ANCHORS = [
  new THREE.Vector3(0, 1.78, 4.55),
  new THREE.Vector3(-3.45, 0.92, -0.35),
  new THREE.Vector3(0, 0.92, -3.45),
  new THREE.Vector3(3.45, 0.92, -0.35),
];

const ERROR_TEXT = {
  not_your_turn: 'Wait for your turn!',
  illegal_card: "Doesn't match the active colour or symbol!",
  card_not_in_hand: 'That card is no longer in your hand.',
  game_not_running: 'The match is not running.',
};

export class Uno3DGame {
  constructor(arena, uiCallbacks) {
    this.arena = arena;
    this.ui = uiCallbacks;
    this.network = null;
    this.localHost = null; // GameHost for solo games

    this.rules = { ...DEFAULT_RULES };
    this.activeCampaignLevel = 2;
    this.localSeat = 0;
    this.localProfileName = 'You';
    this.waitingForAdminStart = false;
    this.cameraPresetIndex = 0;
    this.pendingWildCard = null;
    this.awaitingServer = false;

    this.view = null;
    this.meshes = new Map(); // key -> mesh
    this.hands = [[], [], [], []]; // seat -> [{key,id,color,value,mesh}]
    this.discard = []; // [{key, mesh}]
    this.deck = []; // meshes

    this.players = this.emptyRoster();
    this.deckPos = new THREE.Vector3(-0.98, 0.04, -0.15);
    this.discardPos = new THREE.Vector3(0.55, 0.04, -0.15);
    this.matchStats = {
      cardsPlayed: 0,
      actionCardsPlayed: 0,
      biggestStack: 0,
      drawsTotal: 0,
    };
    this.lastPlayedInfo = null;
  }

  getLocalHandCards() {
    const hand = this.hands[this.localSeat] || [];
    const isMyTurn = Boolean(
      this.view &&
        !this.view.gameOver &&
        !this.waitingForAdminStart &&
        this.view.currentPlayer === this.localSeat
    );
    return hand.map((entry) => ({
      id: entry.id,
      color: entry.color,
      value: entry.value,
      playable: isMyTurn && this.canPlay(entry),
    }));
  }

  playCardByIdFromModal(cardId) {
    if (this.isBusy || this.waitingForAdminStart || !this.view) return false;
    const hand = this.hands[this.localSeat] || [];
    const card = hand.find((c) => c.id === cardId);
    if (!card) return false;
    if (this.view.currentPlayer !== this.localSeat || !this.canPlay(card)) {
      return false;
    }
    if (card.color === 'wild') {
      this.pendingWildCard = card;
      this.ui.openWildColorModal();
      return true;
    }
    this.sendAction({ type: 'play', cardId: card.id });
    return true;
  }

  getLastDiscardInfo() {
    if (this.lastPlayedInfo) return this.lastPlayedInfo;
    if (!this.view) return null;
    return {
      card: {
        color: this.view.activeColor,
        value: this.view.activeValue,
      },
      activeColor: this.view.activeColor,
      byName: 'Opening Card',
    };
  }

  resetMatchStats() {
    this.matchStats = {
      cardsPlayed: 0,
      actionCardsPlayed: 0,
      biggestStack: 0,
      drawsTotal: 0,
    };
    this.ui.clearMatchFeed?.();
  }

  sortLocalHand() {
    if (this.waitingForAdminStart || this.gameOver) return;
    const hand = this.hands[this.localSeat];
    if (!hand || hand.length < 2) return;

    // Stays on for the rest of the match: every update re-sorts the hand.
    this.keepHandSorted = true;
    this.sortHandEntries(hand);
    sound.playCardSwoosh();
    this.layoutPlayerHand(this.localSeat, 0);
  }

  sortHandEntries(hand) {
    const colorOrder = { red: 0, yellow: 1, green: 2, blue: 3, wild: 4 };
    const valueOrder = {
      '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
      '6': 6, '7': 7, '8': 8, '9': 9,
      skip: 10, reverse: 11, draw2: 12, wild: 13, wild4: 14,
    };
    hand.sort((a, b) => {
      const cDiff = (colorOrder[a.color] ?? 9) - (colorOrder[b.color] ?? 9);
      if (cDiff !== 0) return cDiff;
      return (valueOrder[a.value] ?? 99) - (valueOrder[b.value] ?? 99);
    });
  }

  // ---------------------------------------------------------------------
  // Roster helpers (also used by main.js)
  // ---------------------------------------------------------------------
  emptyRoster() {
    return [0, 1, 2, 3].map((seat) => ({
      id: seat,
      name: seat === 0 ? `${this.localProfileName || 'You'} (You)` : SOLO_BOT_NAMES[seat],
      rawName: seat === 0 ? this.localProfileName || 'You' : SOLO_BOT_NAMES[seat],
      isBot: seat !== 0,
      activeSeat: true,
      isVacant: false,
      count: 0,
      calledUno: false,
    }));
  }

  get gameOver() {
    return !this.view || this.view.gameOver;
  }
  set gameOver(_) {
    // kept for compatibility with older callers; state comes from the host
  }
  get isBusy() {
    return !this.view || this.view.gameOver || this.awaitingServer;
  }
  set isBusy(_) {}
  get currentPlayer() {
    return this.view ? this.view.currentPlayer : -1;
  }
  get activeColor() {
    return this.view ? this.view.activeColor : 'red';
  }

  attachNetwork(networkClient) {
    this.network = networkClient;
  }

  inRoom() {
    return Boolean(this.network && this.network.isInRoom());
  }

  setLocalProfileName(name) {
    this.localProfileName = name || 'You';
    if (!this.inRoom() && !this.view) {
      this.players[0].name = `${this.localProfileName} (You)`;
      this.players[0].rawName = this.localProfileName;
      this.syncHUD();
    }
  }

  setRules(newRules) {
    this.rules = { ...this.rules, ...newRules };
    this.syncHUD();
  }

  selectCampaignLevel(levelNum) {
    const lvl = CAMPAIGN_LEVELS.find((l) => l.level === levelNum);
    if (!lvl) return;
    this.activeCampaignLevel = lvl.level;
    this.arena.setArenaLevelTheme(lvl.level);
    this.setRules(lvl.rules);
  }

  getVisualSlot(seat) {
    return (seat - this.localSeat + 4) % 4;
  }

  configureRosterFromRoom(room, localSeat) {
    this.localSeat = localSeat;
    if (room?.rules) this.rules = { ...this.rules, ...room.rules };
    if (this.view) {
      // During a match the host's view is authoritative; just refresh names.
      this.applyViewRoster();
    } else {
      this.players = [0, 1, 2, 3].map((seat) => {
        const occ = room?.players?.find((p) => p.seat === seat);
        return {
          id: seat,
          name: occ ? (seat === localSeat ? `${occ.name} (You)` : occ.name) : 'VACANT SEAT',
          rawName: occ ? occ.name : 'Vacant',
          isBot: Boolean(occ?.isBot),
          activeSeat: Boolean(occ),
          isVacant: !occ,
          count: 0,
          calledUno: false,
        };
      });
    }
    this.update3DSeatTotems();
    this.syncHUD();
  }

  update3DSeatTotems() {
    for (let seat = 0; seat < 4; seat++) {
      const slot = this.getVisualSlot(seat);
      if (slot > 0) {
        const p = this.players[seat];
        this.arena.setSeatOccupiedVisual(slot, Boolean(p && p.activeSeat && !p.isVacant));
      }
    }
  }

  enterRoomWaitingState(room, localSeat) {
    this.stopLocalGame();
    this.waitingForAdminStart = true;
    this.view = null;
    this.ui.hideUnoShoutButton();
    this.clearBoardMeshes();
    this.configureRosterFromRoom(room, localSeat);
    this.arena.highlightTurnPlayer(-1);
    const isAdmin = this.network && this.network.isHost();
    this.ui.showBanner(
      isAdmin
        ? `Room "${room.roomName}" (${room.code}) • Waiting for players. Click "Start Game" when ready!`
        : `Room "${room.roomName}" (${room.code}) • Waiting for the host to start the game...`,
      'neutral'
    );
  }

  // ---------------------------------------------------------------------
  // Starting games
  // ---------------------------------------------------------------------
  stopLocalGame() {
    if (this.localHost) {
      this.localHost.stop();
      this.localHost = null;
    }
  }

  /** Solo: starts a new local game. In a room: the host asks the server for a (re)match. */
  startNewMatch() {
    if (this.inRoom()) {
      if (this.network.isHost()) {
        this.network.requestStartMatch();
      } else {
        this.ui.showBanner('Waiting for the room host to start the next match...', 'neutral');
      }
      return;
    }
    this.startSoloGame();
  }

  startSoloGame() {
    this.stopLocalGame();
    this.prepareForMatch(0);
    const players = [0, 1, 2, 3].map((seat) => ({
      name: seat === 0 ? this.localProfileName : SOLO_BOT_NAMES[seat],
      isBot: seat !== 0,
      active: true,
    }));
    const host = new GameHost({
      rules: this.rules,
      players,
      send: (seat, payload) => {
        if (seat !== 0 || this.localHost !== host) return;
        // Deliver asynchronously, like a network message.
        setTimeout(() => {
          if (this.localHost !== host) return;
          if (payload.type === 'game_update') this.onGameUpdate(payload);
          else if (payload.type === 'action_error') this.onActionError(payload.error);
        }, 0);
      },
    });
    this.localHost = host;
    host.start();
  }

  prepareForMatch(localSeat) {
    this.localSeat = localSeat;
    this.waitingForAdminStart = false;
    this.view = null;
    this.pendingWildCard = null;
    this.awaitingServer = false;
    this.keepHandSorted = false;
    this.ui.hideUnoShoutButton();
    this.clearBoardMeshes();
    this.ui.showBanner('Dealing cards...', 'neutral');
  }

  sendAction(action) {
    this.awaitingServer = true;
    // Safety net: never lock the table if a reply goes missing.
    clearTimeout(this.awaitTimer);
    this.awaitTimer = setTimeout(() => (this.awaitingServer = false), 2500);
    if (this.localHost) {
      this.localHost.handle(0, action);
    } else if (this.inRoom()) {
      this.network.sendAction(action);
    }
  }

  onActionError(error) {
    this.awaitingServer = false;
    this.ui.showBanner(ERROR_TEXT[error] || 'That move is not allowed.', 'neutral');
    sound.vibrate(20);
    this.layoutAllHands();
  }

  // ---------------------------------------------------------------------
  // Rendering the host's view
  // ---------------------------------------------------------------------
  onGameUpdate({ view, events = [] }) {
    const firstView = !this.view;
    this.awaitingServer = false;
    this.waitingForAdminStart = false;
    this.localSeat = view.seat;
    this.view = view;
    this.rules = { ...this.rules, ...view.rules };
    // Turn timer (multiplayer only): convert to a local deadline and tick the banner.
    this.turnEndsAt = typeof view.turnMsLeft === 'number' ? Date.now() + view.turnMsLeft : null;
    if (this.turnEndsAt && !this.turnTicker) {
      this.turnTicker = setInterval(() => this.updateTurnBanner(), 1000);
    }
    this.applyViewRoster();
    this.update3DSeatTotems();

    const lastPlay = [...events].reverse().find((e) => e.type === 'play');
    this.reconcileMeshes(lastPlay, firstView);

    this.arena.setActiveColorVisual(view.activeColor);
    this.arena.setDirectionVisual(view.direction);
    this.arena.highlightTurnPlayer(view.gameOver ? -1 : this.getVisualSlot(view.currentPlayer));
    this.syncHUD();
    this.playEventEffects(events, firstView);

    const me = view.players[this.localSeat];
    if (!view.gameOver && me && me.count === 1 && !me.calledUno) {
      this.ui.showUnoShoutButton();
    } else {
      this.ui.hideUnoShoutButton();
    }

    if (view.gameOver) {
      const winEvent = events.find((e) => e.type === 'win');
      if (winEvent) this.handleMatchWin(winEvent.seat, winEvent.points);
    } else {
      this.updateTurnBanner();
    }
  }

  applyViewRoster() {
    if (!this.view) return;
    this.players = this.view.players.map((p) => ({
      id: p.seat,
      name: !p.active ? 'VACANT SEAT' : p.seat === this.localSeat ? `${p.name} (You)` : p.name,
      rawName: p.name,
      isBot: p.isBot,
      activeSeat: p.active,
      isVacant: !p.active,
      count: p.count,
      calledUno: p.calledUno,
    }));
  }

  makeCardMesh(card) {
    let mesh;
    if (card) {
      mesh = this.arena.createCardMesh(card);
    } else {
      const a = this.arena;
      mesh = new THREE.Mesh(a.cardGeometry, [
        a.edgeMaterial, a.edgeMaterial, a.edgeMaterial, a.edgeMaterial, a.backMaterial, a.backMaterial,
      ]);
      mesh.castShadow = true;
    }
    this.arena.scene.add(mesh);
    return mesh;
  }

  takeMesh(key, card, spawnAt) {
    let mesh = this.meshes.get(key);
    if (!mesh) {
      mesh = this.makeCardMesh(card);
      if (spawnAt) mesh.position.copy(spawnAt);
      mesh.rotation.set(Math.PI / 2, 0, 0);
    }
    return mesh;
  }

  deckTopPosition() {
    const visibleDeck = Math.min(this.deck.length, 12);
    return new THREE.Vector3(this.deckPos.x, this.deckPos.y + visibleDeck * 0.022, this.deckPos.z);
  }

  reconcileMeshes(lastPlay, firstView) {
    const v = this.view;
    const next = new Map();
    const deckTop = this.deckTopPosition();

    // Hands
    this.hands = v.players.map((p) => {
      if (!p.active) return [];
      if (p.hand) {
        return p.hand.map((c) => {
          const key = `c${c.id}`;
          const mesh = this.takeMesh(key, c, deckTop);
          mesh.userData = { ...mesh.userData, card: c, owner: p.seat, isDrawDeck: false, role: 'hand' };
          next.set(key, mesh);
          return { key, ...c, mesh };
        });
      }
      return Array.from({ length: p.count }, (_, i) => {
        const key = `h${p.seat}_${i}`;
        const mesh = this.takeMesh(key, null, deckTop);
        mesh.userData = { ...mesh.userData, card: null, owner: p.seat, isDrawDeck: false, role: 'hand' };
        next.set(key, mesh);
        return { key, mesh };
      });
    });

    if (this.keepHandSorted) this.sortHandEntries(this.hands[this.localSeat]);

    // Discard pile (cap to top 8 cards with non-overlapping Y step to prevent Z-fighting pixelation)
    const oldRoles = new Map([...this.meshes].map(([k, m]) => [k, m.userData.role]));
    const visibleDiscard = v.discardTop.slice(-8);
    this.discard = visibleDiscard.map((c, idx) => {
      const key = `c${c.id}`;
      const isTop = idx === visibleDiscard.length - 1;
      let spawn = deckTop;
      if (isTop && lastPlay && lastPlay.card.id === c.id) {
        const slot = this.getVisualSlot(lastPlay.seat);
        spawn = SLOT_ANCHORS[slot];
      }
      const mesh = this.takeMesh(key, c, spawn);
      const wasDiscard = oldRoles.get(key) === 'discard';
      mesh.userData = { ...mesh.userData, card: c, owner: undefined, isDrawDeck: false, role: 'discard' };
      mesh.castShadow = isTop;
      mesh.receiveShadow = isTop;
      next.set(key, mesh);
      if (!wasDiscard) {
        if (isTop && !firstView) {
          const isAction = c.color === 'wild' || ['skip', 'reverse', 'draw2'].includes(c.value);
          this.animateCardToDiscard(mesh, idx, isAction);
        } else {
          this.placeOnDiscard(mesh, idx);
        }
      } else {
        // Keep shifted discard cards strictly separated in Y so they never Z-fight
        mesh.position.y = this.discardPos.y + (idx + 1) * 0.022;
      }
      return { key, mesh };
    });

    // Draw pile (capped to 12 crisp non-overlapping 3D cards)
    const deckCount = Math.min(v.drawCount, 12);
    this.deck = [];
    for (let i = 0; i < deckCount; i++) {
      const key = `d${i}`;
      const mesh = this.meshes.get(key) || this.makeCardMesh(null);
      const isTopDeck = i === deckCount - 1;
      mesh.userData = { ...mesh.userData, card: null, owner: undefined, isDrawDeck: true, role: 'deck' };
      mesh.castShadow = isTopDeck;
      mesh.receiveShadow = isTopDeck;
      mesh.position.set(this.deckPos.x, this.deckPos.y + i * 0.022, this.deckPos.z);
      mesh.rotation.set(Math.PI / 2, 0, 0);
      mesh.scale.set(1, 1, 1);
      next.set(key, mesh);
      this.deck.push(mesh);
    }

    // Remove meshes that are no longer on the table
    for (const [key, mesh] of this.meshes) {
      if (!next.has(key)) this.disposeMesh(mesh);
    }
    this.meshes = next;

    if (firstView) {
      for (let seat = 0; seat < 4; seat++) this.layoutPlayerHand(seat, seat * 0.05);
      sound.playCardSwoosh();
    } else {
      this.layoutAllHands();
    }
  }

  disposeMesh(mesh) {
    gsap.killTweensOf(mesh.position);
    gsap.killTweensOf(mesh.rotation);
    gsap.killTweensOf(mesh.scale);
    this.arena.scene.remove(mesh);
  }

  clearBoardMeshes() {
    for (const mesh of this.meshes.values()) this.disposeMesh(mesh);
    this.meshes.clear();
    this.hands = [[], [], [], []];
    this.discard = [];
    this.deck = [];
  }

  placeOnDiscard(mesh, idx) {
    gsap.killTweensOf(mesh.position);
    gsap.killTweensOf(mesh.rotation);
    mesh.position.set(this.discardPos.x, this.discardPos.y + (idx + 1) * 0.022, this.discardPos.z);
    mesh.rotation.set(-Math.PI / 2, 0, ((idx % 5) - 2) * 0.12);
    mesh.scale.set(1, 1, 1);
  }

  canPlay(card) {
    return Boolean(this.view && card && canPlayCard(card, this.view));
  }

  layoutAllHands() {
    for (let i = 0; i < 4; i++) this.layoutPlayerHand(i, 0);
  }

  layoutPlayerHand(seat, delay = 0) {
    const hand = this.hands[seat] || [];
    const count = hand.length;
    if (count === 0) return Promise.resolve();
    const visualSlot = this.getVisualSlot(seat);
    const isMyTurn = this.view && !this.view.gameOver && this.view.currentPlayer === this.localSeat;

    return new Promise((resolve) => {
      hand.forEach((entry, i) => {
        const mesh = entry.mesh;
        const offset = i - (count - 1) / 2;
        const targetPos = new THREE.Vector3();
        const targetRot = new THREE.Euler();
        let targetScale = 1.08;

        if (visualSlot === 0) {
          const maxSpread = Math.min(0.86, 5.4 / Math.max(count, 1));
          const arch = Math.abs(offset) * 0.052;
          const playable = isMyTurn && entry.color && this.canPlay(entry);
          targetScale = count > 13 ? 1.08 : count > 9 ? 1.2 : 1.32;
          targetPos.set(
            offset * maxSpread,
            1.78 - arch + (playable ? 0.28 : 0),
            4.55 + arch * 0.3 + i * 0.032 + (playable ? -0.18 : 0)
          );
          targetRot.set(-0.62, 0, -offset * 0.052);
        } else {
          const spread = Math.min(0.36, 2.4 / Math.max(count, 1));
          if (visualSlot === 1) {
            targetPos.set(-3.45, 0.92, -0.35 + offset * spread);
            targetRot.set(0, -Math.PI / 2, offset * 0.05);
          } else if (visualSlot === 2) {
            targetPos.set(-offset * spread, 0.92, -3.45);
            targetRot.set(0, 0, offset * 0.05);
          } else {
            targetPos.set(3.45, 0.92, -0.35 - offset * spread);
            targetRot.set(0, Math.PI / 2, offset * 0.05);
          }
        }

        mesh.userData.basePos = targetPos.clone();
        mesh.userData.baseRot = targetRot.clone();
        mesh.userData.baseScale = targetScale;

        gsap.to(mesh.position, {
          x: targetPos.x, y: targetPos.y, z: targetPos.z,
          duration: 0.4, delay, ease: 'back.out(1.3)',
          onComplete: i === count - 1 ? resolve : undefined,
        });
        gsap.to(mesh.rotation, { x: targetRot.x, y: targetRot.y, z: targetRot.z, duration: 0.4, delay, ease: 'power2.out' });
        gsap.to(mesh.scale, { x: targetScale, y: targetScale, z: targetScale, duration: 0.38, delay, ease: 'power2.out' });
      });
    });
  }

  animateCardToDiscard(mesh, stackIndex, isAction = false) {
    gsap.killTweensOf(mesh.position);
    gsap.killTweensOf(mesh.rotation);
    const destY = this.discardPos.y + (stackIndex + 1) * 0.022;
    const startPos = mesh.position.clone();
    const midPos = new THREE.Vector3(
      (startPos.x + this.discardPos.x) * 0.5,
      Math.max(startPos.y, destY) + (isAction ? 2.45 : 1.55),
      (startPos.z + this.discardPos.z) * 0.5
    );
    const dur = isAction ? 0.5 : 0.36;
    sound.playCardSwoosh();

    const proxy = { t: 0 };
    gsap.to(proxy, {
      t: 1,
      duration: dur,
      ease: 'power2.inOut',
      onUpdate: () => {
        const t = proxy.t;
        const inv = 1 - t;
        mesh.position.set(
          inv * inv * startPos.x + 2 * inv * t * midPos.x + t * t * this.discardPos.x,
          inv * inv * startPos.y + 2 * inv * t * midPos.y + t * t * destY,
          inv * inv * startPos.z + 2 * inv * t * midPos.z + t * t * this.discardPos.z
        );
      },
      onComplete: () => sound.playCardSlam(isAction),
    });
    gsap.to(mesh.rotation, {
      x: -Math.PI / 2, y: 0, z: (Math.random() - 0.5) * 0.55 + (isAction ? Math.PI * 2 : 0),
      duration: dur, ease: 'power2.inOut',
    });
    gsap.to(mesh.scale, { x: 1, y: 1, z: 1, duration: dur, ease: 'power2.out' });
  }

  // ---------------------------------------------------------------------
  // Effects for events
  // ---------------------------------------------------------------------
  nameOf(seat) {
    return this.view?.players[seat]?.name || `Seat ${seat + 1}`;
  }

  reaction(seat, emoji, label) {
    if (seat === this.localSeat || !this.ui.showSeatReaction) return;
    this.ui.showSeatReaction(this.getVisualSlot(seat), emoji, label);
  }

  playEventEffects(events) {
    const color = this.view.activeColor;
    const pushFeed = (text, colorKey = color) => {
      this.ui.pushMatchFeed?.(text, colorKey);
    };
    const labelOfCard = (c, activeCol) => {
      if (!c) return 'a card';
      if (c.value === 'wild') return `Wild → ${COLOR_PALETTE[activeCol]?.label || activeCol}`;
      if (c.value === 'wild4') return `Wild +4 → ${COLOR_PALETTE[activeCol]?.label || activeCol}`;
      const colName = COLOR_PALETTE[c.color]?.label || c.color;
      const valName =
        c.value === 'draw2' ? '+2' : c.value === 'skip' ? '⊘ Skip' : c.value === 'reverse' ? '⇄ Reverse' : c.value;
      return `${colName} ${valName}`;
    };

    for (const e of events) {
      switch (e.type) {
        case 'play': {
          this.matchStats.cardsPlayed += 1;
          if (e.card.color === 'wild' || ['skip', 'reverse', 'draw2'].includes(e.card.value)) {
            this.matchStats.actionCardsPlayed += 1;
          }
          const who = e.seat === this.localSeat ? 'You' : this.nameOf(e.seat);
          this.lastPlayedInfo = {
            card: { ...e.card },
            activeColor: e.color,
            byName: who,
          };
          pushFeed(`${who} played ${labelOfCard(e.card, e.color)}`, e.card.color === 'wild' ? e.color : e.card.color);
          this.ui.showCardPlayedBanner?.(this.nameOf(e.seat), e.card, e.color, e.seat === this.localSeat);
          if (e.card.color === 'wild') {
            sound.playWildChord();
            if (e.card.value === 'wild') {
              this.fx(`WILD → ${COLOR_PALETTE[e.color].label.toUpperCase()}!`, 1.25, 0.7);
            }
          } else {
            this.arena.triggerShockwave(color, 0.55);
          }
          break;
        }
        case 'jump_in':
          pushFeed(`⚡ ${this.nameOf(e.seat)} jumped in!`, color);
          this.fx(e.seat === this.localSeat ? '⚡ JUMP-IN!' : `⚡ ${this.nameOf(e.seat)} JUMPED IN!`, 1.1, 0.6);
          break;
        case 'reverse':
          pushFeed('⇄ Arena direction reversed!', color);
          this.fx('⇄ REVERSE!', 1.15, 0.75);
          break;
        case 'skip':
          this.arena.animateBotReaction(this.getVisualSlot(e.seat), 'hit');
          this.reaction(e.seat, '💔');
          pushFeed(`⊘ ${this.nameOf(e.seat)} was skipped`, color);
          this.fx(`⊘ ${this.nameOf(e.seat)} SKIPPED!`, 1.1, 0.8);
          break;
        case 'stack':
          this.matchStats.biggestStack = Math.max(this.matchStats.biggestStack, e.total || 0);
          pushFeed(`🔥 Stack climbed to +${e.total}!`, color);
          sound.playPenaltyBoom();
          this.fx(`STACK AT +${e.total}!`, 1.4, 1.1);
          break;
        case 'draw':
          this.matchStats.drawsTotal += e.count || 1;
          if (e.reason === 'penalty' || e.reason === 'stack') {
            sound.playPenaltyBoom();
            this.arena.animateBotReaction(this.getVisualSlot(e.seat), 'hit');
            this.reaction(e.seat, '😱');
            pushFeed(`${this.nameOf(e.seat)} drew +${e.count} penalty`, color);
            this.fx(`${this.nameOf(e.seat).toUpperCase()} DRAWS +${e.count}!`, 1.45, 1.2);
          } else if (e.reason === 'uno_penalty') {
            sound.playPenaltyBoom();
            pushFeed(`${this.nameOf(e.seat)} missed UNO! (+${e.count})`, 'red');
            this.fx(
              e.seat === this.localSeat ? `MISSED UNO! +${e.count} PENALTY` : `${this.nameOf(e.seat)} MISSED UNO! +${e.count}`,
              1.1, 1.1, 'red'
            );
          } else {
            sound.playCardSwoosh();
          }
          break;
        case 'drew_playable':
          this.ui.showBanner(`${this.nameOf(e.seat)} drew a playable card!`, color);
          break;
        case 'pass':
          pushFeed(`${this.nameOf(e.seat)} drew & passed`, 'neutral');
          this.ui.showBanner(`${this.nameOf(e.seat)} passes`, 'neutral');
          break;
        case 'uno':
          sound.playUnoShout();
          this.arena.animateBotReaction(this.getVisualSlot(e.seat), 'jump');
          this.reaction(e.seat, '🔥', 'UNO!');
          pushFeed(`🔥 ${this.nameOf(e.seat)} shouted UNO!`, 'yellow');
          this.fx(e.seat === this.localSeat ? 'YOU SHOUTED UNO!' : `${this.nameOf(e.seat)} shouts UNO!`, 1.4, 0.8, 'yellow');
          break;
        case 'swap_hands':
          pushFeed(`7-Rule: ${this.nameOf(e.seat)} swapped hands with ${this.nameOf(e.target)}`, color);
          this.fx(`7: ${this.nameOf(e.seat).toUpperCase()} SWAPPED WITH ${this.nameOf(e.target).toUpperCase()}!`, 1.35, 0.6);
          break;
        case 'rotate_hands':
          pushFeed('0-Rule: All 3D hands rotated!', color);
          this.fx('0: ALL HANDS ROTATED!', 1.35, 0.6);
          break;
        case 'player_away':
          if (e.seat !== this.localSeat) pushFeed(`📡 ${this.nameOf(e.seat)} lost connection`, 'neutral');
          break;
        case 'player_back':
          if (e.seat !== this.localSeat) pushFeed(`✅ ${this.nameOf(e.seat)} is back`, 'neutral');
          break;
        case 'timeout':
          pushFeed(`⏱ ${e.seat === this.localSeat ? 'You' : this.nameOf(e.seat)} ran out of time`, 'neutral');
          if (e.seat === this.localSeat) this.fx("⏱ TIME'S UP!", 0.8, 0.4, 'red');
          break;
        case 'start_card':
          this.resetMatchStats();
          this.lastPlayedInfo = {
            card: { ...e.card },
            activeColor: color,
            byName: 'Opening Card',
          };
          pushFeed(`Match started • ${labelOfCard(e.card, color)}`, color);
          this.arena.triggerShockwave(color, 0.75);
          break;
        default:
          break;
      }
    }
  }

  fx(text, shock = 1, punch = 0, colorKey) {
    const c = colorKey || this.view.activeColor;
    this.ui.showFloatingFX(text, c);
    this.arena.triggerShockwave(this.view.activeColor, shock);
    if (punch) this.arena.cameraPunch(punch);
  }

  updateTurnBanner() {
    const v = this.view;
    if (!v || v.gameOver || this.waitingForAdminStart) {
      clearInterval(this.turnTicker);
      this.turnTicker = null;
      return;
    }
    const secs = this.turnEndsAt ? Math.max(0, Math.ceil((this.turnEndsAt - Date.now()) / 1000)) : null;
    const timer = secs !== null ? ` • ${secs}s` : '';
    if (v.currentPlayer === this.localSeat) {
      this.ui.showBanner(
        (v.pendingDrawStack > 0
          ? `Your Turn! Stack a +2/+4 or tap Draw (+${v.pendingDrawStack})`
          : 'Your Turn! Tap a lifted card or tap Draw') + timer,
        secs !== null && secs <= 5 ? 'red' : v.activeColor
      );
    } else {
      const away = v.players[v.currentPlayer]?.away ? ' (reconnecting)' : '';
      this.ui.showBanner(`${this.nameOf(v.currentPlayer)}'s Turn${away}...${timer}`, v.activeColor);
    }
  }

  // ---------------------------------------------------------------------
  // Player input
  // ---------------------------------------------------------------------
  handleHumanTap(clientX, clientY) {
    if (this.waitingForAdminStart) return;
    const mine = (this.hands[this.localSeat] || []).map((h) => h.mesh);
    const topDeck = this.deck.length ? [this.deck[this.deck.length - 1]] : [];
    const topDiscard = this.discard.length
      ? [this.discard[this.discard.length - 1].mesh]
      : [];
    const hit = this.arena.pickCard(clientX, clientY, [
      ...mine,
      ...topDeck,
      ...topDiscard,
    ]);
    if (!hit) return;

    if (topDiscard.length && hit === topDiscard[0]) {
      const info = this.getLastDiscardInfo();
      if (info && this.ui.openLastCardPreview) {
        this.ui.openLastCardPreview(info);
      }
      return;
    }

    if (this.isBusy) return;

    if (hit.userData.isDrawDeck) {
      this.humanDrawFromDeck();
      return;
    }

    const card = hit.userData.card;
    if (!card) return;
    const v = this.view;

    if (v.currentPlayer !== this.localSeat) {
      const canJump =
        v.rules.jumpIn && card.color !== 'wild' && card.color === v.activeColor &&
        card.value === v.activeValue && v.pendingDrawStack === 0;
      if (canJump) {
        this.sendAction({ type: 'play', cardId: card.id });
      } else {
        this.ui.showBanner('Wait for your turn!', 'neutral');
      }
      return;
    }

    if (!this.canPlay(card)) {
      sound.vibrate(20);
      const baseX = hit.userData.basePos?.x ?? hit.position.x;
      gsap.fromTo(hit.position, { x: baseX - 0.14 }, { x: baseX, duration: 0.35, ease: 'elastic.out(2, 0.2)' });
      this.ui.showBanner(
        v.pendingDrawStack > 0 ? `Stack a +2/+4 or tap Draw (+${v.pendingDrawStack})!` : "Doesn't match the active colour or symbol!",
        v.pendingDrawStack > 0 ? v.activeColor : 'neutral'
      );
      return;
    }

    if (card.color === 'wild') {
      this.pendingWildCard = card;
      this.ui.openWildColorModal();
      return;
    }
    this.sendAction({ type: 'play', cardId: card.id });
  }

  humanDrawFromDeck() {
    if (this.isBusy || this.waitingForAdminStart || this.view.currentPlayer !== this.localSeat) return;
    this.sendAction({ type: 'draw' });
  }

  resolveWildColorChoice(colorKey) {
    if (!this.pendingWildCard) return;
    const card = this.pendingWildCard;
    this.pendingWildCard = null;
    this.sendAction({ type: 'play', cardId: card.id, color: colorKey });
  }

  shoutUnoHuman() {
    if (!this.view || this.view.gameOver) return;
    this.ui.hideUnoShoutButton();
    this.sendAction({ type: 'uno' });
  }

  // ---------------------------------------------------------------------
  // Camera, win, HUD
  // ---------------------------------------------------------------------
  cycleCameraView() {
    this.cameraPresetIndex = (this.cameraPresetIndex + 1) % 3;
    const presets = [
      { name: 'Tabletop Perspective', pos: this.arena.baseCamPos.clone(), look: this.arena.baseLookAt.clone() },
      { name: 'Cinema Close-Up', pos: new THREE.Vector3(0, 6.4, 7.6), look: new THREE.Vector3(0, 0.3, 0.7) },
      { name: 'Overhead Arena', pos: new THREE.Vector3(0, 12.8, 4.8), look: new THREE.Vector3(0, 0, 0.5) },
    ];
    const p = presets[this.cameraPresetIndex];
    gsap.to(this.arena.camera.position, { x: p.pos.x, y: p.pos.y, z: p.pos.z, duration: 0.7, ease: 'power3.out' });
    gsap.to(this.arena.currentLookAt, { x: p.look.x, y: p.look.y, z: p.look.z, duration: 0.7, ease: 'power3.out' });
    this.ui.showBanner(`Camera: ${p.name}`, this.activeColor);
  }

  handleMatchWin(winnerSeat, points) {
    this.ui.hideUnoShoutButton();
    sound.playUnoShout();
    this.arena.triggerShockwave(this.view.activeColor, 2.2);
    this.arena.cameraPunch(1.5);
    const winner = this.players[winnerSeat];
    const standings = this.players
      .filter((p) => p.activeSeat && !p.isVacant)
      .map((p) => ({
        id: p.id,
        name: p.id === this.localSeat ? `${p.rawName || p.name} (You)` : p.rawName || p.name,
        cardsLeft: p.count || 0,
        isWinner: p.id === winnerSeat,
      }))
      .sort((a, b) => a.cardsLeft - b.cardsLeft);

    this.ui.openVictoryModal(
      winner,
      points,
      winnerSeat === this.localSeat,
      this.activeCampaignLevel,
      this.inRoom(),
      standings,
      { ...this.matchStats }
    );
  }

  syncHUD() {
    const v = this.view;
    const visualPlayers = [0, 1, 2, 3].map((seat) => {
      const p = this.players[seat];
      return {
        logicalSeat: seat,
        visualSlot: this.getVisualSlot(seat),
        name: p.name,
        rawName: p.rawName || p.name,
        isBot: p.isBot,
        activeSeat: p.activeSeat !== false,
        isVacant: Boolean(p.isVacant),
        count: p.count || 0,
        isTurn: Boolean(v && !v.gameOver && seat === v.currentPlayer),
        calledUno: p.calledUno && p.count === 1,
      };
    });
    this.ui.updateHUD({
      visualPlayers,
      activeColor: v ? v.activeColor : 'red',
      activeValue: v ? v.activeValue : '0',
      direction: v ? v.direction : 1,
      drawCount: v ? v.drawCount : 0,
      pendingDrawStack: v ? v.pendingDrawStack : 0,
      rules: this.rules,
      waitingForAdminStart: this.waitingForAdminStart,
      activeCampaignLevel: this.activeCampaignLevel,
    });
  }
}
