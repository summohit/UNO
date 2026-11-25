import * as THREE from 'three';
import { gsap } from 'gsap';
import { COLOR_PALETTE } from './textures.js';
import { sound } from './audio.js';

const COLORS = ['red', 'yellow', 'green', 'blue'];
const VALUES = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'skip',
  'reverse',
  'draw2',
];
const BOT_NAMES = ['You', 'Nova (Bot)', 'Apex (Bot)', 'Blaze (Bot)'];

export const DEFAULT_RULES = {
  stacking: true,
  drawUntilPlayable: false,
  sevenZeroSwap: false,
  jumpIn: false,
  unoPenaltyCards: 2,
  startingHandSize: 7,
  fillWithBots: false, // Multiplayer rooms keep seats VACANT by default
};

export const CAMPAIGN_LEVELS = [
  {
    level: 1,
    title: 'Level 1: Rookie Lounge',
    subtitle: 'Classic 7-card UNO rules • Standard +2 penalty',
    rewardCoins: 150,
    rewardXp: 100,
    unlockLevel: 1,
    rules: {
      stacking: false,
      drawUntilPlayable: false,
      sevenZeroSwap: false,
      jumpIn: false,
      unoPenaltyCards: 2,
      startingHandSize: 7,
    },
  },
  {
    level: 2,
    title: 'Level 2: Cyber Neon Club',
    subtitle: 'Stacking (+2 on +2, +4 on +4) enabled!',
    rewardCoins: 300,
    rewardXp: 200,
    unlockLevel: 1,
    rules: {
      stacking: true,
      drawUntilPlayable: false,
      sevenZeroSwap: false,
      jumpIn: false,
      unoPenaltyCards: 2,
      startingHandSize: 7,
    },
  },
  {
    level: 3,
    title: 'Level 3: Chaos Gold Vault',
    subtitle: '7–0 Hand Swap & Rotate + Stacking active!',
    rewardCoins: 600,
    rewardXp: 350,
    unlockLevel: 2,
    rules: {
      stacking: true,
      drawUntilPlayable: false,
      sevenZeroSwap: true,
      jumpIn: false,
      unoPenaltyCards: 2,
      startingHandSize: 7,
    },
  },
  {
    level: 4,
    title: 'Level 4: Obsidian Blitz Arena',
    subtitle: '5-Card High-Speed Blitz + Out-of-Turn Jump-In!',
    rewardCoins: 1200,
    rewardXp: 500,
    unlockLevel: 3,
    rules: {
      stacking: true,
      drawUntilPlayable: false,
      sevenZeroSwap: false,
      jumpIn: true,
      unoPenaltyCards: 2,
      startingHandSize: 5,
    },
  },
  {
    level: 5,
    title: 'Level 5: Grandmaster Galaxy',
    subtitle: 'All House Rules + Draw-To-Match + Hardcore +4 Penalty',
    rewardCoins: 2500,
    rewardXp: 1000,
    unlockLevel: 4,
    rules: {
      stacking: true,
      drawUntilPlayable: true,
      sevenZeroSwap: true,
      jumpIn: true,
      unoPenaltyCards: 4,
      startingHandSize: 7,
    },
  },
];

export class Uno3DGame {
  constructor(arena, uiCallbacks) {
    this.arena = arena;
    this.ui = uiCallbacks;
    this.network = null;

    this.rules = { ...DEFAULT_RULES };
    this.activeCampaignLevel = 2;
    this.localSeat = 0;
    this.isMultiplayerGuest = false;
    this.waitingForAdminStart = false;
    this.localProfileName = 'You';

    this.players = [
      { id: 0, name: 'You', rawName: 'You', isBot: false, activeSeat: true, isVacant: false, hand: [], calledUno: false },
      { id: 1, name: 'Nova (Bot)', rawName: 'Nova', isBot: true, activeSeat: true, isVacant: false, hand: [], calledUno: false },
      { id: 2, name: 'Apex (Bot)', rawName: 'Apex', isBot: true, activeSeat: true, isVacant: false, hand: [], calledUno: false },
      { id: 3, name: 'Blaze (Bot)', rawName: 'Blaze', isBot: true, activeSeat: true, isVacant: false, hand: [], calledUno: false },
    ];

    this.drawPile = [];
    this.discardPile = [];
    this.currentPlayer = 0;
    this.direction = 1;
    this.activeColor = 'red';
    this.activeValue = '0';
    this.pendingDrawStack = 0;
    this.isBusy = false;
    this.gameOver = false;
    this.pendingWildCard = null;
    this.unoWindowTimer = null;
    this.cameraPresetIndex = 0;
    this.hoveredCardMesh = null;

    this.deckPos = new THREE.Vector3(-0.98, 0.04, -0.15);
    this.discardPos = new THREE.Vector3(0.55, 0.04, -0.15);
  }

  attachNetwork(networkClient) {
    this.network = networkClient;
  }

  setLocalProfileName(name) {
    this.localProfileName = name || 'You';
    if (!this.network || !this.network.isInRoom()) {
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

  getVisualSlot(seatIndex) {
    return (seatIndex - this.localSeat + 4) % 4;
  }

  // Configures seats from Multiplayer Room; empty seats remain VACANT unless a bot was explicitly placed or fillWithBots is ON
  configureRosterFromRoom(room, localSeat) {
    this.localSeat = localSeat;
    this.isMultiplayerGuest = Boolean(room && !this.network.isHost());
    if (room && room.rules) {
      this.rules = { ...this.rules, ...room.rules };
    }

    const newPlayers = [];
    for (let seat = 0; seat < 4; seat++) {
      const occupant = room?.players?.find((p) => p.seat === seat);
      if (occupant) {
        newPlayers.push({
          id: seat,
          clientId: occupant.id,
          name:
            seat === localSeat ? `${occupant.name} (You)` : occupant.name,
          rawName: occupant.name,
          isBot: Boolean(occupant.isBot),
          activeSeat: true,
          isVacant: false,
          hand: this.players[seat]?.hand || [],
          calledUno: this.players[seat]?.calledUno || false,
        });
      } else if (room && !this.rules.fillWithBots) {
        // Multiplayer Room Vacant Seat!
        newPlayers.push({
          id: seat,
          name: 'VACANT SEAT',
          rawName: 'Vacant',
          isBot: false,
          activeSeat: false,
          isVacant: true,
          hand: [],
          calledUno: false,
        });
      } else {
        newPlayers.push({
          id: seat,
          name: BOT_NAMES[seat] || `Bot ${seat}`,
          rawName: BOT_NAMES[seat] || `Bot ${seat}`,
          isBot: true,
          activeSeat: true,
          isVacant: false,
          hand: this.players[seat]?.hand || [],
          calledUno: this.players[seat]?.calledUno || false,
        });
      }
    }

    this.players = newPlayers;
    this.update3DSeatTotems();
    this.syncHUD();
  }

  update3DSeatTotems() {
    for (let logicalSeat = 0; logicalSeat < 4; logicalSeat++) {
      const visualSlot = this.getVisualSlot(logicalSeat);
      if (visualSlot > 0) {
        const p = this.players[logicalSeat];
        this.arena.setSeatOccupiedVisual(
          visualSlot,
          Boolean(p && p.activeSeat && !p.isVacant)
        );
      }
    }
  }

  // Puts the 3D table into a clean Waiting-for-Players state until the Admin starts the match
  enterRoomWaitingState(room, localSeat) {
    if (this.unoWindowTimer) {
      clearTimeout(this.unoWindowTimer);
      this.unoWindowTimer = null;
    }
    this.waitingForAdminStart = true;
    this.isBusy = true;
    this.gameOver = false;
    this.pendingDrawStack = 0;
    this.ui.hideUnoShoutButton();
    this.clearBoardMeshes();
    this.configureRosterFromRoom(room, localSeat);
    this.arena.highlightTurnPlayer(-1);

    const isAdmin = this.network && this.network.isHost();
    this.ui.showBanner(
      isAdmin
        ? `Room "${room.roomName}" (${room.code}) • Waiting for players to join. Click "Start Game" when ready!`
        : `Room "${room.roomName}" (${room.code}) • Waiting for Admin to start the game...`,
      'neutral'
    );
  }

  buildDeckData() {
    const cards = [];
    let uid = 1;
    for (const color of COLORS) {
      cards.push({ id: uid++, color, value: '0' });
      for (let copy = 0; copy < 2; copy++) {
        for (const val of VALUES.slice(1)) {
          cards.push({ id: uid++, color, value: val });
        }
      }
    }
    for (let i = 0; i < 4; i++) {
      cards.push({ id: uid++, color: 'wild', value: 'wild' });
      cards.push({ id: uid++, color: 'wild', value: 'wild4' });
    }
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }

  clearBoardMeshes() {
    const allCards = [
      ...this.drawPile,
      ...this.discardPile,
      ...this.players.flatMap((p) => p.hand),
    ];
    allCards.forEach((c) => {
      if (c.mesh) {
        gsap.killTweensOf(c.mesh.position);
        gsap.killTweensOf(c.mesh.rotation);
        gsap.killTweensOf(c.mesh.scale);
        this.arena.scene.remove(c.mesh);
      }
    });
    this.drawPile = [];
    this.discardPile = [];
    this.players.forEach((p) => {
      p.hand = [];
      p.calledUno = false;
    });
  }

  async startNewMatch() {
    if (this.isMultiplayerGuest) {
      this.ui.showBanner('Waiting for Room Admin to deal new match...', 'neutral');
      return;
    }

    if (this.unoWindowTimer) {
      clearTimeout(this.unoWindowTimer);
      this.unoWindowTimer = null;
    }

    if (this.network && this.network.isInRoom()) {
      this.configureRosterFromRoom(this.network.room, this.localSeat);
      const activeCount = this.players.filter((p) => p.activeSeat).length;
      if (activeCount < 2) {
        this.enterRoomWaitingState(this.network.room, this.localSeat);
        return;
      }
    } else {
      this.localSeat = 0;
      this.isMultiplayerGuest = false;
      this.players = [
        {
          id: 0,
          name: `${this.localProfileName} (You)`,
          rawName: this.localProfileName,
          isBot: false,
          activeSeat: true,
          isVacant: false,
          hand: [],
          calledUno: false,
        },
        {
          id: 1,
          name: 'Nova (Bot)',
          rawName: 'Nova',
          isBot: true,
          activeSeat: true,
          isVacant: false,
          hand: [],
          calledUno: false,
        },
        {
          id: 2,
          name: 'Apex (Bot)',
          rawName: 'Apex',
          isBot: true,
          activeSeat: true,
          isVacant: false,
          hand: [],
          calledUno: false,
        },
        {
          id: 3,
          name: 'Blaze (Bot)',
          rawName: 'Blaze',
          isBot: true,
          activeSeat: true,
          isVacant: false,
          hand: [],
          calledUno: false,
        },
      ];
      this.update3DSeatTotems();
    }

    this.waitingForAdminStart = false;
    this.isBusy = true;
    this.gameOver = false;
    this.direction = 1;
    this.currentPlayer = 0;
    this.pendingDrawStack = 0;
    this.arena.setDirectionVisual(1);
    this.ui.hideUnoShoutButton();

    this.clearBoardMeshes();
    const rawDeck = this.buildDeckData();

    rawDeck.forEach((cardData, idx) => {
      const mesh = this.arena.createCardMesh(cardData);
      cardData.mesh = mesh;
      mesh.userData.isDrawDeck = true;
      mesh.position.set(
        this.deckPos.x,
        this.deckPos.y + idx * 0.0045,
        this.deckPos.z
      );
      mesh.rotation.set(Math.PI / 2, 0, 0);
      this.arena.scene.add(mesh);
      this.drawPile.push(cardData);
    });

    const handSize = Number(this.rules.startingHandSize) || 7;
    this.ui.showBanner(`Dealing ${handSize} cards in 3D...`, 'neutral');
    this.syncHUD();

    for (let round = 0; round < handSize; round++) {
      for (let pIdx = 0; pIdx < 4; pIdx++) {
        if (!this.players[pIdx].activeSeat) continue;
        const card = this.drawPile.pop();
        card.mesh.userData.isDrawDeck = false;
        card.mesh.userData.owner = pIdx;
        this.players[pIdx].hand.push(card);
        const delay = (round * 4 + pIdx) * 0.038;
        this.layoutPlayerHand(pIdx, delay);
      }
    }

    gsap.delayedCall(0.1, () => sound.playCardSwoosh());
    gsap.delayedCall(0.45, () => sound.playCardSwoosh());
    gsap.delayedCall(0.8, () => sound.playCardSwoosh());

    await new Promise((r) => setTimeout(r, 1350));

    let starterIdx = this.drawPile.length - 1;
    while (starterIdx >= 0 && this.drawPile[starterIdx].color === 'wild') {
      starterIdx--;
    }
    const [starterCard] = this.drawPile.splice(starterIdx, 1);
    starterCard.mesh.userData.isDrawDeck = false;
    this.discardPile.push(starterCard);

    this.activeColor = starterCard.color;
    this.activeValue = starterCard.value;

    await this.animateCardToDiscard(starterCard, false);
    this.arena.setActiveColorVisual(this.activeColor);
    this.arena.triggerShockwave(this.activeColor, 0.75);

    this.isBusy = false;
    this.arena.highlightTurnPlayer(this.getVisualSlot(this.currentPlayer));
    this.layoutAllHands();
    this.syncHUD();
    this.broadcastSnapshot({ type: 'match_dealt' });
    this.updateTurnBannerForCurrentPlayer();
  }

  canPlayCard(card) {
    if (!card) return false;
    if (this.pendingDrawStack > 0 && this.rules.stacking) {
      if (this.activeValue === 'draw2') {
        return card.value === 'draw2' || card.value === 'wild4';
      }
      if (this.activeValue === 'wild4') {
        return card.value === 'wild4';
      }
    }
    if (card.color === 'wild') return true;
    if (card.color === this.activeColor) return true;
    if (card.value === this.activeValue) return true;
    return false;
  }

  layoutAllHands() {
    for (let i = 0; i < 4; i++) {
      this.layoutPlayerHand(i, 0);
    }
  }

  layoutPlayerHand(playerIndex, delay = 0) {
    const player = this.players[playerIndex];
    if (!player) return Promise.resolve();
    const hand = player.hand;
    const count = hand.length;
    if (count === 0) return Promise.resolve();

    const visualSlot = this.getVisualSlot(playerIndex);
    const isMyTurn =
      this.currentPlayer === this.localSeat &&
      !this.isBusy &&
      !this.gameOver &&
      !this.waitingForAdminStart;

    return new Promise((resolve) => {
      hand.forEach((card, i) => {
        const mesh = card.mesh;
        if (!mesh) return;
        const offset = i - (count - 1) / 2;
        const targetPos = new THREE.Vector3();
        const targetRot = new THREE.Euler();

        let targetScale = 1;

        if (visualSlot === 0) {
          // Big, crisp, wide-fanned player hand matching the screenshot!
          const maxSpread = Math.min(0.86, 5.4 / Math.max(count, 1));
          const arch = Math.abs(offset) * 0.058;
          const playable = isMyTurn && this.canPlayCard(card);
          targetScale = 1.32;

          targetPos.set(
            offset * maxSpread,
            1.78 - arch + (playable ? 0.28 : 0),
            4.55 + arch * 0.35 + i * 0.02 + (playable ? -0.18 : 0)
          );
          targetRot.set(-0.62, 0, -offset * 0.058);
        } else if (visualSlot === 1) {
          targetScale = 1.08;
          const spread = Math.min(0.36, 2.4 / Math.max(count, 1));
          targetPos.set(-3.45, 0.92, -0.35 + offset * spread);
          targetRot.set(0, -Math.PI / 2, offset * 0.05);
        } else if (visualSlot === 2) {
          targetScale = 1.08;
          const spread = Math.min(0.36, 2.4 / Math.max(count, 1));
          targetPos.set(-offset * spread, 0.92, -3.45);
          targetRot.set(0, 0, offset * 0.05);
        } else if (visualSlot === 3) {
          targetScale = 1.08;
          const spread = Math.min(0.36, 2.4 / Math.max(count, 1));
          targetPos.set(3.45, 0.92, -0.35 - offset * spread);
          targetRot.set(0, Math.PI / 2, offset * 0.05);
        }

        mesh.userData.basePos = targetPos.clone();
        mesh.userData.baseRot = targetRot.clone();
        mesh.userData.baseScale = targetScale;

        gsap.to(mesh.position, {
          x: targetPos.x,
          y: targetPos.y,
          z: targetPos.z,
          duration: 0.4,
          delay,
          ease: 'back.out(1.3)',
          onComplete: i === count - 1 ? resolve : undefined,
        });

        gsap.to(mesh.rotation, {
          x: targetRot.x,
          y: targetRot.y,
          z: targetRot.z,
          duration: 0.4,
          delay,
          ease: 'power2.out',
        });

        gsap.to(mesh.scale, {
          x: targetScale,
          y: targetScale,
          z: targetScale,
          duration: 0.38,
          delay,
          ease: 'power2.out',
        });
      });
    });
  }

  animateCardToDiscard(card, isAction = false) {
    const mesh = card.mesh;
    const stackIndex = this.discardPile.length;
    const destY = this.discardPos.y + stackIndex * 0.0055;
    const randomYaw = (Math.random() - 0.5) * 0.55;

    const startPos = mesh.position.clone();
    const midPos = new THREE.Vector3(
      (startPos.x + this.discardPos.x) * 0.5,
      Math.max(startPos.y, destY) + (isAction ? 2.45 : 1.55),
      (startPos.z + this.discardPos.z) * 0.5
    );

    sound.playCardSwoosh();

    return new Promise((resolve) => {
      const proxy = { t: 0 };
      gsap.to(proxy, {
        t: 1,
        duration: isAction ? 0.5 : 0.36,
        ease: 'power2.inOut',
        onUpdate: () => {
          const t = proxy.t;
          const inv = 1 - t;
          mesh.position.x =
            inv * inv * startPos.x +
            2 * inv * t * midPos.x +
            t * t * this.discardPos.x;
          mesh.position.y =
            inv * inv * startPos.y +
            2 * inv * t * midPos.y +
            t * t * destY;
          mesh.position.z =
            inv * inv * startPos.z +
            2 * inv * t * midPos.z +
            t * t * this.discardPos.z;
        },
        onComplete: () => {
          sound.playCardSlam(isAction);
          resolve();
        },
      });

      gsap.to(mesh.rotation, {
        x: -Math.PI / 2,
        y: 0,
        z: randomYaw + (isAction ? Math.PI * 2 : 0),
        duration: isAction ? 0.5 : 0.36,
        ease: 'power2.inOut',
      });

      gsap.to(mesh.scale, {
        x: 1,
        y: 1,
        z: 1,
        duration: isAction ? 0.5 : 0.36,
        ease: 'power2.out',
      });
    });
  }

  replenishDrawPileIfNeeded() {
    if (this.drawPile.length > 4 || this.discardPile.length <= 2) return;
    const topCard = this.discardPile.pop();
    const recycled = this.discardPile.splice(0, this.discardPile.length);
    this.discardPile.push(topCard);

    for (let i = recycled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [recycled[i], recycled[j]] = [recycled[j], recycled[i]];
    }

    recycled.forEach((card, idx) => {
      card.mesh.userData.isDrawDeck = true;
      card.mesh.userData.owner = undefined;
      card.mesh.position.set(
        this.deckPos.x,
        this.deckPos.y + idx * 0.0045,
        this.deckPos.z
      );
      card.mesh.rotation.set(Math.PI / 2, 0, 0);
      this.drawPile.unshift(card);
    });
  }

  async drawCardsForPlayer(playerIndex, count, isPenalty = false) {
    this.replenishDrawPileIfNeeded();
    const player = this.players[playerIndex];
    player.calledUno = false;

    for (let i = 0; i < count; i++) {
      if (this.drawPile.length === 0) break;
      const card = this.drawPile.pop();
      card.mesh.userData.isDrawDeck = false;
      card.mesh.userData.owner = playerIndex;
      player.hand.push(card);
      sound.playCardSwoosh();
      await this.layoutPlayerHand(playerIndex, 0);
      await new Promise((r) => setTimeout(r, isPenalty ? 145 : 110));
    }
    this.syncHUD();
  }

  clearHoveredCard() {
    if (this.hoveredCardMesh) {
      const m = this.hoveredCardMesh;
      this.hoveredCardMesh = null;
      if (m.userData.basePos && m.userData.owner === this.localSeat) {
        const s = m.userData.baseScale || 1.32;
        gsap.to(m.position, {
          x: m.userData.basePos.x,
          y: m.userData.basePos.y,
          z: m.userData.basePos.z,
          duration: 0.22,
          ease: 'power2.out',
        });
        gsap.to(m.rotation, {
          x: m.userData.baseRot.x,
          y: m.userData.baseRot.y,
          z: m.userData.baseRot.z,
          duration: 0.22,
          ease: 'power2.out',
        });
        gsap.to(m.scale, { x: s, y: s, z: s, duration: 0.22, ease: 'power2.out' });
      }
    }
    if (this.ui.hideCardPreview) this.ui.hideCardPreview();
  }

  handlePointerHover(clientX, clientY) {
    if (this.isBusy || this.gameOver || this.waitingForAdminStart) {
      this.clearHoveredCard();
      return;
    }
    const myHand = this.players[this.localSeat]?.hand || [];
    const humanCards = myHand.map((c) => c.mesh).filter(Boolean);
    const hitMesh = this.arena.pickCard(clientX, clientY, humanCards);

    if (hitMesh === this.hoveredCardMesh) return;

    if (this.hoveredCardMesh) {
      const prev = this.hoveredCardMesh;
      this.hoveredCardMesh = null;
      if (prev.userData.basePos && prev.userData.owner === this.localSeat) {
        const s = prev.userData.baseScale || 1.32;
        gsap.to(prev.position, {
          x: prev.userData.basePos.x,
          y: prev.userData.basePos.y,
          z: prev.userData.basePos.z,
          duration: 0.2,
          ease: 'power2.out',
        });
        gsap.to(prev.rotation, {
          x: prev.userData.baseRot.x,
          y: prev.userData.baseRot.y,
          z: prev.userData.baseRot.z,
          duration: 0.2,
          ease: 'power2.out',
        });
        gsap.to(prev.scale, { x: s, y: s, z: s, duration: 0.2, ease: 'power2.out' });
      }
    }

    if (!hitMesh) {
      if (this.ui.hideCardPreview) this.ui.hideCardPreview();
      return;
    }

    this.hoveredCardMesh = hitMesh;
    const base = hitMesh.userData.basePos || hitMesh.position;
    const card = hitMesh.userData.card;
    const playable =
      this.currentPlayer === this.localSeat && this.canPlayCard(card);

    gsap.to(hitMesh.position, {
      x: base.x,
      y: base.y + (playable ? 0.38 : 0.18),
      z: base.z - (playable ? 0.24 : 0.1),
      duration: 0.18,
      ease: 'power2.out',
    });
    gsap.to(hitMesh.rotation, {
      x: -0.52,
      y: 0,
      z: 0,
      duration: 0.18,
      ease: 'power2.out',
    });
    gsap.to(hitMesh.scale, {
      x: playable ? 1.44 : 1.37,
      y: playable ? 1.44 : 1.37,
      z: playable ? 1.44 : 1.37,
      duration: 0.18,
      ease: 'power2.out',
    });

    if (this.ui.showCardPreview) {
      this.ui.showCardPreview(card, playable, this.currentPlayer === this.localSeat);
    }
  }

  async handleHumanTap(clientX, clientY) {
    this.clearHoveredCard();
    if (this.isBusy || this.gameOver || this.waitingForAdminStart) return;

    const myHand = this.players[this.localSeat]?.hand || [];
    const humanCards = myHand.map((c) => c.mesh).filter(Boolean);
    const topDrawMesh =
      this.drawPile.length > 0
        ? [this.drawPile[this.drawPile.length - 1].mesh]
        : [];
    const hitMesh = this.arena.pickCard(clientX, clientY, [
      ...humanCards,
      ...topDrawMesh,
    ]);

    if (!hitMesh) return;

    if (hitMesh.userData.isDrawDeck) {
      await this.humanDrawFromDeck();
      return;
    }

    const card = hitMesh.userData.card;

    if (this.currentPlayer !== this.localSeat) {
      if (
        this.rules.jumpIn &&
        card.color !== 'wild' &&
        card.color === this.activeColor &&
        card.value === this.activeValue &&
        this.pendingDrawStack === 0
      ) {
        if (this.isMultiplayerGuest) {
          this.network.sendGuestAction({ type: 'jump_in', cardId: card.id });
          return;
        }
        this.currentPlayer = this.localSeat;
        this.ui.showFloatingFX('⚡ JUMP-IN!', this.activeColor);
        await this.playCardFromHand(this.localSeat, card);
      } else {
        this.ui.showBanner('Wait for your turn!', 'neutral');
      }
      return;
    }

    if (!this.canPlayCard(card)) {
      sound.vibrate(20);
      const baseX = hitMesh.userData.basePos?.x ?? hitMesh.position.x;
      gsap.fromTo(
        hitMesh.position,
        { x: baseX - 0.14 },
        { x: baseX, duration: 0.35, ease: 'elastic.out(2, 0.2)' }
      );
      if (this.pendingDrawStack > 0) {
        this.ui.showBanner(
          `Stack a +2/+4 or tap Draw (+${this.pendingDrawStack})!`,
          this.activeColor
        );
      } else {
        this.ui.showBanner("Doesn't match active color or symbol!", 'neutral');
      }
      return;
    }

    if (card.color === 'wild') {
      this.pendingWildCard = card;
      this.ui.openWildColorModal();
      return;
    }

    if (this.isMultiplayerGuest) {
      this.network.sendGuestAction({
        type: 'play_card',
        cardId: card.id,
        chosenColor: null,
      });
      return;
    }

    await this.playCardFromHand(this.localSeat, card);
  }

  async humanDrawFromDeck() {
    if (
      this.isBusy ||
      this.gameOver ||
      this.waitingForAdminStart ||
      this.currentPlayer !== this.localSeat
    ) {
      return;
    }

    if (this.isMultiplayerGuest) {
      this.network.sendGuestAction({ type: 'draw_card' });
      return;
    }

    await this.executePlayerDrawAction(this.localSeat);
  }

  async executePlayerDrawAction(seatIndex) {
    this.isBusy = true;
    const player = this.players[seatIndex];

    if (this.pendingDrawStack > 0) {
      const count = this.pendingDrawStack;
      this.pendingDrawStack = 0;
      sound.playPenaltyBoom();
      this.arena.triggerShockwave(this.activeColor, 1.4);
      this.arena.cameraPunch(1.2);
      this.ui.showFloatingFX(
        `${player.rawName} DRAWS +${count}!`,
        this.activeColor
      );
      await this.drawCardsForPlayer(seatIndex, count, true);
      this.broadcastSnapshot({
        type: 'stack_accepted',
        seat: seatIndex,
        count,
      });
      this.advanceTurn(1);
      return;
    }

    const maxDraws = this.rules.drawUntilPlayable ? 5 : 1;
    let drawnCard = null;
    for (let attempt = 0; attempt < maxDraws; attempt++) {
      await this.drawCardsForPlayer(seatIndex, 1, false);
      drawnCard = player.hand[player.hand.length - 1];
      if (this.canPlayCard(drawnCard)) break;
    }

    if (drawnCard && this.canPlayCard(drawnCard)) {
      this.ui.showBanner(
        `${player.rawName} drew a playable card!`,
        this.activeColor
      );
      await new Promise((r) => setTimeout(r, 340));
      this.isBusy = false;
      const chosenWild =
        drawnCard.color === 'wild' ? this.chooseSmartBotColor(player) : null;
      await this.playCardFromHand(seatIndex, drawnCard, chosenWild);
    } else {
      this.ui.showBanner(`${player.rawName} passes turn`, 'neutral');
      this.broadcastSnapshot({ type: 'draw_pass', seat: seatIndex });
      await new Promise((r) => setTimeout(r, 380));
      this.advanceTurn(1);
    }
  }

  applySevenZeroHouseRule(playerIndex, cardValue) {
    if (!this.rules.sevenZeroSwap) return null;

    if (cardValue === '0') {
      const activeIndices = this.players
        .filter((p) => p.activeSeat)
        .map((p) => p.id);
      if (activeIndices.length < 2) return null;

      if (this.direction === 1) {
        const lastHand =
          this.players[activeIndices[activeIndices.length - 1]].hand;
        for (let i = activeIndices.length - 1; i > 0; i--) {
          this.players[activeIndices[i]].hand =
            this.players[activeIndices[i - 1]].hand;
        }
        this.players[activeIndices[0]].hand = lastHand;
      } else {
        const firstHand = this.players[activeIndices[0]].hand;
        for (let i = 0; i < activeIndices.length - 1; i++) {
          this.players[activeIndices[i]].hand =
            this.players[activeIndices[i + 1]].hand;
        }
        this.players[activeIndices[activeIndices.length - 1]].hand = firstHand;
      }
      this.layoutAllHands();
      return '0 RULE: ALL HANDS ROTATED!';
    }

    if (cardValue === '7') {
      const opponents = this.players.filter(
        (p) => p.activeSeat && p.id !== playerIndex && p.hand.length > 0
      );
      if (opponents.length === 0) return null;
      opponents.sort((a, b) => a.hand.length - b.hand.length);
      const target = opponents[0];
      const temp = this.players[playerIndex].hand;
      this.players[playerIndex].hand = target.hand;
      target.hand = temp;
      this.layoutPlayerHand(playerIndex, 0);
      this.layoutPlayerHand(target.id, 0);
      return `7 RULE: SWAPPED HANDS WITH ${target.rawName.toUpperCase()}!`;
    }

    return null;
  }

  async playCardFromHand(playerIndex, card, chosenWildColor = null) {
    this.isBusy = true;
    const player = this.players[playerIndex];
    const cardIdx = player.hand.findIndex((c) => c.id === card.id);
    if (cardIdx === -1) {
      this.isBusy = false;
      return;
    }

    player.hand.splice(cardIdx, 1);
    card.mesh.userData.owner = undefined;
    this.discardPile.push(card);

    const isAction =
      card.color === 'wild' ||
      card.value === 'skip' ||
      card.value === 'reverse' ||
      card.value === 'draw2';

    await Promise.all([
      this.animateCardToDiscard(card, isAction),
      this.layoutPlayerHand(playerIndex, 0),
    ]);

    this.activeValue = card.value;
    if (card.color === 'wild') {
      this.activeColor = chosenWildColor || this.chooseSmartBotColor(player);
      sound.playWildChord();
    } else {
      this.activeColor = card.color;
    }

    // Announce & animate who played this card to all players!
    const playedEvent = {
      type: 'card_played',
      bySeat: playerIndex,
      byName: player.rawName || player.name,
      card: { id: card.id, color: card.color, value: card.value },
      activeColor: this.activeColor,
    };
    if (this.ui.showCardPlayedBanner) {
      this.ui.showCardPlayedBanner(
        playedEvent.byName,
        playedEvent.card,
        this.activeColor,
        playerIndex === this.localSeat
      );
    }

    this.arena.setActiveColorVisual(this.activeColor);

    const swapMsg = this.applySevenZeroHouseRule(playerIndex, card.value);
    if (swapMsg) {
      this.ui.showFloatingFX(swapMsg, this.activeColor);
      this.arena.triggerShockwave(this.activeColor, 1.35);
    }

    this.syncHUD();

    if (player.hand.length === 1) {
      if (playerIndex === this.localSeat) {
        this.triggerHumanUnoChallenge();
      } else if (player.isBot) {
        player.calledUno = true;
        sound.playUnoShout();
        this.arena.animateBotReaction(this.getVisualSlot(playerIndex), 'jump');
        this.ui.showFloatingFX(`${player.rawName} shouts UNO!`, this.activeColor);
        if (this.ui.showSeatReaction) {
          this.ui.showSeatReaction(this.getVisualSlot(playerIndex), '🔥', 'UNO!');
        }
      }
    }

    if (player.hand.length === 0) {
      this.broadcastSnapshot({
        type: 'match_won',
        winnerSeat: playerIndex,
      });
      this.handleMatchWin(player);
      return;
    }

    let stepCount = 1;
    let fxLabel = null;

    if (card.value === 'reverse') {
      const activePlayersCount = this.players.filter((p) => p.activeSeat).length;
      this.direction *= -1;
      this.arena.setDirectionVisual(this.direction);
      this.arena.triggerShockwave(this.activeColor, 1.15);
      this.arena.cameraPunch(0.75);
      fxLabel = '⇄ REVERSE!';
      this.ui.showFloatingFX(fxLabel, this.activeColor);
      if (activePlayersCount === 2) stepCount = 2;
      await new Promise((r) => setTimeout(r, 450));
    } else if (card.value === 'skip') {
      const skippedIdx = this.getNextPlayerIndex(1);
      const skippedPlayer = this.players[skippedIdx];
      this.arena.triggerShockwave(this.activeColor, 1.1);
      this.arena.cameraPunch(0.8);
      this.arena.animateBotReaction(this.getVisualSlot(skippedIdx), 'hit');
      if (this.ui.showSeatReaction && skippedIdx !== this.localSeat) {
        this.ui.showSeatReaction(this.getVisualSlot(skippedIdx), '💔');
      }
      fxLabel = `⊘ ${skippedPlayer.rawName} SKIPPED!`;
      this.ui.showFloatingFX(fxLabel, this.activeColor);
      stepCount = 2;
      await new Promise((r) => setTimeout(r, 500));
    } else if (card.value === 'draw2') {
      if (this.rules.stacking) {
        this.pendingDrawStack += 2;
        sound.playPenaltyBoom();
        this.arena.triggerShockwave(this.activeColor, 1.35);
        this.arena.cameraPunch(1.1);
        fxLabel = `STACK AT +${this.pendingDrawStack}!`;
        this.ui.showFloatingFX(fxLabel, this.activeColor);
        await new Promise((r) => setTimeout(r, 420));
      } else {
        const victimIdx = this.getNextPlayerIndex(1);
        const victim = this.players[victimIdx];
        sound.playPenaltyBoom();
        this.arena.triggerShockwave(this.activeColor, 1.45);
        this.arena.cameraPunch(1.25);
        this.arena.animateBotReaction(this.getVisualSlot(victimIdx), 'hit');
        if (this.ui.showSeatReaction && victimIdx !== this.localSeat) {
          this.ui.showSeatReaction(this.getVisualSlot(victimIdx), '😱');
        }
        fxLabel = `+2 ON ${victim.rawName.toUpperCase()}!`;
        this.ui.showFloatingFX(fxLabel, this.activeColor);
        await this.drawCardsForPlayer(victimIdx, 2, true);
        stepCount = 2;
        await new Promise((r) => setTimeout(r, 360));
      }
    } else if (card.value === 'wild4') {
      if (this.rules.stacking) {
        this.pendingDrawStack += 4;
        sound.playPenaltyBoom();
        this.arena.triggerShockwave(this.activeColor, 1.75);
        this.arena.cameraPunch(1.55);
        fxLabel = `WILD STACK AT +${this.pendingDrawStack}!`;
        this.ui.showFloatingFX(fxLabel, this.activeColor);
        await new Promise((r) => setTimeout(r, 450));
      } else {
        const victimIdx = this.getNextPlayerIndex(1);
        const victim = this.players[victimIdx];
        sound.playPenaltyBoom();
        this.arena.triggerShockwave(this.activeColor, 1.9);
        this.arena.cameraPunch(1.75);
        this.arena.animateBotReaction(this.getVisualSlot(victimIdx), 'hit');
        if (this.ui.showSeatReaction && victimIdx !== this.localSeat) {
          this.ui.showSeatReaction(this.getVisualSlot(victimIdx), '😱');
        }
        fxLabel = `WILD +4 ON ${victim.rawName.toUpperCase()}!`;
        this.ui.showFloatingFX(fxLabel, this.activeColor);
        await this.drawCardsForPlayer(victimIdx, 4, true);
        stepCount = 2;
        await new Promise((r) => setTimeout(r, 420));
      }
    } else if (card.value === 'wild') {
      this.arena.triggerShockwave(this.activeColor, 1.25);
      this.arena.cameraPunch(0.7);
      fxLabel = `WILD → ${COLOR_PALETTE[this.activeColor].label.toUpperCase()}!`;
      this.ui.showFloatingFX(fxLabel, this.activeColor);
      await new Promise((r) => setTimeout(r, 360));
    } else {
      this.arena.triggerShockwave(this.activeColor, 0.55);
    }

    this.advanceTurn(stepCount, fxLabel, playedEvent);
  }

  async resolveWildColorChoice(colorKey) {
    if (!this.pendingWildCard) return;
    const card = this.pendingWildCard;
    this.pendingWildCard = null;
    if (this.isMultiplayerGuest) {
      this.network.sendGuestAction({
        type: 'play_card',
        cardId: card.id,
        chosenColor: colorKey,
      });
      return;
    }
    await this.playCardFromHand(this.localSeat, card, colorKey);
  }

  triggerHumanUnoChallenge() {
    const human = this.players[this.localSeat];
    if (!human || human.calledUno) return;

    this.ui.showUnoShoutButton();
    if (this.unoWindowTimer) clearTimeout(this.unoWindowTimer);

    const penaltyCount = Number(this.rules.unoPenaltyCards) || 2;
    this.unoWindowTimer = setTimeout(async () => {
      this.ui.hideUnoShoutButton();
      if (!human.calledUno && human.hand.length === 1 && !this.gameOver) {
        if (this.isMultiplayerGuest) {
          this.network.sendGuestAction({ type: 'uno_penalty' });
          return;
        }
        sound.playPenaltyBoom();
        this.arena.cameraPunch(1.1);
        this.ui.showFloatingFX(`MISSED UNO! +${penaltyCount} PENALTY`, 'red');
        await this.drawCardsForPlayer(this.localSeat, penaltyCount, true);
        this.layoutPlayerHand(this.localSeat, 0);
        this.broadcastSnapshot({
          type: 'uno_penalty',
          seat: this.localSeat,
          count: penaltyCount,
        });
      }
    }, 3200);
  }

  shoutUnoHuman() {
    const human = this.players[this.localSeat];
    if (!human || human.hand.length > 2 || this.gameOver) return;
    human.calledUno = true;
    if (this.unoWindowTimer) {
      clearTimeout(this.unoWindowTimer);
      this.unoWindowTimer = null;
    }
    this.ui.hideUnoShoutButton();
    sound.playUnoShout();
    this.arena.triggerShockwave('yellow', 1.4);
    this.arena.cameraPunch(0.8);
    this.ui.showFloatingFX('YOU SHOUTED UNO!', 'yellow');

    if (this.isMultiplayerGuest) {
      this.network.sendGuestAction({ type: 'shout_uno' });
    } else {
      this.broadcastSnapshot({ type: 'shout_uno', seat: this.localSeat });
    }
    this.syncHUD();
  }

  getNextPlayerIndex(steps = 1) {
    let idx = this.currentPlayer;
    let remaining = steps;
    let guard = 0;
    while (remaining > 0 && guard < 16) {
      idx = (idx + this.direction + 4) % 4;
      guard++;
      if (this.players[idx]?.activeSeat) {
        remaining--;
      }
    }
    return idx;
  }

  advanceTurn(steps = 1, fxLabel = null, playedEvent = null) {
    if (this.gameOver) return;
    this.currentPlayer = this.getNextPlayerIndex(steps);
    this.isBusy = false;
    this.arena.highlightTurnPlayer(this.getVisualSlot(this.currentPlayer));
    this.layoutAllHands();
    this.syncHUD();
    this.broadcastSnapshot({
      type: 'turn_advanced',
      fxLabel,
      playedEvent,
    });
    this.updateTurnBannerForCurrentPlayer();

    const activePlayer = this.players[this.currentPlayer];
    if (activePlayer.isBot && !this.isMultiplayerGuest) {
      setTimeout(() => this.executeBotTurn(this.currentPlayer), 760);
    }
  }

  updateTurnBannerForCurrentPlayer() {
    if (this.waitingForAdminStart) return;
    const activePlayer = this.players[this.currentPlayer];
    if (!activePlayer) return;
    if (this.currentPlayer === this.localSeat) {
      if (this.pendingDrawStack > 0) {
        this.ui.showBanner(
          `Your Turn! Stack a +2/+4 or tap Draw (+${this.pendingDrawStack})`,
          this.activeColor
        );
      } else {
        this.ui.showBanner(
          'Your Turn! Tap a lifted 3D card or tap Draw',
          this.activeColor
        );
      }
    } else {
      this.ui.showBanner(`${activePlayer.rawName}'s Turn...`, this.activeColor);
    }
  }

  chooseSmartBotColor(bot) {
    const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
    bot.hand.forEach((c) => {
      if (counts[c.color] !== undefined) counts[c.color]++;
    });
    let best = 'red';
    let max = -1;
    for (const c of COLORS) {
      if (counts[c] > max) {
        max = counts[c];
        best = c;
      }
    }
    return best;
  }

  async executeBotTurn(botIndex) {
    if (
      this.gameOver ||
      this.waitingForAdminStart ||
      this.currentPlayer !== botIndex ||
      this.isMultiplayerGuest
    ) {
      return;
    }
    this.isBusy = true;
    const bot = this.players[botIndex];
    const playable = bot.hand.filter((c) => this.canPlayCard(c));

    if (playable.length > 0) {
      playable.sort((a, b) => {
        const aWild = a.color === 'wild' ? 1 : 0;
        const bWild = b.color === 'wild' ? 1 : 0;
        return aWild - bWild;
      });
      const chosen = playable[0];
      await this.playCardFromHand(botIndex, chosen);
    } else {
      await this.executePlayerDrawAction(botIndex);
    }
  }

  async handleRemotePlayerAction(seatIndex, action) {
    if (this.isMultiplayerGuest || this.gameOver || this.waitingForAdminStart) {
      return;
    }
    const player = this.players[seatIndex];
    if (!player) return;

    if (action.type === 'shout_uno') {
      player.calledUno = true;
      sound.playUnoShout();
      this.ui.showFloatingFX(`${player.rawName} SHOUTED UNO!`, 'yellow');
      this.syncHUD();
      this.broadcastSnapshot({ type: 'shout_uno', seat: seatIndex });
      return;
    }

    if (action.type === 'uno_penalty') {
      const penaltyCount = Number(this.rules.unoPenaltyCards) || 2;
      await this.drawCardsForPlayer(seatIndex, penaltyCount, true);
      this.broadcastSnapshot({
        type: 'uno_penalty',
        seat: seatIndex,
        count: penaltyCount,
      });
      return;
    }

    if (action.type === 'jump_in' && this.rules.jumpIn) {
      const card = player.hand.find((c) => c.id === action.cardId);
      if (
        card &&
        card.color === this.activeColor &&
        card.value === this.activeValue &&
        this.pendingDrawStack === 0
      ) {
        this.currentPlayer = seatIndex;
        this.ui.showFloatingFX(
          `⚡ ${player.rawName} JUMPED IN!`,
          this.activeColor
        );
        await this.playCardFromHand(seatIndex, card);
      }
      return;
    }

    if (this.currentPlayer !== seatIndex || this.isBusy) return;

    if (action.type === 'play_card') {
      const card = player.hand.find((c) => c.id === action.cardId);
      if (card && this.canPlayCard(card)) {
        await this.playCardFromHand(seatIndex, card, action.chosenColor);
      }
    } else if (action.type === 'draw_card') {
      await this.executePlayerDrawAction(seatIndex);
    }
  }

  broadcastSnapshot(event = null) {
    if (!this.network || !this.network.isInRoom() || !this.network.isHost()) {
      return;
    }
    const serializeCard = (c) => ({
      id: c.id,
      color: c.color,
      value: c.value,
    });
    const state = {
      rules: this.rules,
      waitingForAdminStart: this.waitingForAdminStart,
      currentPlayer: this.currentPlayer,
      direction: this.direction,
      activeColor: this.activeColor,
      activeValue: this.activeValue,
      pendingDrawStack: this.pendingDrawStack,
      gameOver: this.gameOver,
      drawPile: this.drawPile.map(serializeCard),
      discardPile: this.discardPile.map(serializeCard),
      players: this.players.map((p) => ({
        id: p.id,
        rawName: p.rawName,
        isBot: p.isBot,
        activeSeat: p.activeSeat,
        isVacant: p.isVacant,
        calledUno: p.calledUno,
        hand: p.hand.map(serializeCard),
      })),
    };
    this.network.syncStateFromHost(state, event);
  }

  applyRemoteStateSnapshot(state, event = null) {
    if (!state) return;
    this.isMultiplayerGuest = true;
    this.waitingForAdminStart = Boolean(state.waitingForAdminStart);
    this.rules = { ...this.rules, ...(state.rules || {}) };
    this.currentPlayer = state.currentPlayer;
    this.direction = state.direction;
    this.activeColor = state.activeColor;
    this.activeValue = state.activeValue;
    this.pendingDrawStack = state.pendingDrawStack || 0;
    this.gameOver = state.gameOver;

    const existingMeshes = new Map();
    [
      ...this.drawPile,
      ...this.discardPile,
      ...this.players.flatMap((p) => p.hand),
    ].forEach((c) => {
      if (c && c.mesh) existingMeshes.set(c.id, c.mesh);
    });

    const attachMesh = (cardData) => {
      let mesh = existingMeshes.get(cardData.id);
      if (!mesh) {
        mesh = this.arena.createCardMesh(cardData);
        this.arena.scene.add(mesh);
      }
      mesh.userData.card = cardData;
      cardData.mesh = mesh;
      return cardData;
    };

    this.drawPile = state.drawPile.map((c, idx) => {
      const card = attachMesh({ ...c });
      card.mesh.userData.isDrawDeck = true;
      card.mesh.position.set(
        this.deckPos.x,
        this.deckPos.y + idx * 0.0045,
        this.deckPos.z
      );
      card.mesh.rotation.set(Math.PI / 2, 0, 0);
      return card;
    });

    this.discardPile = state.discardPile.map((c, idx) => {
      const card = attachMesh({ ...c });
      card.mesh.userData.isDrawDeck = false;
      const isNewlyPlayedTop =
        idx === state.discardPile.length - 1 &&
        event?.playedEvent?.card?.id === card.id;
      if (isNewlyPlayedTop) {
        // Animate the newly played card flying smoothly in 3D on guest screens!
        this.animateCardToDiscard(card, card.color === 'wild' || ['skip', 'reverse', 'draw2'].includes(card.value));
      } else {
        card.mesh.position.set(
          this.discardPos.x,
          this.discardPos.y + (idx + 1) * 0.0055,
          this.discardPos.z
        );
        card.mesh.rotation.set(-Math.PI / 2, 0, ((idx % 5) - 2) * 0.12);
        card.mesh.scale.set(1, 1, 1);
      }
      return card;
    });

    this.players = state.players.map((p) => ({
      id: p.id,
      rawName: p.rawName,
      name: p.isVacant
        ? 'VACANT SEAT'
        : p.id === this.localSeat
          ? `${p.rawName} (You)`
          : p.rawName,
      isBot: p.isBot,
      activeSeat: p.activeSeat,
      isVacant: p.isVacant,
      calledUno: p.calledUno,
      hand: p.hand.map((c) => {
        const card = attachMesh({ ...c });
        card.mesh.userData.isDrawDeck = false;
        card.mesh.userData.owner = p.id;
        return card;
      }),
    }));

    this.update3DSeatTotems();
    this.arena.setActiveColorVisual(this.activeColor);
    this.arena.setDirectionVisual(this.direction);
    this.arena.highlightTurnPlayer(this.getVisualSlot(this.currentPlayer));
    this.layoutAllHands();
    this.syncHUD();
    this.updateTurnBannerForCurrentPlayer();

    if (event?.playedEvent && this.ui.showCardPlayedBanner) {
      const pe = event.playedEvent;
      this.ui.showCardPlayedBanner(
        pe.byName,
        pe.card,
        pe.activeColor || this.activeColor,
        pe.bySeat === this.localSeat
      );
    }
    if (event?.fxLabel) {
      this.ui.showFloatingFX(event.fxLabel, this.activeColor);
      this.arena.triggerShockwave(this.activeColor, 1.15);
    }
    if (event?.type === 'match_won') {
      const winner = this.players[event.winnerSeat];
      if (winner) this.handleMatchWin(winner);
    }

    const me = this.players[this.localSeat];
    if (me && me.hand.length === 1 && !me.calledUno && !this.gameOver) {
      this.triggerHumanUnoChallenge();
    }
  }

  cycleCameraView() {
    this.cameraPresetIndex = (this.cameraPresetIndex + 1) % 3;
    const presets = [
      {
        name: 'Tabletop Perspective',
        pos: this.arena.baseCamPos.clone(),
        look: this.arena.baseLookAt.clone(),
      },
      {
        name: 'Cinema Close-Up',
        pos: new THREE.Vector3(0, 6.4, 7.6),
        look: new THREE.Vector3(0, 0.3, 0.7),
      },
      {
        name: 'Overhead Arena',
        pos: new THREE.Vector3(0, 12.8, 4.8),
        look: new THREE.Vector3(0, 0, 0.5),
      },
    ];
    const preset = presets[this.cameraPresetIndex];
    gsap.to(this.arena.camera.position, {
      x: preset.pos.x,
      y: preset.pos.y,
      z: preset.pos.z,
      duration: 0.7,
      ease: 'power3.out',
    });
    gsap.to(this.arena.currentLookAt, {
      x: preset.look.x,
      y: preset.look.y,
      z: preset.look.z,
      duration: 0.7,
      ease: 'power3.out',
    });
    this.ui.showBanner(`Camera: ${preset.name}`, this.activeColor);
  }

  handleMatchWin(winner) {
    this.gameOver = true;
    this.isBusy = false;
    if (this.unoWindowTimer) clearTimeout(this.unoWindowTimer);
    this.ui.hideUnoShoutButton();

    sound.playUnoShout();
    this.arena.triggerShockwave(this.activeColor, 2.2);
    this.arena.cameraPunch(1.5);

    let points = 0;
    this.players.forEach((p) => {
      if (p.id !== winner.id) {
        p.hand.forEach((c) => {
          if (c.color === 'wild') points += 50;
          else if (['skip', 'reverse', 'draw2'].includes(c.value)) points += 20;
          else points += parseInt(c.value, 10) || 0;
        });
      }
    });

    this.ui.openVictoryModal(
      winner,
      points,
      winner.id === this.localSeat,
      this.activeCampaignLevel
    );
  }

  syncHUD() {
    const visualPlayers = [0, 1, 2, 3].map((logicalSeat) => {
      const p = this.players[logicalSeat];
      const visualSlot = this.getVisualSlot(logicalSeat);
      return {
        logicalSeat,
        visualSlot,
        name: p.name,
        rawName: p.rawName || p.name,
        isBot: p.isBot,
        activeSeat: p.activeSeat !== false,
        isVacant: Boolean(p.isVacant),
        count: p.hand.length,
        isTurn:
          !this.waitingForAdminStart && logicalSeat === this.currentPlayer,
        calledUno: p.calledUno && p.hand.length === 1,
      };
    });

    this.ui.updateHUD({
      visualPlayers,
      activeColor: this.activeColor,
      activeValue: this.activeValue,
      direction: this.direction,
      drawCount: this.drawPile.length,
      pendingDrawStack: this.pendingDrawStack,
      rules: this.rules,
      waitingForAdminStart: this.waitingForAdminStart,
      activeCampaignLevel: this.activeCampaignLevel,
    });
  }
}
