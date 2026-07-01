// src/engine/tick.js
// The 600ms game tick. The simulation advances ONLY on these boundaries; the
// renderer (Phaser's update / requestAnimationFrame) runs independently at
// ~60fps and just interpolates between tick states.
//
// The ticker is driven by the WALL CLOCK, not by assuming each timer fire equals
// one tick. Browsers throttle (and eventually freeze) setInterval in a
// background tab, so a naive `setInterval(fn, 600)` would silently run slow or
// stall whenever the player looks away. Instead we sample `Date.now()` on every
// fire, work out how many 600ms boundaries have actually passed, and run that
// many ticks — so the simulation keeps real time whether the tab is focused,
// backgrounded, or just came back from being throttled. (A fully closed tab
// still can't run; that gap is closed by offline catch-up on the next login —
// see engine/save.js + engine/session.js.)

export const TICK_MS = 600;

// Never process more than this many ticks in a single fire. Protects against a
// pathological backlog (e.g. the OS suspended the tab for an hour) turning into
// one multi-second freeze of AI/pathfinding when focus returns. Anything beyond
// this is dropped from the live sim; long real gaps are handled as offline
// catch-up at load time instead.
const MAX_CATCHUP_TICKS = 120;

export class Ticker {
  constructor(tickMs = TICK_MS) {
    this.tickMs = tickMs;
    this.count = 0;
    this.handlers = [];
    this.timer = null;
    this._acc = 0;    // real ms observed but not yet converted into ticks
    this._last = 0;   // wall-clock stamp of the previous pump
  }

  onTick(fn) {
    this.handlers.push(fn);
  }

  start() {
    if (this.timer !== null) return;
    this._last = Date.now();
    this._acc = 0;
    // Sample finer than the tick length so focused play stays smooth and 1-tick
    // pumps stay the common case; catch-up handles any coarser real cadence.
    const sample = Math.min(this.tickMs, 200);
    this.timer = setInterval(() => this._pump(), sample);
  }

  _pump() {
    const now = Date.now();
    let elapsed = now - this._last;
    this._last = now;
    if (elapsed < 0) elapsed = 0;          // clock stepped backwards — ignore
    this._acc += elapsed;

    let due = Math.floor(this._acc / this.tickMs);
    this._acc -= due * this.tickMs;
    if (due <= 0) return;

    if (due > MAX_CATCHUP_TICKS) {
      // Drop the un-simulated backlog rather than freeze; keep the sub-tick
      // remainder so cadence stays phase-aligned.
      due = MAX_CATCHUP_TICKS;
      this._acc = 0;
    }

    for (let i = 0; i < due; i++) {
      this.count++;
      const isLast = i === due - 1;
      for (const fn of this.handlers) fn(this.count, isLast);
    }
  }

  // Advance the tick counter without running handlers — used by offline
  // catch-up so respawn/despawn timers (which are `count`-relative) stay
  // consistent across a session that spanned real time the tab wasn't open.
  advance(ticks) {
    if (ticks > 0) this.count += ticks;
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
