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
  constructor({ rules, players, send, botDelayMs = 1100, unoWindowMs = 3200, rng }) {
    this.engine = new UnoEngine({ rules, players, rng });
    this.send = send;
    this.botDelayMs = botDelayMs;
    this.unoWindowMs = unoWindowMs;
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
    for (let seat = 0; seat < 4; seat++) {
      this.sendView(seat, events);
    }
    for (const e of events) {
      if (e.type === 'uno_window') this.startUnoTimer(e.seat);
    }
    this.scheduleBot();
  }

  sendView(seat, events = []) {
    this.send(seat, {
      type: 'game_update',
      view: this.engine.viewFor(seat),
      events: redactEvents(events, seat),
    });
  }

  startUnoTimer(seat) {
    this.clearUnoTimer(seat);
    this.unoTimers.set(
      seat,
      setTimeout(() => {
        this.unoTimers.delete(seat);
        const events = this.engine.penalizeMissedUno(seat);
        if (events.length) this.publish(events);
      }, this.unoWindowMs)
    );
  }

  clearUnoTimer(seat) {
    const t = this.unoTimers.get(seat);
    if (t) clearTimeout(t);
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

  stop() {
    this.stopped = true;
    clearTimeout(this.botTimer);
    for (const t of this.unoTimers.values()) clearTimeout(t);
    this.unoTimers.clear();
  }
}
