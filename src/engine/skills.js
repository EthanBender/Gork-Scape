// src/engine/skills.js
// Pure skill math: XP table (levels 1-99), level<->XP lookups, and the
// tick-based skilling success roll. No game state lives here.

export const MAX_LEVEL = 99;

// The trainable skills shown in the skills panel (Hitpoints is hidden).
// Prayer is trained by burying bones / offering them at an altar; its level is
// also the player's max prayer points. See src/engine/prayer.js.
export const SKILL_NAMES = [
  'Woodcutting', 'Fishing', 'Mining', 'Farming', 'Cooking', 'Firemaking', 'Smithing',
  'Crafting', 'Alchemy', 'Attack', 'Strength', 'Defence', 'Ranged', 'Prayer',
];

// totalXPForLevel(L) = floor( sum_{l=1}^{L-1} floor(l + 300 * 2^(l/7)) / 4 )
// Matches OSRS: L1=0, L10=1154, L50=101333, L99=13034431.
function computeXpTable() {
  const table = [0, 0]; // index by level; level 1 = 0 xp. (index 0 unused)
  let acc = 0;
  for (let l = 1; l < MAX_LEVEL; l++) {
    acc += Math.floor(l + 300 * Math.pow(2, l / 7));
    table[l + 1] = Math.floor(acc / 4);
  }
  return table;
}

// XP_TABLE[L] = total xp required to BE level L.
export const XP_TABLE = computeXpTable();

export function xpForLevel(level) {
  if (level < 1) return 0;
  if (level > MAX_LEVEL) return XP_TABLE[MAX_LEVEL];
  return XP_TABLE[level];
}

// Highest level whose xp threshold is <= the given xp.
export function levelForXp(xp) {
  let lvl = 1;
  for (let l = 1; l <= MAX_LEVEL; l++) {
    if (xp >= XP_TABLE[l]) lvl = l;
    else break;
  }
  return lvl;
}

// Progress through the current level as { level, current, needed, ratio }.
export function levelProgress(xp) {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) {
    return { level, current: 0, needed: 0, ratio: 1 };
  }
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const current = xp - base;
  const needed = next - base;
  return { level, current, needed, ratio: needed > 0 ? current / needed : 1 };
}

// Tick-based skilling success probability, interpolated by level between
// `low` (level 1) and `high` (level 99), normalised over 256.
//   chance = (1 + high*(level-1)/98 + low*(99-level)/98) / 256
// Returns true if this tick's roll succeeds.
export function rollSkillSuccess(level, low, high) {
  const lvl = Math.max(1, Math.min(MAX_LEVEL, level));
  const chance =
    (1 + (high * (lvl - 1)) / 98 + (low * (MAX_LEVEL - lvl)) / 98) / 256;
  return Math.random() < chance;
}
