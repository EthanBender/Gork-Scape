// src/world/worldData.js
// The 1000x1000 Goblin World design, encoded as data. This is the single
// source of truth for regions, landmarks, resource tiers, gates, shortcuts and
// quests. map.js consumes it to generate the world; main.js reads it for
// gating, location names, etc. (Quests/shortcuts are data-only scaffolding for
// now — see README "World status".)

export const WORLD_W = 1000;
export const WORLD_H = 1000;
export const CHUNK = 64;
export const CENTER = { x: 500, y: 500 };
export const DEFAULT_SEED = 1337;

// --- Terrain ids (stored in a Uint8Array) ---
export const T = {
  GRASS: 0, WATER: 1, ROCK: 2, ROAD: 3, SWAMP: 4, SAND: 5,
  BRIDGE: 6, DIRT: 7, FIELD: 8, FLOOR: 9, WALL: 10,
  // --- visual texture variants (walkability matches their base tile) ---
  GRASS2: 11, GRASS3: 12, WATER_DEEP: 13, WATER_SHALLOW: 14,
  ROCK2: 15, CLIFF: 16, MUD: 17, WET_SAND: 18,
};
export const TERRAIN_DEFS = [
  { id: 'grass',  color: 0x4a7c3a, walkable: true },
  { id: 'water',  color: 0x2e5e8c, walkable: false },
  { id: 'rock',   color: 0x5f5f5f, walkable: false },
  { id: 'road',   color: 0x8a7a52, walkable: true },
  { id: 'swamp',  color: 0x47512c, walkable: true },
  { id: 'sand',   color: 0xc7b487, walkable: true },
  { id: 'bridge', color: 0x9a6f3a, walkable: true },  // planks over water
  { id: 'dirt',   color: 0x7d6a48, walkable: true },  // trails / camp ground
  { id: 'field',  color: 0x6e5a2e, walkable: true },  // tilled farmland
  { id: 'floor',  color: 0x8a7a58, walkable: true },  // building / town floor
  { id: 'wall',   color: 0x4a3f30, walkable: false }, // palisade / fences
  // texture variants (indices 11-18) — visual only, appended so base ids 0-10 stay stable
  { id: 'grass2', color: 0x54864a, walkable: true },  // lighter grass patch
  { id: 'grass3', color: 0x3f6b30, walkable: true },  // darker grass patch
  { id: 'water_deep',    color: 0x244f78, walkable: false },
  { id: 'water_shallow', color: 0x3f77a6, walkable: false },
  { id: 'rock2',  color: 0x6d6d6d, walkable: false }, // lighter rock
  { id: 'cliff',  color: 0x484848, walkable: false }, // shaded cliff face
  { id: 'mud',    color: 0x554b30, walkable: true },  // swamp mud
  { id: 'wet_sand', color: 0xa89a6a, walkable: true }, // sand at the waterline
];

// --- Regions (reverse-engineered from the approved image pack: exact centers,
//   bounds [x1,y1,x2,y2], level ranges and mob lists). x/y = center; r is a
//   naming radius derived from the bounds; regionAt() prefers bounds. ---
export const REGION_ANCHORS = [
  { id: 'settlement', name: 'Goblin Settlement',   x: 500, y: 455, r: 52,  bounds: [450, 405, 555, 510], level: '1-15', mobs: [] },
  { id: 'choppers',   name: "Chopper's Hollow",    x: 335, y: 370, r: 90,  bounds: [250, 295, 430, 455], level: '1-20', mobs: ['forest_rat', 'giant_spider', 'goblin_trainee'] },
  { id: 'willow',     name: 'Willow Riverlands',   x: 285, y: 610, r: 120, bounds: [150, 485, 385, 725], level: '10-30', mobs: ['mud_grub', 'mud_bug', 'river_bandit'] },
  { id: 'mushroom',   name: 'Mushroom Forest',     x: 250, y: 800, r: 137, bounds: [115, 700, 390, 945], level: '25-55', mobs: ['fungal_goblin', 'deep_cave_crawler'] },
  { id: 'grubpit',    name: 'Grubpit Quarry',      x: 455, y: 285, r: 65,  bounds: [390, 230, 520, 345], level: '1-25', mobs: ['cave_bug', 'cave_bat'] },
  { id: 'minehills',  name: 'Northern Mine Hills', x: 610, y: 190, r: 117, bounds: [500, 60, 735, 290], level: '20-55', mobs: ['iron_rock_crab', 'cave_goblin_miner', 'deep_cave_crawler'] },
  { id: 'troll',      name: 'Troll Ridge',         x: 835, y: 80,  r: 135, bounds: [710, 0, 980, 170], level: '50-80+', mobs: ['troll_whelp', 'cave_troll'] },
  { id: 'grublake',   name: 'Grublake',            x: 735, y: 495, r: 135, bounds: [615, 355, 880, 625], level: '15-45', mobs: ['crazed_fisher_gob', 'lake_snapper'] },
  { id: 'oakwoods',   name: 'Eastern Oakwoods',    x: 820, y: 330, r: 140, bounds: [700, 210, 980, 475], level: '20-50', mobs: ['oak_boar', 'moss_wolf', 'rival_goblin_scout'] },
  { id: 'farmlands',  name: 'Main Farmlands',      x: 510, y: 640, r: 90,  bounds: [420, 560, 600, 735], level: '1-35', mobs: ['training_rat', 'forest_rat', 'mud_bug'] },
  { id: 'bog',        name: 'Bog of Grub',         x: 685, y: 710, r: 112, bounds: [595, 620, 805, 845], level: '30-60', mobs: ['swamp_frog', 'bog_rat', 'bog_slime', 'swamp_shaman'] },
  { id: 'rival',      name: 'Rival Goblin Territory', x: 850, y: 825, r: 102, bounds: [760, 730, 955, 935], level: '45-70+', mobs: ['rival_goblin_warrior', 'rival_goblin_archer', 'rival_goblin_brute', 'red_ear_captain'] },
  { id: 'ruins',      name: 'Old Forest Ruins',    x: 245, y: 150, r: 150, bounds: [90, 40, 390, 260], level: '20-45', mobs: ['giant_spider', 'moss_wolf', 'fungal_goblin'] },
];

// --- Landmarks / POIs (exact coordinates from landmarks.json) ---
export const LANDMARKS = [
  { id: 'town_bank', name: 'Bank', x: 485, y: 455, kind: 'service' },
  { id: 'town_furnace', name: 'Town Furnace', x: 515, y: 465, kind: 'furnace' },
  { id: 'town_anvil', name: 'Town Anvil', x: 525, y: 465, kind: 'anvil' },
  { id: 'training_yard', name: 'Training Yard', x: 515, y: 485, kind: 'yard' },
  { id: 'west_bridge', name: 'Repairable West Bridge', x: 340, y: 435, kind: 'shortcut' },
  { id: 'grublake_dock', name: 'Grublake Dock', x: 645, y: 440, kind: 'dock' },
  { id: 'lake_island', name: 'Lake Island', x: 745, y: 520, kind: 'island' },
  { id: 'mine_cart', name: 'Mine Cart Route', x: 590, y: 250, kind: 'shortcut' },
  { id: 'deep_mine_entrance', name: 'Deep Mine Entrance', x: 640, y: 170, kind: 'cave' },
  { id: 'swamp_shrine', name: 'Swamp Shrine', x: 725, y: 775, kind: 'shrine' },
  { id: 'witch_goblin_hut', name: 'Witch-Goblin Hut', x: 250, y: 800, kind: 'hut' },
  { id: 'captured_anvil', name: 'Captured Anvil', x: 840, y: 810, kind: 'anvil' },
  { id: 'troll_gate', name: 'Troll Ridge Gate', x: 800, y: 120, kind: 'gate' },
  { id: 'old_ruin_chapel', name: 'Old Ruin Chapel', x: 245, y: 150, kind: 'ruins' },
];

// Roads (exact polylines from roads.json).
export const ROADS = [
  { id: 'town_to_quarry_to_mines', type: 'main_road', w: 3, pts: [[500, 455], [500, 390], [455, 285], [530, 240], [610, 190], [800, 120]] },
  { id: 'town_to_grublake_to_oakwoods', type: 'main_road', w: 3, pts: [[500, 455], [575, 455], [645, 440], [735, 420], [820, 330]] },
  { id: 'town_to_farms_to_swamp', type: 'main_road', w: 3, pts: [[500, 455], [510, 640], [610, 690], [725, 775], [850, 825]] },
  { id: 'town_to_choppers_hollow', type: 'main_road', w: 3, pts: [[500, 455], [420, 430], [335, 370]] },
  { id: 'willow_to_mushroom_trail', type: 'trail', w: 2, pts: [[335, 370], [285, 610], [250, 800]] },
  { id: 'lake_to_bog_waterline', type: 'water_or_boardwalk', w: 2, pts: [[735, 560], [705, 640], [685, 710], [725, 775]] },
];

// Pack mob names -> base enemy stat block in ENEMY_TYPES (display name is the
// prettified pack name, so region flavour is preserved).
export const MOB_MAP = {
  forest_rat: 'rat', training_rat: 'rat', bog_rat: 'rat',
  goblin_trainee: 'cave_bug', cave_bug: 'cave_bug', cave_bat: 'cave_bug', iron_rock_crab: 'cave_bug',
  giant_spider: 'spider', deep_cave_crawler: 'spider',
  river_bandit: 'bandit', crazed_fisher_gob: 'bandit',
  mud_grub: 'mud_bug', mud_bug: 'mud_bug', lake_snapper: 'mud_bug',
  oak_boar: 'wolf', moss_wolf: 'wolf',
  cave_goblin_miner: 'cave_goblin', fungal_goblin: 'cave_goblin', swamp_shaman: 'cave_goblin',
  swamp_frog: 'slime', bog_slime: 'slime',
  rival_goblin_scout: 'rival_scout', rival_goblin_archer: 'rival_scout',
  rival_goblin_warrior: 'rival_warrior', rival_goblin_brute: 'rival_warrior', red_ear_captain: 'rival_warrior',
  troll_whelp: 'troll', cave_troll: 'troll',
};

// --- Resource node catalog. Each entry is a clickable world object.
//   skill/level/tool gate access; low/high feed the skilling success roll;
//   drop/xp are granted on success; deplete = chance to exhaust per success. ---
export const RESOURCE_TYPES = {
  // Woodcutting
  tree:        { label: 'Tree',        skill: 'Woodcutting', level: 1,  tool: 'axe', drop: 'logs',        xp: 25, low: 32, high: 232, color: 0x1f5c1f, deplete: 0.15, respawn: 15, blocking: true },
  tree_oak:    { label: 'Oak',         skill: 'Woodcutting', level: 10, tool: 'axe', drop: 'oak_logs',    xp: 37, low: 24, high: 200, color: 0x2f6b25, deplete: 0.12, respawn: 25, blocking: true },
  tree_willow: { label: 'Willow',      skill: 'Woodcutting', level: 20, tool: 'axe', drop: 'willow_logs', xp: 52, low: 18, high: 175, color: 0x6a8f3a, deplete: 0.10, respawn: 30, blocking: true },
  tree_dead:   { label: 'Dead Tree',   skill: 'Woodcutting', level: 35, tool: 'axe', drop: 'dead_logs',   xp: 70, low: 14, high: 150, color: 0x4a4030, deplete: 0.10, respawn: 35, blocking: true },
  // [economy lane] Firemaking tiers 5-10 — higher trees so the whole Firemaking ladder (fm 40-75) has a log source. Levels/outputs mirror world_nodes.json (dense_oak_tree … moonwillow_tree).
  tree_dense_oak:  { label: 'Dense Oak',    skill: 'Woodcutting', level: 30, tool: 'axe', drop: 'dense_oak_logs',     xp: 90,  low: 16, high: 140, color: 0x3a5a1e, deplete: 0.10, respawn: 38, blocking: true },
  tree_fungal:     { label: 'Fungal Tree',  skill: 'Woodcutting', level: 40, tool: 'axe', drop: 'fungal_logs',        xp: 110, low: 14, high: 130, color: 0x7a6a9a, deplete: 0.10, respawn: 40, blocking: true },
  tree_blackroot:  { label: 'Blackroot',    skill: 'Woodcutting', level: 50, tool: 'axe', drop: 'blackroot_logs',     xp: 135, low: 12, high: 120, color: 0x2a2a20, deplete: 0.09, respawn: 42, blocking: true },
  tree_ironbark:   { label: 'Ironbark',     skill: 'Woodcutting', level: 60, tool: 'axe', drop: 'ironbark_logs',      xp: 165, low: 10, high: 105, color: 0x5a5a4a, deplete: 0.09, respawn: 45, blocking: true },
  tree_rotwood:    { label: 'Elder Rotwood', skill: 'Woodcutting', level: 70, tool: 'axe', drop: 'elder_rotwood_logs', xp: 200, low: 9,  high: 95,  color: 0x4a3a2a, deplete: 0.08, respawn: 48, blocking: true },
  tree_moonwillow: { label: 'Moonwillow',   skill: 'Woodcutting', level: 75, tool: 'axe', drop: 'moonwillow_logs',    xp: 240, low: 8,  high: 85,  color: 0x8aa8c0, deplete: 0.08, respawn: 50, blocking: true },
  // Mining
  rock_copper: { label: 'Copper',      skill: 'Mining', level: 1,  tool: 'pickaxe', drop: 'ore',      xp: 25, low: 40, high: 200, color: 0xb87333, deplete: 0.25, respawn: 18, blocking: true },
  rock_tin:    { label: 'Tin',         skill: 'Mining', level: 1,  tool: 'pickaxe', drop: 'tin_ore',  xp: 25, low: 40, high: 200, color: 0x9a9a9a, deplete: 0.25, respawn: 18, blocking: true },
  rock_iron:   { label: 'Iron',        skill: 'Mining', level: 15, tool: 'pickaxe', drop: 'iron_ore', xp: 35, low: 30, high: 180, color: 0x8a5a3a, deplete: 0.30, respawn: 22, blocking: true },
  rock_coal:   { label: 'Coal',        skill: 'Mining', level: 30, tool: 'pickaxe', drop: 'coal',     xp: 50, low: 20, high: 160, color: 0x2a2a2a, deplete: 0.35, respawn: 28, blocking: true },
  rock_gold:   { label: 'Gold',        skill: 'Mining', level: 40, tool: 'pickaxe', drop: 'gold_ore', xp: 65, low: 16, high: 140, color: 0xe3c14a, deplete: 0.40, respawn: 35, blocking: true },
  // Fishing (spots sit on/next to water; non-blocking — fish from the shore)
  fish_shrimp: { label: 'Shrimp',      skill: 'Fishing', level: 1,  tool: 'net',     drop: 'raw_fish',  xp: 10, low: 16, high: 180, color: 0x57b9d6, deplete: 0, respawn: 0, blocking: false },
  fish_trout:  { label: 'Trout',       skill: 'Fishing', level: 10, tool: 'rod',     drop: 'raw_trout', xp: 40, low: 14, high: 160, color: 0x4fa3c7, deplete: 0, respawn: 0, blocking: false },
  fish_pike:   { label: 'Pike',        skill: 'Fishing', level: 20, tool: 'harpoon', drop: 'raw_pike',  xp: 55, low: 12, high: 140, color: 0x3f8fb5, deplete: 0, respawn: 0, blocking: false },
  fish_eel:    { label: 'Eel',         skill: 'Fishing', level: 30, tool: 'cage',    drop: 'raw_eel',   xp: 70, low: 10, high: 120, color: 0x5a8a6a, deplete: 0, respawn: 0, blocking: false },
};

// Which item ids satisfy each tool gate.
export const TOOLS = {
  axe: ['bronze_hatchet', 'iron_axe'],
  pickaxe: ['bronze_pickaxe', 'iron_pickaxe'],
  net: ['small_net'],
  rod: ['fishing_rod'],
  harpoon: ['harpoon'],
  cage: ['fishing_cage'],
};

// Resource spawns per region: [resourceType, count].
export const REGION_RESOURCES = {
  grubpit:   [['rock_copper', 14], ['rock_tin', 12], ['rock_iron', 4]],
  choppers:  [['tree', 26], ['tree_oak', 8]],
  willow:    [['tree_willow', 14], ['fish_shrimp', 5], ['fish_trout', 6]],
  farmlands: [['tree', 8]],
  grublake:  [['fish_shrimp', 6], ['fish_trout', 8], ['fish_pike', 7], ['tree_willow', 8], ['tree_moonwillow', 6]],
  oakwoods:  [['tree_oak', 22], ['tree', 12], ['tree_willow', 6], ['tree_dense_oak', 8]],
  minehills: [['rock_copper', 8], ['rock_tin', 8], ['rock_iron', 14], ['rock_coal', 12], ['rock_gold', 8]],
  bog:       [['tree_dead', 12], ['fish_eel', 8], ['tree_blackroot', 6]],
  mushroom:  [['tree', 14], ['tree_dead', 8], ['tree_fungal', 8], ['tree_blackroot', 5]],
  rival:     [['rock_iron', 8], ['rock_coal', 8], ['rock_gold', 6], ['tree_dead', 6]],
  troll:     [['rock_coal', 10], ['rock_gold', 10], ['tree_ironbark', 8], ['tree_rotwood', 6]],
  ruins:     [['tree', 16], ['tree_oak', 8], ['rock_iron', 6], ['tree_ironbark', 5], ['tree_rotwood', 5], ['tree_moonwillow', 4]],
};

// --- Enemy catalog (combat stats kept simple; combatLevel computed at spawn). ---
export const ENEMY_TYPES = {
  rat:        { name: 'Giant Rat',     color: 0x8a7a5a, hp: 5,  att: 1,  str: 1,  def: 1,  speed: 3, loot: 'rat' },
  cave_bug:   { name: 'Cave Bug',      color: 0x6a5a7a, hp: 6,  att: 3,  str: 3,  def: 2,  speed: 3, loot: 'rat' },
  spider:     { name: 'Giant Spider',  color: 0x3a3a3a, hp: 8,  att: 5,  str: 5,  def: 3,  speed: 2, loot: 'rat' },
  bandit:     { name: 'Goblin Bandit', color: 0x7a5a3a, hp: 12, att: 8,  str: 8,  def: 6,  speed: 3, loot: 'goblin_guard' },
  mud_bug:    { name: 'Mud Bug',       color: 0x5a6a4a, hp: 10, att: 6,  str: 6,  def: 5,  speed: 3, loot: 'rat' },
  wolf:       { name: 'Wolf',          color: 0x9a9a9a, hp: 18, att: 14, str: 14, def: 8,  speed: 2, loot: 'goblin_guard' },
  cave_goblin:{ name: 'Cave Goblin',   color: 0x4f7f4a, hp: 16, att: 12, str: 12, def: 10, speed: 3, loot: 'goblin_guard' },
  slime:      { name: 'Bog Slime',     color: 0x6abf6a, hp: 14, att: 10, str: 10, def: 7,  speed: 4, loot: 'rat' },
  rival_scout:{ name: 'Rival Scout',   color: 0x9a4a4a, hp: 22, att: 18, str: 16, def: 14, speed: 3, loot: 'goblin_guard' },
  rival_warrior:{ name: 'Rival Warrior', color: 0xb03030, hp: 35, att: 30, str: 28, def: 24, speed: 3, loot: 'rival' },
  troll:      { name: 'Mountain Troll',color: 0x6a7a8a, hp: 60, att: 45, str: 50, def: 35, speed: 4, loot: 'rival' },
};

// Enemy spawns per region: [enemyType, count].
export const REGION_ENEMIES = {
  grubpit:   [['rat', 3], ['cave_bug', 3]],
  choppers:  [['rat', 3], ['spider', 2]],
  willow:    [['mud_bug', 3], ['bandit', 2]],
  farmlands: [['rat', 3]],
  grublake:  [['mud_bug', 2], ['bandit', 2]],
  oakwoods:  [['wolf', 3], ['spider', 3], ['rival_scout', 2]],
  minehills: [['cave_bug', 3], ['cave_goblin', 4]],
  bog:       [['slime', 4], ['mud_bug', 3]],
  mushroom:  [['spider', 3], ['cave_goblin', 2]],
  rival:     [['rival_warrior', 5], ['rival_scout', 4]],
  troll:     [['troll', 3], ['wolf', 3]],
  ruins:     [['spider', 3], ['bandit', 3]],
};

// Loot tables referenced by enemy.loot (rat table added alongside goblin_guard).
export const EXTRA_LOOT = {
  rat: {
    always: [{ id: 'bones', qty: 1 }],
    roll: [
      { id: 'coins', qty: [1, 8], weight: 50 },
      { id: null, weight: 45 },
      { id: 'raw_fish', qty: 1, weight: 5 },
    ],
  },
  rival: {
    always: [{ id: 'bones', qty: 1 }, { id: 'coins', qty: [20, 60] }],
    roll: [
      { id: 'iron_bar', qty: 1, weight: 30 },
      { id: 'coal', qty: [1, 3], weight: 25 },
      { id: 'gold_ore', qty: 1, weight: 15 },
      { id: 'iron_pickaxe', qty: 1, weight: 8 },
      { id: 'iron_axe', qty: 1, weight: 8 },
      { id: null, weight: 14 },
    ],
  },
};

// --- Gates / shortcuts / quests (data scaffolding; not all wired yet) ---
export const SHORTCUTS = [
  { id: 'west_bridge', name: 'West Bridge', connects: ['settlement', 'willow'], at: [360, 575], requires: '10 logs, 5 oak logs, bronze nails' },
  { id: 'mine_cart', name: 'Mine Cart', connects: ['minehills', 'settlement'], at: [665, 300], requires: 'iron bars, planks, engineer quest' },
  { id: 'grublake_boat', name: 'Grublake Boat', connects: ['grublake', 'oakwoods'], at: [685, 525], requires: 'willow logs, rope, coins' },
  { id: 'swamp_path', name: 'Swamp Shrine Path', connects: ['farmlands', 'bog', 'mushroom'], at: [735, 745], requires: 'deadwood, swamp herbs, combat' },
  { id: 'mushroom_ring', name: 'Mushroom Ring', connects: ['mushroom', 'settlement'], at: [285, 825], requires: 'rare mushrooms, goblin charm' },
  { id: 'mountain_pass', name: 'Mountain Pass', connects: ['minehills', 'troll'], at: [790, 120], requires: 'mid combat, mining progress' },
];

export const QUEST_ACTS = [
  { act: 1, name: 'Goblin Starts Small', levels: [1, 10],
    quests: ['Goblin Needs Pointy Stick', 'Fish for the Chief', 'First Pickaxe', 'Cabbage for Cowards', 'Rats in the Storehouse'] },
  { act: 2, name: 'Goblin Gets Useful', levels: [10, 25],
    quests: ['Bridge Over Dumb Water', 'The Grubpit Problem', 'A Proper Goblin Axe', "The Farmer's Bad Smell", 'Grublake Fish Thieves'] },
  { act: 3, name: 'Goblin Gets Brave', levels: [25, 45],
    quests: ['The Bog Bites Back', 'Repair the Grublake Dock', 'Scouts in the Oakwoods', 'Mine Cart Madness', "The Witch-Goblin's Favour"] },
  { act: 4, name: 'Goblin Goes to War', levels: [45, 70],
    quests: ['Banner of the Bigger Goblin', 'Bog Road Ambush', 'The Captured Anvil', 'Gold for the Chief', 'War on the Red-Ear Clan'] },
];
