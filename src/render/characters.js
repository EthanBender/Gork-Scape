// src/render/characters.js
// [character-render lane] The "what does this character look like right now"
// layer — extracted from main.js to shrink the shared god-file and to give this
// concern a home the render lane owns outright.
//
// This module answers, per entity per frame: which silhouette, gear, facing,
// animation, tint, and size to draw — WITHOUT touching the Phaser scene. It
// returns plain state objects (`avatarStateFor`) that main.js's draw loop feeds
// to `drawAvatar`. The only draw helper here (`drawSkillFx`) takes its Graphics
// as a parameter, so it stays scene-agnostic too. Pure functions of `Game` +
// the static registries; no sim mutation.

import { Game } from '../engine/state.js';
import { gearHints, weaponStyleFor, bodyTypeFor, creatureFeatures } from './gear.js';
import { TILE_SIZE } from '../world/map.js';

const tilePx = (t) => t * TILE_SIZE + TILE_SIZE / 2;
const manhattan = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);

// avatar sizing. The rig is ~30 local px tall and bottom-anchored, so we drop
// the feet a touch below the tile centre.
export const AV_SCALE = TILE_SIZE / 26;
export const AV_FEET = TILE_SIZE * 0.34;
export const AV_TOP = 30 * AV_SCALE + 6;   // head-top offset for HP bars / labels

// Role-based visual loadout for a humanoid NPC, chosen by name keyword — so a
// Witch carries a staff & hood, an Archer a bow, a Prospector a pickaxe, a
// Captain a helm & sword, etc. Reuses the gear.js id parsers (fake equipment).
function npcLoadout(name, type) {
  const n = (name || '').toLowerCase();
  const eq = {};
  if (/archer|sharpshooter|\bbow\b|ranger|hunt/.test(n)) eq.weapon = { id: 'goblin_shortbow' };
  else if (/witch|shaman|herbalist|sage|wisp|mystic|spirit/.test(n)) eq.weapon = { id: 'gnarled_staff' };
  else if (/miner|prospector|foreman|pick/.test(n)) eq.weapon = { id: 'bronze_pickaxe' };
  else if (/woodcut|lumber|chopper|splinter/.test(n)) eq.weapon = { id: 'bronze_hatchet' };
  else if (/bait|fisher|angler/.test(n)) eq.weapon = { id: 'fishing_rod' };
  else if (/warrior|brute|captain|guardian|knight|berserker|golem|king/.test(n)) eq.weapon = { id: 'bronze_scimitar' };
  else if (/scout|thief|bandit|poacher|assassin|rogue|supplier/.test(n)) eq.weapon = { id: 'bronze_dagger' };
  else if (type === 'elder') eq.weapon = { id: 'walking_staff' }; // townsfolk lean on a staff
  else eq.weapon = { id: 'crude_club' };

  if (/witch|shaman|mystic|sage/.test(n)) eq.head = { id: 'wizard_hood' };
  else if (/captain|warrior|guardian|knight/.test(n)) eq.head = { id: 'bronze_full_helm' };
  else if (type === 'elder') eq.head = { id: 'cloth_hood' };

  if (/archer|scout|warrior|brute|captain|rival/.test(n)) eq.body = { id: 'leather_body' };
  if (type === 'elder') eq.body = { id: 'cloth_robe' };
  return eq;
}

export function npcGear(n) {
  return gearHints(npcLoadout(n.name, n.type));
}

// Which tool + motion the avatar mimes per skill (drawn instead of the weapon
// while gathering). `motion` maps to the rig's skill animation.
const SKILL_TOOL = {
  Woodcutting: { hint: { kind: 'axe',  color: 0xb5793a, len: 12 }, motion: 'chop' },
  Mining:      { hint: { kind: 'pick', color: 0x8f9196, len: 12 }, motion: 'chop' },
  Fishing:     { hint: { kind: 'rod',  color: 0x8a5a2b, len: 17 }, motion: 'fish' },
  Smithing:    { hint: { kind: 'mace', color: 0x6b6b6b, len: 9 },  motion: 'work' }, // hammer
  Cooking:     { hint: null,                                       motion: 'work' },
  Crafting:    { hint: { kind: 'dagger', color: 0xcfd3d8, len: 6 }, motion: 'work' },
};

// The object the player is actively gathering (adjacent, arrived, not depleted).
export function playerSkillTarget() {
  const p = Game.player;
  if (!p || !p.interactTarget || p.combatTarget) return null;
  const o = p.interactTarget;
  if (o.depleted || !o.skill) return null;
  if (manhattan(p.tileX, p.tileY, o.x, o.y) !== 1) return null;
  if (p.path && p.path.length) return null;
  return o;
}

// Gathering particle FX at the node (chips / sparks / ripple). Draws onto the
// passed Graphics `g` in world space (caller decides the layer).
export function drawSkillFx(g, o, time) {
  const ox = o.x * TILE_SIZE + 16, oy = o.y * TILE_SIZE + 16;
  if (o.skill === 'Woodcutting' || o.skill === 'Mining') {
    const cyc = (time % 640) / 640;
    const col = o.skill === 'Woodcutting' ? 0x6b4a2a : 0xe8e2c8;
    const a = Math.max(0, 1 - cyc);
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + time * 0.008;
      const r = 3 + cyc * 11;
      g.fillStyle(col, a);
      g.fillRect(ox + Math.cos(ang) * r - 1, oy - 5 + Math.sin(ang) * r * 0.5 - 1, 2, 2);
    }
  } else if (o.skill === 'Fishing') {
    const cyc = (time % 1100) / 1100;
    g.lineStyle(1.5, 0x9fd8e8, Math.max(0, 0.7 - cyc * 0.7));
    g.strokeCircle(ox, oy, 3 + cyc * 11);
  }
}

// Derive the avatar draw-state purely from data the sim already maintains:
// facing from tile steps, walk from interpolation, attack from lastAttackTick
// bumps, hit from an HP drop. No combat-code edits required.
export function avatarStateFor(e, isPlayer, time, skillObj = null) {
  if (e._ptx == null) { e._ptx = e.tileX; e._pty = e.tileY; e._facing = 'S'; }
  if (e.tileX !== e._ptx || e.tileY !== e._pty) {
    const dx = e.tileX - e._ptx, dy = e.tileY - e._pty;
    if (dx || dy) e._facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
    e._ptx = e.tileX; e._pty = e.tileY;
  }
  const moving = Math.abs(e.px - tilePx(e.tileX)) > 0.6 || Math.abs(e.py - tilePx(e.tileY)) > 0.6;

  // attention: guards in combat face their target; idle townsfolk face the
  // player when close — makes NPCs feel aware rather than staring into space.
  if (!isPlayer && !moving) {
    const dxp = Game.player.tileX - e.tileX, dyp = Game.player.tileY - e.tileY;
    const distP = Math.abs(dxp) + Math.abs(dyp);
    const attentive = (e.target && !e.target.dead) || (e.type === 'elder' && distP > 0 && distP <= 6);
    if (attentive) e._facing = Math.abs(dxp) >= Math.abs(dyp) ? (dxp > 0 ? 'E' : 'W') : (dyp > 0 ? 'S' : 'N');
  }

  // gathering overrides walk/idle: face the node and mime the tool
  if (skillObj && !moving) {
    const tool = SKILL_TOOL[skillObj.skill] || SKILL_TOOL.Crafting;
    const dx = skillObj.x - e.tileX, dy = skillObj.y - e.tileY;
    return {
      facing: Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N'),
      anim: 'skill', skillType: tool.motion, tool: tool.hint, phase: 0, t: time,
      weaponStyle: 'unarmed', gear: gearHints(Game.equipment), skin: 0x6fbf3f, scale: AV_SCALE,
    };
  }

  if (e._seenAtk == null) e._seenAtk = e.lastAttackTick;
  if (e.lastAttackTick != null && e.lastAttackTick !== e._seenAtk) { e._seenAtk = e.lastAttackTick; e._swingAt = time; }
  const attacking = e._swingAt != null && time - e._swingAt < 420;

  const hp = isPlayer ? Game.hp : e.hp;
  if (e._seenHp == null) e._seenHp = hp;
  if (hp < e._seenHp) e._hitAt = time;
  e._seenHp = hp;
  const hit = !attacking && e._hitAt != null && time - e._hitAt < 300;

  const equip = isPlayer ? Game.equipment : null;
  const elder = e.type === 'elder';
  // cached per NPC: silhouette, gear loadout, and a stable time offset so a
  // crowd doesn't animate in lockstep.
  if (!isPlayer && !e._body) {
    e._body = elder ? { type: 'humanoid', size: 1 } : bodyTypeFor(e.name);
    e._gearCache = npcGear(e);
    e._tOff = tOffFor(e.id || e.name || '');
    // per-enemy visual variety (tint + size); townsfolk stay uniform.
    e._variant = elder ? null : creatureVariant((e.id || e.name || '') + 'v', e.combatLevel);
    // per-creature distinctive features (spider legs/fangs, etc.) — see gear.js.
    e._features = elder ? null : creatureFeatures(e.name);
  }
  const body = isPlayer ? { type: 'humanoid', size: 1 } : e._body;
  const gear = isPlayer ? gearHints(equip) : e._gearCache;
  const t = isPlayer ? time : time + e._tOff;
  let skin = isPlayer ? 0x6fbf3f : (elder ? 0x6fbf3f : e.color); // green goblins; robe carries elder colour
  let sizeMul = body.size;
  if (e._variant) { skin = tintColor(skin, e._variant.tint); sizeMul *= e._variant.size; }
  return {
    facing: e._facing,
    anim: attacking ? 'attack' : hit ? 'hit' : moving ? 'walk' : 'idle',
    phase: attacking ? (time - e._swingAt) / 420 : hit ? (time - e._hitAt) / 300 : 0,
    t,
    bodyType: body.type,
    features: isPlayer ? null : e._features,
    boss: !isPlayer && !!body.boss,
    weaponStyle: isPlayer ? weaponStyleFor(equip.weapon)
      : (elder ? 'unarmed' : (gear.weapon ? gear.weapon.style : 'crush')),
    gear,
    skin,
    scale: AV_SCALE * sizeMul,
  };
}

// Per-enemy visual variety so a herd isn't identical clones. Fewer distinct
// looks the tougher the foe (owner spec): low combat lvl (≤12) → 6 variants,
// mid (≤45) → 4, high → 3. Stable-random per NPC id; tint + size only, applied
// on top of the base creature colour/silhouette.
const CREATURE_VARIANTS = [
  { tint: [1.00, 1.00, 1.00], size: 1.00 },  // 0 base
  { tint: [1.20, 0.90, 0.80], size: 0.88 },  // 1 ruddy, smaller
  { tint: [0.86, 0.92, 1.05], size: 1.13 },  // 2 ashen, bigger
  { tint: [1.12, 1.08, 0.76], size: 0.95 },  // 3 tan
  { tint: [0.84, 1.07, 0.86], size: 1.06 },  // 4 sickly green
  { tint: [1.03, 0.83, 1.09], size: 0.90 },  // 5 violet, smaller
];
function creatureVariant(id, combatLevel) {
  const n = combatLevel == null ? 6 : combatLevel <= 12 ? 6 : combatLevel <= 45 ? 4 : 3;
  return CREATURE_VARIANTS[tOffFor(String(id)) % n];
}
function tintColor(c, f) {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f[0]));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f[1]));
  const b = Math.min(255, Math.round((c & 255) * f[2]));
  return (r << 16) | (g << 8) | b;
}

// stable per-NPC animation phase offset (ms) from a string id — desyncs crowds.
function tOffFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 1400;
}
