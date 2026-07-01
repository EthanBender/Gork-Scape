// src/render/gear.js
// Equipment-id -> *visual* render hints for the procedural avatar rig.
//
// This is a rendering concern only: it never touches game state or item stats.
// Given the player's (or an NPC's) equipment map it returns small hint objects
// describing how to *draw* each worn item on the rig — a weapon's shape and
// metal colour, an armour tint over the torso, a helm over the head, etc.
//
// It works from id substrings so it degrades gracefully for ids it has never
// seen (a sensible default weapon/armour still draws). If the economy lane ever
// adds an explicit `item.render` block, we prefer that (see readHint()).

// ---- palettes -------------------------------------------------------------
const METAL = {
  bronze: 0xb5793a, iron: 0x8f9196, steel: 0xc2c7ce, mithril: 0x5b74b0,
  adamant: 0x3f7d5c, rune: 0x3fa0b8, gold: 0xe3c45a, black: 0x35383d,
  wood: 0x8a5a2b, bone: 0xd8cfa8, rusty: 0x9a7a4a,
};
const CLOTH = {
  hide: 0x6b4a2a, leather: 0x7a5230, cloth: 0x6d6450, robe: 0x8a6fbf,
  green: 0x4f7c34, red: 0x8c3a2e, blue: 0x35507e,
};

// pick a metal colour from an id (first material keyword that appears)
function metalOf(id, fallback = METAL.iron) {
  for (const k of Object.keys(METAL)) if (id.includes(k)) return METAL[k];
  if (id.includes('goblin') || id.includes('crude')) return METAL.rusty;
  return fallback;
}
function clothOf(id, fallback = CLOTH.hide) {
  for (const k of Object.keys(CLOTH)) if (id.includes(k)) return CLOTH[k];
  if (id.includes('hide')) return CLOTH.hide;
  return fallback;
}

// ---- weapon --------------------------------------------------------------
// kind drives the silhouette; style drives which attack *motion* plays.
export function weaponHint(item) {
  if (!item) return { kind: 'fist', style: 'unarmed', color: 0x6fbf3f, len: 0 };
  const id = (item.id || '').toLowerCase();
  const render = item.render || {};
  let kind, style, len;

  if (/bow|shortbow|longbow/.test(id))      { kind = 'bow';    style = 'ranged'; len = 12; }
  else if (/cross/.test(id))                { kind = 'cbow';   style = 'ranged'; len = 10; }
  else if (/spear|lance|hasta|halberd/.test(id)) { kind = 'spear'; style = 'stab'; len = 20; }
  else if (/dagger|knife|dirk/.test(id))    { kind = 'dagger'; style = 'stab';  len = 7; }
  else if (/scimitar|sword|blade|sabre/.test(id)) { kind = 'sword'; style = 'slash'; len = 14; }
  else if (/hatchet|axe|cleaver/.test(id))  { kind = 'axe';    style = 'slash'; len = 12; }
  else if (/pickaxe|pick/.test(id))         { kind = 'pick';   style = 'crush'; len = 12; }
  else if (/mace|hammer|maul|club|flail/.test(id)) { kind = 'mace'; style = 'crush'; len = 11; }
  else if (/staff|wand|rod/.test(id))       { kind = 'staff';  style = 'crush'; len = 18; }
  else                                      { kind = 'club';   style = 'crush'; len = 10; }

  // an economy-provided render block can override the guess
  return {
    kind: render.kind || kind,
    style: render.style || style,
    color: render.color != null ? render.color : metalOf(id, METAL.wood),
    len: render.len || len,
  };
}

// convenience: the attack motion for the currently-held weapon
export function weaponStyleFor(item) { return weaponHint(item).style; }

// ---- worn armour / accessories -------------------------------------------
function bodyHint(item) {
  if (!item) return null;
  const id = (item.id || '').toLowerCase();
  const metal = /bronze|iron|steel|mithril|adamant|rune|plate|chain|mail/.test(id);
  return { color: metal ? metalOf(id) : clothOf(id), metal };
}
function headHint(item) {
  if (!item) return null;
  const id = (item.id || '').toLowerCase();
  if (/hood|cowl|coif/.test(id)) return { kind: 'hood', color: clothOf(id, CLOTH.cloth) };
  if (/helm|helmet|full/.test(id)) return { kind: 'full', color: metalOf(id) };
  if (/cap|hat/.test(id)) return { kind: 'cap', color: clothOf(id, CLOTH.leather) };
  return { kind: 'cap', color: metalOf(id) }; // any other head item -> a simple cap
}
function shieldHint(item) {
  if (!item) return null;
  const id = (item.id || '').toLowerCase();
  const shape = /round|buckler/.test(id) ? 'round' : 'kite';
  return { shape, color: metalOf(id) };
}
function capeHint(item) {
  if (!item) return null;
  return { color: clothOf((item.id || '').toLowerCase(), CLOTH.red) };
}

// ---- creature body type (from monster name) ------------------------------
// Picks which rig silhouette to draw + a size multiplier. Keyword-based so it
// works for the whole bestiary without a data field; the economy lane can later
// add an authoritative `render.bodyType` on monsters.json to override this.
export function bodyTypeFor(name = '') {
  const n = name.toLowerCase();
  if (/slime|ooze|blob|jelly|wisp|spirit|sprite|mireling/.test(n)) return { type: 'amorphous', size: 0.95 };
  if (/spider|\bbug\b|crab|crawler|mosquito|\bgrub\b|beetle|scorpion|mite|swarm|snapper/.test(n))
    return { type: 'insectoid', size: /giant|deep|horror|swarm/.test(n) ? 1.05 : 0.85 };
  if (/\brat\b|wolf|boar|hound|\bdog\b|bear|frog|\bbat\b|snake/.test(n))
    return { type: 'quadruped', size: /wolf|boar|bear|dire/.test(n) ? 1.15 : 0.8 };
  const size = /troll|golem|\bking\b|horror|berserker|brute|ogre|captain|guardian/.test(n) ? 1.4 : 1;
  return { type: 'humanoid', size };
}

// ---- top-level: whole-loadout hints --------------------------------------
// `equipment` is the Game.equipment slot map ({ weapon, shield, body, head,
// legs, cape } -> item | undefined). Missing slots yield null hints.
export function gearHints(equipment = {}) {
  const eq = equipment || {};
  return {
    weapon: weaponHint(eq.weapon),
    body: bodyHint(eq.body),
    legs: bodyHint(eq.legs),
    head: headHint(eq.head),
    shield: shieldHint(eq.shield),
    cape: capeHint(eq.cape),
  };
}
