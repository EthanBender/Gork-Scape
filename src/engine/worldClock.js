// src/engine/worldClock.js
// The world's own clock. It is a PURE FUNCTION of absolute wall-clock time
// (Date.now) measured from a fixed epoch — nothing to persist, nothing to
// advance. That is exactly what "the world/environment keeps going while a
// player is offline" means in a client build: day/night, seasons, and any
// time-derived world state are computed from `now`, so whenever anyone logs in
// the world reflects however much real time has passed, as if it had been
// running the whole time. No DOM/game imports, so it drops onto a server
// unchanged (the server would call the same functions for the shared clock).

// Fixed anchor for "the beginning of the world" (2023-11-14T22:13:20Z). Any
// constant in the past works; it just defines where Day 1 starts.
export const WORLD_EPOCH_MS = 1_700_000_000_000;

// Real milliseconds per in-world day. 24 real minutes = 1 world day: long
// enough to feel like time, short enough that a session sees dawn→dusk and that
// logging back in hours later lands on a visibly different day. Team-tunable.
export const DAY_MS = 24 * 60 * 1000;

// Day/night segmentation as fractions of a day (0 = midnight).
const SEGMENTS = [
  { name: 'night', end: 0.22 },
  { name: 'dawn', end: 0.30 },
  { name: 'day', end: 0.72 },
  { name: 'dusk', end: 0.80 },
  { name: 'night', end: 1.01 },
];

export function worldElapsedMs(now = Date.now()) {
  return Math.max(0, now - WORLD_EPOCH_MS);
}

// 1-based world day number.
export function dayNumber(now = Date.now()) {
  return Math.floor(worldElapsedMs(now) / DAY_MS) + 1;
}

// Fraction [0,1) through the current world day (0 = midnight, 0.5 = midday).
export function timeOfDay(now = Date.now()) {
  return (worldElapsedMs(now) % DAY_MS) / DAY_MS;
}

// 24-hour "HH:MM" reading of the current world time.
export function clockHHMM(now = Date.now()) {
  const t = timeOfDay(now) * 24;
  const h = Math.floor(t);
  const m = Math.floor((t - h) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

export function phase(now = Date.now()) {
  const t = timeOfDay(now);
  for (const s of SEGMENTS) if (t < s.end) return s.name;
  return 'night';
}

export function isNight(now = Date.now()) {
  return phase(now) === 'night';
}

// Smooth daylight factor [0,1]: 0 at midnight, 1 at midday. Handy for a render
// lane that wants to tint the world by time of day (world-gen owns any tinting).
export function daylight(now = Date.now()) {
  return Math.max(0, Math.sin(timeOfDay(now) * Math.PI));
}

// Human-readable HUD/log label, e.g. "Day 12 · 14:30 ☀️".
export function label(now = Date.now()) {
  const p = phase(now);
  const glyph = p === 'night' ? '🌙' : p === 'dawn' ? '🌅' : p === 'dusk' ? '🌇' : '☀️';
  return `Day ${dayNumber(now)} · ${clockHHMM(now)} ${glyph}`;
}

// How many whole world-days elapsed between two instants — used to tell a
// returning player how much the world moved on without them.
export function daysBetween(fromMs, toMs = Date.now()) {
  return Math.floor(worldElapsedMs(toMs) / DAY_MS) - Math.floor(worldElapsedMs(fromMs) / DAY_MS);
}
