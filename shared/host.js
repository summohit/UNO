// Runs one match: owns the engine, schedules bot turns and UNO-call windows,
// and sends each seat its own redacted view. Used by the server for rooms
// and by the browser for solo games.
import { UnoEngine, redactEvents } from './engine.js';

export class GameHost {
  /**
   * @param {object} opts
   * @param {object} opts.rules
   * @param {{name:string,isBot:boolean,active:boolean}[]} opts.players
   * @param {(seat:number, payload:object) => void} opts.send
   * @param {number} [opts.botDelayMs]
   * @param {number} [opts.unoWindowMs]
   */
  constructor({
    rules, players, send, botDelayMs = 1100, unoWindowMs = 3200, turnMs = null, rng,
    scores, botForgetChance,
  }) {
    this.engine = new UnoEngine({ rules, players, rng, scores, botForgetChance });
    this.send = send;
    this.botDelayMs = botDelayMs;
    this.unoWindowMs = unoWindowMs;
    this.turnMs = turnMs; // null = no turn timer (solo)
    this.turnTimer = null;
    this.turnEndsAt = null;
    this.botTimer = null;
    this.unoTimers = new Map();
    this.stopped = false;
  }

  start() {
    this.publish(this.engine.start());
  }

  /** A human (or bot) action for a seat. The seat must come from the server, not the client. */
  handle(seat, action) {
    if (this.stopped) return { ok: false, error: 'stopped' };
    const res = this.engine.act(seat, action);
    if (!res.ok) {
      this.send(seat, { type: 'action_error', error: res.error });
      return res;
    }
    if (action.type === 'uno') this.clearUnoTimer(seat);
    this.publish(res.events);
    return res;
  }

  publish(events) {
    if (this.stopped) return;
    if (events.some((e) => e.type === 'turn' || e.type === 'roster')) this.scheduleTurnTimer();
    for (let seat = 0; seat < 4; seat++) {
      this.sendView(seat, events);
    }
    for (const e of events) {
      if (e.type === 'uno_window') this.scheduleUnoWindow(e.seat);
    }
    this.scheduleBot();
  }

  sendView(seat, events = []) {
    this.send(seat, {
      type: 'game_update',
      view: {
        ...this.engine.viewFor(seat),
        turnMsLeft: this.turnEndsAt ? Math.max(0, this.turnEndsAt - Date.now()) : null,
      },
      events: redactEvents(events, seat),
    });
  }

  /** Humans who run out of time draw automatically (or take the stacked penalty). */
  scheduleTurnTimer() {
    clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnEndsAt = null;
    const e = this.engine;
    if (!this.turnMs || e.gameOver) return;
    const seat = e.currentPlayer;
    if (e.players[seat].isBot) return;
    this.turnEndsAt = Date.now() + this.turnMs;
    this.turnTimer = setTimeout(() => {
      if (this.stopped || e.gameOver || e.currentPlayer !== seat) return;
      this.publish([{ type: 'timeout', seat }]);
      this.handle(seat, { type: 'draw' });
    }, this.turnMs);
  }

  /**
   * Someone is on one card without calling UNO. Humans can tap "Catch!" any time;
   * a bot opponent catches them after a short delay, and a bot that forgot may
   * still remember in time.
   */
  scheduleUnoWindow(seat) {
    this.clearUnoTimer(seat);
    const e = this.engine;
    const rand = (min, max) => min + Math.random() * (max - min);
    const timers = [];

    if (e.players[seat].isBot && Math.random() < 0.5) {
      timers.push(setTimeout(() => {
        if (this.stopped || !e.isCatchable(seat)) return;
        const res = e.act(seat, { type: 'uno' });
        if (res.ok) this.publish(res.events);
      }, rand(800, 2000)));
    }

    const catchers = e.players.filter((p) => p.active && p.isBot && p.seat !== seat);
    if (catchers.length) {
      const bot = catchers[Math.floor(Math.random() * catchers.length)];
      timers.push(setTimeout(() => {
        if (this.stopped || !e.isCatchable(seat) || !e.players[bot.seat].active) return;
        const res = e.act(bot.seat, { type: 'catch', target: seat });
        if (res.ok) this.publish(res.events);
      }, rand(this.unoWindowMs * 0.7, this.unoWindowMs * 1.2)));
    }
    this.unoTimers.set(seat, timers);
  }

  clearUnoTimer(seat) {
    for (const t of this.unoTimers.get(seat) || []) clearTimeout(t);
    this.unoTimers.delete(seat);
  }

  scheduleBot() {
    clearTimeout(this.botTimer);
    this.botTimer = null;
    const e = this.engine;
    if (this.stopped || e.gameOver) return;
    const seat = e.currentPlayer;
    if (!e.players[seat].isBot) return;
    this.botTimer = setTimeout(() => {
      if (this.stopped || e.gameOver || e.currentPlayer !== seat) return;
      this.handle(seat, e.botAction(seat));
    }, this.botDelayMs);
  }

  /** Hand a seat over to a bot (player left) or back to a human. */
  setBot(seat, isBot, name) {
    this.engine.setBot(seat, isBot, name);
    if (isBot) this.clearUnoTimer(seat);
    this.publish([{ type: 'roster', seat }]);
  }

  /** Mark a seat as disconnected (shown to others) without handing it to a bot yet. */
  setAway(seat, away) {
    const p = this.engine.players[seat];
    if (!p || Boolean(p.away) === away) return;
    p.away = away;
    this.publish([{ type: away ? 'player_away' : 'player_back', seat }]);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.botTimer);
    clearTimeout(this.turnTimer);
    for (const list of this.unoTimers.values()) list.forEach((t) => clearTimeout(t));
    this.unoTimers.clear();
  }
}
