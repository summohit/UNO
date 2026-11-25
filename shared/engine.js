// Pure game rules engine. No DOM, no Three.js, no timers.
// Runs on the server (multiplayer) and in the browser (solo vs bots).
// Every mutating call returns a list of events describing what happened,
// which clients use for animations and effects.

export const COLORS = ['red', 'yellow', 'green', 'blue'];
const NUMBER_VALUES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const ACTION_VALUES = ['skip', 'reverse', 'draw2'];

// Chaos Mode cards (colored): +4, Skip Everyone, Discard All.
const CHAOS_COLOR_VALUES = ['draw4c', 'skipall', 'discardall'];
// Chaos Mode wild cards: Reverse +4, +6, +10, Colour Roulette.
const CHAOS_WILD_VALUES = ['rev4', 'draw6', 'draw10', 'roulette'];

/** How many cards a draw card adds to the stack (0 = not a draw card). */
export const DRAW_VALUE = { draw2: 2, wild4: 4, draw4c: 4, rev4: 4, draw6: 6, draw10: 10 };
export const ELIMINATION_HAND_SIZE = 25;
export const SCORE_TARGET = 500;

export const DEFAULT_RULES = {
  mode: 'classic', // 'classic' | 'chaos'
  stacking: true,
  drawUntilPlayable: false,
  sevenZeroSwap: false,
  jumpIn: false,
  unoPenaltyCards: 2,
  startingHandSize: 7,
};

// Whitelist + clamp rules coming from clients.
export function sanitizeRules(input = {}) {
  const r = { ...DEFAULT_RULES };
  if (input.mode === 'chaos') r.mode = 'chaos';
  for (const key of ['stacking', 'drawUntilPlayable', 'sevenZeroSwap', 'jumpIn']) {
    if (typeof input[key] === 'boolean') r[key] = input[key];
  }
  const hand = Number(input.startingHandSize);
  if ([5, 7, 10].includes(hand)) r.startingHandSize = hand;
  const pen = Number(input.unoPenaltyCards);
  if ([2, 4].includes(pen)) r.unoPenaltyCards = pen;
  return r;
}

/** Chaos Mode always has stacking, draw-until-playable and 7–0 swaps on. */
export function effectiveRules(rules) {
  const r = sanitizeRules(rules);
  if (r.mode === 'chaos') {
    r.stacking = true;
    r.drawUntilPlayable = true;
    r.sevenZeroSwap = true;
    r.eliminationAt = ELIMINATION_HAND_SIZE;
  }
  return r;
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Classic: 108 cards. Chaos: 140 cards with the extra Chaos cards and no plain wilds. */
export function buildDeck(rng = Math.random, mode = 'classic') {
  const chaos = mode === 'chaos';
  const colorValues = [...NUMBER_VALUES, ...ACTION_VALUES, ...(chaos ? CHAOS_COLOR_VALUES : [])];
  const cards = [];
  let id = 1;
  for (const color of COLORS) {
    cards.push({ id: id++, color, value: '0' });
    for (let copy = 0; copy < 2; copy++) {
      for (const value of colorValues) {
        cards.push({ id: id++, color, value });
      }
    }
  }
  const wildValues = chaos ? CHAOS_WILD_VALUES : ['wild', 'wild4'];
  for (let i = 0; i < 4; i++) {
    for (const value of wildValues) cards.push({ id: id++, color: 'wild', value });
  }
  return shuffle(cards, rng);
}

export function cardPoints(card) {
  if (card.color === 'wild') return 50;
  if (/^\d$/.test(card.value)) return parseInt(card.value, 10);
  return 20;
}

// Shared by engine and client (to lift playable cards in the hand).
export function canPlayCard(card, { activeColor, activeValue, pendingDrawStack, rules }) {
  if (!card) return false;
  if (pendingDrawStack > 0 && rules.mode === 'chaos') {
    // Chaos: stack any draw card worth the same or more, whatever its colour.
    const v = DRAW_VALUE[card.value] || 0;
    return v > 0 && v >= (DRAW_VALUE[activeValue] || 0);
  }
  if (pendingDrawStack > 0 && rules.stacking) {
    if (activeValue === 'draw2') return card.value === 'draw2' || card.value === 'wild4';
    if (activeValue === 'wild4') return card.value === 'wild4';
  }
  if (card.color === 'wild') return true;
  return card.color === activeColor || card.value === activeValue;
}

const pub = (c) => ({ id: c.id, color: c.color, value: c.value });

export class UnoEngine {
  /**
   * @param {object} opts
   * @param {object} opts.rules
   * @param {{name:string,isBot:boolean,active:boolean}[]} opts.players exactly 4 seats
   * @param {() => number} [opts.rng]
   */
  constructor({ rules, players, rng = Math.random, scores = null, scoreTarget = SCORE_TARGET, botForgetChance = 0.25 }) {
    // Running score across rounds (the caller keeps the array between matches).
    this.scores = scores || [0, 0, 0, 0];
    this.scoreTarget = scoreTarget;
    this.champion = null;
    this.botForgetChance = botForgetChance;
    this.rng = rng;
    this.rules = effectiveRules(rules);
    this.players = players.map((p, seat) => ({
      seat,
      name: String(p.name || `Player ${seat + 1}`),
      isBot: Boolean(p.isBot),
      active: Boolean(p.active),
      hand: [],
      calledUno: false,
    }));
    this.drawPile = [];
    this.discardPile = [];
    this.currentPlayer = 0;
    this.direction = 1;
    this.activeColor = 'red';
    this.activeValue = '0';
    this.pendingDrawStack = 0;
    this.gameOver = false;
    this.winner = null;
    this.points = 0;
    this.started = false;
  }

  activeSeats() {
    return this.players.filter((p) => p.active).map((p) => p.seat);
  }

  start() {
    const events = [];
    if (this.activeSeats().length < 2) throw new Error('Need at least 2 active players');
    this.drawPile = buildDeck(this.rng, this.rules.mode);
    const handSize = this.rules.startingHandSize;
    for (let round = 0; round < handSize; round++) {
      for (const seat of this.activeSeats()) {
        this.players[seat].hand.push(this.drawPile.pop());
      }
    }
    events.push({ type: 'deal', handSize });

    // Starter: never a wild; wilds go back into the pile.
    let starter = this.drawPile.pop();
    const badStarter = (c) => c.color === 'wild' || (this.rules.mode === 'chaos' && !/^\d$/.test(c.value));
    while (badStarter(starter)) {
      this.drawPile.unshift(starter);
      starter = this.drawPile.pop();
    }
    this.discardPile.push(starter);
    this.activeColor = starter.color;
    this.activeValue = starter.value;
    this.currentPlayer = this.activeSeats()[0];
    this.started = true;
    events.push({ type: 'start_card', card: pub(starter) });

    // Apply the starter card's effect to the first player.
    if (starter.value === 'skip') {
      events.push({ type: 'skip', seat: this.currentPlayer });
      this.currentPlayer = this.nextSeat(1);
    } else if (starter.value === 'reverse') {
      this.direction = -1;
      events.push({ type: 'reverse', direction: -1 });
      if (this.activeSeats().length === 2) this.currentPlayer = this.nextSeat(1);
    } else if (starter.value === 'draw2') {
      const victim = this.currentPlayer;
      this.drawCards(victim, 2, 'penalty', events);
      events.push({ type: 'skip', seat: victim });
      this.currentPlayer = this.nextSeat(1);
    }
    events.push({ type: 'turn', seat: this.currentPlayer });
    return events;
  }

  nextSeat(steps = 1, from = this.currentPlayer) {
    let idx = from;
    let remaining = steps;
    for (let guard = 0; remaining > 0 && guard < 16; guard++) {
      idx = (idx + this.direction + 4) % 4;
      if (this.players[idx].active) remaining--;
    }
    return idx;
  }

  canPlay(card) {
    return canPlayCard(card, this);
  }

  refillDrawPile() {
    if (this.discardPile.length <= 1) return false;
    const top = this.discardPile.pop();
    const recycled = shuffle(this.discardPile.splice(0), this.rng);
    this.discardPile.push(top);
    this.drawPile.unshift(...recycled);
    return true;
  }

  drawOne(seat) {
    if (this.drawPile.length === 0) this.refillDrawPile();
    const card = this.drawPile.pop();
    if (!card) return null;
    this.players[seat].hand.push(card);
    return card;
  }

  drawCards(seat, count, reason, events) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
      const c = this.drawOne(seat);
      if (!c) break; // every card is in someone's hand
      drawn.push(c);
    }
    this.players[seat].calledUno = false;
    this.players[seat].unoVulnerable = false;
    events.push({ type: 'draw', seat, reason, count: drawn.length, cards: drawn.map(pub) });
    this.checkElimination(seat, events);
    return drawn;
  }

  /** Chaos: a player holding too many cards is out; their cards go back under the pile. */
  checkElimination(seat, events) {
    const limit = this.rules.eliminationAt;
    const p = this.players[seat];
    if (!limit || !p.active || p.hand.length < limit || this.gameOver) return;
    p.active = false;
    p.eliminated = true;
    p.calledUno = false;
    this.drawPile.unshift(...shuffle(p.hand.splice(0), this.rng));
    events.push({ type: 'eliminated', seat });
    const left = this.activeSeats();
    if (left.length === 1) this.finish(left[0], events);
  }

  bestColorFor(seat) {
    const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
    for (const c of this.players[seat].hand) if (c.color in counts) counts[c.color]++;
    return COLORS.reduce((best, c) => (counts[c] > counts[best] ? c : best), 'red');
  }

  /** Main entry point. Returns { ok, error?, events }. */
  act(seat, action) {
    if (!this.started || this.gameOver) return { ok: false, error: 'game_not_running', events: [] };
    const player = this.players[seat];
    if (!player || !player.active) return { ok: false, error: 'invalid_seat', events: [] };
    const events = [];

    switch (action?.type) {
      case 'uno': {
        if (player.hand.length > 2) return { ok: false, error: 'too_many_cards', events };
        if (!player.calledUno) {
          player.calledUno = true;
          player.unoVulnerable = false;
          events.push({ type: 'uno', seat });
        }
        return { ok: true, events };
      }

      // Catch someone who is down to one card and has not called UNO. Works out of turn.
      case 'catch': {
        const target = this.players[action.target];
        if (!target || target.seat === seat || !this.isCatchable(target.seat)) {
          return { ok: false, error: 'nothing_to_catch', events };
        }
        target.unoVulnerable = false;
        events.push({ type: 'caught', seat: target.seat, by: seat });
        this.drawCards(target.seat, this.rules.unoPenaltyCards, 'uno_penalty', events);
        return { ok: true, events };
      }

      case 'play': {
        const card = player.hand.find((c) => c.id === action.cardId);
        if (!card) return { ok: false, error: 'card_not_in_hand', events };

        if (seat !== this.currentPlayer) {
          const canJump =
            this.rules.jumpIn &&
            card.color !== 'wild' &&
            card.color === this.activeColor &&
            card.value === this.activeValue &&
            this.pendingDrawStack === 0;
          if (!canJump) return { ok: false, error: 'not_your_turn', events };
          this.currentPlayer = seat;
          events.push({ type: 'jump_in', seat });
        } else if (!this.canPlay(card)) {
          return { ok: false, error: 'illegal_card', events };
        }

        const color = COLORS.includes(action.color) ? action.color : null;
        const target = Number.isInteger(action.target) ? action.target : null;
        this.playCard(seat, card, color, events, target);
        return { ok: true, events };
      }

      case 'draw': {
        if (seat !== this.currentPlayer) return { ok: false, error: 'not_your_turn', events };
        this.drawAction(seat, events);
        return { ok: true, events };
      }

      default:
        return { ok: false, error: 'unknown_action', events };
    }
  }

  drawAction(seat, events) {
    const player = this.players[seat];
    if (this.pendingDrawStack > 0) {
      const count = this.pendingDrawStack;
      this.pendingDrawStack = 0;
      this.drawCards(seat, count, 'stack', events);
      this.advance(1, events);
      return;
    }

    let drawn = null;
    const maxDraws = this.rules.drawUntilPlayable ? 200 : 1;
    for (let i = 0; i < maxDraws && player.active && !this.gameOver; i++) {
      const [c] = this.drawCards(seat, 1, 'draw', events);
      if (!c) break;
      drawn = c;
      if (this.canPlay(c)) break;
    }
    if (this.gameOver) return;

    if (player.active && drawn && this.canPlay(drawn)) {
      events.push({ type: 'drew_playable', seat });
      this.playCard(seat, drawn, this.bestColorFor(seat), events, this.botSwapTarget(seat));
    } else {
      if (player.active) events.push({ type: 'pass', seat });
      this.advance(1, events);
    }
  }

  playCard(seat, card, chosenColor, events, swapTarget = null) {
    const player = this.players[seat];
    player.hand.splice(player.hand.indexOf(card), 1);
    this.discardPile.push(card);
    this.activeValue = card.value;
    this.activeColor = card.color === 'wild' ? chosenColor || this.bestColorFor(seat) : card.color;
    events.push({ type: 'play', seat, card: pub(card), color: this.activeColor });

    if (card.value === 'discardall') {
      // Throw away every other card of this colour too (under the played card).
      const same = player.hand.filter((c) => c.color === card.color);
      if (same.length) {
        player.hand = player.hand.filter((c) => c.color !== card.color);
        this.discardPile.splice(this.discardPile.length - 1, 0, ...same);
        events.push({ type: 'discard_all', seat, color: card.color, count: same.length });
      }
    }

    if (player.hand.length === 0) {
      this.finish(seat, events);
      return;
    }

    this.applySevenZero(seat, card.value, events, swapTarget);

    if (player.hand.length === 1 && !player.calledUno) {
      // Bots usually remember UNO; sometimes they forget and can be caught.
      if (player.isBot && this.rng() >= this.botForgetChance) {
        player.calledUno = true;
        events.push({ type: 'uno', seat });
      } else {
        player.unoVulnerable = true;
        events.push({ type: 'uno_window', seat });
      }
    }

    let steps = 1;
    const active = this.activeSeats().length;
    // Skip the victim only if they are still in the game (they may have been eliminated).
    const skipVictim = (victim) => {
      if (this.players[victim].active) {
        events.push({ type: 'skip', seat: victim });
        steps = 2;
      }
    };

    if (card.value === 'reverse' || card.value === 'rev4') {
      this.direction *= -1;
      events.push({ type: 'reverse', direction: this.direction });
      if (card.value === 'reverse' && active === 2) steps = 2;
    }

    const amount = DRAW_VALUE[card.value];
    if (amount) {
      if (this.rules.stacking) {
        this.pendingDrawStack += amount;
        events.push({ type: 'stack', total: this.pendingDrawStack });
      } else {
        const victim = this.nextSeat(1);
        this.drawCards(victim, amount, 'penalty', events);
        if (this.gameOver) return;
        skipVictim(victim);
      }
    } else if (card.value === 'skip') {
      skipVictim(this.nextSeat(1));
    } else if (card.value === 'skipall') {
      events.push({ type: 'skip_all', seat });
      steps = 0; // everyone else is skipped: same player again
    } else if (card.value === 'roulette') {
      // Next player flips cards until they hit the chosen colour, keeps them all, and is skipped.
      const victim = this.nextSeat(1);
      let flipped = 0;
      const drawnCards = [];
      for (let guard = 0; guard < 200 && this.players[victim].active; guard++) {
        const c = this.drawOne(victim);
        if (!c) break;
        flipped++;
        drawnCards.push(c);
        if (c.color === this.activeColor) break;
      }
      this.players[victim].calledUno = false;
      events.push({ type: 'draw', seat: victim, reason: 'roulette', count: flipped, cards: drawnCards.map(pub) });
      events.push({ type: 'roulette', seat: victim, color: this.activeColor, count: flipped });
      this.checkElimination(victim, events);
      if (this.gameOver) return;
      skipVictim(victim);
    }
    this.advance(steps, events);
  }

  /** Default 7-swap target: the opponent with the fewest cards. */
  botSwapTarget(seat) {
    const t = this.players
      .filter((p) => p.active && p.seat !== seat && p.hand.length > 0)
      .sort((a, b) => a.hand.length - b.hand.length)[0];
    return t ? t.seat : null;
  }

  applySevenZero(seat, value, events, requestedTarget = null) {
    if (!this.rules.sevenZeroSwap) return;
    if (value === '0') {
      const seats = this.activeSeats();
      const hands = seats.map((s) => this.players[s].hand);
      // Each hand moves to the next player in the direction of play.
      seats.forEach((s, i) => {
        const from = (i - this.direction + seats.length) % seats.length;
        this.players[s].hand = hands[from];
        this.players[s].calledUno = false;
        this.players[s].unoVulnerable = false;
      });
      events.push({ type: 'rotate_hands', direction: this.direction });
    } else if (value === '7') {
      const valid = (t) => Number.isInteger(t) && t !== seat && this.players[t]?.active && this.players[t].hand.length > 0;
      const targetSeat = valid(requestedTarget) ? requestedTarget : this.botSwapTarget(seat);
      if (targetSeat === null) return;
      const me = this.players[seat];
      const target = this.players[targetSeat];
      [me.hand, target.hand] = [target.hand, me.hand];
      me.calledUno = false;
      target.calledUno = false;
      me.unoVulnerable = false;
      target.unoVulnerable = false;
      events.push({ type: 'swap_hands', seat, target: targetSeat });
    }
  }

  advance(steps, events) {
    if (this.gameOver) return;
    this.currentPlayer = this.nextSeat(steps);
    events.push({ type: 'turn', seat: this.currentPlayer });
  }

  finish(seat, events) {
    this.gameOver = true;
    this.winner = seat;
    this.points = this.players
      .filter((p) => p.seat !== seat)
      .reduce((sum, p) => sum + p.hand.reduce((s, c) => s + cardPoints(c), 0), 0);
    this.scores[seat] = (this.scores[seat] || 0) + this.points;
    if (this.scores[seat] >= this.scoreTarget) this.champion = seat;
    events.push({ type: 'win', seat, points: this.points, total: this.scores[seat], champion: this.champion });
  }

  isCatchable(seat) {
    const p = this.players[seat];
    return Boolean(!this.gameOver && p && p.active && p.unoVulnerable && !p.calledUno && p.hand.length === 1);
  }

  /** Simple bot: prefer coloured cards over wilds, otherwise draw. */
  botAction(seat) {
    const hand = this.players[seat].hand;
    const playable = hand.filter((c) => this.canPlay(c));
    if (playable.length === 0) return { type: 'draw' };
    // Coloured cards before wilds; when answering a stack, use the smallest draw card.
    const drawValue = (c) => DRAW_VALUE[c.value] || 0;
    playable.sort((a, b) =>
      this.pendingDrawStack > 0
        ? drawValue(a) - drawValue(b)
        : (a.color === 'wild') - (b.color === 'wild')
    );
    const card = playable[0];
    return {
      type: 'play',
      cardId: card.id,
      color: card.color === 'wild' ? this.bestColorFor(seat) : undefined,
      target: card.value === '7' ? this.botSwapTarget(seat) : undefined,
    };
  }

  /** State as seen by one seat: only that seat's own cards are revealed. */
  viewFor(seat) {
    return {
      seat,
      rules: this.rules,
      started: this.started,
      currentPlayer: this.currentPlayer,
      direction: this.direction,
      activeColor: this.activeColor,
      activeValue: this.activeValue,
      pendingDrawStack: this.pendingDrawStack,
      gameOver: this.gameOver,
      winner: this.winner,
      points: this.points,
      scores: [...this.scores],
      scoreTarget: this.scoreTarget,
      champion: this.champion,
      drawCount: this.drawPile.length,
      discardTop: this.discardPile.slice(-12).map(pub),
      players: this.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        isBot: p.isBot,
        active: p.active,
        count: p.hand.length,
        calledUno: p.calledUno,
        catchable: this.isCatchable(p.seat),
        away: Boolean(p.away),
        eliminated: Boolean(p.eliminated),
        hand: p.seat === seat ? p.hand.map(pub) : null,
      })),
    };
  }

  setBot(seat, isBot, name) {
    const p = this.players[seat];
    if (!p) return;
    p.isBot = isBot;
    if (name) p.name = name;
  }
}

/** Strip cards other players shouldn't see from an event list. */
export function redactEvents(events, seat) {
  return events.map((e) => {
    if (e.type === 'draw' && e.seat !== seat) {
      const { cards, ...rest } = e;
      return rest;
    }
    return e;
  });
}
