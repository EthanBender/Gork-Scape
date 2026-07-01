// src/engine/prayer.js
// Prayer definitions + pure helpers. The Prayer *skill* is trained by burying
// bones or offering them at an altar (see state.grantXp / main.performSkill);
// Prayer *points* (= your Prayer level) are spent by activating prayers, which
// boost combat stats or protect against a damage style. All pure data + lookups
// here; live state (points, active set) lives on `Game` in state.js.
//
// Levels are lowered from OSRS's thresholds for early-game accessibility, but
// keep the same shape (defence/strength/attack/ranged boosts, then protection).
// `drain` is prayer points spent per 600ms tick while the prayer is active.

export const PRAYERS = [
  { id: 'thick_skin',          name: 'Thick Skin',          level: 1,  drain: 0.10, boost: { defence: 1.05 },  desc: '+5% Defence' },
  { id: 'burst_of_strength',   name: 'Burst of Strength',   level: 4,  drain: 0.10, boost: { strength: 1.05 }, desc: '+5% Strength' },
  { id: 'sharp_eye',           name: 'Sharp Eye',           level: 5,  drain: 0.10, boost: { ranged: 1.05 },   desc: '+5% Ranged' },
  { id: 'clarity_of_thought',  name: 'Clarity of Thought',  level: 7,  drain: 0.10, boost: { attack: 1.05 },   desc: '+5% Attack' },
  { id: 'rock_skin',           name: 'Rock Skin',           level: 10, drain: 0.18, boost: { defence: 1.10 },  desc: '+10% Defence' },
  { id: 'superhuman_strength', name: 'Superhuman Strength', level: 13, drain: 0.18, boost: { strength: 1.10 }, desc: '+10% Strength' },
  { id: 'hawk_eye',            name: 'Hawk Eye',            level: 14, drain: 0.18, boost: { ranged: 1.10 },   desc: '+10% Ranged' },
  { id: 'improved_reflexes',   name: 'Improved Reflexes',   level: 16, drain: 0.18, boost: { attack: 1.10 },   desc: '+10% Attack' },
  { id: 'protect_from_missiles', name: 'Protect from Missiles', level: 18, drain: 0.30, protect: 'ranged', desc: 'Halves ranged damage taken' },
  { id: 'protect_from_melee',  name: 'Protect from Melee',  level: 20, drain: 0.30, protect: 'melee',  desc: 'Halves melee damage taken' },
  { id: 'steel_skin',          name: 'Steel Skin',          level: 22, drain: 0.24, boost: { defence: 1.15 },  desc: '+15% Defence' },
];

// Fraction of damage that survives an active protection prayer (0.5 = halved).
export const PROTECT_FACTOR = 0.5;

const BY_ID = Object.fromEntries(PRAYERS.map((p) => [p.id, p]));

export function prayerById(id) {
  return BY_ID[id] || null;
}

// Prayers available at a given Prayer level.
export function unlockedPrayers(level) {
  return PRAYERS.filter((p) => p.level <= level);
}

// Which protection style covers an attacker's weapon type.
export function styleOfWeapon(weaponType) {
  if (weaponType === 'ranged') return 'ranged';
  if (weaponType === 'magic') return 'magic';
  return 'melee';
}
