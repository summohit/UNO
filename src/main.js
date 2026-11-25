import { Uno3DArena } from './scene.js';
import { Uno3DGame, DEFAULT_RULES, CAMPAIGN_LEVELS } from './game.js';
import { MultiplayerClient } from './network.js';
import { COLOR_PALETTE, getCardFaceDataUrl } from './textures.js';
import { sound } from './audio.js';

// Fallback for <dialog closedby="any"> light-dismiss in browsers without native closedBy support
if (!('closedBy' in HTMLDialogElement.prototype)) {
  const outside = (e, dialog) => {
    const r = dialog.getBoundingClientRect();
    return (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    );
  };
  for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (e) => {
      pressedOutside = outside(e, dialog);
    });
    dialog.addEventListener('pointerup', (e) => {
      if (pressedOutside && outside(e, dialog)) dialog.close();
    });
  }
}

// ============================================================================
// 1. Slide-Out Hamburger Navigation Drawer (modern-web-guidance navigation-drawer)
// ============================================================================
const drawer = document.getElementById('nav-drawer');
const openDrawerBtn = document.getElementById('drawer-open');
const closeDrawerBtn = document.getElementById('drawer-close');
const drawerScroller = drawer.querySelector('.Drawer-scroller');
const drawerSheet = drawer.querySelector('.Drawer-sheet');

if (!CSS.supports('animation-timeline: scroll()')) {
  drawerScroller.addEventListener('scroll', () => {
    const ratio = 1 - drawerScroller.scrollLeft / drawerSheet.offsetWidth;
    drawer.style.setProperty('--drawer-backdrop', String(Math.max(0, Math.min(1, ratio))));
  });
}

async function openDrawer() {
  drawer.showModal();
  if (!CSS.supports('scroll-initial-target', 'nearest')) {
    drawerScroller.scrollTo({ left: drawerScroller.offsetWidth, behavior: 'instant' });
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r))
    );
  }
  drawerScroller.scrollTo({ left: 0, behavior: 'auto' });
}

function closeDrawer() {
  if (!drawer.open) return;
  drawerScroller.scrollTo({ left: drawerScroller.offsetWidth, behavior: 'auto' });
}

// innerWidth can be 0 while a tab loads in the background; keep the threshold finite.
const visibleThreshold = 1 / Math.max(window.innerWidth, 1);
const drawerObserver = new IntersectionObserver(
  (entries) => {
    const entry = entries.at(-1);
    if (!entry) return;
    if (entry.intersectionRatio < visibleThreshold && drawer.open) {
      drawer.close();
      openDrawerBtn.setAttribute('aria-expanded', 'false');
    }
    if (entry.intersectionRatio === 1) {
      openDrawerBtn.setAttribute('aria-expanded', 'true');
    }
  },
  { root: drawer, threshold: [visibleThreshold, 1] }
);
drawerObserver.observe(drawerSheet);

openDrawerBtn.addEventListener('click', openDrawer);
closeDrawerBtn.addEventListener('click', closeDrawer);

drawer.addEventListener('click', (event) => {
  if (!drawerSheet.contains(event.target)) closeDrawer();
});

drawer.addEventListener('cancel', (event) => {
  if (event.cancelable) {
    event.preventDefault();
    closeDrawer();
  }
});

// Helper to close drawer before opening another modal dialog
function closeDrawerAndRun(fn) {
  if (drawer.open) {
    drawer.close();
    openDrawerBtn.setAttribute('aria-expanded', 'false');
  }
  fn();
}

// ============================================================================
// 2. Local Player Profile (name + coins/xp saved in this browser)
// ============================================================================
const STORAGE_KEY = 'uno_3d_local_profile_v1';

const playerProfile = {
  displayName: 'Player',
  xp: 0,
  level: 1,
  coins: 500,
};

try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    playerProfile.displayName = saved.displayName || playerProfile.displayName;
    playerProfile.xp = Number(saved.xp) || 0;
    playerProfile.level = Number(saved.level) || 1;
    playerProfile.coins = Number(saved.coins) || 500;
  }
} catch (_) {
  // Ignore storage errors
}

function saveProfile() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(playerProfile));
  } catch (_) {
    // Ignore storage errors
  }
}

// ============================================================================
// 3. DOM Elements & UI Callbacks
// ============================================================================
const canvas = document.getElementById('uno-canvas');
const turnBanner = document.getElementById('turn-banner');
const fxCallout = document.getElementById('fx-callout');
const activeColorOrb = document.getElementById('active-color-orb');
const activeStateText = document.getElementById('active-state-text');
const stackBadge = document.getElementById('stack-badge');
const directionBadge = document.getElementById('direction-badge');
const drawBtnLabel = document.getElementById('draw-btn-label');
const unoShoutBtn = document.getElementById('uno-shout-btn');

const wildDialog = document.getElementById('wild-dialog');
const wildRequiredMsg = document.getElementById('wild-required-msg');
const victoryDialog = document.getElementById('victory-dialog');
const victoryTitle = document.getElementById('victory-dialog-title');
const victorySubtitle = document.getElementById('victory-subtitle');
const victoryScore = document.getElementById('victory-score');
const rulesDialog = document.getElementById('rules-dialog');
const houseRulesForm = document.getElementById('house-rules-form');
const mpDialog = document.getElementById('multiplayer-dialog');
const mpStatusBanner = document.getElementById('mp-status-banner');
const homeScreen = document.getElementById('home-screen');
const homeForm = document.getElementById('home-form');
const homeNameInput = document.getElementById('home-player-name');
const mpEntryForms = document.getElementById('mp-entry-forms');
const campaignDialog = document.getElementById('campaign-dialog');

// On-Table Multiplayer Waiting Overlay
const tableWaitingOverlay = document.getElementById('table-waiting-overlay');
const overlayRoomName = document.getElementById('overlay-room-name');
const overlayRoomCode = document.getElementById('overlay-room-code');
const overlayWaitingStatus = document.getElementById('overlay-waiting-status');
const overlaySeatList = document.getElementById('overlay-seat-list');
const overlayAdminStartBtn = document.getElementById('overlay-admin-start-btn');

let fxTimer = null;

function syncRulesFormFromObject(rules) {
  document.getElementById('rule-stacking').checked = Boolean(rules.stacking);
  document.getElementById('rule-seven-zero').checked = Boolean(rules.sevenZeroSwap);
  document.getElementById('rule-draw-until').checked = Boolean(
    rules.drawUntilPlayable
  );
  document.getElementById('rule-jump-in').checked = Boolean(rules.jumpIn);

  const handRadio = houseRulesForm.querySelector(
    `input[name="startingHandSize"][value="${rules.startingHandSize}"]`
  );
  if (handRadio) handRadio.checked = true;

  const penRadio = houseRulesForm.querySelector(
    `input[name="unoPenaltyCards"][value="${rules.unoPenaltyCards}"]`
  );
  if (penRadio) penRadio.checked = true;
}

const uiCallbacks = {
  showBanner(text, colorKey = 'neutral') {
    turnBanner.textContent = text;
    const pal = COLOR_PALETTE[colorKey];
    if (pal) {
      turnBanner.style.borderColor = pal.glow;
    } else {
      turnBanner.style.borderColor = 'rgba(148, 163, 184, 0.24)';
    }
  },

  showFloatingFX(text, colorKey = 'yellow') {
    const pal = COLOR_PALETTE[colorKey] || COLOR_PALETTE.yellow;
    fxCallout.textContent = text;
    fxCallout.style.borderColor = pal.glow;
    fxCallout.style.boxShadow = `0 12px 38px ${pal.main}66`;
    fxCallout.classList.add('visible');
    if (fxTimer) clearTimeout(fxTimer);
    fxTimer = setTimeout(() => {
      fxCallout.classList.remove('visible');
    }, 1450);
  },

  showUnoShoutButton() {
    unoShoutBtn.hidden = false;
  },

  hideUnoShoutButton() {
    unoShoutBtn.hidden = true;
  },

  openWildColorModal() {
    wildRequiredMsg.classList.remove('warn');
    wildDialog.returnValue = '';
    if (!wildDialog.open) {
      wildDialog.showModal();
    }
  },

  openVictoryModal(
    winner,
    score,
    isLocalWinner,
    campaignLevel,
    isMultiplayer = false,
    standings = [],
    stats = {}
  ) {
    const lvlInfo =
      CAMPAIGN_LEVELS.find((l) => l.level === campaignLevel) ||
      CAMPAIGN_LEVELS[0];
    // Campaign rewards are for solo games only.
    const earnsReward = isLocalWinner && !isMultiplayer;
    if (earnsReward) {
      playerProfile.coins += lvlInfo.rewardCoins;
      playerProfile.xp += lvlInfo.rewardXp;
      playerProfile.level = Math.max(
        playerProfile.level,
        Math.min(5, 1 + Math.floor(playerProfile.xp / 250))
      );
      saveProfile();
      syncProfileUI();
    }

    victoryTitle.textContent = isLocalWinner
      ? 'Victory in 3D Arena!'
      : `${winner.rawName || winner.name} Wins!`;
    victorySubtitle.textContent = isLocalWinner
      ? isMultiplayer
        ? 'You emptied your hand first!'
        : `You conquered ${lvlInfo.title}!`
      : `${winner.rawName || winner.name} emptied their hand first. Ready for a rematch?`;
    victoryScore.textContent = earnsReward
      ? `+${score} PTS • +${lvlInfo.rewardCoins} 🪙`
      : `+${score} PTS`;

    // Update XP Progress Bar
    const xpWithinLevel = playerProfile.xp % 250;
    const xpPct = Math.min(100, Math.round((xpWithinLevel / 250) * 100));
    const lvlLabel = document.getElementById('victory-level-label');
    const xpLabel = document.getElementById('victory-xp-label');
    const xpFill = document.getElementById('victory-xp-fill');
    if (lvlLabel) lvlLabel.textContent = `Level ${playerProfile.level}`;
    if (xpLabel) {
      xpLabel.textContent = earnsReward
        ? `${xpWithinLevel} / 250 XP (+${lvlInfo.rewardXp})`
        : `${xpWithinLevel} / 250 XP`;
    }
    if (xpFill) {
      xpFill.style.width = '0%';
      requestAnimationFrame(() => {
        xpFill.style.width = `${xpPct}%`;
      });
    }

    // Render 1st–4th Podium Standings
    const podiumList = document.getElementById('victory-podium-list');
    if (podiumList) {
      podiumList.innerHTML = '';
      const medals = ['🥇', '🥈', '🥉', '4️⃣'];
      standings.forEach((entry, idx) => {
        const li = document.createElement('li');
        li.className = `podium-row ${entry.isWinner ? 'winner-row' : ''}`;
        const left = document.createElement('span');
        left.className = 'podium-left';
        left.textContent = `${medals[idx] || `${idx + 1}.`} ${entry.name}`;
        const right = document.createElement('span');
        right.className = 'podium-cards-tag';
        right.textContent = entry.isWinner
          ? 'WINNER'
          : `${entry.cardsLeft} ${entry.cardsLeft === 1 ? 'card' : 'cards'} left`;
        li.append(left, right);
        podiumList.appendChild(li);
      });
    }

    // Populate Match Stats Grid
    const setStat = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };
    setStat('stat-cards-played', stats.cardsPlayed ?? 0);
    setStat('stat-action-cards', stats.actionCardsPlayed ?? 0);
    setStat('stat-biggest-stack', `+${stats.biggestStack ?? 0}`);
    setStat('stat-total-draws', stats.drawsTotal ?? 0);

    victoryDialog.returnValue = '';
    if (!victoryDialog.open) {
      victoryDialog.showModal();
    }
  },

  updateHUD(state) {
    const pal = COLOR_PALETTE[state.activeColor] || COLOR_PALETTE.red;
    activeColorOrb.style.backgroundColor = pal.main;
    activeColorOrb.style.boxShadow = `0 0 12px ${pal.glow}`;

    const valDisplay =
      state.activeValue === 'draw2'
        ? '+2'
        : state.activeValue === 'wild4'
          ? '+4'
          : state.activeValue.toUpperCase();
    activeStateText.textContent = `${pal.label.toUpperCase()} • ${valDisplay}`;
    directionBadge.textContent = state.direction === 1 ? '👑 CW' : '👑 CCW';

    const lastCardThumb = document.getElementById('last-card-thumb');
    if (lastCardThumb) {
      const topColor =
        state.activeValue === 'wild' || state.activeValue === 'wild4'
          ? 'wild'
          : state.activeColor;
      lastCardThumb.src = getCardFaceDataUrl(topColor, state.activeValue);
      lastCardThumb.hidden = false;
    }

    if (state.pendingDrawStack > 0) {
      stackBadge.hidden = false;
      stackBadge.textContent = `STACK +${state.pendingDrawStack}`;
      drawBtnLabel.innerHTML = `Accept Stack (<strong>+${state.pendingDrawStack}</strong>)`;
    } else {
      stackBadge.hidden = true;
      drawBtnLabel.innerHTML = `Draw (<strong id="draw-pile-count">${state.drawCount}</strong>)`;
    }

    const lvl =
      CAMPAIGN_LEVELS.find((l) => l.level === state.activeCampaignLevel) ||
      CAMPAIGN_LEVELS[1];
    document.getElementById('top-level-text').textContent = lvl.title;
    document.getElementById('drawer-level-subtext').textContent = lvl.title;

    state.visualPlayers.forEach((vp) => {
      const seatEl = document.getElementById(`seat-${vp.visualSlot}`);
      const nameEl = document.getElementById(`name-${vp.visualSlot}`);
      const countEl = document.getElementById(`count-${vp.visualSlot}`);
      const unoEl = document.getElementById(`uno-${vp.visualSlot}`);

      if (seatEl) {
        const isPlayingMatch = !state.waitingForAdminStart && !game.gameOver;
        seatEl.classList.toggle('active-turn', vp.isTurn);
        seatEl.classList.toggle('vacant-seat', vp.isVacant);
        seatEl.classList.toggle(
          'blurred-inactive',
          isPlayingMatch && !vp.isTurn && !vp.isVacant
        );
      }
      if (nameEl) {
        nameEl.textContent = vp.isVacant ? 'VACANT SEAT' : vp.name;
      }
      if (countEl) {
        countEl.textContent = vp.isVacant
          ? 'Waiting for player...'
          : state.waitingForAdminStart
            ? 'Ready in lobby'
            : `${vp.count} ${vp.count === 1 ? 'card' : 'cards'}`;
      }
      if (unoEl) {
        unoEl.hidden = !vp.calledUno;
      }
    });
  },
};

const arena = new Uno3DArena(canvas);
const game = new Uno3DGame(arena, uiCallbacks);

const homeAvatar = document.getElementById('home-avatar');
const hudAvatarBtn = document.getElementById('hud-avatar-btn');
const hudAvatarLetter = document.getElementById('hud-avatar-letter');
const topLevelPill = document.getElementById('top-level-pill');
const homeArenaBtn = document.getElementById('home-arena-btn');
const onlineDot = document.getElementById('online-dot');
const onlineText = document.getElementById('online-text');

const seatReactionTimers = new Map();

function spawnFloatingEmojis(anchorEl, emoji) {
  if (!anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const baseX = rect.left + rect.width / 2;
  const baseY = rect.top + rect.height / 3;
  for (let i = 0; i < 3; i++) {
    const p = document.createElement('span');
    p.className = 'floating-emoji-particle';
    p.textContent = emoji;
    p.style.left = `${baseX + (i - 1) * 18}px`;
    p.style.top = `${baseY}px`;
    p.style.setProperty('--drift', `${(Math.random() - 0.5) * 44}px`);
    p.style.animationDelay = `${i * 90}ms`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1300);
  }
}

function showSeatReaction(visualSlot, emoji, label = '') {
  const bubble = document.getElementById(`reaction-${visualSlot}`);
  const seatEl = document.getElementById(`seat-${visualSlot}`);
  if (!bubble) return;

  // Built with textContent: labels can contain player names.
  const emojiSpan = document.createElement('span');
  emojiSpan.textContent = emoji;
  bubble.replaceChildren(emojiSpan);
  if (label) {
    const labelSpan = document.createElement('span');
    labelSpan.className = 'rx-label';
    labelSpan.textContent = label;
    bubble.append(labelSpan);
  }
  bubble.classList.add('show');
  spawnFloatingEmojis(seatEl, emoji);

  if (seatReactionTimers.has(visualSlot)) {
    clearTimeout(seatReactionTimers.get(visualSlot));
  }
  seatReactionTimers.set(
    visualSlot,
    setTimeout(() => {
      bubble.classList.remove('show');
    }, 1850)
  );
}

uiCallbacks.showSeatReaction = showSeatReaction;

function updateHomeAvatarLetter(nameStr) {
  const ch = (nameStr || 'P').trim().charAt(0).toUpperCase() || 'P';
  if (homeAvatar) homeAvatar.textContent = ch;
  if (hudAvatarLetter) hudAvatarLetter.textContent = ch;
}

function updateHomeArenaLine() {
  const lvl =
    CAMPAIGN_LEVELS.find((l) => l.level === game.activeCampaignLevel) ||
    CAMPAIGN_LEVELS[1];
  const arenaName = lvl.title.replace(/^Level\s+\d+:\s*/i, '');
  const el = document.getElementById('home-arena-line');
  if (el) {
    el.innerHTML = `Arena: <em>Level ${lvl.level}</em> • <em>${arenaName}</em>`;
  }
}

function syncProfileUI() {
  document.getElementById('top-coins-text').textContent = String(playerProfile.coins);
  homeNameInput.value = playerProfile.displayName;
  updateHomeAvatarLetter(playerProfile.displayName);
  document.getElementById('create-player-name').value = playerProfile.displayName;
  document.getElementById('join-player-name').value = playerProfile.displayName;
  game.setLocalProfileName(playerProfile.displayName);
}

// ============================================================================
// Home Screen: Play with Bots / Create Room / Join Room
// ============================================================================
function showHomeScreen() {
  if (network.isInRoom()) network.leaveRoom();
  tableWaitingOverlay.hidden = true;
  game.stopLocalGame();
  game.view = null;
  game.clearBoardMeshes();
  game.waitingForAdminStart = false;
  uiCallbacks.hideUnoShoutButton();
  uiCallbacks.showBanner('Choose a game mode to begin', 'neutral');
  document.getElementById('drawer-mp-subtext').textContent = 'Create room or join by code';
  updateHomeArenaLine();
  homeScreen.hidden = false;
  document.body.classList.add('home-active');
}

function hideHomeScreen() {
  homeScreen.hidden = true;
  document.body.classList.remove('home-active');
}

const mpDialogTitle = document.getElementById('mp-dialog-title');
const mpTabCreate = document.getElementById('mp-tab-create');
const mpTabJoin = document.getElementById('mp-tab-join');

function setMultiplayerModalMode(mode) {
  const activeMode = mode === 'join' ? 'join' : 'create';
  mpDialog.dataset.mode = activeMode;
  mpEntryForms.dataset.mode = activeMode;

  if (mpDialogTitle) {
    mpDialogTitle.textContent =
      activeMode === 'join' ? 'Join Existing Room' : 'Create a New Room';
  }
  if (mpTabCreate && mpTabJoin) {
    mpTabCreate.classList.toggle('active', activeMode === 'create');
    mpTabJoin.classList.toggle('active', activeMode === 'join');
  }
  mpStatusBanner.classList.remove('warn');
  mpStatusBanner.innerHTML =
    activeMode === 'join'
      ? 'Enter the 6-character code or exact Room Name your friend shared.'
      : 'Name your room to get a 6-character code and shareable invite link.';
}

function openMultiplayerDialog(mode = 'create') {
  setMultiplayerModalMode(mode === 'both' ? 'create' : mode);
  mpDialog.returnValue = '';
  if (!mpDialog.open) mpDialog.showModal();
}

if (mpTabCreate) {
  mpTabCreate.addEventListener('click', () => setMultiplayerModalMode('create'));
}
if (mpTabJoin) {
  mpTabJoin.addEventListener('click', () => setMultiplayerModalMode('join'));
}

homeNameInput.addEventListener('input', () => {
  homeNameInput.setCustomValidity('');
  updateHomeAvatarLetter(homeNameInput.value);
});

if (homeAvatar) {
  homeAvatar.addEventListener('click', openDrawer);
}

if (homeArenaBtn) {
  homeArenaBtn.addEventListener('click', () => {
    renderCampaignLevels();
    campaignDialog.returnValue = '';
    campaignDialog.showModal();
  });
}

homeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = homeNameInput.value.trim();
  if (name.length < 2) {
    homeNameInput.setCustomValidity('Please enter a name with at least 2 characters.');
    homeNameInput.reportValidity();
    homeNameInput.focus();
    return;
  }
  playerProfile.displayName = name;
  saveProfile();
  syncProfileUI();

  const mode = e.submitter?.value || 'bots';
  if (mode === 'bots') {
    hideHomeScreen();
    game.startNewMatch();
  } else {
    openMultiplayerDialog(mode);
  }
});

// ============================================================================
// 4. Multiplayer Room Waiting Overlay (Vacant Seats & Admin Start Control)
// ============================================================================
function renderWaitingRoomOverlay(room, localSeat) {
  if (!room || room.started) {
    tableWaitingOverlay.hidden = true;
    return;
  }

  tableWaitingOverlay.hidden = false;
  overlayRoomName.textContent = room.roomName || 'UNO Room';
  overlayRoomCode.textContent = room.code;

  const isAdmin = network.isHost();
  const occupiedCount = room.players.length;
  document.getElementById('drawer-mp-subtext').textContent =
    `Room "${room.roomName}" (${room.code}) • ${occupiedCount}/4 Players`;

  // Built from text nodes: the room name comes from another player.
  const strong = (t) => {
    const el = document.createElement('strong');
    el.textContent = t;
    return el;
  };
  overlayWaitingStatus.replaceChildren(
    ...(isAdmin
      ? [
          'You are the ', strong('Room Admin'), '. Empty seats wait for players to join with code ',
          strong(room.code), '. The game starts when you click Start Game.',
        ]
      : ['Joined room ', strong(room.roomName), '. Waiting for the room host to start the match...'])
  );

  overlaySeatList.innerHTML = '';
  for (let s = 0; s < 4; s++) {
    const occupant = room.players.find((p) => p.seat === s);
    const li = document.createElement('li');
    li.className = `waiting-seat-slot ${occupant ? '' : 'vacant'}`;

    const topRow = document.createElement('div');
    topRow.className = 'waiting-seat-top';
    const status = !occupant
      ? '⚪ VACANT'
      : occupant.away
        ? '📡 RECONNECTING'
        : occupant.isBot
          ? '🤖 BOT'
          : '🟢 READY';
    const isRoomHost = occupant && occupant.id === room.hostId;
    topRow.innerHTML = `<span>SEAT ${s + 1} ${isRoomHost ? '• ADMIN' : ''}</span><span>${status}</span>`;

    const nameEl = document.createElement('strong');
    nameEl.className = 'waiting-seat-name';
    if (occupant) {
      nameEl.textContent =
        s === localSeat
          ? `${occupant.name} (You)`
          : occupant.name;
    } else {
      nameEl.textContent = 'Vacant — Waiting for player...';
    }

    li.append(topRow, nameEl);

    // Allow Admin to optionally add or remove a Bot on seats 1..3 if they want
    if (isAdmin && s > 0 && (!occupant || occupant.isBot)) {
      const botBtn = document.createElement('button');
      botBtn.type = 'button';
      botBtn.className = 'seat-bot-toggle-btn';
      botBtn.textContent = occupant?.isBot
        ? '✕ Remove Bot (Make Vacant)'
        : '+ Add AI Bot to Seat';
      botBtn.addEventListener('click', () => {
        network.toggleSeatBot(s);
      });
      li.appendChild(botBtn);
    }

    overlaySeatList.appendChild(li);
  }

  overlayAdminStartBtn.hidden = !isAdmin;
  overlayAdminStartBtn.textContent =
    occupiedCount >= 2
      ? `▶ Start Game Now (${occupiedCount}/4 Players)`
      : '▶ Start Game (Need at least 2 Players)';
}

const network = new MultiplayerClient({
  onConnectionChange(connected, wasInRoom) {
    if (onlineDot) onlineDot.classList.toggle('live', connected);
    if (!connected && onlineText) {
      onlineText.textContent = 'Offline • Solo Ready';
    }
    // In a room: keep the table on screen and rejoin automatically.
    if (!connected && wasInRoom) {
      uiCallbacks.showBanner('Connection lost • Reconnecting...', 'red');
    }
  },

  onRoomLost(message) {
    showHomeScreen();
    uiCallbacks.showBanner(
      message || 'Your seat in the room was released. Join again with the room code.',
      'red'
    );
  },

  onOnlineCount(count) {
    if (onlineDot) onlineDot.classList.add('live');
    if (onlineText) {
      onlineText.textContent = `Online • ${count} ${count === 1 ? 'player' : 'players'}`;
    }
  },

  onRoomJoined(room, localSeat) {
    hideHomeScreen();
    if (mpDialog.open) mpDialog.close();
    if (!room.started) {
      // Wait in the lobby until the host starts the match.
      game.enterRoomWaitingState(room, localSeat);
      renderWaitingRoomOverlay(room, localSeat);
    } else {
      // Joined a running match: the server sends the current table next.
      tableWaitingOverlay.hidden = true;
      game.stopLocalGame();
      game.prepareForMatch(localSeat);
    }
  },

  onRoomUpdated(room, localSeat) {
    if (!room.started) {
      game.enterRoomWaitingState(room, localSeat);
      renderWaitingRoomOverlay(room, localSeat);
    } else {
      tableWaitingOverlay.hidden = true;
      game.configureRosterFromRoom(room, localSeat);
    }
  },

  onRoomError(message) {
    mpStatusBanner.textContent = message;
    mpStatusBanner.classList.add('warn');
    overlayWaitingStatus.textContent = message;
    uiCallbacks.showBanner(message, 'red');
  },

  onMatchStarted(room, localSeat) {
    hideHomeScreen();
    tableWaitingOverlay.hidden = true;
    if (mpDialog.open) mpDialog.close();
    if (victoryDialog.open) victoryDialog.close();
    game.stopLocalGame();
    game.prepareForMatch(localSeat);
    game.configureRosterFromRoom(room, localSeat);
  },

  onGameUpdate(payload) {
    tableWaitingOverlay.hidden = true;
    game.onGameUpdate(payload);
  },

  onActionError(error) {
    game.onActionError(error);
  },

  onRoomEmote(seat, playerName, emote) {
    const visualSlot = game.getVisualSlot(seat);
    showSeatReaction(visualSlot, emote, visualSlot === 0 ? '' : playerName);
    sound.playCardSwoosh();
  },
});

game.attachNetwork(network);
window.unoGame = game;

// ============================================================================
// 5. Campaign Multi-Level Selector Renderer
// ============================================================================
function renderCampaignLevels() {
  const container = document.getElementById('campaign-levels-list');
  container.innerHTML = '';

  CAMPAIGN_LEVELS.forEach((lvl) => {
    const isCurrent = game.activeCampaignLevel === lvl.level;
    const card = document.createElement('div');
    card.className = `campaign-level-card ${isCurrent ? 'active-level' : ''}`;

    const meta = document.createElement('div');
    meta.className = 'level-meta';
    meta.innerHTML = `
      <strong>${lvl.title}</strong>
      <span>${lvl.subtitle}</span>
      <span class="level-reward-tag">Reward: +${lvl.rewardCoins} 🪙 • +${lvl.rewardXp} XP</span>
    `;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = isCurrent ? 'primary-modal-btn' : 'secondary-modal-btn';
    btn.style.width = 'auto';
    btn.textContent = isCurrent ? '✓ Active Arena (Play)' : 'Play Level';
    btn.addEventListener('click', () => {
      game.selectCampaignLevel(lvl.level);
      syncRulesFormFromObject(game.rules);
      campaignDialog.close();
      if (!network.isInRoom()) {
        hideHomeScreen();
        game.startNewMatch();
      }
      uiCallbacks.showFloatingFX(lvl.title.toUpperCase(), game.activeColor);
    });

    card.append(meta, btn);
    container.appendChild(card);
  });
}

// ============================================================================
// 6. Event Listeners (Hamburger Menu, Home Screen, Waiting Lobby, Table)
// ============================================================================
const playedCardToast = document.getElementById('played-card-toast');
const playedMiniCard = document.getElementById('played-mini-card');
const playedMiniSymbol = document.getElementById('played-mini-symbol');
const playedByName = document.getElementById('played-by-name');
const playedCardName = document.getElementById('played-card-name');
let playedToastTimer = null;

function formatCardSymbol(val) {
  if (val === 'skip') return '⊘';
  if (val === 'reverse') return '⇄';
  if (val === 'draw2') return '+2';
  if (val === 'wild') return 'W';
  if (val === 'wild4') return '+4';
  return String(val);
}

function formatCardFullName(card, activeColor) {
  const activePal = COLOR_PALETTE[activeColor] || COLOR_PALETTE.red;
  if (card.value === 'wild') return `Wild → ${activePal.label}`;
  if (card.value === 'wild4') return `Wild +4 → ${activePal.label}`;
  const cardPal = COLOR_PALETTE[card.color] || activePal;
  const valLabel =
    card.value === 'draw2'
      ? 'Draw +2'
      : card.value === 'skip'
        ? 'Skip'
        : card.value === 'reverse'
          ? 'Reverse'
          : card.value;
  return `${cardPal.label} ${valLabel}`;
}

uiCallbacks.showCardPlayedBanner = (playerName, card, activeColor, isMe) => {
  if (!playedCardToast || !card) return;
  const displayColor = card.color === 'wild' ? activeColor : card.color;
  const pal = COLOR_PALETTE[displayColor] || COLOR_PALETTE.wild;

  playedMiniCard.style.background =
    card.color === 'wild'
      ? `linear-gradient(145deg, #1e1b4b, ${pal.main})`
      : `linear-gradient(145deg, ${pal.main}, ${pal.dark})`;
  playedMiniSymbol.textContent = formatCardSymbol(card.value);
  playedMiniSymbol.style.color = pal.dark || '#111827';
  playedByName.textContent = isMe ? 'You played' : `${playerName} played`;
  playedCardName.textContent = formatCardFullName(card, activeColor);
  playedCardToast.style.borderColor = pal.glow;

  // Restart animation cleanly on rapid plays
  playedCardToast.classList.remove('show');
  void playedCardToast.offsetWidth;
  playedCardToast.classList.add('show');

  if (playedToastTimer) clearTimeout(playedToastTimer);
  playedToastTimer = setTimeout(() => {
    playedCardToast.classList.remove('show');
  }, 1900);
};

// Hover preview disabled per user preference; direct tap/click plays cards cleanly
canvas.addEventListener('pointerdown', (e) => {
  game.handleHumanTap(e.clientX, e.clientY);
});

// Live Match Feed (Last 3 Plays Strip)
const matchFeedBox = document.getElementById('match-feed-box');
const matchFeedList = document.getElementById('match-feed-list');
const feedToggleBtn = document.getElementById('feed-toggle-btn');

uiCallbacks.clearMatchFeed = () => {
  if (matchFeedList) matchFeedList.innerHTML = '';
};

uiCallbacks.pushMatchFeed = (text, colorKey = 'neutral') => {
  if (!matchFeedList) return;
  const pal = COLOR_PALETTE[colorKey];
  const li = document.createElement('li');
  li.className = 'feed-item';

  const dot = document.createElement('span');
  dot.className = 'feed-item-dot';
  dot.style.backgroundColor = pal ? pal.main : '#94a3b8';
  if (pal) dot.style.boxShadow = `0 0 8px ${pal.glow}`;

  const span = document.createElement('span');
  span.textContent = text;
  li.append(dot, span);

  matchFeedList.prepend(li);
  while (matchFeedList.children.length > 3) {
    matchFeedList.removeChild(matchFeedList.lastElementChild);
  }
};

if (feedToggleBtn && matchFeedBox) {
  feedToggleBtn.addEventListener('click', () => {
    const collapsed = matchFeedBox.classList.toggle('collapsed');
    feedToggleBtn.textContent = collapsed ? '▸' : '▾';
    feedToggleBtn.setAttribute('aria-expanded', String(!collapsed));
  });
}

// Last Card HD Preview Modal & Show All Cards Modal
const lastCardDialog = document.getElementById('last-card-dialog');
const lastCardByLabel = document.getElementById('last-card-by-label');
const lastCardDialogTitle = document.getElementById('last-card-dialog-title');
const lastCardPreviewImg = document.getElementById('last-card-preview-img');
const lastCardRuleDesc = document.getElementById('last-card-rule-desc');

const allCardsDialog = document.getElementById('all-cards-dialog');
const allCardsGrid = document.getElementById('all-cards-grid');
const allCardsCountLabel = document.getElementById('all-cards-count-label');
const allCardsHint = document.getElementById('all-cards-hint');

const CARD_RULE_TEXT = {
  skip: 'Skip: The next player in turn order loses their turn.',
  reverse: 'Reverse: Flips the 3D arena play direction (acts as Skip in 2-player).',
  draw2: 'Draw +2: Forces the next player to draw 2 cards (or stack another +2/+4).',
  wild: 'Wild: Playable on any turn to change the active arena color.',
  wild4: 'Wild Draw +4: Changes the active color and forces the next player to draw 4 cards.',
};

uiCallbacks.openLastCardPreview = (info) => {
  if (!lastCardDialog || !info || !info.card) return;
  const card = info.card;
  const activeCol = info.activeColor || card.color;
  lastCardByLabel.textContent =
    info.byName === 'Opening Card'
      ? 'OPENING TABLE CARD'
      : `THROWN BY ${String(info.byName || 'PLAYER').toUpperCase()}`;
  lastCardDialogTitle.textContent = formatCardFullName(card, activeCol);
  lastCardPreviewImg.src = getCardFaceDataUrl(card.color, card.value);
  lastCardRuleDesc.textContent =
    CARD_RULE_TEXT[card.value] ||
    'Number Card: Match the active color or the same number to play on top.';
  lastCardDialog.returnValue = '';
  if (!lastCardDialog.open) lastCardDialog.showModal();
};

document.getElementById('active-state-pill')?.addEventListener('click', () => {
  const info = game.getLastDiscardInfo();
  if (info) uiCallbacks.openLastCardPreview(info);
});

document.getElementById('close-last-card-btn')?.addEventListener('click', () => {
  lastCardDialog?.close();
});

function openAllCardsModal() {
  if (!allCardsDialog || !allCardsGrid) return;
  const cards = game.getLocalHandCards();
  allCardsCountLabel.textContent = `YOUR FULL HAND • ${cards.length} ${cards.length === 1 ? 'CARD' : 'CARDS'}`;
  const playableCount = cards.filter((c) => c.playable).length;
  allCardsHint.textContent =
    playableCount > 0
      ? `${playableCount} ${playableCount === 1 ? 'card is' : 'cards are'} playable right now — tap any green-highlighted card to play it!`
      : 'Review all cards in your hand. Tap any card when it is your turn to play.';

  allCardsGrid.innerHTML = '';
  cards.forEach((card) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `hand-grid-card ${card.playable ? 'playable' : ''}`;
    btn.disabled = !card.playable;

    const img = document.createElement('img');
    img.src = getCardFaceDataUrl(card.color, card.value);
    img.alt = formatCardFullName(card, card.color);

    const tag = document.createElement('span');
    tag.className = 'hand-card-tag';
    tag.textContent = card.playable ? '✓ Tap to Play' : formatCardFullName(card, card.color);

    btn.append(img, tag);
    if (card.playable) {
      btn.addEventListener('click', () => {
        allCardsDialog.close();
        game.playCardByIdFromModal(card.id);
      });
    }
    allCardsGrid.appendChild(btn);
  });

  allCardsDialog.returnValue = '';
  if (!allCardsDialog.open) allCardsDialog.showModal();
}

document.getElementById('show-cards-btn')?.addEventListener('click', openAllCardsModal);
document.getElementById('close-all-cards-btn')?.addEventListener('click', () => {
  allCardsDialog?.close();
});

lastCardDialog?.addEventListener('close', () => {
  lastCardDialog.returnValue = '';
});
allCardsDialog?.addEventListener('close', () => {
  allCardsDialog.returnValue = '';
});

// One-Tap 3D Sort Hand Button
const sortHandBtn = document.getElementById('sort-hand-btn');
if (sortHandBtn) {
  sortHandBtn.addEventListener('click', () => {
    game.sortLocalHand();
  });
}

document.getElementById('draw-deck-btn').addEventListener('click', () => {
  game.humanDrawFromDeck();
});

unoShoutBtn.addEventListener('click', () => {
  game.shoutUnoHuman();
});

// Hamburger Drawer Navigation Items
document.getElementById('menu-home-btn').addEventListener('click', () => {
  closeDrawerAndRun(showHomeScreen);
});

document.getElementById('menu-multiplayer-btn').addEventListener('click', () => {
  closeDrawerAndRun(() => {
    if (network.isInRoom() && !network.room.started) {
      renderWaitingRoomOverlay(network.room, network.localSeat);
    } else {
      openMultiplayerDialog('both');
    }
  });
});

document.getElementById('menu-campaign-btn').addEventListener('click', () => {
  closeDrawerAndRun(() => {
    renderCampaignLevels();
    campaignDialog.returnValue = '';
    campaignDialog.showModal();
  });
});

document.getElementById('menu-rules-btn').addEventListener('click', () => {
  closeDrawerAndRun(() => {
    syncRulesFormFromObject(game.rules);
    rulesDialog.returnValue = '';
    rulesDialog.showModal();
  });
});

document.getElementById('menu-new-deal-btn').addEventListener('click', () => {
  closeDrawerAndRun(() => {
    if (network.isInRoom()) {
      network.leaveRoom();
      tableWaitingOverlay.hidden = true;
    }
    hideHomeScreen();
    game.startNewMatch();
  });
});

const cameraSwitchBtn = document.getElementById('camera-switch-btn');
const cameraViewLabel = document.getElementById('camera-view-label');
const CAMERA_SHORT_LABELS = ['3D View', 'Close-Up', 'Overhead'];

if (cameraSwitchBtn) {
  cameraSwitchBtn.addEventListener('click', () => {
    game.cycleCameraView();
    if (cameraViewLabel) {
      cameraViewLabel.textContent =
        CAMERA_SHORT_LABELS[game.cameraPresetIndex] || '3D View';
    }
  });
}

document.getElementById('menu-sound-btn').addEventListener('click', () => {
  sound.muted = !sound.muted;
  document.getElementById('drawer-sound-icon').textContent = sound.muted
    ? '🔇'
    : '🔊';
  document.getElementById('drawer-sound-title').textContent = sound.muted
    ? 'Sound & Haptics: MUTED'
    : 'Sound & Haptics: ON';
});

// Close buttons for Campaign, Rules, Multiplayer modals
document.getElementById('close-campaign-btn').addEventListener('click', () => {
  campaignDialog.close();
});

document.getElementById('close-rules-btn').addEventListener('click', () => {
  rulesDialog.close();
});

document.getElementById('close-mp-btn').addEventListener('click', () => {
  mpDialog.close();
});

houseRulesForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(houseRulesForm);
  const newRules = {
    stacking: data.get('stacking') === 'on',
    sevenZeroSwap: data.get('sevenZeroSwap') === 'on',
    drawUntilPlayable: data.get('drawUntilPlayable') === 'on',
    jumpIn: data.get('jumpIn') === 'on',
    startingHandSize: Number(data.get('startingHandSize')) || 7,
    unoPenaltyCards: Number(data.get('unoPenaltyCards')) || 2,
  };

  game.setRules(newRules);
  if (network.isInRoom() && network.isHost()) {
    network.updateRules(game.rules); // applies from the next match
  }
  rulesDialog.close();
  if (!network.isInRoom() && homeScreen.hidden) {
    game.startNewMatch();
  }
  uiCallbacks.showFloatingFX('HOUSE RULES SAVED!', game.activeColor);
});

// Multiplayer Create & Join Forms
document.getElementById('create-room-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const roomName =
    document.getElementById('create-room-name').value.trim() || 'testing';
  const playerName =
    document.getElementById('create-player-name').value.trim() ||
    playerProfile.displayName;
  network.createRoom(roomName, playerName, game.rules);
});

const joinCodeInput = document.getElementById('join-room-code');
joinCodeInput.addEventListener('input', () => {
  joinCodeInput.setCustomValidity('');
  joinCodeInput.removeAttribute('aria-invalid');
});

document.getElementById('join-room-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const query = joinCodeInput.value.trim();
  if (query.length < 2) {
    joinCodeInput.setCustomValidity(
      'Enter the 6-character Room Code or the Room Name.'
    );
    joinCodeInput.setAttribute('aria-invalid', 'true');
    joinCodeInput.reportValidity();
    return;
  }
  const playerName =
    document.getElementById('join-player-name').value.trim() ||
    playerProfile.displayName;
  network.joinRoom(query, playerName);
});

// Waiting Overlay Actions (Copy Code, Copy Link, Admin Start Game, Leave Room)
document.getElementById('overlay-copy-code-btn').addEventListener('click', async () => {
  if (!network.room) return;
  try {
    await navigator.clipboard.writeText(network.room.code);
    overlayWaitingStatus.textContent = `Copied Room Code "${network.room.code}" to clipboard!`;
  } catch (_) {
    overlayWaitingStatus.textContent = `Room Code: ${network.room.code}`;
  }
});

document.getElementById('overlay-copy-link-btn').addEventListener('click', async () => {
  if (!network.room) return;
  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${network.room.code}`;
  try {
    await navigator.clipboard.writeText(inviteUrl);
    overlayWaitingStatus.textContent = `Copied invite link (${inviteUrl}) to clipboard!`;
  } catch (_) {
    overlayWaitingStatus.textContent = `Invite Link: ${inviteUrl}`;
  }
});

overlayAdminStartBtn.addEventListener('click', () => {
  network.requestStartMatch();
});

document.getElementById('overlay-leave-room-btn').addEventListener('click', () => {
  showHomeScreen();
});

// Top HUD Avatar & Level Pill buttons
if (hudAvatarBtn) {
  hudAvatarBtn.addEventListener('click', openDrawer);
}

if (topLevelPill) {
  topLevelPill.addEventListener('click', () => {
    renderCampaignLevels();
    campaignDialog.returnValue = '';
    campaignDialog.showModal();
  });
}

// Quick Table Emotes (Broadcasts to Multiplayer Room & triggers Bot Reactions in Solo)
const BOT_REPLY_MAP = {
  '🔥': ['😎', '👏', '🔥'],
  '😂': ['😂', '😱', '😎'],
  '😱': ['😂', '🔥', '👏'],
  '👏': ['👏', '😎', '🔥'],
  '😎': ['🔥', '😂', '👏'],
  '💔': ['😂', '👏', '😱'],
};

document.querySelectorAll('.emote-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const emote = btn.dataset.emote;
    const myName = game.players[game.localSeat]?.rawName || playerProfile.displayName;
    sound.playCardSwoosh();
    if (network.isInRoom()) {
      network.sendEmote(emote);
    } else {
      showSeatReaction(0, emote);
      // Let a random active AI bot reply with a fun emoji reaction!
      const activeBots = [1, 2, 3].filter((s) => game.players[s]?.isBot && game.players[s]?.activeSeat);
      if (activeBots.length > 0) {
        const botSlot = activeBots[Math.floor(Math.random() * activeBots.length)];
        const replies = BOT_REPLY_MAP[emote] || ['🔥', '😂', '👏'];
        const botEmote = replies[Math.floor(Math.random() * replies.length)];
        setTimeout(() => {
          showSeatReaction(botSlot, botEmote);
        }, 550);
      }
    }
  });
});

// Tap an opponent's seat badge to send a friendly reaction directly at them!
[1, 2, 3].forEach((slot) => {
  const seatEl = document.getElementById(`seat-${slot}`);
  if (!seatEl) return;
  seatEl.addEventListener('click', () => {
    if (game.waitingForAdminStart) return;
    const targetPlayer = game.players.find((p) => game.getVisualSlot(p.id) === slot);
    if (!targetPlayer || targetPlayer.isVacant) return;
    const myName = game.players[game.localSeat]?.rawName || playerProfile.displayName;
    if (network.isInRoom()) {
      network.sendEmote('👋');
    } else {
      showSeatReaction(0, '👋');
      setTimeout(() => showSeatReaction(slot, '😎'), 420);
    }
  });
});

// Wild Color Dialog
wildDialog.addEventListener('cancel', (e) => {
  e.preventDefault();
  wildRequiredMsg.textContent =
    'A color choice is required after playing a Wild card — tap one of the 4 colors below.';
  wildRequiredMsg.classList.add('warn');
});

wildDialog.addEventListener('close', () => {
  const chosen = wildDialog.returnValue;
  wildDialog.returnValue = '';
  if (chosen && ['red', 'blue', 'yellow', 'green'].includes(chosen)) {
    game.resolveWildColorChoice(chosen);
  } else if (game.pendingWildCard) {
    wildDialog.showModal();
  }
});

victoryDialog.addEventListener('close', () => {
  const action = victoryDialog.returnValue;
  victoryDialog.returnValue = '';
  if (action === 'rematch') {
    game.startNewMatch();
  } else if (action === 'home') {
    showHomeScreen();
  }
});

[rulesDialog, campaignDialog].forEach((dlg) => {
  dlg.addEventListener('close', () => {
    dlg.returnValue = '';
  });
});

mpDialog.addEventListener('close', () => {
  mpDialog.returnValue = '';
  // If the player cancelled without joining a room, keep them on the Home Screen
  if (!network.isInRoom() && !homeScreen.hidden) {
    homeNameInput.focus();
  }
});

// Auto-open Join dialog if URL has ?room=XXXXXX
const urlParams = new URLSearchParams(window.location.search);
const invitedRoom = urlParams.get('room');
if (invitedRoom && invitedRoom.trim().length >= 2) {
  joinCodeInput.value = invitedRoom.trim();
  setTimeout(() => {
    openMultiplayerDialog('join');
    mpStatusBanner.textContent = `Invite link detected for Room "${joinCodeInput.value}" — enter your name and tap Join 3D Room Lobby!`;
  }, 450);
}

// Initialize Profile, 3D Arena Render Loop, and Initial Practice Table
syncProfileUI();
syncRulesFormFromObject(DEFAULT_RULES);
arena.startRenderLoop();
showHomeScreen();
