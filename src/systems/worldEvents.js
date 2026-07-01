// src/systems/worldEvents.js
// World events on the world calendar. Like worldClock.js, the schedule is a PURE
// FUNCTION of absolute time: which event is running at instant T is derived from
// the world day/time, not from anything that has to be simulated or persisted.
// That is the strongest form of "the world keeps going while you're offline" —
// the Blood Moon rises on its night whether or not anyone is watching, and a
// returning player simply reads the calendar to see what's happening now and
// what's next.
//
// Pure: imports only the (pure) world clock. No DOM/game/market imports, so it
// drops onto a server unchanged (the server reads the same calendar for all
// clients). Consumers opt into effects via the exposed `effect` data — this
// module never mutates game state.

import { dayNumber, isNight, timeOfDay, DAY_MS, worldElapsedMs, clockHHMM } from '../engine/worldClock.js';

// The event catalogue. `window` picks when in a scheduled day it is live:
//   'all'   — the whole world-day
//   'day'   — daylight hours only
//   'night' — night hours only
// `effect` is plain data other systems can read (GE demand mult + matcher, drop
// and XP bonuses). This module applies none of it itself.
export const EVENTS = [
  {
    id: 'blood_moon', name: '🌑 Blood Moon', window: 'night',
    blurb: 'Monsters grow bolder and hit harder beneath the blood moon — but drop more.',
    effect: { dropBonus: 1.25, geMatch: /potion|food|fish|cooked|arrow|bolt|rune/i, geMult: 1.15 },
  },
  {
    id: 'merchant_caravan', name: '🐫 Merchant Caravan', window: 'day',
    blurb: 'A merchant caravan rolls through — the market is flush and prices soften.',
    effect: { geMatch: /.*/, geMult: 0.93 },
  },
  {
    id: 'goblin_festival', name: '🎉 Goblin Festival', window: 'all',
    blurb: 'The clans feast and brawl for sport — experience flows a little freer today.',
    effect: { xpBonus: 1.10 },
  },
  {
    id: 'ore_rush', name: '⛏️ Ore Rush', window: 'day',
    blurb: 'Rich seams surface across the mines — ore and metal are in high demand.',
    effect: { geMatch: /ore|bar|coal|metal|ingot|rock/i, geMult: 1.18 },
  },
  {
    id: 'timber_glut', name: '🪵 Timber Glut', window: 'all',
    blurb: 'Loggers flood the market with wood — timber prices sag.',
    effect: { geMatch: /log|plank|wood|timber/i, geMult: 0.78 },
  },
  {
    id: 'wandering_horde', name: '👹 Wandering Horde', window: 'night',
    blurb: 'A horde roams the wilds after dark — dangerous, but rich pickings.',
    effect: { dropBonus: 1.4, geMatch: /weapon|armou?r|shield|helm|sword|axe|mace|spear|bow/i, geMult: 1.1 },
  },
];

// Deterministic day→event mapping. ~40% of days are calm (no event); the rest
// pick a catalogue entry by hashing the day number. Same day → same event,
// forever, on every client — the calendar is fixed, not rolled.
function hashDay(day) {
  let h = (day * 2654435761) % 2147483647;
  return h < 0 ? h + 2147483647 : h;
}

// The event SCHEDULED for a given world-day (may not be live yet if it's a
// day/night-windowed event). Returns an event object or null (calm day).
export function eventForDay(day) {
  const h = hashDay(day);
  if (h % 5 < 2) return null;         // ~40% calm days
  return EVENTS[h % EVENTS.length];
}

function windowLive(win, now) {
  switch (win) {
    case 'all': return true;
    case 'day': return !isNight(now);
    case 'night': return isNight(now);
    default: return false;
  }
}

// The event LIVE right now (scheduled for today AND inside its time window), or
// null. Pure function of `now`.
export function activeEvent(now = Date.now()) {
  const ev = eventForDay(dayNumber(now));
  if (!ev) return null;
  return windowLive(ev.window, now) ? ev : null;
}

// GE demand bias for offline market drift: {match, mult} for the live event, or
// null. Consumed by geActions.advanceMarketOffline so offline prices drift toward
// the event's equilibrium (e.g. Ore Rush pulls ore/metal up while it runs).
export function marketBias(now = Date.now()) {
  const ev = activeEvent(now);
  if (ev && ev.effect && ev.effect.geMatch && ev.effect.geMult) {
    return { match: ev.effect.geMatch, mult: ev.effect.geMult };
  }
  return null;
}

// The next scheduled event START at or after `now` (skipping the currently-live
// one), scanning the calendar forward. Returns { event, at, inMs } or null if
// nothing is scheduled within `horizonDays`.
export function nextEvent(now = Date.now(), horizonDays = 8) {
  const current = activeEvent(now);
  const step = DAY_MS / 24; // 1 world-hour resolution
  const end = now + horizonDays * DAY_MS;
  for (let t = now + step; t <= end; t += step) {
    const ev = activeEvent(t);
    if (ev && ev !== current) return { event: ev, at: t, inMs: t - now };
  }
  return null;
}

// One-line HUD/log label for the live event, or '' when calm.
export function label(now = Date.now()) {
  const ev = activeEvent(now);
  return ev ? ev.name : '';
}

// Human "in 3h20m" style gap for a future instant.
export function humanGap(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  if (h >= 24) { const d = Math.floor(h / 24); return `${d} day${d === 1 ? '' : 's'}`; }
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export { clockHHMM, timeOfDay, worldElapsedMs };
