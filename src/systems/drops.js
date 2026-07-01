// src/systems/drops.js
// Drop-table roller. Reads drop_tables.json rows for a monster's drop_table_id
// and rolls each independently (first-pass model, per the design brief — can
// become weighted buckets later). Returns [{id, qty}] the caller drops/awards.

import { GameData } from '../data/gameData.js';
import { randInt } from '../engine/rng.js';

// Roll a drop table id -> array of { id, qty } awarded this kill.
export function rollDropTable(tableId) {
  const rows = GameData.dropTable(tableId);
  const out = [];
  for (const d of rows) {
    const chance = d.chance_percent != null ? d.chance_percent : 100;
    if (Math.random() * 100 < chance) {
      const lo = d.qty_min != null ? d.qty_min : 1;
      const hi = d.qty_max != null ? d.qty_max : lo;
      out.push({ id: d.item_id, qty: hi > lo ? randInt(lo, hi) : lo });
    }
  }
  return out;
}

// Convenience: roll drops for a monster by its monster_id.
export function rollMonsterDrops(monsterId) {
  const m = GameData.monster(monsterId);
  if (!m || !m.drop_table_id) return [];
  return rollDropTable(m.drop_table_id);
}
