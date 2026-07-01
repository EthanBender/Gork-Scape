// src/world/loot.js
// Loot tables and the roller used when an NPC dies. A table has `always`
// drops (every kill) plus one weighted `roll` from the main list. Entries may
// specify a quantity range `qty: [min, max]`. A null id is "nothing" — it just
// pads the table so not every kill yields a bonus drop.

import { randInt } from '../engine/rng.js';
import { EXTRA_LOOT } from './worldData.js';

export const LOOT_TABLES = Object.assign({
  goblin_guard: {
    always: [{ id: 'bones', qty: 1 }],
    roll: [
      { id: 'coins', qty: [1, 18], weight: 55 },
      { id: null, weight: 28 },                  // nothing
      { id: 'raw_fish', qty: 1, weight: 8 },
      { id: 'ore', qty: 1, weight: 6 },
      { id: 'bronze_bar', qty: 1, weight: 5 },
      { id: 'goblin_spear', qty: 1, weight: 3 }, // rare
    ],
  },
  // [economy lane] Goblin Archer — always recovers some arrows (keeps ranged
  // self-sustaining), plus coins and a rare shortbow.
  goblin_archer: {
    always: [{ id: 'bones', qty: 1 }, { id: 'bronze_arrow', qty: [4, 12] }],
    roll: [
      { id: 'coins', qty: [3, 22], weight: 50 },
      { id: null, weight: 24 },
      { id: 'bronze_arrow', qty: [5, 15], weight: 16 },
      { id: 'goblin_shortbow', qty: 1, weight: 5 }, // rare
    ],
  },
}, EXTRA_LOOT);

function qtyOf(entry) {
  if (Array.isArray(entry.qty)) return randInt(entry.qty[0], entry.qty[1]);
  return entry.qty ?? 1;
}

// Returns an array of { id, qty } drops for the given table id.
export function rollLoot(tableId) {
  const table = LOOT_TABLES[tableId];
  if (!table) return [];
  const drops = [];

  for (const a of table.always) drops.push({ id: a.id, qty: qtyOf(a) });

  const total = table.roll.reduce((s, e) => s + e.weight, 0);
  let r = randInt(1, total);
  for (const entry of table.roll) {
    r -= entry.weight;
    if (r <= 0) {
      if (entry.id) drops.push({ id: entry.id, qty: qtyOf(entry) });
      break;
    }
  }
  return drops;
}
