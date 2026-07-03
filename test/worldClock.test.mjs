// test/worldClock.test.mjs — the world's clock (src/engine/worldClock.js).
// Pure function of wall-clock time; drives day/night, offline drift, and the
// world-event schedule, so it's boot-critical and shared by every lane. All
// functions take an explicit `now`, so this tests fully deterministically.
import { test, assert, eq, almost } from './run.mjs';
import {
  WORLD_EPOCH_MS, DAY_MS, worldElapsedMs, dayNumber, timeOfDay, clockHHMM,
  phase, isNight, daylight, label, daysBetween,
} from '../src/engine/worldClock.js';

const E = WORLD_EPOCH_MS;
const at = (frac, day = 0) => E + day * DAY_MS + Math.round(frac * DAY_MS); // instant at frac through `day`

test('elapsed time is clamped at the epoch (no negative world time)', () => {
  eq(worldElapsedMs(E), 0);
  eq(worldElapsedMs(E - 100000), 0, 'before the epoch reads as 0');
  eq(worldElapsedMs(E + DAY_MS), DAY_MS);
});

test('day number is 1-based and advances every DAY_MS', () => {
  eq(dayNumber(E), 1);
  eq(dayNumber(E + DAY_MS - 1), 1, 'last ms of day 1');
  eq(dayNumber(E + DAY_MS), 2);
  eq(dayNumber(E + 5 * DAY_MS + 123), 6);
  eq(dayNumber(E - 999), 1, 'before epoch clamps to day 1');
});

test('time-of-day is the [0,1) fraction through the day', () => {
  almost(timeOfDay(E), 0);
  almost(timeOfDay(at(0.25)), 0.25);
  almost(timeOfDay(at(0.5, 3)), 0.5, 1e-9, 'fraction ignores which day');
});

test('HH:MM clock reads correctly', () => {
  eq(clockHHMM(E), '00:00');
  eq(clockHHMM(at(0.25)), '06:00');
  eq(clockHHMM(at(0.5)), '12:00');
  eq(clockHHMM(at(0.75)), '18:00');
});

test('phase segmentation matches the day/night bands', () => {
  eq(phase(at(0.0)), 'night');
  eq(phase(at(0.25)), 'dawn');
  eq(phase(at(0.5)), 'day');
  eq(phase(at(0.75)), 'dusk');
  eq(phase(at(0.9)), 'night');
  assert(isNight(E) === true && isNight(at(0.5)) === false);
});

test('daylight is 0 at midnight, peaks at midday, symmetric', () => {
  almost(daylight(E), 0);
  almost(daylight(at(0.5)), 1);
  assert(Math.abs(daylight(at(0.25)) - daylight(at(0.75))) < 1e-9, 'dawn/dusk symmetric');
});

test('label reads "Day N · HH:MM <glyph>"', () => {
  eq(label(E), 'Day 1 · 00:00 Night');
  eq(label(at(0.5, 11)), 'Day 12 · 12:00 Day');
});

test('daysBetween counts whole world-days crossed', () => {
  eq(daysBetween(E, E + 3 * DAY_MS), 3);
  eq(daysBetween(E, E + DAY_MS - 1), 0, 'same day = 0');
  eq(daysBetween(at(0.9), at(0.1, 1)), 1, 'crossing midnight once');
});
