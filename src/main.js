// src/main.js
// Phaser scene + glue for the 1000x1000 Goblin World. Rendering is viewport-
// culled (terrain + objects + entities), NPC AI only runs near the player, and
// skilling is skill/tool gated. Per-tick simulation runs off a 600ms timer.

import { Ticker, TICK_MS } from './engine/tick.js';
import { initSession, notifyGameReady, registerSaver } from './engine/session.js';
import { applySave } from './engine/save.js';
import * as WorldClock from './engine/worldClock.js';
import * as WorldEvents from './systems/worldEvents.js';
import {
  generateWorld, isWalkable, findPath, regionAt, objectsInView, addWorldObject,
  TILE_SIZE, WORLD_W, WORLD_H, TERRAIN_DEFS, T,
} from './world/map.js';
import { generateInterior } from './world/interiors.js'; // M2: dungeon sub-maps (enter/exit world swap)
import { contractOnKill, contractDialog, contractState } from './systems/contracts.js'; // M3: slayer-lite contracts
import { playSfx, unlockAudio, toggleMute } from './engine/sfx.js'; // juice: the game's first audio
import { LANDMARKS, REGION_ANCHORS } from './world/worldData.js';

// World-map overlay toggles (PASS 7)
const SHOW_REGION_BOUNDS = false;    // giant region circles — off (debug only)
const SHOW_LABELS = true;            // region name labels
const SHOW_RESOURCE_MARKERS = true;  // trees/ore/fishing specks from real data
import { Player, NPC } from './world/entities.js';
import {
  Game, initState, addItem, grantXp, countItem, removeOneById, removeAt,
  playerProfile, totalBonuses, playerCombatLevel, spawnGroundItem, pickupGroundAt, pickupOneAt,
  GROUND_DESPAWN_TICKS,
  playerAttackRange, needsAmmo, hasAmmoForRanged, consumeAmmo, ammoRecoveryChance,
  drainPrayer, restorePrayer, isProtecting,
  weaponSpec, consumeSpec, regenSpec,
} from './engine/state.js';
import { resolveAttack, resolveSpecial, combatLevel, weaponRange } from './engine/combat.js';
import { RUN_TILES, ensureRun, wantsToRun, updateRunEnergy, toggleRun, updateRunHud } from './engine/run.js';
import { HOME_COOLDOWN_TICKS, TICK_SECONDS, homeState, isChanneling, beginHomeTeleport, cancelHomeTeleport, tickHomeTeleport, resetHomeTeleport } from './systems/homeTeleport.js'; // [economy lane] OSRS-style home teleport
import { styleOfWeapon, PROTECT_FACTOR } from './engine/prayer.js';
// [economy lane] Tinkering — the sapper combat style. Importing registers its
// generated item catalogue into ITEMS and exposes the gadget combat effects.
import { isTinkerWeapon, effectiveGadgetEffect } from './systems/tinkering.js';
import { initTinkerHud, openWorkbench } from './systems/tinkeringUI.js';
import { initWiki } from './ui/wiki.js'; // [economy lane] item Codex/Wiki button + overlay
import { facilityPOIs } from './ui/worldMap.js'; // [economy lane] facility POIs for minimap (same set as the world map)
import { gather as gatherNode, rollGatherByproduct, hasRequiredTool } from './systems/gathering.js'; // [economy lane] data-driven world-node gathering + byproducts
import { rollSkillSuccess } from './engine/skills.js';
import { emptyBonuses, ITEMS } from './items/equipment.js';
import { rollLoot } from './world/loot.js';
import { randInt } from './engine/rng.js';
import { placeTransports, boardTransport } from './systems/travel.js'; // [economy lane] fast travel (carts/portal)
import { drawTownDecor } from './systems/townDecor.js'; // [economy lane] settlement decoration layer
import { initPanels, showContextMenu, openExchange, openShop, openBank, openStation, activePanel, closeWorldPanels } from './ui/panels.js'; // open* panels [economy lane]
// [economy lane] — combat drops from the database drop tables. See COORDINATION.md.
import { rollMonsterDrops } from './systems/drops.js';
import { monsterIdForSpawn } from './data/worldContract.js';
import { GameData } from './data/gameData.js'; // [economy lane] crop-patch node lookups for farming
import { shopkeeperSpawns, loadAndRestockShops, saveWorldShops, restockShops, SHOP_POSTS } from './systems/shops.js'; // [economy lane] shopkeeper NPCs + world-time restock ([char-render] SHOP_POSTS for minimap POIs)
import * as Farming from './systems/farming.js'; // [economy lane] crops grow on world time (offline too)
import { connectServerLink } from './net/serverLink.js'; // [economy lane] shared-world GE price feed (Phase 4)
import { startPresence, stopPresence } from './net/presence.js'; // [presence lane] see other players + shared chat
// [economy lane] — Firemaking: temporary ground fires (lit from inventory in
// panels.js) render here, expire on the global tick, and cook via performSkill.
import { activeFires, tickFires, fireAt, fireLifeRatio } from './systems/firemaking.js';
// [economy lane] — Grand Exchange world state persists globally and drifts while
// everyone is offline; restored + fast-forwarded on login. See geActions.js.
import { loadAndAdvanceWorldMarket, saveWorldMarket } from './systems/geActions.js';
import {
  initQuests, evaluate as tickQuests, onKill as questOnKill,
  onTalk as questOnTalk, onArrive as questOnArrive, questMarkers, ensureQuestBosses,
  trackedQuestId, questById, activeStep,
} from './systems/quests.js'; // [economy lane] quest engine v2
import { playCutscene } from './systems/cutscene.js'; // [economy lane] cinematic quest beats
import './data/questItems.js'; // [economy lane] register unique quest items into ITEMS
// [character-render lane] — the visible avatar. Pure rendering; reads state only.
import { drawAvatar } from './render/avatar.js';
import { gearHints, weaponStyleFor, bodyTypeFor, footprintFor } from './render/gear.js';
import { avatarStateFor, playerSkillTarget, drawSkillFx, AV_SCALE, AV_FEET, AV_TOP } from './render/characters.js';
import { drawProp, propKind } from './render/props.js'; // [char-render] structure props (anvil/chest/stall/…) replace flat squares
import { loadTerrainArt, terrainArtUrl, terrainGrid } from './render/terrainArt.js'; // [char-render] optional real ground-tile art (falls back to procedural)
import { loadObjectArt, objectArtUrl, objectScale } from './render/objectArt.js'; // [char-render] optional real world-object art (falls back to procedural)

const tilePx = (t) => t * TILE_SIZE + TILE_SIZE / 2;
const manhattan = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);
const ACTIVATE = 46;   // NPC AI/draw radius (tiles) around the player
const COOK_XP = { raw_fish: 30, raw_trout: 70, raw_pike: 90, raw_eel: 110 };
const TOOL_NAME = { axe: 'an axe', pickaxe: 'a pickaxe', net: 'a fishing net', rod: 'a fishing rod', harpoon: 'a harpoon', cage: 'a fishing cage' };

let scene;
let terrainGfx, objectsGfx, groundGfx, entitiesGfx, miniGfx, decorGfx;
let uiCam; // dedicated HUD camera: keeps the minimap upright under main-cam zoom/rotation
let compassN = null; // the "N" marker on the minimap compass
let objLabelPool = [];
let npcLabelPool = [];   // pooled, positioned on nearby NPCs each frame (never one-per-NPC)
let groundLabels = [];
let playerLabel = null;
let projectiles = []; // [character-render lane] in-flight arrows/bolts: {x,y,tx,ty,at,dur}

const MINI_SIZE = 168; // local minimap size in px
// [char-render] minimap zoom: px per world tile. Scroll over the minimap steps
// through these; wider (smaller) shows more world, closer (larger) shows detail
// and reveals more POI icons (shops appear only when zoomed in — declutter).
const MINI_ZOOMS = [2, 3, 5, 8];
let miniZoomI = 1;              // index into MINI_ZOOMS (default 3 px/tile)
let MINI_SPT = MINI_ZOOMS[miniZoomI];
const hexCss = (n) => '#' + n.toString(16).padStart(6, '0');

// ---- camera controls (zoom + rotate around the player) --------------------
// ZOOM_MIN = 1 → the starting view is the furthest you can zoom out; you can only
// zoom IN from there (never further out than the native framing).
const ZOOM_MIN = 1, ZOOM_MAX = 2.6, ZOOM_STEP = 0.12;
const ROT_STEP = Math.PI / 12; // 15° per key tap / wheel notch
let targetZoom = 1;            // smoothed-toward values; main cam eases to these
let targetRot = 0;            // radians, accumulates (not wrapped)
const csCamPx = { x: null, y: null }; // [economy lane] eased cutscene camera position
// [r3d] real-3D render mode, opt-in via ?r3d=1. Read ONCE. When off, the two guarded
// hooks below are dead code and the 2D path is byte-identical (three.js never loads).
const R3D = typeof location !== 'undefined' && /[?&]r3d=1/.test(location.search);

// ---------------------------------------------------------------- world setup
function buildWorld() {
  const world = generateWorld();
  Game.world = world;

  const p = new Player(world.spawn.x, world.spawn.y);
  Game.player = p;

  // Starting kit: weapons, armour, the basic gathering tools, and a quiver of
  // arrows so the shortbow works out of the box (equip both to try ranged).
  ['goblin_spear', 'goblin_shortbow', 'goblin_hide_armor', 'bronze_hatchet',
   'bronze_pickaxe', 'small_net', 'fishing_rod'].forEach((id) => addItem(id));
  addItem('bronze_arrow', 150);
  addItem('coins', 25);

  Game.npcs = [];
  Game.activeNpcs = [];   // near-player subset, rebuilt each tick; all per-frame NPC work iterates THIS, not Game.npcs
  // Under Geography 2.0 the whole town is translated to its river-ford site;
  // hand-placed town NPCs ride along via this offset (zero under the legacy map).
  const TD = world.townOffset || { dx: 0, dy: 0 };
  // Elder in town.
  const elderLevels = { attack: 1, strength: 1, defence: 1, ranged: 1, hitpoints: 20 };
  Game.npcs.push(new NPC({
    id: 'elder', name: 'Goblin Elder', type: 'elder', tileX: 492 + TD.dx, tileY: 448 + TD.dy,
    color: 0x8a6fbf, aggressive: false, dialog: 'Welcome to the Goblin Empire, young Gork!',
    levels: elderLevels, combatLevel: combatLevel(elderLevels), bonuses: emptyBonuses(),
  }));

  // [economy lane] Exchange Merchant — the ONLY way to use the Grand Exchange.
  // Placed near spawn provisionally; world-gen: relocate to the real Grand Bazaar
  // and keep id 'exchange_merchant' so the GE proximity gate finds it.
  Game.npcs.push(new NPC({
    id: 'exchange_merchant', name: 'Exchange Merchant', type: 'elder',
    tileX: world.spawn.x + 2, tileY: world.spawn.y,
    color: 0xe8c65a, aggressive: false,
    dialog: 'Welcome to the Grand Exchange! Post your buy and sell offers here.',
    levels: elderLevels, combatLevel: null, bonuses: emptyBonuses(),
  }));

  // [economy lane] Sprocket the Tinker — quest-giver for the Tinkering skill and
  // keeper of the Workbench (talk to open it). id 'sprocket' matches the quest
  // giver + talkTo hook. world-gen: fine to relocate, keep the id.
  const sproketPos = findOpenTileNear(world, world.spawn.x + 6, world.spawn.y + 4, 8) || { x: world.spawn.x + 6, y: world.spawn.y + 4 };
  Game.npcs.push(new NPC({
    id: 'sprocket', name: 'Sprocket the Tinker', type: 'elder',
    tileX: sproketPos.x, tileY: sproketPos.y,
    color: 0xb8863a, aggressive: false,
    dialog: 'Bombs, cannons, contraptions — that\'s the goblin art! Talk to me to tinker.',
    levels: elderLevels, combatLevel: null, bonuses: emptyBonuses(),
  }));

  // [economy lane] Banker — gates the Bank panel. Stands in the keep's west-wing
  // vault one tile IN FRONT of the Bank counter (counter at 493,431), facing the
  // open plaza-side floor. He used to stand flush against the counter (493,432),
  // but the town's elevation lift draws the counter prop shifted up-and-over so it
  // overhung his approach tile — players read the (walkable) tile beside him as a
  // blocked square. Pulling him back to 493,433 leaves a clear buffer tile (the
  // banking mat, drawn in townDecor) between him and the counter so the approach
  // reads unambiguously. Reachable via the N passage + the wing door cut at
  // 497,427; banking still gates on either his tile or the counter (both range 3).
  // Keep id 'banker' so the proximity gate finds it.
  Game.npcs.push(new NPC({
    id: 'banker', name: 'Banker', type: 'elder',
    tileX: 493 + TD.dx, tileY: 433 + TD.dy,
    color: 0xc9a24a, aggressive: false,
    dialog: 'Welcome to the Bank of Gorkholm. Deposit and withdraw your goods here.',
    levels: elderLevels, combatLevel: null, bonuses: emptyBonuses(),
  }));

  // [economy lane] Shopkeepers — one per shop in shops.json, each gating its Shop
  // panel (proximity). Placed on a provisional ring west of spawn; world-gen:
  // relocate each to its themed building using its `region`, keep id
  // `shopkeeper_<shop_id>` so the gate + talk hook still find it.
  shopkeeperSpawns().forEach((sk, k, arr) => {
    // [economy lane] Stand ward keepers at their building post; region shops with
    // no town building fall back to the provisional ring west of spawn.
    const ang = (k / arr.length) * Math.PI * 2;
    const [tileX, tileY] = sk.post ? [sk.post[0] + TD.dx, sk.post[1] + TD.dy] : [
      world.spawn.x - 4 + Math.round(Math.cos(ang) * 3),
      world.spawn.y + Math.round(Math.sin(ang) * 3),
    ];
    Game.npcs.push(new NPC({
      id: sk.npcId, name: sk.shopName + ' Keeper', type: 'elder',
      tileX, tileY,
      color: 0x8fb8e0, aggressive: false,
      dialog: `Welcome to the ${sk.shopName}!`,
      levels: elderLevels, combatLevel: null, bonuses: emptyBonuses(),
    }));
  });

  // Sergeant Grimjaw — the Contract Master (M3). Stands by the training yard;
  // talking to him assigns / reports slayer-lite contracts (systems/contracts.js).
  Game.npcs.push(new NPC({
    id: 'contract_master', name: 'Sergeant Grimjaw', type: 'elder',
    tileX: 514 + TD.dx, tileY: 486 + TD.dy,
    color: 0xa03a2a, aggressive: false,
    dialog: 'Monsters need killing, goblin. I keep the list.',
    levels: elderLevels, combatLevel: null, bonuses: emptyBonuses(),
  }));

  // Enemies from region spawn points (name carries region flavour).
  // M3: aggression comes from the monster DATABASE — 39 of the 60 monsters are
  // flagged aggressive, so the wilderness finally attacks first. (Anything
  // without a DB row stays passive, which covers the town/teaser mobs.)
  world.enemySpawns.forEach((s, i) => {
    const def = world.ENEMY_TYPES[s.type];
    const levels = { attack: def.att, strength: def.str, defence: def.def, ranged: 1, hitpoints: def.hp };
    const dbMon = GameData.monster ? GameData.monster(monsterIdForSpawn(s)) : null;
    Game.npcs.push(new NPC({
      id: 'e' + i, name: s.name || def.name, type: 'guard', tileX: s.x, tileY: s.y, color: def.color,
      monsterId: monsterIdForSpawn(s), // [economy lane] -> database drop table
      wanderRadius: 4, leashRadius: 8,
      aggressive: !!(dbMon && dbMon.aggressive && !s._keep), aggroRange: dbMon && dbMon.aggressive ? 5 : 4,
      attackSpeed: def.speed, weaponType: 'crush', levels,
      combatLevel: combatLevel(levels), lootTable: def.loot,
      bonuses: Object.assign(emptyBonuses(), {
        crush_atk: Math.floor(def.att / 2), melee_str: Math.floor(def.str / 3),
        slash_def: def.def, crush_def: def.def, stab_def: def.def,
      }),
    }));
  });

  // [economy lane] A hand-placed Goblin Archer near spawn — a ranged sparring
  // partner that shoots back from up to 5 tiles, so ranged combat (and the
  // line-of-sight / ammo systems) has something to demonstrate against. Not
  // aggressive: the player chooses to engage. Drops arrows so ranged is
  // self-sustaining early on.
  const archerPos = findOpenTileNear(world, world.spawn.x - 6, world.spawn.y - 4, 8);
  if (archerPos) {
    // Tuned as a beatable early sparring partner (~Combat Lv 8) for a fresh
    // character, not a spawn-camping killer: modest ranged offence, low HP.
    const archerLevels = { attack: 1, strength: 1, defence: 3, ranged: 8, hitpoints: 15 };
    Game.npcs.push(new NPC({
      id: 'goblin_archer', name: 'Goblin Archer', type: 'guard',
      tileX: archerPos.x, tileY: archerPos.y, color: 0x7a9c3c,
      aggressive: false, aggroRange: 6, wanderRadius: 3, leashRadius: 12,
      attackSpeed: 3, weaponType: 'ranged', attackRange: 5,
      levels: archerLevels, combatLevel: combatLevel(archerLevels),
      lootTable: 'goblin_archer',
      bonuses: Object.assign(emptyBonuses(), {
        range_atk: 9, range_str: 5,
        stab_def: 3, slash_def: 3, crush_def: 3, range_def: 2,
      }),
    }));
  }

  // [economy lane] A Bones Altar near spawn: click to offer bones for 2.5× the
  // burying XP and a full prayer-point recharge. Hand-placed as a world object
  // (world-gen: relocate to a shrine/temple and keep `altar: true` + the id).
  const altarPos = findOpenTileNear(world, world.spawn.x + 4, world.spawn.y - 3, 8);
  if (altarPos) {
    const altar = {
      x: altarPos.x, y: altarPos.y, type: 'altar', altar: true,
      label: 'Bones Altar', color: 0xcfc4e0, blocking: true,
      depleted: false, respawnAt: 0,
    };
    addWorldObject(world, altar); // [economy lane] chunk-index so it renders
  }

  // [economy lane] Fast-travel transports (cart / mine-cart stations + blood
  // portal) as clickable world objects — near the hub, with a return at each stop.
  placeTransports(world);

  // Friendly (non-combat) NPCs — tutors, prospectors, farmers, etc.
  (world.friendlies || []).forEach((f, i) => {
    const lv = { attack: 1, strength: 1, defence: 1, ranged: 1, hitpoints: 10 };
    Game.npcs.push(new NPC({
      id: 'f' + i, name: f.name, type: 'elder', tileX: f.x, tileY: f.y,
      color: f.color || 0x8a7a4a, aggressive: false, dialog: f.dialog,
      levels: lv, combatLevel: null, bonuses: emptyBonuses(),
    }));
  });
}

// Spiral outward from (cx,cy) for a walkable tile no NPC already sits on.
// Returns {x,y} or null. Used to place hand-authored NPCs on valid ground.
function findOpenTileNear(world, cx, cy, radius) {
  const taken = new Set(Game.npcs.map((n) => n.tileX + ',' + n.tileY));
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // current ring only
        const x = cx + dx, y = cy + dy;
        if (isWalkable(world, x, y) && !taken.has(x + ',' + y)) return { x, y };
      }
    }
  }
  return null;
}

// Legacy resource objects gate on 'axe'/'pickaxe'/'net'/'rod'/'harpoon'/'cage';
// gathering.hasRequiredTool maps those words onto the same tool families the
// data-driven node path uses, so any obtainable tool of the family works.
function hasTool(toolType) {
  return hasRequiredTool(toolType);
}

// [economy lane] Spawn a unique QUEST BOSS into the world (installed as
// Game.spawnQuestBoss for the quest engine's `boss` steps). Idempotent — won't
// duplicate a boss that's already present; worldUpkeep removes it once slain.
// onKill(spec.id) (via the boss NPC's monsterId) advances the quest step.
function spawnQuestBoss(spec) {
  if (!spec || !spec.id || !Game.world || !Game.player) return;
  const npcId = 'qb_' + spec.id;
  if (Game.npcs.some((n) => n.id === npcId)) return; // already spawned (or being slain)
  const p = Game.player;
  const pos = findOpenTileNear(Game.world, spec.x != null ? spec.x : p.tileX,
    spec.y != null ? spec.y : p.tileY, 12) || { x: p.tileX, y: p.tileY };
  const lv = { attack: spec.att || 10, strength: spec.str || 10, defence: spec.def || 10, ranged: 1, hitpoints: spec.hp || 40 };
  const npc = new NPC({
    id: npcId, name: spec.name || 'Quest Boss', type: 'guard',
    tileX: pos.x, tileY: pos.y, color: spec.color || 0x9a3a3a,
    monsterId: spec.id,                        // onKill(spec.id) advances the step
    aggressive: !!spec.aggressive, aggroRange: spec.aggroRange != null ? spec.aggroRange : 6,
    wanderRadius: 2, leashRadius: 24,
    attackSpeed: spec.attackSpeed || 3, weaponType: spec.weaponType || 'crush',
    levels: lv, combatLevel: spec.combatLevel || combatLevel(lv), lootTable: null,
    bonuses: Object.assign(emptyBonuses(), {
      crush_atk: spec.att || 10, melee_str: spec.str || 10,
      slash_def: spec.def || 10, crush_def: spec.def || 10, stab_def: spec.def || 10,
    }),
  });
  npc.questBoss = true;
  Game.npcs.push(npc);
  Game.log(`${npc.name} rises to face you!`);
  Game.refresh();
}

// [economy lane] perf probe helpers (exposed via window.__GE). stress(n) spawns n
// throwaway wandering guards around the player to MEASURE the frame cost of many
// procedural rigs (watch #tb-fps). They're tagged `_stress` so stressClear() can
// remove exactly them without touching real NPCs.
function stressSpawn(n = 100) {
  const world = Game.world, p = Game.player;
  if (!world || !p) { console.warn('stress: world not ready'); return 0; }
  const lv = { attack: 1, strength: 1, defence: 1, ranged: 1, hitpoints: 10 };
  let made = 0;
  for (let i = 0; i < n; i++) {
    const pos = findOpenTileNear(world, p.tileX + randInt(-10, 10), p.tileY + randInt(-10, 10), 12);
    if (!pos) continue;
    const npc = new NPC({
      id: '_stress' + i, name: 'Stress Dummy', type: 'guard',
      tileX: pos.x, tileY: pos.y, color: 0x9a9a9a,
      wanderRadius: 5, aggressive: false, aggroRange: 0,
      levels: lv, combatLevel: combatLevel(lv), bonuses: emptyBonuses(),
    });
    npc._stress = true;
    Game.npcs.push(npc);
    made++;
  }
  Game.log(`Perf probe: spawned ${made} stress dummies (${Game.npcs.length} NPCs total). Watch the fps readout.`);
  Game.refresh();
  return made;
}
function stressClear() {
  const before = Game.npcs.length;
  Game.npcs = Game.npcs.filter((n) => !n._stress);
  const removed = before - Game.npcs.length;
  Game.log(`Perf probe: cleared ${removed} stress dummies (${Game.npcs.length} NPCs remain).`);
  Game.refresh();
  return removed;
}

// ---------------------------------------------------------------- scene create
function create() {
  scene = this;
  Game.scene = this;
  // Re-entrant: a logout destroys the Phaser game and a later login creates a
  // fresh one, re-running create(). Reset module-level pools that held now-
  // destroyed Phaser objects so we don't draw against stale handles.
  objLabelPool = [];
  npcLabelPool = [];
  groundLabels = [];
  projectiles = [];

  initState();
  buildWorld();
  initPanels();

  const ticker = new Ticker();
  ticker.onTick(gameTick);
  Game.ticker = ticker;

  // [world-continuity] The world clock + event calendar are pure functions of
  // wall-clock time, so day/night and world events keep turning whether or not
  // anyone is online. Expose them for any lane (world-gen tinting, combat drop/xp
  // bonuses, panels) and mirror the clock + live event into topbar readouts.
  Game.worldClock = WorldClock;
  Game.worldEvents = WorldEvents;
  Game.farming = Farming; // crops grow on the world clock; interaction wiring TBD
  mountWorldClockHud();
  ticker.onTick((_c, isLast) => {
    if (!isLast) return;
    updateWorldClockHud();
    updateWorldEventHud();
    updateHomeHud();
    restockShops(); // self-throttled (~15s); refills NPC shops during live play too
    updateCropLabels(); // reflect crop growth in patch labels without a click
  });

  // Overlay the signed-in character's saved state (skills, inventory, position,
  // clock) onto the freshly-built world, then advance the sim clock by the real
  // time the player was away. For a new character this is a no-op.
  applyPendingSave();

  // [economy lane] Quest reward payoffs that touch the world: expose the free
  // shortcut-opener to the (pure) quest engine, and re-apply any shortcuts the
  // player had already opened so bridges stay open across sessions.
  Game.grantShortcut = grantShortcut;
  reapplyOpenedShortcuts();

  // [economy lane] Cutscene hooks: the quest engine plays intro/outro cutscenes
  // via Game.playCutscene; the DOM player drives the camera pan through these.
  Game.playCutscene = playCutscene;
  window.__cutsceneCamSet = (x, y) => { Game.cutsceneCam = { x, y }; };
  window.__cutsceneCamClear = () => { Game.cutsceneCam = null; };

  // [economy lane] Quest bosses: the engine spawns unique named bosses through
  // this hook; re-spawn one the player was mid-fight on after a world rebuild.
  Game.spawnQuestBoss = spawnQuestBoss;

  // [economy lane] Quest engine: build the quest slate (new character) or reconcile
  // the restored one (returning character). Idempotent — never restarts a quest
  // that's already active/complete; auto-starts the opening tutorial for newcomers.
  initQuests();
  ensureQuestBosses(); // [economy lane] re-spawn any active quest-boss encounter
  // [economy lane] Onboarding nudge: point a brand-new goblin at their first
  // quest-giver (the '!' on the map), so the very first thing they learn is
  // "walk to the marker and talk". Only when the opening quest is still available.
  if (Game.questState && Game.questState.tutorial_first_scrap
      && Game.questState.tutorial_first_scrap.status === 'available') {
    Game.log('A quest-giver awaits — look for the gold ✦ marker and talk to the Goblin Elder to begin.');
  }

  // [economy lane] Restore the shared Grand Exchange world state and fast-forward
  // it over the real time everyone was away — the market kept trading offline.
  restoreWorldMarket();
  // [economy lane] Restore + fast-forward NPC shop stock: shelves that ran low
  // refill over world-time whether or not anyone was online.
  restoreShopsOnLogin();
  // [economy lane] Restore planted crops; they kept growing on the world clock.
  restoreFarmsOnLogin();
  // [economy lane] Connect to the authoritative world server if one is running:
  // its live guide prices replace the local ones (shared, always-on market).
  // Non-blocking and self-healing — no server → silently stays local.
  connectServerLink();
  // [presence lane] Start live multiplayer presence + shared chat: heartbeat my
  // position and render other signed-in players walking the same world.
  startPresence();
  // [world-continuity] Tell the returning player what's happening in the world
  // right now and what's coming — events run on the world calendar regardless.
  announceWorldEvents();

  ticker.start();

  terrainGfx = this.add.graphics().setDepth(0);
  objectsGfx = this.add.graphics().setDepth(1);
  decorGfx = this.add.graphics().setDepth(1.2); // [economy lane] town decoration, above structures
  groundGfx = this.add.graphics().setDepth(1.5);
  entitiesGfx = this.add.graphics().setDepth(2);

  playerLabel = this.add.text(0, 0, '', {
    fontFamily: 'monospace', fontSize: '11px', color: '#bff29a', fontStyle: 'bold',
  }).setOrigin(0.5, 1).setDepth(40);
  playerLabel.setStroke('#000', 3);
  // NPC name labels are POOLED (see updateLabels) — a fixed handful positioned on the
  // nearest NPCs each frame — so the world can hold thousands of mobs without thousands
  // of Phaser text objects sitting in the display list.

  miniGfx = this.add.graphics().setScrollFactor(0).setDepth(1001);

  this.cameras.main.setBounds(0, 0, WORLD_W * TILE_SIZE, WORLD_H * TILE_SIZE);
  this.cameras.main.centerOn(Game.player.px, Game.player.py);

  // The minimap lives on its own camera so it stays upright and unscaled while
  // the main camera zooms and rotates. Main cam draws the world (not the HUD);
  // uiCam draws only the HUD (not the world / world-space labels).
  uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
  uiCam.setScroll(0, 0);
  this.cameras.main.ignore(miniGfx);
  uiCam.ignore([terrainGfx, objectsGfx, decorGfx, groundGfx, entitiesGfx, playerLabel]); // pooled NPC labels get uiCam.ignore on creation (see updateLabels)
  this.scale.on('resize', (size) => uiCam.setSize(size.width, size.height));
  initTerrainArt(this); // [char-render] load any real ground-tile art (no-op if none)
  initObjectArt(this);  // [char-render] load any real world-object art (no-op if none)

  // Compass "N" marker — rides the HUD camera (screen-space, upright), repositioned
  // each frame around the compass dial to point at world-north. Main cam ignores it.
  compassN = this.add.text(0, 0, 'N', {
    fontFamily: 'monospace', fontSize: '9px', color: '#ff5a45', fontStyle: 'bold',
  }).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(1002);
  compassN.setStroke('#000', 2);
  this.cameras.main.ignore(compassN);

  // Run mechanics: init energy state + wire the HUD run toggle button.
  ensureRun();
  const runBtn = document.getElementById('run-btn');
  if (runBtn) runBtn.onclick = () => { toggleRun(); };
  updateRunHud(true);
  // [economy lane] Home Teleport button
  resetHomeTeleport();
  const homeBtn = document.getElementById('home-btn');
  if (homeBtn) homeBtn.onclick = () => startHomeTeleport();
  updateHomeHud();

  initTinkerHud(); // [economy lane] readies the Tinker's Workbench popup CSS (opened from the world node)

  // "Next up" goal chip (M1): the tracked quest's current objective, always visible
  // top-left of the world view — so a new player never wonders what to do next.
  if (!document.getElementById('goal-chip')) {
    const chip = document.createElement('div');
    chip.id = 'goal-chip';
    chip.style.cssText = 'position:absolute;left:10px;top:10px;z-index:30;max-width:46%;' +
      'padding:7px 11px;font:600 12px/1.4 var(--font-display),sans-serif;color:#e8c65a;' +
      'background:rgba(16,15,11,.86);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);' +
      'border:1px solid rgba(232,198,90,.4);border-radius:8px;box-shadow:0 3px 10px rgba(0,0,0,.45);' +
      'pointer-events:none;display:none;text-shadow:0 1px 0 #000;white-space:pre-line;';
    (document.getElementById('game-panel') || document.body).appendChild(chip);
  }
  // Day/night light (juice): a multiply-blended overlay driven by the world
  // clock — dawn gold, clear noon, amber dusk, moonlit blue night. DOM so it
  // costs nothing per frame and never touches the render pipeline.
  if (!document.getElementById('daylight-overlay')) {
    const dl = document.createElement('div');
    dl.id = 'daylight-overlay';
    dl.style.cssText = 'position:absolute;inset:0;z-index:20;pointer-events:none;mix-blend-mode:multiply;background:#fff;transition:background 2s linear;';
    (document.getElementById('game-panel') || document.body).appendChild(dl);
  }
  initWiki(); // [economy lane] the item Codex/Wiki button

  this.input.mouse.disableContextMenu();
  this.input.addPointer(3); // iPad multitouch: allow a few simultaneous touch pointers
  this.input.on('pointerdown', onPointerDown);
  this.input.on('pointermove', onPointerMove);
  this.input.on('wheel', onWheel);
  this.input.keyboard.on('keydown', onCameraKey);
  wireWorldMap();

  Game.location = regionAt(Game.player.tileX, Game.player.tileY);
  if (!Game.pendingSave) {
    // First-time intro — a returning player already got a "welcome back".
    Game.log(`Welcome to the Goblin Empire, young ${Game.account || 'Gork'}!`);
    Game.log('You stand in the goblin settlement at the heart of the world.');
    Game.log('Explore outward — resources get richer and more dangerous the farther you roam.');
  }
  Game.refresh();

  // [economy lane] perf probe — window.__GE.stress(n) spawns n throwaway dummy
  // NPCs around the player so the "135 procedural rigs at 60fps" claim can be
  // MEASURED (watch the #tb-fps topbar readout) instead of asserted. stressClear()
  // removes them. Dummies are inert guards on valid ground; they cost render +
  // the near-player AI/interp exactly like real NPCs.
  Game.sfx = playSfx; // bridge for engine/state (level-ups) + systems (quests/contracts)
  window.addEventListener('keydown', (e) => { if ((e.key === 'm' || e.key === 'M') && !/INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName || '')) Game.log(toggleMute() ? 'Sound muted. (M to unmute)' : 'Sound on.'); });
  window.__GE = { Game, startInteract, startAttack, regionAt, stress: stressSpawn, stressClear, tick: gameTick, goalChip: updateGoalChip };

  // Persistence/idle/autosave may start now that saved state is applied.
  notifyGameReady();

  // [r3d] mount the real-3D overlay ONLY under ?r3d=1. Dynamic import keeps three.js
  // out of the 2D bundle entirely; failure is caught and never affects the 2D game.
  if (R3D) import('./render3d/mount3d.js').then(m => m.mount3d(Game)).catch(e => console.error('[r3d] load failed', e));
}

// [economy lane] Restore + fast-forward the shared Grand Exchange on login, and
// tell the player how the market moved while everyone was offline. Guide prices
// drifted; the player's own resting offers are untouched (nothing happens to the
// player offline — they settle through normal play on return).
function restoreWorldMarket() {
  const res = loadAndAdvanceWorldMarket();
  if (!res || res.elapsedMs < 60000) return; // no snapshot, or away < 1 min
  const mins = Math.floor(res.elapsedMs / 60000);
  if (!res.movers.length) {
    Game.log('The Grand Exchange was quiet while you were away.');
    return;
  }
  Game.log('While you were away, the Grand Exchange kept trading:');
  for (const m of res.movers) {
    const arrow = m.pct >= 0 ? '▲' : '▼';
    Game.log(`  ${arrow} ${m.name}: ${m.from} → ${m.to} gp (${(m.pct * 100).toFixed(0)}%)`);
  }
}

// [economy lane] Restore shop stock and refill it for the offline gap; note it
// to the returning player if shelves were meaningfully restocked.
function restoreShopsOnLogin() {
  const refilled = loadAndRestockShops();
  if (refilled >= 10) Game.log('The merchants have restocked their shelves while you were away.');
}

// [economy lane] Restore planted crops — they matured on the world clock while
// you were gone (growth is a pure function of time). Note any that ripened.
function restoreFarmsOnLogin() {
  const ripe = Farming.loadWorldFarms();
  if (ripe > 0) Game.log(`${ripe} of your crops ${ripe === 1 ? 'has' : 'have'} ripened and ${ripe === 1 ? 'is' : 'are'} ready to harvest.`);
}

// [world-continuity] Login summary of the world calendar: the live event (if any)
// and the next one coming up. Sets _lastEventId so the HUD updater doesn't re-log
// the same event on its first tick.
function announceWorldEvents() {
  const ev = WorldEvents.activeEvent();
  if (ev) { Game.log(`${ev.name} — ${ev.blurb}`); _lastEventId = ev.id; }
  const nx = WorldEvents.nextEvent();
  if (nx) Game.log(`Coming up: ${nx.event.name} in ${WorldEvents.humanGap(nx.inMs)}.`);
}

// [world-continuity] topbar readout of the world clock. Injected once; kept in
// sync by a per-tick handler (updates on the last tick of a burst only).
function mountWorldClockHud() {
  const bar = document.getElementById('topbar');
  if (!bar || document.getElementById('tb-worldtime')) return;
  const span = document.createElement('span');
  span.className = 'tb';
  span.id = 'tb-worldtime';
  span.title = "The world's own time — it advances in real time whether or not you're online.";
  // Insert before the logout button (added later) so it stays in the left group.
  bar.insertBefore(span, document.getElementById('logout-btn'));
  updateWorldClockHud();
}
function updateWorldClockHud() {
  const el = document.getElementById('tb-worldtime');
  if (el) el.textContent = WorldClock.label();
}

// [world-continuity] topbar readout of the live world event (hidden when calm).
// The event that is showing is a pure function of the world clock, so it appears
// on schedule whether or not the player was here when it began.
let _lastEventId = null;
function updateWorldEventHud() {
  let el = document.getElementById('tb-worldevent');
  if (!el) {
    const bar = document.getElementById('topbar');
    if (!bar) return;
    el = document.createElement('span');
    el.className = 'tb';
    el.id = 'tb-worldevent';
    el.style.color = 'var(--gold, #e8c65a)';
    bar.insertBefore(el, document.getElementById('logout-btn'));
  }
  const ev = WorldEvents.activeEvent();
  el.textContent = ev ? ev.name : '';
  el.style.display = ev ? '' : 'none';
  // Announce transitions in the chat log as they happen during play.
  const id = ev ? ev.id : null;
  if (id !== _lastEventId) {
    if (ev) Game.log(`${ev.name} — ${ev.blurb}`);
    else if (_lastEventId) Game.log('The lands fall quiet again.');
    _lastEventId = id;
  }
}

// Restore the pending save (if any) onto live state and fast-forward the sim
// clock to cover the real time the player was signed out. See engine/save.js.
function applyPendingSave() {
  const data = Game.pendingSave;
  const p = Game.player;
  if (!data) return; // new character: keep buildWorld()'s spawn + starter kit

  applySave(data);
  if (p) { p.px = tilePx(p.tileX); p.py = tilePx(p.tileY); }

  Game.ticker.count = data.tick || 0;
  const awayMs = Math.max(0, Date.now() - (data.savedAt || Date.now()));
  const awayTicks = Math.floor(awayMs / TICK_MS);
  if (awayTicks > 0) {
    Game.ticker.advance(awayTicks);
    worldUpkeep(Game.ticker.count); // resolve any respawns/despawns that elapsed
  }

  Game.log(`Welcome back, ${Game.account}. It is now ${WorldClock.label()}.`);
  const mins = Math.floor(awayMs / 60000);
  if (mins >= 1) {
    const h = Math.floor(mins / 60), m = mins % 60;
    const worldDays = WorldClock.daysBetween(data.savedAt || Date.now());
    const worldNote = worldDays >= 1 ? ` The world moved on ${worldDays} day${worldDays === 1 ? '' : 's'} without you.` : '';
    Game.log(`You were away for ${h > 0 ? h + 'h ' : ''}${m}m — you resume exactly as you left off.${worldNote}`);
  }
}

function npcLabelText(n) {
  return n.combatLevel ? `${n.name} (Lv ${n.combatLevel})` : n.name;
}

// ---------------------------------------------------------------- view helpers
// worldView tracks zoom but is axis-aligned, so a rotated camera sees past its
// corners. Inflate the half-extents by the rotated bounding box so culling never
// clips visible tiles.
function viewRange() {
  const cam = scene.cameras.main;
  const v = cam.worldView;
  let hx = v.width / 2, hy = v.height / 2;
  const cxw = v.x + hx, cyw = v.y + hy;
  if (cam.rotation) {
    const c = Math.abs(Math.cos(cam.rotation)), s = Math.abs(Math.sin(cam.rotation));
    const rx = hx * c + hy * s, ry = hx * s + hy * c;
    hx = rx; hy = ry;
  }
  return {
    // clamp to the LIVE world's size — interiors are much smaller than the overworld
    x0: Math.max(0, Math.floor((cxw - hx) / TILE_SIZE) - 1),
    y0: Math.max(0, Math.floor((cyw - hy) / TILE_SIZE) - 1),
    x1: Math.min(Game.world.W - 1, Math.ceil((cxw + hx) / TILE_SIZE) + 1),
    y1: Math.min(Game.world.H - 1, Math.ceil((cyw + hy) / TILE_SIZE) + 1),
  };
}

// ---------------------------------------------------------------- minimap geometry
// Shared between drawMinimap() and click-to-navigate so the picture and the hit
// test always agree. The minimap is a player-centred, screen-space HUD element.
function miniGeom() {
  // [mobile] Keep the minimap clear of the full-bleed HUD overlays. Portrait: drop
  // below the top HUD. Landscape phone: below the HUD and left of the right tab
  // rail. Draw + hit-test both read this, so they stay in sync.
  const w = scene.scale.width, h = scene.scale.height;
  const portraitPhone = w <= 560;
  const landscapePhone = w > 560 && h <= 500;
  const oy = portraitPhone ? 74 : (landscapePhone ? 46 : 12);
  const railClear = landscapePhone ? 66 : 0;
  const ox = w - MINI_SIZE - 12 - railClear;
  return { ox, oy, cx: ox + MINI_SIZE / 2, cy: oy + MINI_SIZE / 2 };
}
// [mobile] The handoff drops the persistent minimap on phones (full-bleed world;
// the map button opens the full world map instead). Matches the CSS layout
// triggers: portrait phones, and short landscape phones.
function minimapHidden() {
  const w = scene.scale.width, h = scene.scale.height;
  return w <= 560 || (h <= 500 && w >= 561 && w > h);
}
function pointerOnMinimap(sx, sy) {
  if (minimapHidden()) return false;
  const { ox, oy } = miniGeom();
  return sx >= ox && sx <= ox + MINI_SIZE && sy >= oy && sy <= oy + MINI_SIZE;
}
function minimapToTile(sx, sy) {
  const { cx, cy } = miniGeom();
  const p = Game.player;
  const wpx = p.px + ((sx - cx) / MINI_SPT) * TILE_SIZE;
  const wpy = p.py + ((sy - cy) / MINI_SPT) * TILE_SIZE;
  return {
    tx: Phaser.Math.Clamp(Math.floor(wpx / TILE_SIZE), 0, WORLD_W - 1),
    ty: Phaser.Math.Clamp(Math.floor(wpy / TILE_SIZE), 0, WORLD_H - 1),
  };
}
// Compass dial: a small clickable circle in the minimap's top-left corner. Its
// needle points at world-north (which rotates on screen with the camera); clicking
// it snaps the camera back to north.
const COMPASS_R = 14;
function compassGeom() {
  const { ox, oy } = miniGeom();
  return { x: ox + COMPASS_R + 4, y: oy + COMPASS_R + 4, r: COMPASS_R };
}
function pointerOnCompass(sx, sy) {
  if (minimapHidden()) return false;
  const c = compassGeom();
  const dx = sx - c.x, dy = sy - c.y;
  return dx * dx + dy * dy <= c.r * c.r;
}

// ---------------------------------------------------------------- input
// [economy lane] Hover tracking for on-demand labels: assets + mobs only show
// their name when the cursor is over their tile (keeps the world uncluttered);
// named AI-character NPCs keep a persistent nameplate. hoverTile is the world
// tile under the cursor, resolved to an object/NPC in updateLabels().
let hoverTile = null;
function onPointerMove(pointer) {
  if (pointerOnMinimap(pointer.x, pointer.y) || pointerOnCompass(pointer.x, pointer.y)) { hoverTile = null; return; }
  const tx = Math.floor(pointer.worldX / TILE_SIZE);
  const ty = Math.floor(pointer.worldY / TILE_SIZE);
  hoverTile = (tx >= 0 && ty >= 0 && tx < WORLD_W && ty < WORLD_H) ? { tx, ty } : null;
}

function onPointerDown(pointer) {
  unlockAudio(); // browser autoplay policy: audio starts on the first gesture
  // Compass sits on top of the minimap corner — check it first: clicking it snaps
  // the camera back to north (nearest full turn, so it eases the short way).
  if (!pointer.rightButtonDown() && pointerOnCompass(pointer.x, pointer.y)) {
    targetRot = Math.round(scene.cameras.main.rotation / (Math.PI * 2)) * (Math.PI * 2);
    Game.log('Compass set — facing north.');
    return;
  }
  // Clicks that land on the HUD minimap navigate there instead of falling
  // through to the world tile drawn behind it.
  if (!pointer.rightButtonDown() && pointerOnMinimap(pointer.x, pointer.y)) {
    const { tx, ty } = minimapToTile(pointer.x, pointer.y);
    walkTo(tx, ty);
    Game.log(`Moving toward (${tx}, ${ty})…`);
    return;
  }

  const tx = Math.floor(pointer.worldX / TILE_SIZE);
  const ty = Math.floor(pointer.worldY / TILE_SIZE);
  if (tx < 0 || ty < 0 || tx >= WORLD_W || ty >= WORLD_H) return;

  // Prefer an exact-tile hit, but also let a click anywhere on a big monster's
  // footprint select it (so you can attack a 3×3 troll by clicking any of it).
  const npc = Game.npcs.find((n) => !n.dead && n.tileX === tx && n.tileY === ty)
    || Game.npcs.find((n) => !n.dead && npcFR(n) > 0 && inFootprint(n, tx, ty));
  const obj = Game.world.objectAt.get(tx + ',' + ty);
  const usableObj = obj && !obj.depleted ? obj : null;
  const ground = Game.groundItems.filter((g) => g.x === tx && g.y === ty);
  const fire = fireAt(tx, ty); // [economy lane] temporary firemaking fire on this tile

  if (pointer.rightButtonDown()) return rightClickMenu(pointer, tx, ty, npc, usableObj, ground, fire);

  if (npc && npc.type === 'elder') return startTalk(npc);
  if (npc && npc.type === 'guard') return startAttack(npc);
  if (usableObj && (usableObj.skill || usableObj.altar || usableObj.transport || usableObj.shortcut || usableObj.examine)) return startInteract(usableObj);
  if (usableObj && isCropPatch(usableObj)) return startInteract(usableObj); // plant/harvest
  if (usableObj && usableObj.nodeId) return startInteract(usableObj); // [economy lane] data-driven gather node
  if (usableObj) { Game.log(`${usableObj.label}. (Nothing to do here yet.)`); return walkTo(tx, ty); }
  if (fire) return startInteract(fire); // [economy lane] walk to & cook at the fire
  if (ground.length) return startPickup(tx, ty);
  walkTo(tx, ty);
}

// Mouse wheel zooms toward / away from the player.
function onWheel(pointer, over, dx, dy) {
  // scrolling over the minimap zooms the MINIMAP (not the world camera)
  if (pointerOnMinimap(pointer.x, pointer.y)) {
    miniZoomI = Phaser.Math.Clamp(miniZoomI + (dy > 0 ? -1 : 1), 0, MINI_ZOOMS.length - 1);
    MINI_SPT = MINI_ZOOMS[miniZoomI];
    return;
  }
  const f = dy > 0 ? 1 - ZOOM_STEP : 1 + ZOOM_STEP;
  targetZoom = Phaser.Math.Clamp(targetZoom * f, ZOOM_MIN, ZOOM_MAX);
}

// Keyboard camera controls — only when not typing in a panel input.
// Arrow keys ←/→ rotate around the player, ↑/↓ zoom; Q/E also rotate, +/- also
// zoom, 0 resets both. Arrow keys preventDefault so the page doesn't scroll.
const zoomBy = (d) => { targetZoom = Phaser.Math.Clamp(targetZoom + d, ZOOM_MIN, ZOOM_MAX); };
function onCameraKey(e) {
  if (document.activeElement !== document.body) return;
  switch (e.key.toLowerCase()) {
    case 'arrowleft':  case 'q': targetRot += ROT_STEP; break;
    case 'arrowright': case 'e': targetRot -= ROT_STEP; break;
    case 'arrowup':    case '=': case '+': zoomBy(+ZOOM_STEP); break;
    case 'arrowdown':  case '-': case '_': zoomBy(-ZOOM_STEP); break;
    case '0': targetZoom = 1; targetRot = 0; break;
    case 'r': toggleRun(); break; // toggle run/walk
    default: return;
  }
  if (e.key.startsWith('Arrow')) e.preventDefault(); // don't scroll the page
}

function rightClickMenu(pointer, tx, ty, npc, obj, ground, fire) {
  const opts = [];
  if (npc && npc.type === 'guard') {
    opts.push(['Attack ' + npcLabelText(npc), () => startAttack(npc)]);
  } else if (npc && npc.type === 'elder') {
    // [economy lane] the Banker gets a direct "Bank" verb (both open the vault).
    if (npc.id === 'banker') opts.push(['Bank', () => talkTo(npc)]);
    opts.push(['Talk-to ' + npc.name, () => talkTo(npc)]);
  } else if (fire) { // [economy lane] temporary firemaking fire
    opts.push(['Cook at Fire', () => startInteract(fire)]);
  } else if (obj && obj.altar) {
    opts.push([`Offer bones at ${obj.label}`, () => startInteract(obj)]);
  } else if (obj && obj.skill) {
    const verb = { Woodcutting: 'Chop', Fishing: 'Fish', Mining: 'Mine', Smithing: 'Use', Cooking: 'Cook at', Crafting: 'Craft at' }[obj.skill] || 'Use';
    opts.push([`${verb} ${obj.label}`, () => startInteract(obj)]);
  } else if (obj && isCropPatch(obj)) {
    const key = obj.x + ',' + obj.y;
    const planted = Farming.cropAt(key);
    const verb = planted ? (Farming.isReady(key) ? 'Harvest' : 'Inspect') : 'Plant at';
    opts.push([`${verb} ${obj.label}`, () => startInteract(obj)]);
  } else if (obj && obj.label === 'Bank') {
    // [economy lane] right-click the Bank counter to open the vault (matches the
    // left-click interaction) — same "Bank" verb as the Banker.
    opts.push(['Bank', () => startInteract(obj)]);
    opts.push(['Examine Bank', () => Game.log('The Bank of Gorkholm.')]);
  } else if (obj) {
    opts.push(['Examine ' + obj.label, () => Game.log(`${obj.label}.`)]);
  }
  for (const g of (ground || [])) {
    const def = ITEMS[g.id] || { name: g.id };
    opts.push([`Take ${def.name}${g.qty > 1 ? ' x' + g.qty : ''}`, () => startPickup(tx, ty, g.id)]);
  }
  opts.push(['Walk here', () => walkTo(tx, ty)]);
  showContextMenu(pointer.event.clientX, pointer.event.clientY, opts);
}

function clearTargets(p) {
  p.combatTarget = null; p.interactTarget = null; p.pickupTarget = null; p.travelTarget = null; p.talkTarget = null;
}

function walkTo(tx, ty) {
  const p = Game.player;
  clearTargets(p);
  // Remember the destination so we keep re-pathing toward it each tick (the
  // pathfinder is capped, so far targets take several hops to reach).
  p.travelTarget = { x: tx, y: ty };
  p.path = isWalkable(Game.world, tx, ty)
    ? findPath(Game.world, p.tileX, p.tileY, tx, ty, false)
    : findPath(Game.world, p.tileX, p.tileY, tx, ty, true);
}

function startInteract(obj) {
  const p = Game.player;
  clearTargets(p);
  p.interactTarget = obj;
  p.path = findPath(Game.world, p.tileX, p.tileY, obj.x, obj.y, true);
}

function startAttack(npc) {
  const p = Game.player;
  clearTargets(p);
  p.combatTarget = npc;
  p.path = findPath(Game.world, p.tileX, p.tileY, npc.tileX, npc.tileY, true);
}

function startPickup(tx, ty, id = null) {
  const p = Game.player;
  clearTargets(p);
  // id set -> grab that specific item on arrival; else grab one (top of pile).
  p.pickupTarget = { x: tx, y: ty, id };
  p.path = findPath(Game.world, p.tileX, p.tileY, tx, ty, false);
}

// [economy lane] The world asset that opened the current side panel; the panel
// auto-closes (main.js gameTick) once the player walks out of `range` of it.
let panelAnchor = null; // { tab, x, y, range }

// Walk to an elder, then open its panel on arrival (talk-to-open).
function startTalk(npc) {
  const p = Game.player;
  clearTargets(p);
  p.talkTarget = npc;
  p.path = findPath(Game.world, p.tileX, p.tileY, npc.tileX, npc.tileY, true);
}

function talkTo(npc) {
  // [economy lane] Quest first: talking to a marked giver starts / advances /
  // turns in a quest (the engine emits the dialogue itself). If it wasn't a quest
  // conversation, fall back to the NPC's flavour line.
  const handledQuest = questOnTalk(npc.id);
  if (!handledQuest) Game.log(`${npc.name}: "${npc.dialog}"`);
  if (npc.id === 'exchange_merchant') { openExchange(); panelAnchor = { tab: 'ge', x: npc.tileX, y: npc.tileY, range: 3 }; }
  else if (npc.id && npc.id.startsWith('shopkeeper_')) { openShop(npc.id.replace('shopkeeper_', '')); panelAnchor = { tab: 'shop', x: npc.tileX, y: npc.tileY, range: 3 }; }
  else if (npc.id === 'banker') { openBank(); panelAnchor = { tab: 'bank', x: npc.tileX, y: npc.tileY, range: 3 }; }
  // [economy lane] Sprocket the Tinker — talking opens his Workbench (the overlay
  // itself gates on the intro-quest unlock).
  else if (npc.id === 'sprocket') { openWorkbench(); }
  // M3: Sergeant Grimjaw hands out / reports slayer contracts.
  else if (npc.id === 'contract_master') { Game.log(`Sergeant Grimjaw: "${contractDialog()}"`); }
}

// ---------------------------------------------------------------- tick logic

// Bresenham line-of-sight: true when no blocking (non-walkable) tile lies
// strictly between the two tiles. Ranged attacks use this so arrows can't pass
// through walls/cliffs; melee (adjacent) never needs it.
function lineOfSight(world, x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
    if ((x !== x1 || y !== y1) && !isWalkable(world, x, y)) return false;
  }
  return true;
}

// Can `attacker` ({tileX,tileY}) strike the tile (tx,ty) this instant? Within
// weapon reach, and — for ranged (reach > 1) — with clear line-of-sight.
function canAttackFrom(world, attacker, tx, ty, range) {
  if (manhattan(attacker.tileX, attacker.tileY, tx, ty) > range) return false;
  if (range <= 1) return true;
  return lineOfSight(world, attacker.tileX, attacker.tileY, tx, ty);
}

// ---- multi-tile monster footprints ---------------------------------------
// A big monster occupies a (2*fr+1)² block centred on its (tileX,tileY) anchor.
// These helpers let targeting, approach and combat treat the whole block as the
// creature, so you fight it *across* its tiles instead of at one pixel.
function npcFR(n) {
  if (n._fr == null) n._fr = footprintFor(n.name || '');
  return n._fr;
}
function inFootprint(n, x, y) {
  const fr = npcFR(n);
  return Math.abs(x - n.tileX) <= fr && Math.abs(y - n.tileY) <= fr;
}
// Manhattan distance from a point to the nearest footprint tile (0 if inside).
function distToFootprint(x, y, n) {
  const fr = npcFR(n);
  return Math.max(0, Math.abs(x - n.tileX) - fr) + Math.max(0, Math.abs(y - n.tileY) - fr);
}
// The footprint tile closest to (fx,fy) — the point to path toward / shoot at.
function nearestFootprintTile(n, fx, fy) {
  const fr = npcFR(n);
  return {
    x: n.tileX + Math.max(-fr, Math.min(fr, fx - n.tileX)),
    y: n.tileY + Math.max(-fr, Math.min(fr, fy - n.tileY)),
  };
}
// Reach test against a (possibly multi-tile) monster from a point (px,py):
// within weapon range of the footprint, and — for ranged — line-of-sight to the
// nearest footprint tile. For a 1-tile mob this is exactly canAttackFrom.
function reachFP(world, big, px, py, range) {
  if (distToFootprint(px, py, big) > range) return false;
  if (range <= 1) return true;
  const nt = nearestFootprintTile(big, px, py);
  return lineOfSight(world, px, py, nt.x, nt.y);
}
// Any big monster whose footprint covers (x,y) — used to block the player from
// walking through it (checked against the near-player active set only).
function mobFootprintAt(x, y, exclude) {
  for (const n of Game.activeNpcs) {
    if (n.dead || n === exclude || n.type === 'elder') continue;
    if (n.type === 'player') continue; // [presence lane] walk through other players
    if (npcFR(n) > 0 && inFootprint(n, x, y)) return n;
  }
  return null;
}

function stepAlongPath(ent) {
  if (ent.path && ent.path.length) {
    const [nx, ny] = ent.path.shift();
    ent.tileX = nx; ent.tileY = ny;
  }
}

// Time-based world maintenance that must advance whether or not the player is
// nearby: node respawns, ground-item despawns, and dead-NPC revival. Split out
// so offline catch-up (applyPendingSave) can resolve elapsed timers in one pass.
function worldUpkeep(count) {
  const world = Game.world;
  for (const o of world.objects) {
    if (o.depleted && count >= o.respawnAt) o.depleted = false;
  }
  if (Game.groundItems.length) {
    Game.groundItems = Game.groundItems.filter((g) => count < g.despawnAt);
  }
  for (const n of Game.npcs) {
    if (n.questBoss) continue; // one-shot quest bosses never revive
    if (n.dead && count >= n.respawnAt) reviveNpc(n);
  }
  // [economy lane] Remove slain quest bosses (their step advanced on the kill).
  if (Game.npcs.some((n) => n.questBoss && n.dead)) {
    Game.npcs = Game.npcs.filter((n) => !(n.questBoss && n.dead));
  }
}

// Rebuild Game.activeNpcs: the NPCs within (ACTIVATE + margin) of the player. This is
// the ONLY O(total) scan of Game.npcs per tick (cheap — a manhattan compare each), and
// it runs a few times a second, not per frame. Every per-frame loop (interpolation,
// drawing, labels, minimap) iterates this small set, so 100 mobs or 100,000 mobs cost
// the same on screen. NPCs entering/leaving the set get their sprite snapped to tile.
function refreshActiveNpcs() {
  const p = Game.player, R = ACTIVATE + 8, list = [];
  for (const n of Game.npcs) {
    const near = (Math.abs(n.tileX - p.tileX) + Math.abs(n.tileY - p.tileY)) <= R;
    if (near) { if (!n._active) { n._active = true; n.px = tilePx(n.tileX); n.py = tilePx(n.tileY); } list.push(n); }
    else if (n._active) { n._active = false; n.px = tilePx(n.tileX); n.py = tilePx(n.tileY); }
  }
  Game.activeNpcs = list;
}

function gameTick(count, isLast = true) {
  const world = Game.world;
  const p = Game.player;

  // [world-continuity] When the player isn't watching (tab hidden), NOTHING
  // happens TO the character — no movement, no combat, no skilling, no taking
  // damage — but the world/environment keeps advancing (respawns, despawns,
  // world clock). This mirrors the fully-logged-out rule so a monster can't
  // kill you while you're away. (Prolonged inactivity still triggers the 5-min
  // idle logout.)
  if (Game.playerFrozen) {
    worldUpkeep(count);
    if (isLast) Game.refresh();
    return;
  }

  // [economy lane] Home Teleport channel: any movement/combat/interact interrupts
  // it; otherwise advance, and teleport home the tick it completes.
  if (isChanneling()) {
    if (p.combatTarget || p.interactTarget || p.pickupTarget || p.travelTarget || (p.path && p.path.length)) {
      cancelHomeTeleport(); Game.log('Your Home Teleport is interrupted.'); updateHomeHud();
    } else if (tickHomeTeleport(count)) {
      teleportHome(); updateHomeHud();
    } else { updateHomeHud(); }
  }

  // --- player movement target -> path ---
  if (p.combatTarget) {
    const t = p.combatTarget;
    // Stop approaching once the target is within the weapon's reach AND in
    // line-of-sight (1 tile for melee, up to 4 for ranged). Re-evaluated each
    // tick, so a ranged attacker halts at max range instead of walking into
    // melee — and keeps closing (routing around walls) until it can see the
    // target when a wall blocks the shot.
    if (t.dead) { p.combatTarget = null; p.path = []; }
    else if (reachFP(world, t, p.tileX, p.tileY, playerAttackRange())) p.path = [];
    else {
      // Path toward the footprint tile nearest the player (for a big monster
      // that's its edge, so we stop just outside instead of walking into it).
      const nt = nearestFootprintTile(t, p.tileX, p.tileY);
      p.path = findPath(world, p.tileX, p.tileY, nt.x, nt.y, true);
    }
  } else if (p.interactTarget) {
    const o = p.interactTarget;
    if (o.depleted) p.interactTarget = null;
    else if (manhattan(p.tileX, p.tileY, o.x, o.y) === 1) p.path = [];
    else p.path = findPath(world, p.tileX, p.tileY, o.x, o.y, true);
  } else if (p.pickupTarget) {
    const g = p.pickupTarget;
    if (!Game.groundItems.some((it) => it.x === g.x && it.y === g.y)) p.pickupTarget = null;
    else if (p.tileX === g.x && p.tileY === g.y) p.path = [];
    else p.path = findPath(world, p.tileX, p.tileY, g.x, g.y, false);
  } else if (p.travelTarget) {
    const t = p.travelTarget;
    if (p.tileX === t.x && p.tileY === t.y) { p.travelTarget = null; p.path = []; }
    else if (p.path.length === 0) {
      // re-path toward the (possibly far) destination; capped BFS gets us closer each tick
      const np = isWalkable(world, t.x, t.y)
        ? findPath(world, p.tileX, p.tileY, t.x, t.y, false)
        : findPath(world, p.tileX, p.tileY, t.x, t.y, true);
      if (np.length === 0) p.travelTarget = null; // stuck / unreachable
      else p.path = np;
    }
  }
  // Movement: walk 1 tile/tick, or RUN 2 tiles/tick while the run toggle is on and
  // energy remains. Energy drains on a true run, else regenerates (idle or walking).
  const running = wantsToRun(p);
  // Don't walk THROUGH a big monster: if the next path tile lands on a footprint,
  // stop short. (Combat approach already halts at the edge, so this only bites on
  // plain travel; the current target is excluded as a safety belt.)
  const blockedAhead = () => p.path && p.path.length && mobFootprintAt(p.path[0][0], p.path[0][1], p.combatTarget);
  if (blockedAhead()) p.path = [];
  stepAlongPath(p);
  let ran = false;
  if (running && !blockedAhead() && p.path && p.path.length) { stepAlongPath(p); ran = true; }
  updateRunEnergy(ran);
  p._ranTick = ran; // render interpolates 2× faster on a run tick (see update())

  if (p.pickupTarget && p.tileX === p.pickupTarget.x && p.tileY === p.pickupTarget.y) {
    // One item at a time: grab the targeted item (or the top of the pile).
    pickupOneAt(p.tileX, p.tileY, p.pickupTarget.id);
    p.pickupTarget = null;
  }

  // --- [economy lane] talk-to-open: reach an elder, then open its panel ---
  if (p.talkTarget && !p.combatTarget) {
    const n = p.talkTarget;
    if (n.dead) p.talkTarget = null;
    else if (p.path.length === 0 && manhattan(p.tileX, p.tileY, n.tileX, n.tileY) <= 1) { talkTo(n); p.talkTarget = null; }
  }
  // --- [economy lane] close a world panel when you walk away from its asset ---
  if (panelAnchor) {
    if (activePanel() !== panelAnchor.tab) panelAnchor = null; // user switched tabs manually
    else if (manhattan(p.tileX, p.tileY, panelAnchor.x, panelAnchor.y) > panelAnchor.range) { closeWorldPanels(); panelAnchor = null; }
  }

  // --- skilling ---
  if (p.interactTarget && !p.combatTarget) {
    const o = p.interactTarget;
    const dist = manhattan(p.tileX, p.tileY, o.x, o.y);
    // [economy lane] fires and crop patches are non-blocking, so act while
    // standing ON them (dist 0) or beside them (dist 1); every other target
    // stays adjacency-only.
    const inReach = (o.fire || isCropPatch(o) || o.transport || o.shortcut || o.examine) ? dist <= 1 : dist === 1;
    if (!o.depleted && p.path.length === 0 && inReach) {
      // Gathering rhythm (balance): resource nodes roll once per 3 ticks (1.8s),
      // not every tick — the OSRS cadence. Without this the whole gathering
      // ladder is consumed in an evening (pacing sim Part E caught it: L50
      // woodcutting in 1.1h, 159k xp/hr peak). Stations/fires/crops stay instant.
      if (o.type === 'resource') {
        if (count - (p.lastGatherTick || 0) >= 3) { p.lastGatherTick = count; performSkill(o, count); }
      } else {
        performSkill(o, count);
      }
    }
  }

  // --- player attack (melee or ranged, gated by reach + line-of-sight) ---
  if (p.combatTarget && !p.combatTarget.dead &&
      canAttackFrom(world, p, p.combatTarget.tileX, p.combatTarget.tileY, playerAttackRange())) {
    const weapon = Game.equipment.weapon;
    if (needsAmmo() && !hasAmmoForRanged()) {
      // Ranged weapon with an empty ammo slot — disengage rather than swing air.
      Game.log('You have run out of ammunition.');
      clearTargets(p); p.path = [];
    } else {
      const spd = weapon ? weapon.attackSpeed : 4;
      if (count - p.lastAttackTick >= spd) {
        p.lastAttackTick = count;
        const target = p.combatTarget;
        if (needsAmmo()) {
          const ammoId = Game.equipment.ammo ? Game.equipment.ammo.id : null;
          consumeAmmo();
          // A portion of fired arrows (scaling with Ranged level) lands at the
          // target's feet, recoverable — walk over the tile to pick them up.
          if (ammoId && Math.random() < ammoRecoveryChance()) {
            dropRecoveredAmmo(ammoId, target.tileX, target.tileY, count);
          }
        }
        playerAttack(target, count);
      }
    }
  }

  // --- respawns / despawns / revives (time-based, player-agnostic) ---
  worldUpkeep(count);

  // --- [economy lane] firemaking: temp fires burn out on the global tick ---
  for (const dead of tickFires(count)) {
    Game.log('Your fire burns out.');
    if (p.interactTarget && p.interactTarget.id === dead.id) p.interactTarget = null;
  }

  // --- [economy lane] quests: re-check active objectives against live inventory
  // and skills (kills are tallied at the kill site). Cheap — a few active quests.
  tickQuests();
  // Fire the arrival hook only when the player's tile actually changes, so `goto`
  // objectives ("head north to the quarry") complete as you walk into the target.
  if (p.tileX !== p._arriveX || p.tileY !== p._arriveY) {
    p._arriveX = p.tileX; p._arriveY = p.tileY;
    questOnArrive(regionAt(p.tileX, p.tileY), p.tileX, p.tileY);
  }

  // Rebuild the near-player active set once per tick; every per-frame + per-tick NPC
  // loop below iterates THIS, not all of Game.npcs — so total mob count never costs frames.
  refreshActiveNpcs();

  // Lethal-HP safety net: combat calls playerDeath() directly, but damage-over-time
  // effects (burns, future poisons) can also finish the player between attacks.
  if (Game.hp <= 0) playerDeath();

  // --- NPC AI (only near the player) ---
  for (const n of Game.activeNpcs) {
    if (n.dead) continue; // revival handled in worldUpkeep()
    if (n.type === 'elder') continue;
    if (n.type === 'player') continue; // [presence lane] remote players are network-driven, never local AI

    // Tinker burn DoT: a burning enemy loses HP each tick.
    if (n.burnTicks > 0) {
      n.burnTicks -= 1;
      n.hp = Math.max(0, n.hp - (n.burnDmg || 1));
      floatText(n, '-' + (n.burnDmg || 1), '#ff7a2a');
      if (n.hp <= 0) { Game.log(`The ${n.name} burns to a crisp!`); killNpc(n, count); continue; }
    }
    // Tinker snare: a trapped enemy can still attack but cannot move.
    const snared = count < (n.snaredUntil || 0);

    const distPlayer = manhattan(n.tileX, n.tileY, p.tileX, p.tileY);
    const distHome = manhattan(n.tileX, n.tileY, n.homeX, n.homeY);
    if (n.aggressive && distPlayer <= n.aggroRange && distHome <= n.leashRadius) n.target = p;
    if (n.target && (n.target.dead || distHome > n.leashRadius || distPlayer > n.aggroRange + 4)) n.target = null;

    // M3 boss special: a telegraphed SLAM. The boss roars and marks the player's
    // tile; two ticks later the slam lands on that 3×3 — standing still eats a
    // huge hit, stepping away dodges it entirely. Wind-up is loud on purpose.
    if (n.bossSpec && n._windup && count >= n._windup.at) {
      const w = n._windup; n._windup = null;
      if (Math.abs(p.tileX - w.x) <= 1 && Math.abs(p.tileY - w.y) <= 1) {
        const dmg = Math.max(4, Math.round(Game.maxHp * 0.35));
        Game.hp = Math.max(0, Game.hp - dmg);
        floatText(p, '-' + dmg, '#ff2b2b');
        playSfx('slam');
        Game.log(`The ${n.name}'s slam CRUSHES you for ${dmg}!`);
        if (Game.hp <= 0) playerDeath();
      } else {
        Game.log(`The ${n.name}'s slam shatters the ground where you stood!`);
      }
    }

    if (n.target) {
      // NPCs attack from their own weapon reach too — a ranged/spear enemy can
      // strike before closing to melee, but ranged enemies still need line-of-
      // sight (they'll advance around cover otherwise). Re-checked each tick.
      const nRange = weaponRange(n);
      // reachFP: a big monster strikes from its footprint edge (1-tile mobs unchanged).
      if (reachFP(world, n, p.tileX, p.tileY, nRange)) {
        n.path = [];
        if (count - n.lastAttackTick >= n.attackSpeed) {
          n.lastAttackTick = count;
          // every few swings a boss winds up its special instead of attacking
          if (n.bossSpec && !n._windup && ++n._specCount >= n.bossSpec.every) {
            n._specCount = 0;
            n._windup = { x: p.tileX, y: p.tileY, at: count + 2 };
            floatText(n, '!!', '#ffd24d');
            Game.log(`The ${n.name} rears back — MOVE!`);
          } else {
            npcAttack(n, count);
          }
        }
      } else if (!snared) {
        n.path = findPath(world, n.tileX, n.tileY, p.tileX, p.tileY, true);
        stepAlongPath(n);
      }
    } else if (snared) {
      // rooted — hold position this tick
    } else if (distHome > n.wanderRadius) {
      n.path = findPath(world, n.tileX, n.tileY, n.homeX, n.homeY, false);
      stepAlongPath(n);
    } else {
      if ((!n.path || n.path.length === 0) && Math.random() < 0.25) {
        const rx = n.homeX + randInt(-n.wanderRadius, n.wanderRadius);
        const ry = n.homeY + randInt(-n.wanderRadius, n.wanderRadius);
        if (isWalkable(world, rx, ry)) n.path = findPath(world, n.tileX, n.tileY, rx, ry, false);
      }
      stepAlongPath(n);
    }
  }

  // --- prayer point drain (active prayers cost points every tick) ---
  drainPrayer();

  // --- special-attack energy regen ---
  regenSpec();

  // --- location name ---
  const loc = regionAt(p.tileX, p.tileY);
  if (loc !== Game.location) { Game.location = loc; Game.log(`You enter: ${loc}.`); }

  // Refresh the DOM once per pump: a catch-up burst (returning to a throttled
  // tab) runs several ticks in a row, but the panels only need the final state.
  if (isLast) Game.refresh();
}

// Altars grant 2.5× the normal burying XP and refill prayer points.
const ALTAR_MULT = 2.5;

// ---------------------------------------------------------------- farming
// A crop patch is a structure whose node_id resolves to a `crop_patch` in the
// database. Cache the resolved node def on the object so the per-tick reach
// check stays cheap. Returns the node def, or null for non-farming objects.
function cropPatchDef(o) {
  if (!o || !o.nodeId) return null;
  if (o._cropNode === undefined) {
    const n = GameData.node ? GameData.node(o.nodeId) : null;
    o._cropNode = (n && n.node_type === 'crop_patch') ? n : null;
  }
  return o._cropNode;
}
function isCropPatch(o) { return !!cropPatchDef(o); }

// [economy lane] Gather a data-driven world node (world_nodes.json). gather() does
// the skill/tool checks + item/XP payout; here we surface failures and apply a
// light depletion so nodes read as finite and respawn on the world clock.
function performNodeGather(o, count) {
  const p = Game.player;
  const res = gatherNode(o.nodeId);
  if (!res || !res.ok) {
    Game.log(`You can't gather here${res && res.reason ? ` — ${res.reason}` : ''}.`);
    p.interactTarget = null;
    return;
  }
  const node = GameData.node ? GameData.node(o.nodeId) : null;
  const respawnS = node && node.respawn_seconds;
  if (respawnS && Math.random() < 0.14) {
    o.depleted = true;
    o.respawnAt = count + Math.max(8, Math.round(respawnS / 0.6));
    p.interactTarget = null;
    Game.log(`The ${(node && node.display_name) || 'node'} is spent for now.`);
  }
}

// The seed that plants a given crop. Seeds are named `<crop>_seed`; fall back to
// scanning the database for a Seed whose recipe output is this crop.
let _seedMap = null;
function seedForCrop(cropId) {
  const direct = cropId + '_seed';
  if (ITEMS[direct] || (GameData.item && GameData.item(direct))) return direct;
  if (!_seedMap) {
    _seedMap = {};
    for (const it of (GameData.items || [])) {
      if ((it.subcategory || '').toLowerCase() === 'seed' && it.used_in_recipes) {
        _seedMap[it.used_in_recipes] = it.item_id;
      }
    }
  }
  return _seedMap[cropId] || null;
}

function farmItemName(id) {
  return (ITEMS[id] && ITEMS[id].name)
    || (GameData.item && GameData.item(id) && GameData.item(id).display_name) || id;
}
function hasInvItem(id) { return Game.inventory.some((s) => s && s.id === id); }
function consumeOneInv(id) {
  const idx = Game.inventory.findIndex((s) => s && s.id === id);
  if (idx === -1) return false;
  const s = Game.inventory[idx];
  if (s.qty && s.qty > 1) s.qty -= 1;
  else { Game.inventory[idx] = null; if (Game.selectedInv === idx) Game.selectedInv = null; }
  return true;
}

const FARM_PLANT_XP = 8;
const FARM_HARVEST_XP = 26;

// Plant a matching seed on an empty patch (consuming one seed) or harvest a ripe
// one. A one-shot action: clears the interact target after acting, unlike the
// repeating gathering skills. Growth itself lives in systems/farming.js and runs
// on the world clock (so crops keep maturing while logged out).
function performFarming(o) {
  const p = Game.player;
  const node = cropPatchDef(o);
  const key = o.x + ',' + o.y;
  const planted = Farming.cropAt(key);

  if (planted) {
    const g = Farming.growth(key);
    if (!g || !g.ready) {
      Game.log(`Your ${farmItemName(planted.cropId)} crop is ${g ? g.label : 'growing'}.`);
    } else {
      const bonus = 1 + (Game.skills.Farming.level - 1) * 0.015; // gentle yield scaling
      const res = Farming.harvest(key, Date.now(), bonus);
      if (res) {
        if (!addItem(res.cropId, res.qty)) { Game.log('Your inventory is too full to harvest that.'); return; }
        grantXp('Farming', FARM_HARVEST_XP);
        Game.log(`You harvest ${res.qty}× ${farmItemName(res.cropId)}. (+${FARM_HARVEST_XP} Farming xp)`);
        refreshCropLabel(o);
      }
    }
    p.interactTarget = null;
    return;
  }

  // Empty patch → plant.
  const cropId = String(node.outputs || '').split(';')[0];
  const seedId = seedForCrop(cropId);
  const req = node.level_requirement || 1;
  if (Game.skills.Farming.level < req) {
    Game.log(`You need Farming level ${req} to plant at the ${o.label.toLowerCase()}.`);
    p.interactTarget = null; return;
  }
  if (!seedId || !hasInvItem(seedId)) {
    Game.log(`You need ${seedId ? farmItemName(seedId) : 'the right seed'} to plant here.`);
    p.interactTarget = null; return;
  }
  consumeOneInv(seedId);
  Farming.plant(key, { cropId, seedId, patchId: node.node_id });
  grantXp('Farming', FARM_PLANT_XP);
  Game.log(`You plant a ${farmItemName(seedId)}. (+${FARM_PLANT_XP} Farming xp)`);
  refreshCropLabel(o);
  p.interactTarget = null;
}

// Passive feedback: reflect growth state in the patch's on-screen label. This is
// pure data mutation (the renderer just draws `o.label`); richer visuals live in
// the render lane, which can read `o._farm` (cropId/stage/ready).
function refreshCropLabel(o) {
  if (o._baseLabel === undefined) o._baseLabel = o.label;
  const g = Farming.growth(o.x + ',' + o.y);
  if (!g) { o.label = o._baseLabel; o._farm = null; return; }
  o._farm = { cropId: g.cropId, stage: g.stage, ready: g.ready };
  o.label = `${o._baseLabel} — ${g.ready ? 'ripe!' : g.label}`;
}

// Keep planted patches' labels current so growth is visible without clicking.
function updateCropLabels() {
  for (const plot of Farming.allPlots()) {
    const o = Game.world.objectAt.get(plot.key);
    if (o) refreshCropLabel(o);
  }
}

// Bridge the recorded span (flip terrain to BRIDGE + clear collision) so the
// crossing opens, and record the id on Game.openedShortcuts so the save layer can
// re-apply it on load. Shared by the material-spend path and quest-reward grants.
function applyShortcutOpen(o) {
  const sc = o.shortcut, W = Game.world.W;
  // bridges span water; gates clear their wall back to a walkable pass
  const to = sc.kind === 'gate' ? T.DIRT : T.BRIDGE;
  for (const [tx, ty] of sc.span) { const i = ty * W + tx; Game.world.terrain[i] = to; Game.world.collision[i] = 0; }
  sc.opened = true; o.label = sc.doneLabel; o.color = 0x9a7a4a;
  (Game.openedShortcuts || (Game.openedShortcuts = [])).includes(sc.id) || Game.openedShortcuts.push(sc.id);
}

// Open an interactive shortcut by spending its material cost (player interaction).
function tryOpenShortcut(o) {
  const p = Game.player, sc = o.shortcut;
  if (sc.opened) { Game.log(`The ${sc.doneLabel} is already open.`); p.interactTarget = null; return; }
  if (sc.cost.some(([id, q]) => countItem(id) < q)) {
    const need = sc.cost.map(([id, q]) => `${q}× ${ITEMS[id] ? ITEMS[id].name : id}`).join(', ');
    Game.log(`${sc.hint || 'It needs materials.'} (Need ${need}.)`);
    p.interactTarget = null; return;
  }
  for (const [id, q] of sc.cost) for (let k = 0; k < q; k++) removeOneById(id);
  applyShortcutOpen(o);
  Game.log(sc.doneMsg || `You open the ${sc.doneLabel}.`);
  p.interactTarget = null;
}

// [economy lane] Find a placed shortcut object by its SHORTCUTS id.
function findShortcutObj(id) {
  return (Game.world && Game.world.objects || []).find((o) => o.shortcut && o.shortcut.id === id);
}
// [economy lane] Grant-open a shortcut for FREE (a quest reward). Installed as
// Game.grantShortcut so the pure quest engine can trigger it. Degrades gracefully
// if the object isn't placed (records the id so a later re-apply can catch it).
function grantShortcut(id) {
  const o = findShortcutObj(id);
  if (!o) {
    // Not placed yet (world-gen hasn't wired this shortcut's geometry) — record
    // the flag so it opens once it exists, but report "not opened" for now.
    (Game.openedShortcuts || (Game.openedShortcuts = [])).includes(id) || Game.openedShortcuts.push(id);
    return false;
  }
  if (o.shortcut.opened) return false;
  applyShortcutOpen(o);
  Game.log(o.shortcut.doneMsg || `A new shortcut opens: ${o.shortcut.doneLabel || id}.`);
  return true;
}
// [economy lane] Re-apply saved opened shortcuts after the world is (re)built on
// login, so a bridge you opened stays open across sessions.
function reapplyOpenedShortcuts() {
  for (const id of (Game.openedShortcuts || [])) {
    const o = findShortcutObj(id);
    if (o && !o.shortcut.opened) applyShortcutOpen(o);
  }
}

// Examine a wilderness encounter marker: log its flavour the first time, and grant
// its one-time `loot` (guarded — skipped if the item id isn't in the registry).
function doExamine(o) {
  const p = Game.player;
  Game.log(o._examined ? `${o.label}.` : `${o.label}: ${o.examine}`);
  o._examined = true;
  if (o.loot && !o._looted && ITEMS[o.loot]) { o._looted = true; if (addItem(o.loot)) Game.log(`You find ${ITEMS[o.loot].name}.`); }
  p.interactTarget = null;
}

function performSkill(o, count) {
  const p = Game.player;

  // Fast-travel transports: pay the fare (coins) or blood cost (HP) and teleport.
  if (o.transport) { boardTransport(o); return; }

  // Interactive shortcut: spend materials to open a crossing (lay a bridge / clear a gate).
  if (o.shortcut) { tryOpenShortcut(o); return; }

  // Dungeon doorways (checked BEFORE examine — entrances carry examine flavour too).
  if (o.interior) { const p2 = Game.player; p2.interactTarget = null; enterInterior(o.interior, o); return; }
  if (o.exit) { const p2 = Game.player; p2.interactTarget = null; exitInterior(); return; }

  // Wilderness encounter marker: read its flavour and pocket any one-time find.
  if (o.examine) { doExamine(o); return; }

  // Crop patches: plant/harvest via the world-time growth engine.
  if (isCropPatch(o)) return performFarming(o);

  // [economy lane] Data-driven gather nodes (mining/woodcutting/fishing/tinkering
  // materials defined in world_nodes.json). gather() checks skill/tool, adds the
  // output + grants XP; we handle light depletion + respawn here.
  if (o.nodeId) return performNodeGather(o, count);

  // Bones Altar: offer one bones stack per tick until the player runs out.
  if (o.altar) {
    const idx = Game.inventory.findIndex((s) => s && ITEMS[s.id] && ITEMS[s.id].buryXp);
    if (idx < 0) { Game.log('You have no bones to offer at the altar.'); p.interactTarget = null; return; }
    const bone = ITEMS[Game.inventory[idx].id];
    removeAt(idx);
    const xp = bone.buryXp * ALTAR_MULT;
    grantXp('Prayer', xp);
    restorePrayer();
    Game.log(`You offer the ${bone.name} on the altar. (+${xp} Prayer xp)`);
    return;
  }

  if (o.type === 'resource') {
    if (Game.skills[o.skill].level < o.level) {
      Game.log(`You need ${o.skill} level ${o.level} to gather here.`);
      p.interactTarget = null; return;
    }
    if (o.tool && !hasTool(o.tool)) {
      Game.log(`You need ${TOOL_NAME[o.tool] || 'a tool'} to gather here.`);
      p.interactTarget = null; return;
    }
    if (rollSkillSuccess(Game.skills[o.skill].level, o.low, o.high)) {
      if (!addItem(o.drop)) { p.interactTarget = null; return; }
      grantXp(o.skill, o.xp);
      playSfx('gather');
      Game.log(`You get ${ITEMS[o.drop].name}. (+${o.xp} ${o.skill} xp)`);
      rollGatherByproduct(o.skill); // [economy lane] Tinkering cross-pollination byproduct
      if (o.deplete && Math.random() < o.deplete) {
        o.depleted = true; o.respawnAt = count + o.respawn; p.interactTarget = null;
        Game.log(`The ${o.label.toLowerCase()} is exhausted for now.`);
      }
    }
    return;
  }

  // [economy lane] A fixed crafting station opens the data-driven Stations UI
  // (furnace/anvil/range/bench) instead of the legacy quick-craft — so crafting
  // is a "walk to the anvil" world interaction. Firemaking fires (o.fire) keep
  // their auto-cook path below.
  const STATION_OF = { 'Town Furnace': 'furnace', 'Town Anvil': 'anvil', 'Cooking Range': 'fire_or_range', 'Crafting Bench': 'crafting_bench', 'Sawmill': 'sawmill' };
  if (!o.fire && STATION_OF[o.label]) { openStation(STATION_OF[o.label]); panelAnchor = { tab: 'stations', x: o.x, y: o.y, range: 2 }; p.interactTarget = null; return; }

  // [economy lane] The Bank counter opens the vault too — clicking the asset
  // beside the Banker works like talking to the Banker himself (same range-3 anchor).
  if (o.label === 'Bank') { openBank(); panelAnchor = { tab: 'bank', x: o.x, y: o.y, range: 3 }; p.interactTarget = null; return; }

  // [economy lane] Tinker's Workbench is a world object (design doc's station model),
  // not a HUD button — clicking it opens the workbench popup.
  if (o.label === "Tinker's Workbench") { openWorkbench(); p.interactTarget = null; return; }

  // Structures: Smithing / Cooking / Crafting (legacy quick-craft + firemaking fires)
  switch (o.skill) {
    case 'Cooking': {
      const ri = Game.inventory.findIndex((s) => s && ITEMS[s.id].cookInto);
      if (ri < 0) { Game.log('You have no raw food to cook.'); p.interactTarget = null; return; }
      const raw = ITEMS[Game.inventory[ri].id];
      if (Game.skills.Cooking.level < (raw.cookLevel || 1)) {
        Game.log(`You need Cooking ${raw.cookLevel} to cook ${raw.name}.`); p.interactTarget = null; return;
      }
      removeAt(ri);
      const lvl = Game.skills.Cooking.level;
      const burn = Math.max(0.05, 0.40 - lvl * 0.004);
      if (Math.random() < burn) { addItem('burnt_fish'); Game.log(`You burn the ${raw.name}.`); }
      else {
        addItem(raw.cookInto);
        const xp = COOK_XP[raw.id] || 50;
        grantXp('Cooking', xp);
        Game.log(`You cook ${ITEMS[raw.cookInto].name}. (+${xp} Cooking xp)`);
      }
      break;
    }
    case 'Smithing': {
      if (countItem('iron_ore') >= 1 && Game.skills.Smithing.level >= 15) {
        removeOneById('iron_ore'); addItem('iron_bar'); grantXp('Smithing', 80);
        Game.log('You smelt an iron bar. (+80 Smithing xp)');
      } else if (countItem('ore') >= 1 && countItem('tin_ore') >= 1) {
        removeOneById('ore'); removeOneById('tin_ore'); addItem('bronze_bar'); grantXp('Smithing', 60);
        Game.log('You smelt a bronze bar from copper and tin. (+60 Smithing xp)');
      } else if (countItem('ore') >= 2) {
        removeOneById('ore'); removeOneById('ore'); addItem('bronze_bar'); grantXp('Smithing', 60);
        Game.log('You smelt a bronze bar. (+60 Smithing xp)');
      } else {
        Game.log('You need ore to smith here (copper+tin, or iron at Smithing 15).');
        p.interactTarget = null;
      }
      break;
    }
    case 'Crafting': {
      if (countItem('logs') < 1) { Game.log('You need logs to craft something here.'); p.interactTarget = null; return; }
      removeOneById('logs'); grantXp('Crafting', 40);
      Game.log('You carve the logs into a goblin charm. (+40 Crafting xp)');
      break;
    }
    default:
      Game.log(`${o.label}. (Nothing to do here yet.)`);
      p.interactTarget = null;
  }
}

// ---------------------------------------------------------------- combat
function grantCombatXp(dmg) {
  const weapon = Game.equipment.weapon;
  if (weapon && weapon.weaponType === 'tinker') grantXp('Tinkering', 4 * dmg);
  else if (weapon && weapon.weaponType === 'ranged') grantXp('Ranged', 4 * dmg);
  else switch (Game.attackStyle) {
    case 'Accurate': grantXp('Attack', 4 * dmg); break;
    case 'Defensive': grantXp('Defence', 4 * dmg); break;
    case 'Controlled':
      grantXp('Attack', (4 / 3) * dmg); grantXp('Strength', (4 / 3) * dmg); grantXp('Defence', (4 / 3) * dmg); break;
    default: grantXp('Strength', 4 * dmg);
  }
  grantXp('Hitpoints', (4 / 3) * dmg);
}

function playerAttack(npc, count) {
  if (!npc.target) npc.target = Game.player;
  const defender = { levels: npc.levels, bonuses: npc.bonuses };

  // Effect resolution priority: an armed weapon SPECIAL (boss weapons, costs
  // energy) > a tinker gadget's always-on EFFECT (pierce/rapid hits, free) >
  // an ordinary single attack.
  const weapon = Game.equipment.weapon;
  const spec = weaponSpec();
  const gadget = isTinkerWeapon(weapon) ? effectiveGadgetEffect(weapon) : null;
  let results;
  let areaEffect = null;
  if (Game.specArmed && spec && Game.specEnergy >= spec.cost) {
    consumeSpec(spec.cost);
    results = resolveSpecial(playerProfile(), defender, spec);
    areaEffect = spec;
    Game.log(`You unleash ${spec.name}!`);
  } else if (gadget) {
    if (Game.specArmed) Game.specArmed = false;
    results = resolveSpecial(playerProfile(), defender, gadget); // pierce / rapid hits
    areaEffect = gadget;
  } else {
    if (Game.specArmed) Game.specArmed = false; // armed but can't fire → disarm
    results = [resolveAttack(playerProfile(), defender)];
  }

  let total = 0;
  for (const r of results) {
    if (r.hit) { total += r.damage; floatText(npc, '-' + r.damage, '#ffe14d'); }
    else floatText(npc, '0', '#cccccc');
  }
  // M3 boss style weakness: the right combat style bites 50% harder. Hinted the
  // first time you land it, so the puzzle is discoverable.
  if (total > 0 && npc.weakTo) {
    const style = weapon ? (weapon.weaponType || 'crush') : 'crush';
    if (style === npc.weakTo) {
      total = Math.round(total * 1.5);
      if (!npc._weakHinted) { npc._weakHinted = true; Game.log(`The ${npc.name} STAGGERS — ${npc.weakTo} strikes bite deep!`); }
    }
  }
  npc.hp = Math.max(0, npc.hp - total);
  playSfx(total > 0 ? 'hit' : 'miss');
  if (total > 0) {
    Game.log(`You ${results.length > 1 ? 'strike' : 'swing at'} the ${npc.name}... and hit for ${total} damage.`);
    grantCombatXp(total);
  } else {
    Game.log(`You swing at the ${npc.name}... but miss.`);
  }

  // Gadget area effects (splash to neighbours / chain to a nearby foe / burn DoT
  // / snare) apply on a landed hit.
  if (areaEffect && total > 0) applyAreaEffects(npc, areaEffect, total, count);

  if (npc.hp <= 0) {
    npc.dead = true; npc.respawnAt = count + 16; npc.target = null;
    Game.log(`You have defeated the ${npc.name}!`);
    if (Game.player.combatTarget === npc) Game.player.combatTarget = null;
    dropLoot(npc, count);
    questOnKill(npc.monsterId); // [economy lane] tally kills for active quests
    contractOnKill(npc.monsterId); // M3: tally toward the active slayer contract
  }
}

// Kill an NPC (shared by combat, gadget blasts, and burn ticks).
function killNpc(n, count) {
  n.dead = true; n.respawnAt = count + 16; n.target = null;
  if (Game.player.combatTarget === n) Game.player.combatTarget = null;
  dropLoot(n, count);
  questOnKill(n.monsterId);
  contractOnKill(n.monsterId);
}

// Deal splash/chain damage to a secondary target and resolve its death.
function hitNpcExtra(n, dmg, count) {
  if (!n.target) n.target = Game.player;
  n.hp = Math.max(0, n.hp - dmg);
  floatText(n, '-' + dmg, '#ffb14d');
  grantCombatXp(dmg);
  if (n.hp <= 0) { Game.log(`The ${n.name} is caught in the blast!`); killNpc(n, count); }
}

// Apply a gadget's area effects after a landed hit: splash to adjacent foes,
// chain to the nearest others, a burn DoT, and/or a brief snare (root).
function applyAreaEffects(target, effect, dmg, count) {
  const others = (pred) => Game.npcs.filter((n) => n !== target && !n.dead && n.type === 'guard' && pred(n));
  if (effect.splash) {
    for (const n of others((n) => manhattan(n.tileX, n.tileY, target.tileX, target.tileY) <= 1)) {
      hitNpcExtra(n, Math.max(1, Math.floor(dmg * effect.splash)), count);
    }
  }
  if (effect.chain) {
    const near = others((n) => manhattan(n.tileX, n.tileY, target.tileX, target.tileY) <= 4)
      .sort((a, b) => manhattan(a.tileX, a.tileY, target.tileX, target.tileY) - manhattan(b.tileX, b.tileY, target.tileX, target.tileY))
      .slice(0, effect.chain);
    for (const n of near) hitNpcExtra(n, Math.max(1, Math.floor(dmg * 0.6)), count);
  }
  if (effect.burn) { target.burnTicks = effect.burn; target.burnDmg = Math.max(1, Math.floor(dmg * 0.25)); }
  if (effect.snare) target.snaredUntil = count + 4;
}

function dropLoot(npc, count) {
  // [economy lane] Prefer the database drop table (60 monsters / 302 entries)
  // when this spawn mapped to a monster_id; otherwise fall back to the legacy
  // hardcoded loot table. Item ids are all resolvable (registry hydration).
  const drops = npc.monsterId ? rollMonsterDrops(npc.monsterId)
    : (npc.lootTable ? rollLoot(npc.lootTable) : []);
  // [world-continuity] A live world event (🌑 Blood Moon / 👹 Wandering Horde)
  // makes monsters drop more — scale stack sizes by the event's dropBonus.
  const ev = Game.worldEvents && Game.worldEvents.activeEvent && Game.worldEvents.activeEvent();
  let dropBonus = ev && ev.effect && ev.effect.dropBonus > 1 ? ev.effect.dropBonus : 1;
  // M3 risk↔reward: kills in dangerous regions drop more. Region tier comes
  // from the anchor's level band: 45+ regions pay 1.5×, 20+ pay 1.2×.
  if (!Game.world.interior) {
    const rn = regionAt(npc.tileX, npc.tileY);
    const anchor = REGION_ANCHORS.find((a) => a.name === rn);
    const tierMin = anchor ? parseInt(String(anchor.level), 10) || 1 : 1;
    dropBonus *= tierMin >= 45 ? 1.5 : tierMin >= 20 ? 1.2 : 1;
  }
  for (const d of drops) {
    const qty = dropBonus > 1 ? scaleQty(d.qty, dropBonus) : d.qty;
    spawnGroundItem(d.id, qty, npc.tileX, npc.tileY, count);
    const def = ITEMS[d.id] || { name: d.id };
    Game.log(`The ${npc.name} drops ${qty > 1 ? qty + ' ' : ''}${def.name}.`);
  }
  // Dungeon-boss unique: the trophy always drops (prototype tuning — tighten to a
  // rare roll when the fun demands it). Announced loudly; it's the point of the run.
  if (npc.bossDrop && ITEMS[npc.bossDrop]) {
    spawnGroundItem(npc.bossDrop, 1, npc.tileX, npc.tileY, count, 900);
    Game.log(`${npc.name} drops its trophy: ${ITEMS[npc.bossDrop].name}!`);
  }
}

// Scale a drop quantity by a >1 multiplier with probabilistic rounding, so a
// 1.25× bonus on a single item still yields the occasional extra (25% of kills)
// rather than always rounding away.
function scaleQty(qty, mult) {
  const scaled = qty * mult;
  const base = Math.floor(scaled);
  return base + (Math.random() < scaled - base ? 1 : 0);
}

// Drop one recovered arrow at (x,y), merging into an existing stack on that tile
// so a volley piles up as a single pickup rather than many one-arrow stacks.
function dropRecoveredAmmo(id, x, y, count) {
  const existing = Game.groundItems.find((g) => g.id === id && g.x === x && g.y === y);
  if (existing) { existing.qty += 1; existing.despawnAt = count + GROUND_DESPAWN_TICKS; }
  else spawnGroundItem(id, 1, x, y, count);
}

function npcAttack(n, count) {
  const atk = { levels: n.levels, bonuses: n.bonuses, weaponType: n.weaponType, style: 'Aggressive' };
  // Defender uses prayer-boosted Defence (Thick/Rock/Steel Skin) + worn armour.
  const def = { levels: { defence: playerProfile().levels.defence }, bonuses: totalBonuses() };
  const r = resolveAttack(atk, def);
  // Protection prayers halve incoming damage of the matching style.
  let dmg = r.damage;
  if (dmg > 0 && isProtecting(styleOfWeapon(n.weaponType))) {
    dmg = Math.floor(dmg * PROTECT_FACTOR);
  }
  if (r.hit && dmg > 0) {
    Game.hp = Math.max(0, Game.hp - dmg);
    if (cancelHomeTeleport()) Game.log('Your Home Teleport fizzles as you take a hit.');
    floatText(Game.player, '-' + dmg, '#ff5b5b');
    playSfx('hurt');
    Game.log(`The ${n.name} hits you for ${dmg} damage.`);
  } else {
    floatText(Game.player, '0', '#cccccc');
    Game.log(`The ${n.name} attacks you, but misses.`);
  }
  if (Game.hp <= 0) playerDeath();
}

// ============================================================ dungeon interiors
// M2: the four generated dungeons (src/world/interiors.js) are entered through
// doorway objects in the overworld. Entering swaps Game.world for the interior
// sub-map (same shape as the overworld, so the whole render/collision/path
// pipeline just works), stashes the overworld + its NPCs + ground items, and
// spawns the dungeon's own mobs. Stepping on the exit swaps everything back.
let overworldStash = null;

function spawnEnemyNpcs(world, prefix) {
  world.enemySpawns.forEach((s, i) => {
    const def = world.ENEMY_TYPES[s.type]; if (!def) return;
    const m = s.boss ? 2 : 1; // bosses: doubled combat stats, 5× HP, aggressive
    const levels = { attack: def.att * m, strength: def.str * m, defence: def.def * m, ranged: 1, hitpoints: def.hp * (s.boss ? 5 : 1) };
    const npc = new NPC({
      id: prefix + i, name: s.name || def.name, type: 'guard', tileX: s.x, tileY: s.y,
      color: s.boss ? 0xd04a4a : def.color, monsterId: null,
      wanderRadius: 3, leashRadius: 12, aggressive: !!s.boss, aggroRange: s.boss ? 7 : 4,
      attackSpeed: def.speed, weaponType: 'crush', levels, combatLevel: combatLevel(levels), lootTable: def.loot,
      bonuses: Object.assign(emptyBonuses(), {
        crush_atk: Math.floor(def.att * m / 2), melee_str: Math.floor(def.str * m / 3),
        slash_def: def.def * m, crush_def: def.def * m, stab_def: def.def * m,
      }),
    });
    if (s.bossDrop) npc.bossDrop = s.bossDrop; // guaranteed unique on kill (see dropLoot)
    if (s.boss) { npc.bossSpec = { every: 4 }; npc._specCount = 0; }   // telegraphed slam every 4th swing
    if (s.bossWeak) npc.weakTo = s.bossWeak;                           // 1.5x damage from this style
    Game.npcs.push(npc);
  });
}

function enterInterior(kind, entry) {
  if (Game.world.interior || overworldStash) return;
  const inner = generateInterior(kind, { from: { x: entry.x, y: entry.y + 1 } });
  inner.ENEMY_TYPES = Game.world.ENEMY_TYPES; // dungeon mobs use the shared stat blocks
  overworldStash = { world: Game.world, npcs: Game.npcs, ground: Game.groundItems, tile: { x: entry.x, y: entry.y + 1 } };
  Game.world = inner;
  Game.npcs = []; Game.activeNpcs = []; Game.groundItems = [];
  spawnEnemyNpcs(inner, 'dg');
  const p = Game.player;
  p.tileX = inner.spawn.x; p.tileY = inner.spawn.y; p.px = tilePx(p.tileX); p.py = tilePx(p.tileY);
  clearTargets(p); p.path = [];
  scene.cameras.main.setBounds(0, 0, inner.W * TILE_SIZE, inner.H * TILE_SIZE);
  scene.cameras.main.centerOn(p.px, p.py);
  Game.log(`You descend into the ${inner.name}… (the way out is behind you)`);
}

function exitInterior() {
  if (!Game.world.interior || !overworldStash) return;
  const back = overworldStash; overworldStash = null;
  Game.world = back.world; Game.npcs = back.npcs; Game.groundItems = back.ground; Game.activeNpcs = [];
  const p = Game.player;
  p.tileX = back.tile.x; p.tileY = back.tile.y; p.px = tilePx(p.tileX); p.py = tilePx(p.tileY);
  clearTargets(p); p.path = [];
  scene.cameras.main.setBounds(0, 0, Game.world.W * TILE_SIZE, Game.world.H * TILE_SIZE);
  scene.cameras.main.centerOn(p.px, p.py);
  Game.log('You climb back into the daylight.');
}

function playerDeath() {
  playSfx('death');
  // Dying in a dungeon throws you out first: your dropped stacks land at the
  // dungeon's overworld doorstep (no re-entry run required to recover them).
  if (Game.world.interior) exitInterior();
  const count = Game.ticker ? Game.ticker.count : 0;
  const p = Game.player;
  const dx = p.tileX, dy = p.tileY;
  // OSRS-style death cost (M1): your 3 most valuable stacks stay with you;
  // everything else drops WHERE YOU FELL and despawns in ~5 minutes of ticks —
  // death now costs a tense run-back instead of nothing. Equipped gear is safe
  // (beta kindness; revisit for the hardcore pass).
  const slots = [];
  for (let i = 0; i < Game.inventory.length; i++) {
    const s = Game.inventory[i];
    if (!s) continue;
    const def = GameData.item(s.id) || {};
    const unit = def.gp_value ?? (ITEMS[s.id] && ITEMS[s.id].value) ?? 1;
    slots.push({ i, id: s.id, qty: s.qty || 1, total: unit * (s.qty || 1) });
  }
  slots.sort((a, b) => b.total - a.total);
  const dropped = slots.slice(3);
  for (const d of dropped) { spawnGroundItem(d.id, d.qty, dx, dy, count, 500); Game.inventory[d.i] = null; }
  if (Game.selectedInv != null && !Game.inventory[Game.selectedInv]) Game.selectedInv = null;
  if (dropped.length) {
    Game.log(`Oh dear, you are dead! You kept your ${Math.min(3, slots.length)} most valuable stacks — ` +
      `${dropped.length} stack${dropped.length > 1 ? 's' : ''} lie${dropped.length > 1 ? '' : 's'} where you fell. You have ~5 minutes to run back!`);
  } else {
    Game.log('Oh dear, you are dead! You wake back at the settlement.');
  }
  Game.hp = Game.maxHp;
  Game.activePrayers = [];   // prayers switch off on death
  restorePrayer();           // ...and points recharge
  const s = Game.world.spawn;
  p.tileX = s.x; p.tileY = s.y; p.px = tilePx(s.x); p.py = tilePx(s.y);
  clearTargets(p); p.path = [];
  for (const n of Game.npcs) n.target = null;
}

// [economy lane] OSRS-style Home Teleport: free, but a channelled cast (interrupted
// by acting/moving/taking damage) then a cooldown, that returns you to spawn.
function startHomeTeleport() {
  const count = Game.ticker ? Game.ticker.count : 0;
  if (Game.playerFrozen) return;
  const s = homeState(count);
  if (s.status === 'channeling') return;
  if (s.status === 'cooldown') { Game.log(`Home Teleport is recharging — ${Math.ceil(s.remaining * TICK_SECONDS)}s to go.`); return; }
  clearTargets(Game.player); Game.player.path = [];
  beginHomeTeleport(count);
  Game.log('You raise your hands and begin to channel a Home Teleport… stand still.');
  updateHomeHud();
}
function teleportHome() {
  const sp = Game.world.spawn, p = Game.player;
  clearTargets(p); p.path = [];
  p.tileX = sp.x; p.tileY = sp.y; p.px = tilePx(sp.x); p.py = tilePx(sp.y);
  for (const n of Game.npcs) n.target = null;
  Game.location = regionAt(p.tileX, p.tileY);
  Game.log('The world folds and you step out at the settlement.');
  Game.refresh();
}
function updateHomeHud() {
  const btn = document.getElementById('home-btn');
  if (!btn) return;
  const count = Game.ticker ? Game.ticker.count : 0;
  const s = homeState(count);
  btn.classList.toggle('channeling', s.status === 'channeling');
  btn.classList.toggle('cooldown', s.status === 'cooldown');
  const lbl = document.getElementById('home-state');
  if (s.status === 'channeling') {
    btn.style.setProperty('--home-pct', Math.round(s.progress * 100));
    if (lbl) lbl.textContent = '…';
  } else if (s.status === 'cooldown') {
    btn.style.setProperty('--home-pct', 100 - Math.round((s.remaining / HOME_COOLDOWN_TICKS) * 100));
    const sec = Math.ceil(s.remaining * TICK_SECONDS);
    if (lbl) lbl.textContent = sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec}`;
  } else {
    btn.style.setProperty('--home-pct', 100);
    if (lbl) lbl.textContent = '';
  }
}

function reviveNpc(n) {
  n.dead = false; n.hp = n.maxHp;
  n.tileX = n.homeX; n.tileY = n.homeY;
  n.px = tilePx(n.homeX); n.py = tilePx(n.homeY);
  n.target = null; n.path = [];
}

// [character-render lane] combat hitsplats — an OSRS-style diamond splat behind
// the number. Kind is inferred from the string so the combat call-sites stay
// untouched: '0' -> miss (blue), '-N' -> damage (red), anything else -> heal.
function floatText(ent, str /* color ignored: splat colour is by kind */) {
  if (!scene) return;
  const kind = str === '0' ? 'miss' : (str[0] === '-' ? 'hit' : 'heal');
  const num = kind === 'miss' ? '0' : str.replace('-', '');
  const col = kind === 'miss' ? 0x2f5f9e : kind === 'heal' ? 0x2e8b3f : 0xb01e1e;
  const startY = ent.py + AV_FEET - 30 * AV_SCALE - 2; // just above the head
  const dia = [{ x: 0, y: -11 }, { x: 11, y: 0 }, { x: 0, y: 11 }, { x: -11, y: 0 }];

  const c = scene.add.container(ent.px, startY).setDepth(50);
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.22); g.fillEllipse(0, 13, 20, 6);   // faint drop shadow
  g.fillStyle(col, 1); g.fillPoints(dia, true);
  g.lineStyle(1.5, 0xffffff, 0.85); g.strokePoints(dia, true);
  const t = scene.add.text(0, 0, num, {
    fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', fontStyle: 'bold',
  }).setOrigin(0.5);
  t.setStroke('#000', 2);
  c.add([g, t]);
  scene.tweens.add({ targets: c, y: startY - 30, duration: 780, ease: 'Quad.easeOut', onComplete: () => c.destroy() });
  scene.tweens.add({ targets: c, alpha: 0, delay: 470, duration: 300 });
}

// ---------------------------------------------------------------- render loop
function update(time, delta) {
  if (!Game.world) return;
  const speed = TILE_SIZE / 600;
  const p = Game.player;
  // On a run tick the player crossed 2 tiles, so its interpolation must cover the
  // extra ground in the same 600ms — double the approach speed for the player only.
  const pSpeed = speed * (p._ranTick ? RUN_TILES : 1);
  approach(p, 'px', tilePx(p.tileX), pSpeed * delta);
  approach(p, 'py', tilePx(p.tileY), pSpeed * delta);
  for (const n of Game.activeNpcs) {
    if (n.dead) continue;
    approach(n, 'px', tilePx(n.tileX), speed * delta);
    approach(n, 'py', tilePx(n.tileY), speed * delta);
  }

  // Ease zoom/rotation toward their targets so wheel/key input feels smooth,
  // then re-centre on the player (rotation pivots about the view centre = player).
  const cam = this.cameras.main;
  cam.zoom = Phaser.Math.Linear(cam.zoom, targetZoom, 0.18);
  cam.rotation = Phaser.Math.Linear(cam.rotation, targetRot, 0.18);
  // [economy lane] During a cutscene the camera drifts toward the beat's pan
  // target (eased) instead of tracking the player; otherwise follow the player.
  if (Game.cutsceneCam) {
    const tx = tilePx(Game.cutsceneCam.x), ty = tilePx(Game.cutsceneCam.y);
    csCamPx.x = csCamPx.x == null ? p.px : Phaser.Math.Linear(csCamPx.x, tx, 0.06);
    csCamPx.y = csCamPx.y == null ? p.py : Phaser.Math.Linear(csCamPx.y, ty, 0.06);
    cam.centerOn(csCamPx.x, csCamPx.y);
  } else {
    csCamPx.x = csCamPx.y = null;
    cam.centerOn(p.px, p.py);
  }
  drawTerrain();
  drawObjects();
  drawTownDecor(decorGfx);
  drawGround();
  drawEntities();
  updateLabels();
  drawMinimap();
  updateRunHud();
  // [r3d] hand the frame to the 3D overlay (render-only) when ?r3d=1. One boolean when off.
  if (R3D && window.__r3d) window.__r3d.frame();
}

function approach(o, key, target, maxStep) {
  const d = target - o[key];
  if (Math.abs(d) <= maxStep) o[key] = target;
  else o[key] += Math.sign(d) * maxStep;
}

// ---- 2.5D relief -----------------------------------------------------------
// The world ships a coherent elevation field (world.elevation, 0–255; baseline
// ~80 = plains). We lift each tile's draw position by its height so mountains
// rise, water sinks into valleys, and grassland gently rolls — then fill the
// south-facing gap below any raised tile with a darker "side wall" so steps
// (mountain fronts, cliff lips, lake banks) read as solid faces instead of
// leaving seams. Painter order (north→south, front tiles drawn last) makes
// raised tiles occlude what's behind them for free. Purely visual: collision,
// pathing and hit-testing all stay on the flat grid.
const ELEV_BASE = 80, ELEV_K = 0.34;
function elevLift(elev, i) { return elev ? (elev[i] - ELEV_BASE) * ELEV_K : 0; }
// Vertical lift (px) for anything standing on tile (tx,ty) — entities, their
// labels, ground items, path/target highlights — so they ride the raised terrain.
function tileLiftXY(tx, ty) { const e = Game.world.elevation; return e ? (e[ty * Game.world.W + tx] - ELEV_BASE) * ELEV_K : 0; }
function shadeColor(c, f) { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; return ((Math.min(255, r * f) | 0) << 16) | ((Math.min(255, g * f) | 0) << 8) | (Math.min(255, b * f) | 0); }

// Deterministic per-tile hash (stable across frames) for texture variation.
function tHash(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// ---- per-terrain texture detail (drawn over the flat base fill; all fillRect
// for speed). Together these make walls read as capped stone, roads as cobble,
// floors as flagstones, and grass/water/fields as varied ground. ----
function detailWall(g, px, py, color, x, y) {
  // THIN + TALL wall: a ~14px connected-tile footprint (centre + an arm toward each wall
  // neighbour) EXTRUDED upward by H, so the wall reads thin in plan but RISES like a real
  // wall — a lit stone CAP on top and a dark south-facing FRONT FACE beneath it (same
  // straight-up lift the elevation system uses). Ground is painted into the margins so the
  // footprint stays thin; collision stays a full tile. Neighbour-aware -> runs/corners connect,
  // and painter order (north→south) makes each wall's raised body occlude what's behind it.
  const TS = TILE_SIZE, W = Game.world.W, WH = Game.world.H, ter = Game.world.terrain, DEF = TERRAIN_DEFS;
  const inb = (xx, yy) => xx >= 0 && yy >= 0 && xx < W && yy < WH;
  const wall = (xx, yy) => inb(xx, yy) && ter[yy * W + xx] === T.WALL;
  const gcol = (xx, yy) => (inb(xx, yy) && DEF[ter[yy * W + xx]]) ? DEF[ter[yy * W + xx]].color : DEF[T.DIRT].color;
  const wN = wall(x, y - 1), wS = wall(x, y + 1), wE = wall(x + 1, y), wW = wall(x - 1, y);
  const TH = 14, m = (TS - TH) >> 1, H = 12;                                    // 14px footprint, 12px tall
  // 1) paint ground into the non-wall margins so the footprint reads thin
  if (!wN) { g.fillStyle(gcol(x, y - 1), 1); g.fillRect(px, py, TS + 1, m); }
  if (!wS) { g.fillStyle(gcol(x, y + 1), 1); g.fillRect(px, py + TS - m, TS + 1, m + 1); }
  if (!wE) { g.fillStyle(gcol(x + 1, y), 1); g.fillRect(px + TS - m, py, m + 1, TS + 1); }
  if (!wW) { g.fillStyle(gcol(x - 1, y), 1); g.fillRect(px, py, m, TS + 1); }
  // 2) connected footprint bounds (arms reach the tile edge toward wall neighbours)
  const fx0 = wW ? px : px + m, fx1 = wE ? px + TS + 1 : px + m + TH;
  const fy0 = wN ? py : py + m, fy1 = wS ? py + TS + 1 : py + m + TH;
  const fw = fx1 - fx0, fh = fy1 - fy0;
  // 3) extrude the footprint UP by H: dark BODY (the visible front face / height)…
  g.fillStyle(shadeColor(color, 0.5), 1); g.fillRect(fx0, fy0 - H, fw, fh + H);
  g.fillStyle(shadeColor(color, 0.38), 1); g.fillRect(fx0, fy1 - 6, fw, 6);                 // darker at the base
  // 4) …then the lit CAP on top (footprint raised by H)
  g.fillStyle(shadeColor(color, 1.2), 1); g.fillRect(fx0, fy0 - H, fw, fh);
  g.fillStyle(shadeColor(color, 1.78), 0.75); g.fillRect(fx0, fy0 - H, fw, 1.5);            // sunlit top edge
  g.fillStyle(shadeColor(color, 0.95), 0.8); g.fillRect(fx0, fy1 - H - 1, fw, 1.3);         // lit lip where cap meets face
  // 5) soft contact shadow where the wall meets the ground
  g.fillStyle(0x000000, 0.18); g.fillRect(fx0, fy1, fw, 2);
}
function detailFloor(g, px, py, color) {
  const TS = TILE_SIZE;
  g.fillStyle(shadeColor(color, 1.08), 0.28); g.fillRect(px + 2, py + 2, TS - 4, TS - 4); // lit stone face
  g.fillStyle(shadeColor(color, 0.72), 0.6);                                              // flagstone grout grid
  g.fillRect(px, py, TS + 1, 1); g.fillRect(px, py, 1, TS + 1);
}
function detailPath(g, px, py, color, x, y) {
  const TS = TILE_SIZE;
  for (let k = 0; k < 3; k++) {
    const r = tHash(x * 5 + k * 31, y * 7 + k * 17);
    g.fillStyle(shadeColor(color, r < 0.5 ? 0.8 : 1.14), 0.5);
    g.fillRect(px + 3 + ((r * (TS - 8)) | 0), py + 3 + (((r * 613) % (TS - 8)) | 0), 3, 3);
  }
}
function detailGrass(g, px, py, color, x, y) {
  const TS = TILE_SIZE, r = tHash(x, y);
  g.fillStyle(shadeColor(color, r < 0.5 ? 0.86 : 1.14), 0.42);
  g.fillRect(px + ((r * (TS - 5)) | 0), py + (((r * 271) % (TS - 5)) | 0), 3, 3);
  if (r > 0.66) { g.fillStyle(shadeColor(color, 1.2), 0.38); g.fillRect(px + (((r * 431) % (TS - 3)) | 0), py + (((r * 733) % (TS - 6)) | 0), 1, 4); }
}
function detailWater(g, px, py, color, x, y) {
  const TS = TILE_SIZE, ph = Math.sin(Date.now() * 0.0016 + (x * 0.7 + y * 0.5)) * 0.5 + 0.5;
  g.fillStyle(shadeColor(color, 1.4), 0.28); g.fillRect(px + 3, py + Math.round(4 + ph * (TS - 9)), TS - 6, 1.5);
}
function detailField(g, px, py, color) {
  const TS = TILE_SIZE;
  g.fillStyle(shadeColor(color, 0.8), 0.7);
  for (let fy = py + 4; fy < py + TS - 1; fy += 6) g.fillRect(px, fy, TS + 1, 1);
}

// [char-render] Optional real ground-tile art. Each tile's art-key is simply its
// TERRAIN_DEFS id (grass, grass2, water, water_deep, road, cliff, sand, wall…) — a
// 1:1 match with the filenames in assets/terrain/ and the keys in manifest.json.
// When that key's texture is loaded, drawTerrain blits a pooled image instead of
// the procedural fill+detail. No texture (unlisted / missing PNG) => that tile
// stays procedural. See terrainArt.js.
let terrainArtScene = null;              // scene ref for creating pooled images
const terrainTexReady = new Set();       // art-keys whose PNG texture has loaded
const terrainArtPool = [];               // reused Phaser.Image bobs for arted tiles
let terrainArtCursor = 0;                // per-frame pool cursor

// Load a set of art PNGs straight into the texture manager and mark each ready as
// it decodes. Deliberately NOT the scene LoaderPlugin: two features (terrain +
// objects) resolve their manifests async and each would call load.start(), and
// Phaser swallows a second start() while the first batch is mid-load — so the
// later batch never finishes. A plain HTMLImage per key has no such race.
function loadArtTextures(scene, keys, prefix, urlFor, readySet) {
  for (const k of keys) {
    const key = prefix + k;
    if (scene.textures.exists(key)) { readySet.add(k); continue; }
    const im = new Image();
    im.onload = () => { if (!scene.textures.exists(key)) scene.textures.addImage(key, im); readySet.add(k); };
    im.onerror = () => {}; // missing PNG => that art-key just stays procedural
    im.src = urlFor(k);
  }
}
// Load the terrain manifest, then its tile textures. No-op when the manifest is empty.
function initTerrainArt(scene) {
  terrainArtScene = scene;
  loadTerrainArt().then((keys) => {
    if (!keys.length) return;
    const singles = [];
    for (const k of keys) {
      const n = terrainGrid(k);
      if (n > 1) loadTerrainGrid(scene, k, n);   // NxN super-tile set (cross-tile facets mask the grid)
      else singles.push(k);                        // plain single tile
    }
    if (singles.length) loadArtTextures(scene, singles, 'terr_', terrainArtUrl, terrainTexReady);
  });
}
// Load the N*N slice PNGs for a super-tiled ground (<key>_<idx>.png). Marks the base
// key ready only once EVERY slice has decoded, so drawTerrain never blits a missing
// slice — a failed/absent slice just leaves that whole key procedural.
function loadTerrainGrid(scene, key, n) {
  const total = n * n;
  const markIfComplete = () => {
    for (let idx = 0; idx < total; idx++) if (!scene.textures.exists('terr_' + key + '_' + idx)) return;
    terrainTexReady.add(key);
  };
  for (let idx = 0; idx < total; idx++) {
    const texKey = 'terr_' + key + '_' + idx;
    if (scene.textures.exists(texKey)) { markIfComplete(); continue; }
    const im = new Image();
    im.onload = () => { if (!scene.textures.exists(texKey)) scene.textures.addImage(texKey, im); markIfComplete(); };
    im.onerror = () => {}; // missing slice => key stays not-ready => procedural fallback
    im.src = terrainArtUrl(key + '_' + idx);
  }
}
function terrainBlit(px, topY, texKey) {
  let img = terrainArtPool[terrainArtCursor];
  if (!img) {
    img = terrainArtScene.add.image(0, 0, texKey).setOrigin(0, 0).setDepth(0.05);
    if (uiCam) uiCam.ignore(img);         // world layer: main cam only, never the HUD cam
    terrainArtPool[terrainArtCursor] = img;
  }
  img.setTexture(texKey).setPosition(px, topY).setDisplaySize(TILE_SIZE + 1, TILE_SIZE + 1).setVisible(true);
  terrainArtCursor++;
}

function drawTerrain() {
  const g = terrainGfx; g.clear();
  terrainArtCursor = 0;                   // recycle the art-image pool this frame
  const v = viewRange();
  const W = Game.world.W, H = Game.world.H, ter = Game.world.terrain, elev = Game.world.elevation;
  const TS = TILE_SIZE;
  for (let y = v.y0; y <= v.y1; y++) {
    for (let x = v.x0; x <= v.x1; x++) {
      const i = y * W + x;
      const t = ter[i];
      const color = TERRAIN_DEFS[t].color;
      const lift = elevLift(elev, i);
      const px = x * TS, topY = y * TS - lift;
      if (elev) {
        const eSouth = (y < H - 1) ? elev[i + W] : elev[i];
        const side = lift - (eSouth - ELEV_BASE) * ELEV_K; // px of front face exposed above the tile in front
        if (side > 0.5) {                                  // exposed south face → render it as a lit-capped stone wall, not a flat band
          const fh = side + 2, fy = topY + TS - 1;
          g.fillStyle(shadeColor(color, 0.52), 1); g.fillRect(px, fy, TS + 1, fh);                      // face body
          g.fillStyle(shadeColor(color, 0.34), 1); g.fillRect(px, fy + fh * 0.5, TS + 1, fh * 0.5 + 1); // darker lower half → grounds the wall
          g.fillStyle(shadeColor(color, 0.95), 0.85); g.fillRect(px, fy, TS + 1, 1.5);                  // lit cap edge where the top meets the face
          g.fillStyle(0x000000, 0.16); g.fillRect(px, fy + fh, TS + 1, 2);                              // soft contact shadow at the base
        }
      }
      // real ground art (if this tile's texture is loaded) replaces the procedural
      // fill+detail; the elevation side-face above still draws for 2.5D depth.
      const artKey = TERRAIN_DEFS[t].id; // 1:1 with the manifest tile-keys / filenames
      if (terrainTexReady.has(artKey)) {
        const gn = terrainGrid(artKey);  // >1 => NxN super-tile set; slice chosen by tile position
        terrainBlit(px, topY, gn > 1 ? ('terr_' + artKey + '_' + ((x % gn) * gn + (y % gn))) : ('terr_' + artKey));
        continue;
      }
      g.fillStyle(color, 1);
      g.fillRect(px, topY, TS + 1, TS + 1);
      switch (t) {
        case T.WALL: detailWall(g, px, topY, color, x, y); break;
        case T.FLOOR: detailFloor(g, px, topY, color); break;
        case T.ROAD: case T.BRIDGE: case T.DIRT: case T.DIRT_SHADOW: detailPath(g, px, topY, color, x, y); break;
        case T.GRASS: case T.GRASS2: case T.GRASS3: case T.GRASS_SHADOW: detailGrass(g, px, topY, color, x, y); break;
        case T.WATER: case T.WATER_DEEP: case T.WATER_SHALLOW: detailWater(g, px, topY, color, x, y); break;
        case T.FIELD: detailField(g, px, topY, color); break;
        default: break;
      }
    }
  }
  // hide any pooled art images not used this frame (view shrank / fewer arted tiles)
  for (let k = terrainArtCursor; k < terrainArtPool.length; k++) terrainArtPool[k].setVisible(false);
}

// [economy lane] Procedural art for post-gen world objects that used to render as
// a plain colored square: an animated blood/portal gateway and a mine-cart for
// the fast-travel transports, and a small shrine for the Bones Altar.
function drawTransport(g, cx, cy, kind) {
  const x = cx + 16, y = cy + 16, t = Date.now() * 0.004;
  if (kind === 'portal') {
    g.fillStyle(0x241a16, 1); g.fillEllipse(x, y, 24, 32);          // stone arch
    g.fillStyle(0x0e0305, 1); g.fillEllipse(x, y, 17, 25);          // void
    for (let i = 3; i >= 1; i--) {
      const pulse = 0.5 + 0.5 * Math.sin(t + i * 1.2);
      g.lineStyle(2, 0xaa1030, 0.3 + 0.25 * pulse);
      g.strokeEllipse(x, y, 5 * i + 2 * pulse, 7.5 * i + 3 * pulse); // swirling rings
    }
    g.fillStyle(0xff3a5a, 0.55 + 0.35 * Math.sin(t * 1.6)); g.fillEllipse(x, y, 6, 10); // core glow
    g.fillStyle(0xffd6dc, 0.85); g.fillEllipse(x, y - 1, 2.4, 4);   // hot centre
  } else {                                                          // cart / minecart
    g.fillStyle(0x4a3c2c, 1); g.fillRect(x - 10, y - 5, 20, 11);
    g.fillStyle(0x2f2519, 1); g.fillRect(x - 8, y - 3, 16, 7);
    g.fillStyle(0x8a6a3a, 1); g.fillRect(x - 10, y + 5, 20, 2);
    g.fillStyle(0x1a1a1a, 1); g.fillCircle(x - 6, y + 8, 3); g.fillCircle(x + 6, y + 8, 3);
    g.fillStyle(0x888888, 1); g.fillCircle(x - 6, y + 8, 1.2); g.fillCircle(x + 6, y + 8, 1.2);
  }
}
function drawAltar(g, cx, cy) {
  const x = cx + 16, y = cy + 16, t = Date.now() * 0.005;
  g.fillStyle(0x413a5c, 1); g.fillRect(x - 12, y + 6, 24, 4);       // plinth
  g.fillStyle(0x2b2740, 1); g.fillRect(x - 10, y - 2, 20, 10);      // body
  g.fillStyle(0xcfc4e0, 1); g.fillRect(x - 8, y - 6, 16, 5);        // top slab
  g.fillStyle(0x9a7bff, 0.4 + 0.3 * Math.sin(t)); g.fillCircle(x, y - 3, 2.4); // rune glow
}

// [char-render] Optional real world-object art. Each object's art-key is its KIND:
// resources -> 'tree' / 'ore'; structures -> propKind(label) (stall, barrel, chest,
// anvil, well, hut, …); giant mushroom -> 'mushroom'; scenery -> its scenery key.
// Null keeps the object procedural (fishing spots, portals, altars, fires, plain
// decor). When the key's texture is loaded, drawObjects blits a bottom-anchored
// image (so trees overhang upward) instead of the procedural prop. See objectArt.js.
// Ordered art-key candidates for an object, MOST SPECIFIC first. Resources route
// on their species/type (resKey: 'tree_oak', 'copper', …) then fall back to the
// generic 'tree'/'ore', so a willow forest, an oak wood and a fungal grove look
// different the moment species art exists — and still render (generic) before it
// does. Structures route via propKind (+ any data-node id).
function objectArtCandidates(o) {
  if (o.type === 'resource') {
    if (o.blocking === false) return [];            // fishing-spot shimmer stays procedural
    if (o.skill === 'Woodcutting') return [o.resKey, 'tree'];
    if (o.skill === 'Mining') return [o.resKey, 'ore'];
    return [];
  }
  if (o.type === 'structure') return o.nodeId ? [o.nodeId, propKind(o.label)] : [propKind(o.label)];
  if (o.type === 'decor') {
    if (o.mush === 'giant') return ['mushroom'];
    if (o.scenery) return [o.scenery];
  }
  return [];
}
// Stable per-tile hash → deterministic per-object variation (never shimmers).
function objHash(o) { return (((o.x * 73856093) ^ (o.y * 19349663)) >>> 0); }
// First candidate whose texture is loaded; null if none (draw procedural).
function resolveObjectKey(o) {
  const cands = objectArtCandidates(o);
  for (const base of cands) if (base && objTexReady.has(base)) return base;
  return null;
}
let objectArtScene = null;
const objTexReady = new Set();       // object-keys whose PNG texture has loaded
const objectArtPool = [];            // reused Phaser.Image bobs for arted objects
let objectArtCursor = 0;

function initObjectArt(scene) {
  objectArtScene = scene;
  loadObjectArt().then((keys) => { if (keys.length) loadArtTextures(scene, keys, 'obj_', objectArtUrl, objTexReady); });
}
// Draw an object sprite bottom-anchored on its tile ("128px = one tile"), so short
// props sit in the tile and tall ones (trees) rise above it.
function objectBlit(o, cx, cy, base, organic) {
  let img = objectArtPool[objectArtCursor];
  if (!img) {
    img = objectArtScene.add.image(0, 0, 'obj_' + base).setOrigin(0.5, 1).setDepth(1.05);
    if (uiCam) uiCam.ignore(img);     // world layer: main cam only, never the HUD cam
    objectArtPool[objectArtCursor] = img;
  }
  const h = objHash(o);
  const s = (TILE_SIZE / 128) * objectScale(base);   // base "128px = one tile" × per-key scale
  // per-instance variety (organic kinds only — trees/rocks/plants, never buildings):
  // a stable mirror + gentle size jitter + a tiny lean so a forest isn't clones.
  const flip = organic && (h & 1) ? -1 : 1;
  const sj = organic ? (0.9 + ((h >>> 1) & 7) / 35) : 1;       // ~0.9..1.1
  const rot = organic ? ((((h >>> 4) & 7) - 3.5) * 0.014) : 0; // ~ ±0.05 rad lean
  img.setTexture('obj_' + base).setOrigin(0.5, 1)
    .setScale(flip * s * sj, s * sj).setRotation(rot)
    .setPosition(cx + TILE_SIZE / 2, cy + TILE_SIZE).setVisible(true);
  objectArtCursor++;
}

function drawObjects() {
  const g = objectsGfx; g.clear();
  objectArtCursor = 0;                 // recycle the object-art image pool this frame
  const v = viewRange();
  const elevO = Game.world.elevation, Wo = Game.world.W;
  for (const o of objectsInView(Game.world, v.x0, v.y0, v.x1, v.y1)) {
    const cx = o.x * TILE_SIZE, cy = o.y * TILE_SIZE - elevLift(elevO, o.y * Wo + o.x);
    // real object art (if this kind's texture is loaded) replaces the procedural
    // prop; depleted nodes (stumps / mined rock) keep the procedural spent look.
    if (!o.depleted) {
      const base = resolveObjectKey(o);
      if (base) {
        // soft contact shadow (on the graphics layer, under the sprite) grounds it
        g.fillStyle(0x000000, 0.22);
        if (g.fillEllipse) g.fillEllipse(cx + TILE_SIZE / 2, cy + TILE_SIZE - 2, TILE_SIZE * 0.72, TILE_SIZE * 0.28);
        else g.fillCircle(cx + TILE_SIZE / 2, cy + TILE_SIZE - 2, TILE_SIZE * 0.3);
        objectBlit(o, cx, cy, base, o.type !== 'structure'); // structures don't jitter
        continue;
      }
    }
    if (o.type === 'decor') {
      if (o.mush === 'giant') { // giant toadstool: stem on this tile, cap overhangs the neighbours (drawn tree-style)
        const s = o.size;
        g.fillStyle(0x000000, 0.12); g.fillEllipse ? g.fillEllipse(cx + 16, cy + 26, s * 1.3, 6) : g.fillCircle(cx + 16, cy + 26, 6); // ground shadow
        g.fillStyle(0xe6dcc4, 1); g.fillRect(cx + 13, cy + 8, 6, 18);                                   // pale stem
        g.fillStyle(o.color, 1); g.fillCircle(cx + 16, cy + 2, s);                                       // big cap, lifted so it overhangs above/beside
        g.fillStyle(0x000000, 0.14); g.fillCircle(cx + 16, cy + 2 + s * 0.55, s * 0.7);                  // underside shade
        g.fillStyle(o.color, 1); g.fillCircle(cx + 16, cy - s * 0.15, s * 0.92);                         // cap dome over the shade
        g.fillStyle(0xffffff, 0.55); g.fillCircle(cx + 16 - s * 0.4, cy - s * 0.1, s * 0.15); g.fillCircle(cx + 16 + s * 0.35, cy + 2, s * 0.12); g.fillCircle(cx + 16 + s * 0.05, cy - s * 0.45, s * 0.11); // spots
        continue;
      }
      g.fillStyle(o.color, 1);
      if (o.shape === 'circle') g.fillCircle(cx + 16, cy + 16, o.size);
      else g.fillRect(cx + 16 - o.size, cy + 16 - o.size, o.size * 2, o.size * 2);
      continue;
    }
    if (o.type === 'resource') {
      if (o.blocking === false) { // fishing spot
        g.fillStyle(o.depleted ? 0x3a6a7a : o.color, 0.9); g.fillCircle(cx + 16, cy + 16, 7); continue;
      }
      if (o.skill === 'Woodcutting') { // tree: trunk + canopy
        g.fillStyle(0x3a2a18, 1); g.fillRect(cx + 14, cy + 18, 4, 8);
        g.fillStyle(o.depleted ? 0x6a6a4a : o.color, 1); g.fillCircle(cx + 16, cy + 13, 11); continue;
      }
      g.fillStyle(o.depleted ? 0x555555 : o.color, 1); g.fillRect(cx + 5, cy + 5, TILE_SIZE - 10, TILE_SIZE - 10); continue; // ore rock
    }
    if (o.transport) { drawTransport(g, cx, cy, o.kind); continue; } // [economy lane] portal/cart art
    if (o.altar) { drawAltar(g, cx, cy); continue; } // [economy lane] altar art
    if (o.type === 'structure') { drawProp(g, cx, cy, o); continue; } // [char-render] recognisable prop instead of a flat square
    g.fillStyle(o.depleted ? 0x555555 : o.color, 1);
    g.fillRect(cx + 4, cy + 4, TILE_SIZE - 8, TILE_SIZE - 8);
    if (o.label === 'Range' && !o.depleted) { g.fillStyle(0xffd24d, 0.8); g.fillCircle(cx + 16, cy + 16, 5); }
  }
  // hide any pooled object-art images not used this frame
  for (let k = objectArtCursor; k < objectArtPool.length; k++) objectArtPool[k].setVisible(false);

  // [economy lane] temporary firemaking fires: procedural flame that flickers
  // and shrinks as its lifespan (global-tick deadline) runs out. Character-render
  // may replace this with a nicer FX later - it reads the same activeFires().
  const nowTick = Game.ticker ? Game.ticker.count : 0;
  for (const f of activeFires()) {
    const fx = f.x * TILE_SIZE + 16, fy = f.y * TILE_SIZE + 16;
    const life = fireLifeRatio(f, nowTick);
    const flick = 0.85 + 0.15 * Math.sin(Date.now() * 0.02 + f.x * 1.7 + f.y);
    const scale = (0.55 + 0.45 * life) * flick;
    g.fillStyle(0x7a2a0c, 0.9); g.fillCircle(fx, fy + 7, 6 * flick);
    g.lineStyle(3, 0x3b2a1a, 1);
    g.beginPath(); g.moveTo(fx - 8, fy + 9); g.lineTo(fx + 8, fy + 5);
    g.moveTo(fx - 8, fy + 5); g.lineTo(fx + 8, fy + 9); g.strokePath();
    const h = 20 * scale, w = 9 * scale;
    g.fillStyle(0xff6a1a, 0.95); g.fillTriangle(fx - w, fy + 6, fx + w, fy + 6, fx, fy + 6 - h);
    g.fillStyle(0xffd24d, 0.95); g.fillTriangle(fx - w * 0.55, fy + 6, fx + w * 0.55, fy + 6, fx, fy + 6 - h * 0.6);
    g.fillStyle(0xfff2c0, 0.9); g.fillCircle(fx, fy + 1, 2.2 * scale);
  }

  const p = Game.player;
  g.fillStyle(0xffffff, 0.18);
  for (const [tx, ty] of p.path || []) g.fillRect(tx * TILE_SIZE + 8, ty * TILE_SIZE + 8 - tileLiftXY(tx, ty), 16, 16);
  if (p.interactTarget && !p.interactTarget.depleted) {
    const o = p.interactTarget;
    g.lineStyle(2, 0xffe14d, 0.9); g.strokeRect(o.x * TILE_SIZE + 1, o.y * TILE_SIZE + 1 - tileLiftXY(o.x, o.y), TILE_SIZE - 2, TILE_SIZE - 2);
  }
  if (p.combatTarget && !p.combatTarget.dead) {
    const t = p.combatTarget;
    g.lineStyle(2, 0xff4d4d, 0.9); g.strokeRect(t.tileX * TILE_SIZE + 1, t.tileY * TILE_SIZE + 1 - tileLiftXY(t.tileX, t.tileY), TILE_SIZE - 2, TILE_SIZE - 2);
  }
}

function drawGround() {
  const g = groundGfx; g.clear();
  for (const it of Game.groundItems) {
    const def = ITEMS[it.id];
    const cx = it.x * TILE_SIZE + 16, cy = it.y * TILE_SIZE + 16 - tileLiftXY(it.x, it.y);
    g.fillStyle(def.color, 1); g.fillRect(cx - 6, cy - 6, 12, 12);
    g.lineStyle(1, 0xffffff, 0.85); g.strokeRect(cx - 6, cy - 6, 12, 12);
  }
}

// [character-render lane] Avatar sizing, NPC role loadouts, creature variants,
// and the per-frame draw-state deriver moved to src/render/characters.js
// (imported at the top). The draw LOOP below still lives here because it's
// coupled to the Phaser scene / graphics / camera `upright()`.

// Draw `fn` "billboarded" upright: counter-rotate the Graphics about the world
// point (px, py) by the camera's rotation so characters (and their HP bars) never
// appear sideways/upside-down when the camera spins. The camera then rotates it
// back, netting screen-upright. No-op when the camera isn't rotated. The pivot is
// the character's feet, so they stay planted while the body swings upright.
function upright(g, px, py, fn) {
  const r = scene.cameras.main.rotation;
  if (!r) { fn(); return; }
  g.save();
  g.translateCanvas(px, py);
  g.rotateCanvas(-r);
  g.translateCanvas(-px, -py);
  fn();
  g.restore();
}

// HP bar + aggro "!" marker — module-level so the occlusion seam can reuse them.
function charHpBar(g, cx, feetY, ratio, w) {
  const by = feetY - AV_TOP;
  g.fillStyle(0x550000, 1); g.fillRect(cx - w / 2, by, w, 4);
  g.fillStyle(0x33cc33, 1); g.fillRect(cx - w / 2, by, w * ratio, 4);
}
function aggroMark(g, cx, feetY) {
  const y = feetY - AV_TOP - 9;
  g.fillStyle(0xff2b2b, 0.95); g.fillTriangle(cx - 4, y - 4, cx + 4, y - 4, cx, y + 3);
  g.fillStyle(0xffffff, 1); g.fillRect(cx - 0.8, y - 3.5, 1.6, 3.2); g.fillRect(cx - 0.8, y + 0.6, 1.6, 1.4);
}

// ===========================================================================
// OCCLUSION SEAM (for the World-Gen lane) — [character-render lane]
// Characters and world objects currently draw on separate layers, so a
// character always paints over a tree even when standing *behind* it. To make
// them occlude correctly, interleave both by feet-y in ONE pass. This module
// exposes the pieces so World-Gen can drop that in without touching avatar
// internals, and I don't touch object drawing:
//
//   const chars = collectCharacters(scene.time.now); // [{ ent, y }], y-sorted
//   // give each visible object an item { y: <object feet-y>, obj } and merge:
//   [...objectItems, ...chars].sort((a,b) => a.y - b.y).forEach(it =>
//     it.ent ? drawCharacter(g, it.ent, time) : drawObject(g, it.obj));
//   drawProjectiles(g, time); // arrows on top, after the merged pass
//
// drawCharacter() is self-contained (avatar + hp bar + aggro marker + the
// player's projectile-spawn & skill-FX side effects). Draw onto whichever
// Graphics you interleave on. Nothing here mutates sim state.
// ===========================================================================
function collectCharacters(time) {
  const p = Game.player;
  const list = [];
  for (const n of Game.activeNpcs) {
    if (n.dead) {
      if (!n._wasDead) { n._wasDead = true; n._deathAt = time; }
      if ((time - n._deathAt) / 700 >= 1) continue; // topple finished; hidden until respawn
    } else if (n._wasDead) { n._wasDead = false; n._deathAt = null; } // revived
    list.push({ ent: n, y: n.py + AV_FEET - tileLiftXY(n.tileX, n.tileY) });
  }
  list.push({ ent: p, y: p.py + AV_FEET - tileLiftXY(p.tileX, p.tileY) });
  list.sort((a, b) => a.y - b.y); // farther (smaller y) first, nearer on top
  return list;
}

function drawCharacter(g, ent, time) {
  const p = Game.player, isP = ent === p;
  const feetY = ent.py + AV_FEET - tileLiftXY(ent.tileX, ent.tileY); // ride the raised terrain
  if (!isP && ent.dead) {
    const st = avatarStateFor(ent, false, time);
    st.anim = 'dead'; st.phase = (time - ent._deathAt) / 700;
    upright(g, ent.px, feetY, () => drawAvatar(g, ent.px, feetY, st));
    return;
  }
  let st, skillObj = null;
  if (isP) {
    skillObj = playerSkillTarget();
    st = avatarStateFor(p, true, time, skillObj);
    // spawn an arrow the moment a ranged swing fires (p._swingAt stamped this frame)
    if (st.weaponStyle === 'ranged' && p._swingAt === time && p.combatTarget && !p.combatTarget.dead) {
      projectiles.push({ x: p.px, y: p.py - 8, tx: p.combatTarget.px, ty: p.combatTarget.py - 8, at: time, dur: 220 });
    }
  } else {
    st = avatarStateFor(ent, false, time);
  }
  upright(g, ent.px, feetY, () => {
    drawAvatar(g, ent.px, feetY, st);
    if (isP) charHpBar(g, ent.px, feetY, Game.hp / Game.maxHp, 26);
    else if (ent.type === 'guard' && (ent.hp < ent.maxHp || ent.target)) charHpBar(g, ent.px, feetY, ent.hp / ent.maxHp, 24);
    if (!isP && ent.target === p) aggroMark(g, ent.px, feetY);
  });
  if (isP && skillObj) drawSkillFx(g, skillObj, time); // node FX stays in world space
}

function drawProjectiles(g, time) {
  if (!projectiles.length) return;
  projectiles = projectiles.filter((pr) => {
    const k = (time - pr.at) / pr.dur;
    if (k >= 1) return false;
    const x = pr.x + (pr.tx - pr.x) * k, y = pr.y + (pr.ty - pr.y) * k;
    const ang = Math.atan2(pr.ty - pr.y, pr.tx - pr.x);
    const ax = Math.cos(ang) * 7, ay = Math.sin(ang) * 7;
    g.lineStyle(2, 0x6b4325, 1);
    g.beginPath(); g.moveTo(x - ax, y - ay); g.lineTo(x + ax, y + ay); g.strokePath();
    g.fillStyle(0xdadfe4, 1); g.fillCircle(x + ax, y + ay, 1.7); // arrowhead
    return true;
  });
}

function drawEntities() {
  const g = entitiesGfx; g.clear();
  const time = scene.time.now;
  for (const item of collectCharacters(time)) drawCharacter(g, item.ent, time);
  drawProjectiles(g, time);
}

// [labels] Greedy vertical anti-overlap for head labels. Higher-priority labels
// (player, combat target) are placed first and keep their natural height; lower
// ones that would collide are pushed straight up in ~one-line steps until clear.
// Works in world units (label.width/height are pre-zoom), so it holds at any zoom.
const LABEL_LINE = 12; // world-units bump per stacking step (~one text line)
function declutterLabels(labels) {
  const order = labels.slice().sort((a, b) => (b.prio - a.prio) || (a.y - b.y));
  const placed = [];
  for (const L of order) {
    let guard = 0, moved = true;
    while (moved && guard++ < 24) {
      moved = false;
      for (const q of placed) {
        const minGap = (L.w + q.w) / 2 + 4;         // horizontal footprint overlap
        if (Math.abs(L.x - q.x) < minGap && Math.abs(L.y - q.y) < LABEL_LINE) {
          L.y = q.y - LABEL_LINE; moved = true;      // bump up above the blocker
        }
      }
    }
    placed.push(L);
  }
}

// [economy lane] Which NPCs get a floating label. Named AI characters (service /
// quest NPCs, type 'elder') always show one; mobs (type 'guard') only when the
// cursor is over them OR you're actively fighting them, so combat stays readable
// without every enemy on screen wearing a nameplate.
function npcLabelShown(n, p) {
  if (n.type !== 'guard') return true;
  const hov = hoverTile && n.tileX === hoverTile.tx && n.tileY === hoverTile.ty;
  return hov || n === p.combatTarget || n.target === p;
}

// "Next up" chip: tracked quest's current objective (or its giver, if not yet
// started). Cheap — only touches the DOM when the text actually changes.
let goalChipText = '';
function updateGoalChip() {
  const chip = document.getElementById('goal-chip');
  if (!chip) return;
  let text = '';
  const id = trackedQuestId();
  const q = id && questById(id);
  const st = q && Game.questState && Game.questState[id];
  if (q && st) {
    if (st.status === 'active') {
      const step = activeStep(id);
      if (step) text = `▶ ${q.name}: ${step.text}${step.where && step.where.name ? ' — ' + step.where.name : ''}`;
    } else if (st.status === 'available' && q.giver) {
      text = `▶ New quest: ${q.name} — talk to ${q.giver.name} (!)`;
    }
  }
  // M3: the active slayer contract rides the same chip (second line).
  const c = contractState();
  if (c && c.done < c.need) text += `${text ? '\n' : ''}Contract: ${c.done}/${c.need} ${c.name} — ${c.region}`;
  if (text !== goalChipText) {
    goalChipText = text;
    chip.textContent = text;
    chip.style.display = text ? 'block' : 'none';
  }
}

// The daylight curve: hour -> a multiply colour. Piecewise: night 21-05 (moonlit
// blue), dawn 05-08 (warming gold), day 08-18 (clear), dusk 18-21 (amber fade).
let lastDaylightMin = -1;
function updateDaylight() {
  const dl = document.getElementById('daylight-overlay');
  if (!dl || !Game.worldClock) return;
  const t = Game.worldClock.timeOfDay();
  const minute = (t * 24 * 60) | 0;
  if (minute === lastDaylightMin) return;   // colour shifts once a game-minute
  lastDaylightMin = minute;
  const h = t * 24;
  const lerp = (a, b, k) => a + (b - a) * Math.max(0, Math.min(1, k));
  const NIGHT = [125, 135, 190], DAY = [255, 255, 255], DAWN = [255, 216, 165], DUSK = [255, 190, 140];
  let c;
  if (h < 5) c = NIGHT;
  else if (h < 6.5) c = NIGHT.map((v, i) => lerp(v, DAWN[i], (h - 5) / 1.5));
  else if (h < 8) c = DAWN.map((v, i) => lerp(v, DAY[i], (h - 6.5) / 1.5));
  else if (h < 18) c = DAY;
  else if (h < 19.5) c = DAY.map((v, i) => lerp(v, DUSK[i], (h - 18) / 1.5));
  else if (h < 21) c = DUSK.map((v, i) => lerp(v, NIGHT[i], (h - 19.5) / 1.5));
  else c = NIGHT;
  dl.style.background = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  // interiors are torch-lit — steady warm dim regardless of the sky
  if (Game.world && Game.world.interior) dl.style.background = 'rgb(205,180,150)';
}

function updateLabels() {
  const p = Game.player;
  updateGoalChip();
  updateDaylight();
  // World-space labels ride the rotating main camera; spin them back so the text
  // stays upright and readable at any camera angle (no-op when rotation is 0).
  const rot = -scene.cameras.main.rotation;
  // [labels] Gather every visible head-label (player + nearby NPCs) so we can
  // DE-OVERLAP them: in a tight melee scrum the name/level tags would otherwise
  // pile on top of each other. We nudge colliding labels upward so they stack
  // legibly, letting the player and the current combat target keep their spot.
  Game.myCombat = playerCombatLevel(); // [presence lane] shared with the heartbeat
  playerLabel.setText(`${Game.account || 'Gork'} (Lv ${Game.myCombat})`);
  const labelSet = [{
    t: playerLabel, x: p.px,
    y: p.py + AV_FEET - AV_TOP - 4 - tileLiftXY(p.tileX, p.tileY),
    w: playerLabel.width, prio: 2,
  }];
  // Pooled NPC labels: gather the nearest live NPCs (from the active set only), then
  // hand each a pooled text object. Capped at 50 so a dense mob field can't spawn
  // hundreds of text objects — closest first, which is what the player cares about.
  const nearNpcs = [];
  for (const n of Game.activeNpcs) { if (!n.dead && manhattan(n.tileX, n.tileY, p.tileX, p.tileY) <= 18) nearNpcs.push(n); }
  nearNpcs.sort((a, b) => manhattan(a.tileX, a.tileY, p.tileX, p.tileY) - manhattan(b.tileX, b.tileY, p.tileX, p.tileY));
  if (nearNpcs.length > 50) nearNpcs.length = 50;
  const shownNpcs = nearNpcs.filter((n) => npcLabelShown(n, p));
  for (let i = 0; i < shownNpcs.length; i++) {
    const n = shownNpcs[i];
    let t = npcLabelPool[i];
    if (!t) {
      t = scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold' }).setOrigin(0.5, 1).setDepth(40);
      t.setStroke('#000', 3); npcLabelPool.push(t);
      if (uiCam) uiCam.ignore(t);
    }
    t.setText(npcLabelText(n)).setColor(n.type === 'player' ? '#8fd0ff' : n.type === 'elder' ? '#d8b0ff' : '#ffb0b0').setVisible(true);
    labelSet.push({ t, x: n.px, y: n.py + AV_FEET - AV_TOP - 2 - tileLiftXY(n.tileX, n.tileY), w: t.width, prio: (n === p.combatTarget || n.target === p) ? 1 : 0 });
  }
  for (let i = shownNpcs.length; i < npcLabelPool.length; i++) npcLabelPool[i].setVisible(false);
  declutterLabels(labelSet);
  for (const L of labelSet) L.t.setPosition(L.x, L.y).setRotation(rot);
  // Object labels: nearest labeled visible objects, pooled.
  // Assets: only the object under the cursor shows its label (no world clutter).
  const hovO = hoverTile ? Game.world.objectAt.get(hoverTile.tx + ',' + hoverTile.ty) : null;
  const near = (hovO && hovO.label && manhattan(hovO.x, hovO.y, p.tileX, p.tileY) <= 14) ? [hovO] : [];
  for (let i = 0; i < near.length; i++) {
    let t = objLabelPool[i];
    if (!t) {
      t = scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '10px', color: '#d8d0b8' })
        .setOrigin(0.5, 0).setDepth(3);
      t.setStroke('#000', 3); objLabelPool.push(t);
      if (uiCam) uiCam.ignore(t); // HUD camera must not double-draw world labels
    }
    const o = near[i];
    t.setText(o.label).setPosition(o.x * TILE_SIZE + 16, o.y * TILE_SIZE + TILE_SIZE - 1 - tileLiftXY(o.x, o.y))
      .setRotation(rot).setVisible(true);
  }
  for (let i = near.length; i < objLabelPool.length; i++) objLabelPool[i].setVisible(false);
  syncGroundLabels();
}

function syncGroundLabels() {
  const rot = -scene.cameras.main.rotation;
  for (let i = groundLabels.length - 1; i >= 0; i--) {
    const t = groundLabels[i];
    if (!Game.groundItems.includes(t.__g)) { t.destroy(); groundLabels.splice(i, 1); }
    else t.setRotation(rot);
  }
  for (const gi of Game.groundItems) {
    if (gi._text) continue;
    const def = ITEMS[gi.id];
    gi._text = scene.add.text(gi.x * TILE_SIZE + 16, gi.y * TILE_SIZE - 1 - tileLiftXY(gi.x, gi.y),
      def.name + (gi.qty > 1 ? ' x' + gi.qty : ''), { fontFamily: 'monospace', fontSize: '10px', color: '#f2e3a0' })
      .setOrigin(0.5, 1).setDepth(41).setRotation(rot);
    gi._text.setStroke('#000', 3); gi._text.__g = gi;
    if (uiCam) uiCam.ignore(gi._text); // keep off the HUD camera
    groundLabels.push(gi._text);
  }
}

// ---------------------------------------------------------------- minimap POIs
// [char-render] Points of interest surfaced on the minimap so players can find
// transport + shops. Transport objects are placed into world.objects by the
// travel lane (o.transport); shops sit at static SHOP_POSTS tiles. Cached per
// world (recomputed after a re-login rebuilds the world).
let _poiCache = null, _poiCacheWorld = null;
function collectPOIs() {
  if (_poiCache && _poiCacheWorld === Game.world) return _poiCache;
  const list = [];
  for (const o of Game.world.objects) {
    if (o.transport) list.push({ tx: o.x, ty: o.y, kind: o.kind }); // portal|cart|minecart
  }
  for (const xy of Object.values(SHOP_POSTS)) list.push({ tx: xy[0], ty: xy[1], kind: 'shop' });
  _poiCache = list; _poiCacheWorld = Game.world;
  return list;
}
function poiColor(kind) {
  return kind === 'portal' ? 0xdd3355 : kind === 'minecart' ? 0xb8b8b8 : kind === 'shop' ? 0xffcf3f : 0xc08a4a;
}
// Small, legible icons (drawn on the minimap graphics `g` at screen px mx,my).
function drawPOIIcon(g, mx, my, kind) {
  g.fillStyle(0x000000, 0.55); g.fillCircle(mx, my, 4.6); // dark backing for contrast
  if (kind === 'portal') {
    g.lineStyle(1.4, 0xff6b7a, 0.95); g.strokeCircle(mx, my, 3.4);
    g.fillStyle(0xaa2233, 1); g.fillCircle(mx, my, 2.1);
  } else if (kind === 'cart' || kind === 'minecart') {
    g.fillStyle(kind === 'minecart' ? 0xb8b8b8 : 0xc08a4a, 1);
    g.fillRect(mx - 3.2, my - 2, 6.4, 3);                  // wagon body
    g.fillStyle(0x141414, 1); g.fillCircle(mx - 1.9, my + 1.8, 1); g.fillCircle(mx + 1.9, my + 1.8, 1); // wheels
  } else { // shop — a gold coin
    g.fillStyle(0xffcf3f, 1); g.fillCircle(mx, my, 3.1);
    g.lineStyle(1, 0x7a5a10, 1); g.strokeCircle(mx, my, 3.1);
    g.fillStyle(0x7a5a10, 1); g.fillRect(mx - 0.5, my - 1.6, 1, 3.2); // coin slot / $ hint
  }
}

// ---------------------------------------------------------------- local minimap
// A zoomed view centered on the player — a bit wider than the screen view.
function drawMinimap() {
  const g = miniGfx; g.clear();
  // [mobile] Hidden on phones — clear the graphics + the compass label and bail.
  if (minimapHidden()) { if (compassN) compassN.setVisible(false); return; }
  if (compassN) compassN.setVisible(true);
  const p = Game.player;
  const { ox, oy, cx, cy } = miniGeom();
  const ter = Game.world.terrain, W = Game.world.W, H = Game.world.H;
  const R = Math.ceil((MINI_SIZE / 2) / MINI_SPT) + 1;
  const inMini = (mx, my) => mx >= ox - MINI_SPT && mx <= ox + MINI_SIZE && my >= oy - MINI_SPT && my <= oy + MINI_SIZE;
  const toMiniX = (wpx) => cx + ((wpx - p.px) / TILE_SIZE) * MINI_SPT;
  const toMiniY = (wpy) => cy + ((wpy - p.py) / TILE_SIZE) * MINI_SPT;

  // terrain window. At wide (zoomed-out) minimap zoom, sample every Nth tile and
  // draw a bigger cell — the tile window grows as 1/MINI_SPT^2, so without this a
  // zoomed-out minimap tanks fps. [char-render] added with minimap zoom.
  const step = MINI_SPT >= 5 ? 1 : MINI_SPT >= 3 ? 1 : 2;
  const cell = MINI_SPT * step + 0.5;
  for (let ty = p.tileY - R; ty <= p.tileY + R; ty += step) {
    if (ty < 0 || ty >= H) continue;
    for (let tx = p.tileX - R; tx <= p.tileX + R; tx += step) {
      if (tx < 0 || tx >= W) continue;
      const mx = toMiniX(tx * TILE_SIZE + 16) - MINI_SPT / 2;
      const my = toMiniY(ty * TILE_SIZE + 16) - MINI_SPT / 2;
      if (!inMini(mx, my)) continue;
      g.fillStyle(TERRAIN_DEFS[ter[ty * W + tx]].color, 1);
      g.fillRect(mx, my, cell, cell);
    }
  }
  // resource/structure dots
  for (const o of objectsInView(Game.world, Math.max(0, p.tileX - R), Math.max(0, p.tileY - R),
      Math.min(W - 1, p.tileX + R), Math.min(H - 1, p.tileY + R))) {
    if (o.type === 'decor') continue;
    const mx = toMiniX(o.x * TILE_SIZE + 16), my = toMiniY(o.y * TILE_SIZE + 16);
    if (!inMini(mx, my)) continue;
    g.fillStyle(o.depleted ? 0x555555 : o.color, 1); g.fillRect(mx - 1, my - 1, 2.5, 2.5);
  }
  // entities (active set covers a larger radius than the minimap ever shows)
  for (const n of Game.activeNpcs) {
    if (n.dead) continue;
    if (manhattan(n.tileX, n.tileY, p.tileX, p.tileY) > R + 1) continue;
    const mx = toMiniX(n.px), my = toMiniY(n.py);
    if (!inMini(mx, my)) continue;
    g.fillStyle(n.type === 'elder' ? 0xc080ff : 0xff3030, 1); g.fillRect(mx - 1.5, my - 1.5, 3, 3);
  }
  // [economy lane] quest markers — gold pip = a giver with a quest to START,
  // green pip = your current objective. Off-view targets clamp to the minimap
  // edge as a directional arrow so you always know which way to go.
  const half = MINI_SIZE / 2;
  for (const qm of resolveQuestMarkers()) {
    const col = qm.kind === 'available' ? 0xffd23f : 0x7be04a;
    const mx = toMiniX(qm.tx * TILE_SIZE + 16), my = toMiniY(qm.ty * TILE_SIZE + 16);
    if (inMini(mx, my)) {
      drawQuestPip(g, mx, my, col);
    } else {
      let dx = mx - cx, dy = my - cy;
      const mag = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
      const k = (half - 5) / mag;
      drawQuestArrow(g, cx + dx * k, cy + dy * k, Math.atan2(dy, dx), col);
    }
  }
  // [char-render] POI icons — transport (portal/carts) at every zoom; shops only
  // when zoomed in (declutter). In-view → icon; off-view transport → an edge
  // arrow so you can head toward it. Shapes: coin = shop, wagon = cart / mine
  // cart, red ring = blood portal.
  const showShops = MINI_SPT >= 5;
  for (const poi of collectPOIs()) {
    const isShop = poi.kind === 'shop';
    if (isShop && !showShops) continue;
    const mx = toMiniX(poi.tx * TILE_SIZE + 16), my = toMiniY(poi.ty * TILE_SIZE + 16);
    if (inMini(mx, my)) {
      drawPOIIcon(g, mx, my, poi.kind);
    } else if (!isShop) { // only the handful of transports get directional arrows
      const dx2 = mx - cx, dy2 = my - cy;
      const mag2 = Math.max(Math.abs(dx2), Math.abs(dy2)) || 1;
      const k2 = (half - 5) / mag2;
      drawQuestArrow(g, cx + dx2 * k2, cy + dy2 * k2, Math.atan2(dy2, dx2), poiColor(poi.kind));
    }
  }
  // [world-map parity] facility icons — bank/cooking range/furnace/anvil/altar/
  // exchange/quest board etc. as colored pips (same categories + colours as the
  // world map's legend). Shown at default zoom+; hidden only when fully zoomed
  // out (declutter). Shops/transports are drawn above.
  const showFacilities = MINI_SPT >= 3;
  if (showFacilities) {
    for (const f of facilityPOIs()) {
      const mx = toMiniX(f.tx * TILE_SIZE + 16), my = toMiniY(f.ty * TILE_SIZE + 16);
      if (!inMini(mx, my)) continue;
      g.fillStyle(0x000000, 0.5); g.fillCircle(mx, my, 3.6);
      g.fillStyle(f.color, 1); g.fillCircle(mx, my, 2.3);
    }
  }
  // player at center
  g.fillStyle(0xffffff, 1); g.fillRect(cx - 2, cy - 2, 4, 4);
  // frame
  g.lineStyle(2, 0x000000, 0.85); g.strokeRect(ox - 1, oy - 1, MINI_SIZE + 2, MINI_SIZE + 2);
  g.lineStyle(1, 0xe0c050, 0.5); g.strokeRect(ox - 1, oy - 1, MINI_SIZE + 2, MINI_SIZE + 2);

  drawCompass(g);
}

// [economy lane] Resolve quest-marker descriptors to world tiles. `npc` markers
// track wherever that NPC currently stands; otherwise use the descriptor's x/y.
function resolveQuestMarkers() {
  const out = [];
  for (const m of questMarkers()) {
    let tx = m.x, ty = m.y;
    if (m.npc) {
      const n = Game.npcs.find((e) => e.id === m.npc && !e.dead);
      if (n) { tx = n.tileX; ty = n.tileY; }
    }
    if (tx === undefined || ty === undefined) continue;
    out.push({ tx, ty, kind: m.kind, label: m.label });
  }
  return out;
}

// A diamond quest pip on the minimap (Phaser Graphics).
function drawQuestPip(g, x, y, col) {
  g.fillStyle(0x000000, 0.45); g.fillCircle(x, y + 0.5, 5);
  const pts = [{ x, y: y - 4.5 }, { x: x + 4.5, y }, { x, y: y + 4.5 }, { x: x - 4.5, y }];
  g.fillStyle(col, 1); g.fillPoints(pts, true);
  g.lineStyle(1, 0x000000, 0.9); g.strokePoints(pts, true);
}

// An edge arrow pointing toward an off-view quest target.
function drawQuestArrow(g, x, y, ang, col) {
  const ax = Math.cos(ang), ay = Math.sin(ang), px = -ay, py = ax, s = 5;
  const pts = [
    { x: x + ax * s, y: y + ay * s },
    { x: x - ax * s + px * s * 0.7, y: y - ay * s + py * s * 0.7 },
    { x: x - ax * s - px * s * 0.7, y: y - ay * s - py * s * 0.7 },
  ];
  g.fillStyle(col, 1); g.fillPoints(pts, true);
  g.lineStyle(1, 0x000000, 0.85); g.strokePoints(pts, true);
}

// Compass dial drawn on the minimap (HUD camera). The needle points where world-
// north appears in the main view: the camera rotates rendered content by
// +cam.rotation on screen (same fact the label counter-rotation uses), so north
// (screen-up when unrotated) sits at that angle. Red half = north, pale = south.
function drawCompass(g) {
  const c = compassGeom();
  const rot = scene.cameras.main.rotation;
  const nx = Math.sin(rot), ny = -Math.cos(rot);   // north dir on screen
  const px = -ny, py = nx;                          // perpendicular (needle width)
  const nl = c.r - 3, w = 3;

  // dial
  g.fillStyle(0x141210, 0.86); g.fillCircle(c.x, c.y, c.r);
  g.lineStyle(1.5, 0xe0c050, 0.75); g.strokeCircle(c.x, c.y, c.r);
  // needle — north (red) then south (pale), two triangles meeting at the hub
  g.fillStyle(0xff5a45, 1);
  g.beginPath();
  g.moveTo(c.x + nx * nl, c.y + ny * nl);
  g.lineTo(c.x + px * w, c.y + py * w);
  g.lineTo(c.x - px * w, c.y - py * w);
  g.closePath(); g.fillPath();
  g.fillStyle(0xd8d0b8, 1);
  g.beginPath();
  g.moveTo(c.x - nx * nl, c.y - ny * nl);
  g.lineTo(c.x + px * w, c.y + py * w);
  g.lineTo(c.x - px * w, c.y - py * w);
  g.closePath(); g.fillPath();
  g.fillStyle(0x141210, 1); g.fillCircle(c.x, c.y, 1.6); // hub

  // "N" marker just past the north tip, upright on the HUD camera
  if (compassN) compassN.setPosition(c.x + nx * (nl + 5), c.y + ny * (nl + 5));
}

// ---------------------------------------------------------------- world map overlay
function wireWorldMap() {
  const overlay = document.getElementById('worldmap-overlay');
  const canvas = document.getElementById('worldmap-canvas');
  const btn = document.getElementById('map-btn');
  const close = document.getElementById('wm-close');
  const open = () => { drawWorldMap(canvas); overlay.hidden = false; };
  const hide = () => { overlay.hidden = true; };
  btn.onclick = open;
  close.onclick = hide;
  overlay.onclick = (e) => { if (e.target === overlay) hide(); };
  // Guard: create() can run again after a re-login; bind the window-level key
  // handler only once so it doesn't stack across sessions.
  if (wireWorldMap._keyBound) return;
  wireWorldMap._keyBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
    else if ((e.key === 'm' || e.key === 'M') && document.activeElement === document.body) {
      overlay.hidden ? open() : hide();
    }
  });
  // Click the map to set a walk route toward that world tile.
  canvas.onclick = (e) => {
    const r = canvas.getBoundingClientRect();
    const wx = Math.floor(((e.clientX - r.left) / r.width) * WORLD_W);
    const wy = Math.floor(((e.clientY - r.top) / r.height) * WORLD_H);
    walkTo(Math.max(0, Math.min(WORLD_W - 1, wx)), Math.max(0, Math.min(WORLD_H - 1, wy)));
    Game.log(`Travelling toward (${wx}, ${wy})…`);
    hide();
  };
}

function drawWorldMap(canvas) {
  const ctx = canvas.getContext('2d');
  const cw = canvas.width, ch = canvas.height;
  const ter = Game.world.terrain, W = Game.world.W, H = Game.world.H;
  const sx = cw / W, sy = ch / H;
  ctx.fillStyle = '#0c0c0a'; ctx.fillRect(0, 0, cw, ch);

  // terrain (sampled)
  const step = 3;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      ctx.fillStyle = hexCss(TERRAIN_DEFS[ter[y * W + x]].color);
      ctx.fillRect(x * sx, y * sy, step * sx + 1, step * sy + 1);
    }
  }
  // objects from real data — trees/ore/fishing/structures as specks so forests,
  // mines and camps are visible on the map (no labels needed to read them)
  if (SHOW_RESOURCE_MARKERS) {
    // decor first, faint, as ground texture so open grass isn't flat
    ctx.globalAlpha = 0.5;
    for (const o of Game.world.objects) {
      if (o.type !== 'decor') continue;
      ctx.fillStyle = hexCss(o.color);
      ctx.fillRect(o.x * sx - 0.4, o.y * sy - 0.4, 1.0, 1.0);
    }
    ctx.globalAlpha = 1;
    // trees / ore / fishing / structures on top
    for (const o of Game.world.objects) {
      if (o.type === 'decor') continue;
      ctx.fillStyle = hexCss(o.color);
      ctx.fillRect(o.x * sx - 0.7, o.y * sy - 0.7, 1.6, 1.6);
    }
  }

  // optional debug region bounds (soft anchor circles) — off by default
  if (SHOW_REGION_BOUNDS) {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    for (const a of REGION_ANCHORS) { ctx.beginPath(); ctx.arc(a.x * sx, a.y * sy, a.r * sx, 0, Math.PI * 2); ctx.stroke(); }
  }
  // landmark dots
  ctx.fillStyle = '#e0c050';
  for (const lm of LANDMARKS) ctx.fillRect(lm.x * sx - 2, lm.y * sy - 2, 4, 4);
  // region name labels (at anchors) — labels are an overlay, not the map itself
  if (SHOW_LABELS) {
    ctx.font = '11px monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,245,205,0.92)'; ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
    for (const a of REGION_ANCHORS) ctx.fillText(a.name, a.x * sx, a.y * sy);
    ctx.shadowBlur = 0;
  }
  // nearby enemies
  const p = Game.player;
  ctx.fillStyle = '#ff3030';
  for (const n of Game.activeNpcs) {
    if (n.dead || n.type === 'elder') continue;
    if (manhattan(n.tileX, n.tileY, p.tileX, p.tileY) > ACTIVATE + 4) continue;
    ctx.fillRect(n.tileX * sx - 1.5, n.tileY * sy - 1.5, 3, 3);
  }
  // [economy lane] quest markers — gold "!" = a giver to start a quest, green "!"
  // = your current objective's location. Drawn on top so they read at a glance.
  for (const qm of resolveQuestMarkers()) {
    const x = qm.tx * sx, y = qm.ty * sy;
    ctx.fillStyle = qm.kind === 'available' ? '#ffd23f' : '#7be04a';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 6, y);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#241a00'; ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('!', x, y + 0.5);
  }
  // [char-render] POI icons — same set as the minimap: coin = shop, wagon = cart/
  // mine cart, red ring = blood portal. Clustered so the dense town shops don't
  // pile into one gold blob (each town district collapses to one marker).
  for (const c of clusterPOIs(collectPOIs(), 16)) {
    drawWorldPOIIcon(ctx, c.tx * sx, c.ty * sy, c.kind);
  }
  drawWorldMapLegend(ctx);
  // player marker (white ring)
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(p.tileX * sx, p.tileY * sy, 5, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(p.tileX * sx - 1, p.tileY * sy - 1, 2, 2);
}

// [char-render] Merge same-kind POIs within `thresh` tiles into one marker, so
// clusters (e.g. all the town shops) read as a single icon on the world map.
function clusterPOIs(pois, thresh) {
  const out = [];
  for (const poi of pois) {
    let hit = null;
    for (const c of out) {
      if (c.kind === poi.kind && Math.abs(c.tx - poi.tx) <= thresh && Math.abs(c.ty - poi.ty) <= thresh) { hit = c; break; }
    }
    if (hit) { hit.tx = (hit.tx * hit.n + poi.tx) / (hit.n + 1); hit.ty = (hit.ty * hit.n + poi.ty) / (hit.n + 1); hit.n++; }
    else out.push({ tx: poi.tx, ty: poi.ty, kind: poi.kind, n: 1 });
  }
  return out;
}

// Canvas-2D versions of the minimap POI icons (the world map uses a 2D context,
// not Phaser graphics). Fixed pixel size so they stay legible at world scale.
function drawWorldPOIIcon(ctx, x, y, kind) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
  if (kind === 'portal') {
    ctx.strokeStyle = '#ff6b7a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#aa2233'; ctx.beginPath(); ctx.arc(x, y, 2.8, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'cart' || kind === 'minecart') {
    ctx.fillStyle = kind === 'minecart' ? '#b8b8b8' : '#c08a4a';
    ctx.fillRect(x - 5, y - 3.2, 10, 5);
    ctx.fillStyle = '#141414';
    ctx.beginPath(); ctx.arc(x - 3, y + 2.6, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 3, y + 2.6, 1.6, 0, Math.PI * 2); ctx.fill();
  } else { // shop coin
    ctx.fillStyle = '#ffcf3f'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7a5a10'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#7a5a10'; ctx.fillRect(x - 0.8, y - 2.6, 1.6, 5.2);
  }
}

// A small legend in the world map's top-left so the icons make sense at a glance.
function drawWorldMapLegend(ctx) {
  const rows = [['shop', 'Shops'], ['cart', 'Cart / Mine cart'], ['portal', 'Blood portal'], ['quest', 'Quest']];
  const x = 10, w = 148, rh = 19, top = 10;
  ctx.fillStyle = 'rgba(10,10,8,0.72)'; ctx.strokeStyle = 'rgba(224,192,80,0.5)'; ctx.lineWidth = 1;
  ctx.fillRect(x - 4, top - 4, w, rows.length * rh + 8); ctx.strokeRect(x - 4, top - 4, w, rows.length * rh + 8);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = 'bold 11px monospace';
  let y = top + rh / 2;
  for (const [kind, label] of rows) {
    if (kind === 'quest') { // match economy's gold quest diamond
      ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 6, y - 5); ctx.lineTo(x + 11, y); ctx.lineTo(x + 6, y + 5); ctx.lineTo(x + 1, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else { drawWorldPOIIcon(ctx, x + 6, y, kind); }
    ctx.fillStyle = '#e9e2cf'; ctx.fillText(label, x + 20, y);
    y += rh;
  }
}

// ---------------------------------------------------------------- boot
const config = {
  type: Phaser.AUTO,
  backgroundColor: '#161616',
  scale: { mode: Phaser.Scale.RESIZE, parent: 'game-canvas', width: '100%', height: '100%' },
  scene: { create, update },
};

// The Phaser game is created on login and destroyed on logout, so the running
// world always belongs to the signed-in account. The session layer decides when.
let phaserGame = null;
function startGame() {
  if (phaserGame) return;
  phaserGame = new Phaser.Game(config);
}
function stopGame() {
  stopPresence(); // [presence lane] end heartbeat + clear remote players on logout
  if (R3D && window.__r3d) { try { window.__r3d.dispose(); } catch (_) {} } // [r3d] tear down the 3D canvas
  if (Game.ticker) Game.ticker.stop();
  if (phaserGame) { phaserGame.destroy(true); phaserGame = null; }
  scene = null;
  Game.scene = null;
  // Drop handles to now-destroyed Phaser objects; create() rebuilds them.
  objLabelPool = [];
  npcLabelPool = [];
  groundLabels = [];
  projectiles = [];
  playerLabel = null;
}

// [economy lane] The shared GE + shop world state is saved alongside every player
// save (autosave / tab-close / logout), so `savedAt` stays fresh for offline drift.
registerSaver(saveWorldMarket);
registerSaver(saveWorldShops);
registerSaver(Farming.saveWorldFarms);
initSession({ onStart: startGame, onStop: stopGame });
