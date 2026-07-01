// src/data/questItems.js
// Unique, hand-authored QUEST ITEMS — named gear and relics that only come from
// quests (and unique boss drops), registered straight into the equipment ITEMS
// registry. They're real, equippable, saveable items with their own stats,
// colours and flavour; the DB-hydration pass skips ids already present, so these
// hand-authored entries are never clobbered.
//
// Import this module for its side effect (registration). It's pulled in by
// main.js at boot and by the headless quest test, so the ids resolve wherever
// quest rewards are granted.

import { ITEMS, emptyBonuses } from '../items/equipment.js';

const b = (partial) => Object.assign(emptyBonuses(), partial);

// The unique items. `unique: true` marks them for the tooltip/UI to flourish;
// `notes` is examine flavour. Weapons/armour carry combat stats like any gear.
export const QUEST_ITEMS = {
  // Reward for the showcase quest "The Hollow Idol" — Gork's very own blade,
  // reforged from the idol's iron heart. A fast, hard-hitting stab weapon.
  gorks_first_fang: {
    id: 'gorks_first_fang', name: "Gork's First Fang", slot: 'weapon',
    weaponType: 'stab', attackSpeed: 2, attackRange: 1, color: 0xc8b45a, glow: 0xffe27a,
    unique: true, notes: 'Forged from the Hollow Idol\'s iron heart. It hums when goblins are near.',
    bonuses: b({ stab_atk: 22, slash_atk: 8, melee_str: 20, prayer: 2 }),
  },
  // A relic amulet: modest defence + a real prayer boost — the first "special"
  // neck slot a new goblin can earn.
  whisperbone_charm: {
    id: 'whisperbone_charm', name: 'Whisperbone Charm', slot: 'neck', color: 0xd8d0b8,
    unique: true, notes: 'Carved from the idol\'s jaw. The whispers have stopped… mostly.',
    bonuses: b({ prayer: 6, magic_def: 6, stab_def: 4, slash_def: 4 }),
  },
  // The boss trophy — a hollow crown that watched over the yard for a hundred
  // years. Strong early head slot with a prayer edge.
  the_hollow_crown: {
    id: 'the_hollow_crown', name: 'The Hollow Crown', slot: 'head', color: 0x9a8cc0, glow: 0xb9a9ff,
    unique: true, notes: 'It remembers every goblin who wore it. None of them for long.',
    bonuses: b({ slash_def: 14, stab_def: 14, crush_def: 12, magic_def: 8, prayer: 4 }),
  },
  // A non-equippable quest relic — the offering you carry to the shrine. Kept as
  // a keepsake after the quest (slot: null → inventory only).
  hollow_idol_shard: {
    id: 'hollow_idol_shard', name: 'Hollow Idol Shard', slot: null, stackable: false, color: 0x6d5fa0,
    unique: true, notes: 'A shard of black idol-stone, cold to the touch and faintly singing.',
    bonuses: emptyBonuses(),
  },

  // ----- Act 3 ("Goblin Gets Brave") uniques -----
  // Reward for the bog boss finale — a barbed spear that reaches two tiles and
  // drips with something that was never quite water.
  bogfang_spear: {
    id: 'bogfang_spear', name: 'Bogfang Spear', slot: 'weapon',
    weaponType: 'stab', attackSpeed: 2, attackRange: 2, color: 0x5a7a4a, glow: 0x9fe07a,
    unique: true, notes: 'Torn from the Sunken One. The barbs still twitch toward warm blood.',
    bonuses: b({ stab_atk: 34, slash_atk: 12, melee_str: 30, prayer: 3 }),
  },
  // The Oakwood scouts' reward — a warden's cape woven from moss and old grudges.
  mosswarden_cape: {
    id: 'mosswarden_cape', name: 'Mosswarden Cape', slot: 'cape', color: 0x3f6b34,
    unique: true, notes: 'The oakwoods remember who defended them. So does this cape.',
    bonuses: b({ range_def: 10, slash_def: 8, stab_def: 8, magic_def: 4, prayer: 2 }),
  },
};

// Register (idempotent): only add ids not already present, so a re-import or a
// future DB row of the same name never double-writes.
let registered = false;
export function registerQuestItems() {
  if (registered) return;
  for (const [id, def] of Object.entries(QUEST_ITEMS)) {
    if (!ITEMS[id]) ITEMS[id] = def;
  }
  registered = true;
}

registerQuestItems();
