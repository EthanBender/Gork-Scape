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
  else if (/pickaxe|pick/.test(id))         { kind = 'pick';   style = 'crush'; len = 12; } // before 'axe' — a pickaxe is not a hatchet
  else if (/hatchet|axe|cleaver/.test(id))  { kind = 'axe';    style = 'slash'; len = 12; }
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
  // `boss` is orthogonal to silhouette — a boss can be humanoid OR insectoid etc.
  // It adds an aura + guarantees a large size. `big` covers non-boss heavies.
  const boss = /\bking\b|\bboss\b|horror|golem|guardian|overlord|warlord|dragon|titan|elder\b.*\b(dragon|god)/.test(n);
  const big = boss || /troll|ogre|berserker|brute|captain|\bgiant\b|great/.test(n);

  let type, size;
  if (/slime|ooze|blob|jelly|wisp|spirit|sprite|mireling/.test(n)) { type = 'amorphous'; size = 0.95; }
  else if (/\bbat\b|moth|wasp|hornet|\bbird\b|raven|crow|harpy/.test(n)) { type = 'avian'; size = 0.8; }
  else if (/snake|serpent|\beel\b|python|adder|viper|\bworm\b|slug/.test(n)) { type = 'serpent'; size = 0.95; }
  else if (/spider|\bbug\b|crab|crawler|mosquito|\bgrub\b|beetle|scorpion|mite|swarm|snapper/.test(n)) { type = 'insectoid'; size = /giant|deep|swarm/.test(n) ? 1.05 : 0.85; }
  else if (/\brat\b|wolf|boar|hound|\bdog\b|bear|frog|lizard/.test(n)) { type = 'quadruped'; size = /wolf|boar|bear|dire/.test(n) ? 1.15 : 0.8; }
  else { type = 'humanoid'; size = 1; }

  if (big) size = Math.max(size, boss ? 1.5 : 1.3);
  return { type, size, boss };
}

// ---- per-creature distinctive features -----------------------------------
// Keyword-based visual flourishes that make each mob look UNIQUE within its
// shared body-type silhouette (a spider vs a beetle, a wolf vs a rat). Returns a
// small hint object the creature draw functions read; unknown creatures get a
// sensible default for their body type. The economy lane can later add an
// authoritative `render.features` on monsters.json to override this. Built up
// one mob at a time — see COORDINATION (character-render lane).
export function creatureFeatures(name = '') {
  const n = name.toLowerCase();
  const f = {};

  // --- arachnids & insects (insectoid rig) ---
  if (/spider/.test(n)) {
    // A menacing widow: 8 bent legs, bulbous glossy abdomen with a red hourglass,
    // a cluster of glinting eyes and ever-bared fangs.
    f.legPairs = 4; f.legW = 1.1; f.abdomen = 1.3; f.gloss = 0.45;
    f.eyes = 'cluster'; f.eyeColor = 0xd23a3a;
    f.mark = 'hourglass'; f.markColor = 0xc0392b; f.fangs = true;
  } else if (/scorpion/.test(n)) {
    f.legPairs = 4; f.pincers = true; f.eyes = 'two'; f.eyeColor = 0xffd23a;
  } else if (/crab|snapper/.test(n)) {
    f.legPairs = 3; f.pincers = true; f.eyes = 'two'; f.eyeColor = 0x141414; f.abdomen = 1.1;
  } else if (/beetle|scarab/.test(n)) {
    f.legPairs = 3; f.mark = 'stripes'; f.gloss = 0.4; f.eyes = 'two'; f.eyeColor = 0x141414;
  } else if (/bug|grub|mite|mosquito|wasp|hornet/.test(n)) {
    f.legPairs = 3; f.eyes = 'two'; f.eyeColor = 0xffb03a;
  }

  // --- land beasts (quadruped rig) ---
  else if (/wolf|dire|hound|\bdog\b|jackal|warg/.test(n)) {
    f.build = 'canine'; f.ears = 'pointed'; f.tail = 'bushy'; f.snout = 'long';
    f.fangs = true; f.eyeColor = 0xffcf3a;
  } else if (/\brat\b|rodent|skulker|vermin|mouse/.test(n)) {
    f.build = 'rodent'; f.ears = 'round'; f.tail = 'rope'; f.snout = 'pointed';
    f.teeth = 'buck'; f.eyeColor = 0xd23a3a;
  } else if (/boar|hog|\bpig\b|tusker|swine/.test(n)) {
    f.build = 'bulky'; f.ears = 'small'; f.tail = 'curl'; f.snout = 'snout';
    f.tusks = true; f.eyeColor = 0x141414;
  } else if (/bear|ursine/.test(n)) {
    f.build = 'bulky'; f.ears = 'small'; f.tail = 'stub'; f.snout = 'blunt';
    f.fangs = true; f.eyeColor = 0x141414;
  } else if (/frog|toad|newt/.test(n)) {
    f.build = 'squat'; f.ears = 'none'; f.tail = 'none'; f.snout = 'wide';
    f.eyesTop = true; f.eyeColor = 0xffd23a;
  } else if (/lizard|gecko|salamander|skink|reptile/.test(n)) {
    f.build = 'reptile'; f.ears = 'none'; f.tail = 'long'; f.snout = 'pointed';
    f.eyeColor = 0xc0d23a;
  }

  // --- amorphous (blob rig): ghostly wisps vs gooey slimes ---
  else if (/wisp|spirit|sprite|ghost|phantom|shade|soul|wraith|will-o/.test(n)) {
    f.blob = 'wisp'; f.glow = 0x9fe8ff; f.core = 0xffffff; f.translucent = 0.6; f.eyeColor = 0x9fe8ff;
  } else if (/slime|ooze|jelly|gel|pudding|mireling|mud/.test(n)) {
    f.blob = 'slime'; f.core = 0xffffff; f.translucent = 0.82; f.drips = true;
  }

  return f;
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
