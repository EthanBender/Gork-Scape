// src/data/worldContract.js
// Concrete instantiation of the cross-lane ID contract (see COORDINATION.md).
// World-gen spawns enemies keyed by its own ENEMY_TYPES keys + flavour names;
// this maps those onto database monster_ids so combat rolls the real designed
// drop tables (60 monsters / 302 drop entries) instead of the thin hardcoded
// loot. Kept in the economy lane so main.js only needs a tiny tagged hook.

import { GameData } from './gameData.js';

// world ENEMY_TYPES key -> database monster_id (base mapping)
const ENEMY_TYPE_TO_MONSTER = {
  rat: 'training_rat',
  cave_bug: 'cave_bug',
  spider: 'giant_spider',
  bandit: 'river_bandit',
  mud_bug: 'mud_bug',
  wolf: 'ridge_wolf',
  cave_goblin: 'cave_goblin_miner',
  slime: 'bog_slime',
  rival_scout: 'rival_goblin_scout',
  rival_warrior: 'rival_goblin_warrior',
  troll: 'cave_troll',
};

// Exact spawn display-name overrides (named mini-bosses / regional variants get
// their own richer table when the database has a matching monster).
const NAME_TO_MONSTER = {
  'Red-Ear Captain': 'red_ear_captain',
  'Crazed Fisher Gob': 'crazed_fisher_gob',
  'Lake Snapper': 'lake_snapper',
  'Cave Bat': 'cave_bat',
  'Forest Rat': 'forest_rat',
  'Field Rat': 'forest_rat',
};

// Slugify a display name into a candidate monster_id ("Bog Rat" -> "bog_rat").
function slug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// Resolve a world enemy spawn ({ type, name }) to a valid database monster_id,
// or null if none maps (caller then falls back to the legacy loot table).
// Priority: explicit override → exact name-slug match in the DB → enemy-type
// base mapping. This gives named/regional spawns their thematically-correct
// drop table when the database has a matching monster.
export function monsterIdForSpawn(spawn) {
  if (!spawn) return null;
  const bySlug = slug(spawn.name);
  const candidate =
    NAME_TO_MONSTER[spawn.name]
    || (GameData.monster(bySlug) ? bySlug : null)
    || ENEMY_TYPE_TO_MONSTER[spawn.type]
    || null;
  return candidate && GameData.monster(candidate) ? candidate : null;
}
