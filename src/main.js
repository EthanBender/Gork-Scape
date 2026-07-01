// src/main.js
// Phaser scene + glue for the 1000x1000 Goblin World. Rendering is viewport-
// culled (terrain + objects + entities), NPC AI only runs near the player, and
// skilling is skill/tool gated. Per-tick simulation runs off a 600ms timer.

import { Ticker, TICK_MS } from './engine/tick.js';
import { initSession, notifyGameReady, registerSaver } from './engine/session.js';
import { applySave } from './engine/save.js';
import * as WorldClock from './engine/worldClock.js';
import {
  generateWorld, isWalkable, findPath, regionAt, objectsInView,
  TILE_SIZE, WORLD_W, WORLD_H, TERRAIN_DEFS, T,
} from './world/map.js';
import { TOOLS, LANDMARKS, REGION_ANCHORS } from './world/worldData.js';

// World-map overlay toggles (PASS 7)
const SHOW_REGION_BOUNDS = false;    // giant region circles — off (debug only)
const SHOW_LABELS = true;            // region name labels
const SHOW_RESOURCE_MARKERS = true;  // trees/ore/fishing specks from real data
import { Player, NPC } from './world/entities.js';
import {
  Game, initState, addItem, grantXp, countItem, removeOneById, removeAt,
  playerProfile, totalBonuses, playerCombatLevel, spawnGroundItem, pickupGroundAt,
  playerAttackRange, needsAmmo, hasAmmoForRanged, consumeAmmo, ammoRecoveryChance,
  drainPrayer, restorePrayer, isProtecting,
} from './engine/state.js';
import { resolveAttack, combatLevel, weaponRange } from './engine/combat.js';
import { RUN_TILES, ensureRun, wantsToRun, updateRunEnergy, toggleRun, updateRunHud } from './engine/run.js';
import { styleOfWeapon, PROTECT_FACTOR } from './engine/prayer.js';
import { rollSkillSuccess } from './engine/skills.js';
import { emptyBonuses, ITEMS } from './items/equipment.js';
import { rollLoot } from './world/loot.js';
import { randInt } from './engine/rng.js';
import { initPanels, showContextMenu, openExchange, openShop } from './ui/panels.js'; // openExchange/openShop [economy lane]
// [economy lane] — combat drops from the database drop tables. See COORDINATION.md.
import { rollMonsterDrops } from './systems/drops.js';
import { monsterIdForSpawn } from './data/worldContract.js';
import { shopkeeperSpawns } from './systems/shops.js'; // [economy lane] shopkeeper NPCs
// [economy lane] — Firemaking: temporary ground fires (lit from inventory in
// panels.js) render here, expire on the global tick, and cook via performSkill.
import { activeFires, tickFires, fireAt, fireLifeRatio } from './systems/firemaking.js';
// [economy lane] — Grand Exchange world state persists globally and drifts while
// everyone is offline; restored + fast-forwarded on login. See geActions.js.
import { loadAndAdvanceWorldMarket, saveWorldMarket } from './systems/geActions.js';
// [character-render lane] — the visible avatar. Pure rendering; reads state only.
import { drawAvatar } from './render/avatar.js';
import { gearHints, weaponStyleFor, bodyTypeFor } from './render/gear.js';

const tilePx = (t) => t * TILE_SIZE + TILE_SIZE / 2;
const manhattan = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);
const ACTIVATE = 46;   // NPC AI/draw radius (tiles) around the player
const COOK_XP = { raw_fish: 30, raw_trout: 70, raw_pike: 90, raw_eel: 110 };
const TOOL_NAME = { axe: 'an axe', pickaxe: 'a pickaxe', net: 'a fishing net', rod: 'a fishing rod', harpoon: 'a harpoon', cage: 'a fishing cage' };

let scene;
let terrainGfx, objectsGfx, groundGfx, entitiesGfx, miniGfx;
let uiCam; // dedicated HUD camera: keeps the minimap upright under main-cam zoom/rotation
let compassN = null; // the "N" marker on the minimap compass
let objLabelPool = [];
let groundLabels = [];
let playerLabel = null;
let projectiles = []; // [character-render lane] in-flight arrows/bolts: {x,y,tx,ty,at,dur}

const MINI_SIZE = 168; // local minimap size in px
const MINI_SPT = 3;    // minimap pixels per world tile (zoom)
const hexCss = (n) => '#' + n.toString(16).padStart(6, '0');

// ---- camera controls (zoom + rotate around the player) --------------------
// ZOOM_MIN = 1 → the starting view is the furthest you can zoom out; you can only
// zoom IN from there (never further out than the native framing).
const ZOOM_MIN = 1, ZOOM_MAX = 2.6, ZOOM_STEP = 0.12;
const ROT_STEP = Math.PI / 12; // 15° per key tap / wheel notch
let targetZoom = 1;            // smoothed-toward values; main cam eases to these
let targetRot = 0;            // radians, accumulates (not wrapped)

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
  // Elder in town.
  const elderLevels = { attack: 1, strength: 1, defence: 1, ranged: 1, hitpoints: 20 };
  Game.npcs.push(new NPC({
    id: 'elder', name: 'Goblin Elder', type: 'elder', tileX: 492, tileY: 448,
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

  // [economy lane] Shopkeepers — one per shop in shops.json, each gating its Shop
  // panel (proximity). Placed on a provisional ring west of spawn; world-gen:
  // relocate each to its themed building using its `region`, keep id
  // `shopkeeper_<shop_id>` so the gate + talk hook still find it.
  shopkeeperSpawns().forEach((sk, k, arr) => {
    const ang = (k / arr.length) * Math.PI * 2;
    Game.npcs.push(new NPC({
      id: sk.npcId, name: sk.shopName + ' Keeper', type: 'elder',
      tileX: world.spawn.x - 4 + Math.round(Math.cos(ang) * 3),
      tileY: world.spawn.y + Math.round(Math.sin(ang) * 3),
      color: 0x8fb8e0, aggressive: false,
      dialog: `Welcome to the ${sk.shopName}!`,
      levels: elderLevels, combatLevel: null, bonuses: emptyBonuses(),
    }));
  });

  // Enemies from region spawn points (name carries region flavour).
  world.enemySpawns.forEach((s, i) => {
    const def = world.ENEMY_TYPES[s.type];
    const levels = { attack: def.att, strength: def.str, defence: def.def, ranged: 1, hitpoints: def.hp };
    Game.npcs.push(new NPC({
      id: 'e' + i, name: s.name || def.name, type: 'guard', tileX: s.x, tileY: s.y, color: def.color,
      monsterId: monsterIdForSpawn(s), // [economy lane] -> database drop table
      wanderRadius: 4, leashRadius: 8, aggressive: false, aggroRange: 4,
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
    world.objects.push(altar);
    world.objectAt.set(altarPos.x + ',' + altarPos.y, altar);
  }

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

function hasTool(toolType) {
  const ids = TOOLS[toolType] || [];
  if (Game.equipment.weapon && ids.includes(Game.equipment.weapon.id)) return true;
  return Game.inventory.some((s) => s && ids.includes(s.id));
}

// ---------------------------------------------------------------- scene create
function create() {
  scene = this;
  Game.scene = this;
  // Re-entrant: a logout destroys the Phaser game and a later login creates a
  // fresh one, re-running create(). Reset module-level pools that held now-
  // destroyed Phaser objects so we don't draw against stale handles.
  objLabelPool = [];
  groundLabels = [];
  projectiles = [];

  initState();
  buildWorld();
  initPanels();

  const ticker = new Ticker();
  ticker.onTick(gameTick);
  Game.ticker = ticker;

  // [world-continuity] The world clock is a pure function of wall-clock time, so
  // day/night keeps turning whether or not anyone is online. Expose it for any
  // lane (world-gen tinting, panels) and mirror it into a topbar readout.
  Game.worldClock = WorldClock;
  mountWorldClockHud();
  ticker.onTick((_c, isLast) => { if (isLast) updateWorldClockHud(); });

  // Overlay the signed-in character's saved state (skills, inventory, position,
  // clock) onto the freshly-built world, then advance the sim clock by the real
  // time the player was away. For a new character this is a no-op.
  applyPendingSave();

  // [economy lane] Restore the shared Grand Exchange world state and fast-forward
  // it over the real time everyone was away — the market kept trading offline.
  restoreWorldMarket();

  ticker.start();

  terrainGfx = this.add.graphics().setDepth(0);
  objectsGfx = this.add.graphics().setDepth(1);
  groundGfx = this.add.graphics().setDepth(1.5);
  entitiesGfx = this.add.graphics().setDepth(2);

  playerLabel = this.add.text(0, 0, '', {
    fontFamily: 'monospace', fontSize: '11px', color: '#bff29a', fontStyle: 'bold',
  }).setOrigin(0.5, 1).setDepth(40);
  playerLabel.setStroke('#000', 3);
  for (const n of Game.npcs) {
    n._label = this.add.text(0, 0, npcLabelText(n), {
      fontFamily: 'monospace', fontSize: '11px',
      color: n.type === 'elder' ? '#d8b0ff' : '#ffb0b0', fontStyle: 'bold',
    }).setOrigin(0.5, 1).setDepth(40).setVisible(false);
    n._label.setStroke('#000', 3);
  }

  miniGfx = this.add.graphics().setScrollFactor(0).setDepth(1001);

  this.cameras.main.setBounds(0, 0, WORLD_W * TILE_SIZE, WORLD_H * TILE_SIZE);
  this.cameras.main.centerOn(Game.player.px, Game.player.py);

  // The minimap lives on its own camera so it stays upright and unscaled while
  // the main camera zooms and rotates. Main cam draws the world (not the HUD);
  // uiCam draws only the HUD (not the world / world-space labels).
  uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
  uiCam.setScroll(0, 0);
  this.cameras.main.ignore(miniGfx);
  uiCam.ignore([terrainGfx, objectsGfx, groundGfx, entitiesGfx, playerLabel,
    ...Game.npcs.map((n) => n._label).filter(Boolean)]);
  this.scale.on('resize', (size) => uiCam.setSize(size.width, size.height));

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

  this.input.mouse.disableContextMenu();
  this.input.on('pointerdown', onPointerDown);
  this.input.on('wheel', onWheel);
  this.input.keyboard.on('keydown', onCameraKey);
  wireWorldMap();

  Game.location = regionAt(Game.player.tileX, Game.player.tileY);
  if (!Game.pendingSave) {
    // First-time intro — a returning player already got a "welcome back".
    Game.log('Welcome to the Goblin Empire, young Gork!');
    Game.log('You stand in the goblin settlement at the heart of the world.');
    Game.log('Explore outward — resources get richer and more dangerous the farther you roam.');
  }
  Game.refresh();

  window.__GE = { Game, startInteract, startAttack, regionAt };

  // Persistence/idle/autosave may start now that saved state is applied.
  notifyGameReady();
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
    x0: Math.max(0, Math.floor((cxw - hx) / TILE_SIZE) - 1),
    y0: Math.max(0, Math.floor((cyw - hy) / TILE_SIZE) - 1),
    x1: Math.min(WORLD_W - 1, Math.ceil((cxw + hx) / TILE_SIZE) + 1),
    y1: Math.min(WORLD_H - 1, Math.ceil((cyw + hy) / TILE_SIZE) + 1),
  };
}

// ---------------------------------------------------------------- minimap geometry
// Shared between drawMinimap() and click-to-navigate so the picture and the hit
// test always agree. The minimap is a player-centred, screen-space HUD element.
function miniGeom() {
  const ox = scene.scale.width - MINI_SIZE - 12, oy = 12;
  return { ox, oy, cx: ox + MINI_SIZE / 2, cy: oy + MINI_SIZE / 2 };
}
function pointerOnMinimap(sx, sy) {
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
  const c = compassGeom();
  const dx = sx - c.x, dy = sy - c.y;
  return dx * dx + dy * dy <= c.r * c.r;
}

// ---------------------------------------------------------------- input
function onPointerDown(pointer) {
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

  const npc = Game.npcs.find((n) => !n.dead && n.tileX === tx && n.tileY === ty);
  const obj = Game.world.objectAt.get(tx + ',' + ty);
  const usableObj = obj && !obj.depleted ? obj : null;
  const ground = Game.groundItems.filter((g) => g.x === tx && g.y === ty);
  const fire = fireAt(tx, ty); // [economy lane] temporary firemaking fire on this tile

  if (pointer.rightButtonDown()) return rightClickMenu(pointer, tx, ty, npc, usableObj, ground, fire);

  if (npc && npc.type === 'elder') return talkTo(npc);
  if (npc && npc.type === 'guard') return startAttack(npc);
  if (usableObj && (usableObj.skill || usableObj.altar)) return startInteract(usableObj);
  if (usableObj) { Game.log(`${usableObj.label}. (Nothing to do here yet.)`); return walkTo(tx, ty); }
  if (fire) return startInteract(fire); // [economy lane] walk to & cook at the fire
  if (ground.length) return startPickup(tx, ty);
  walkTo(tx, ty);
}

// Mouse wheel zooms toward / away from the player.
function onWheel(pointer, over, dx, dy) {
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
    opts.push(['Talk-to ' + npc.name, () => talkTo(npc)]);
  } else if (fire) { // [economy lane] temporary firemaking fire
    opts.push(['Cook at Fire', () => startInteract(fire)]);
  } else if (obj && obj.altar) {
    opts.push([`Offer bones at ${obj.label}`, () => startInteract(obj)]);
  } else if (obj && obj.skill) {
    const verb = { Woodcutting: 'Chop', Fishing: 'Fish', Mining: 'Mine', Smithing: 'Use', Cooking: 'Cook at', Crafting: 'Craft at' }[obj.skill] || 'Use';
    opts.push([`${verb} ${obj.label}`, () => startInteract(obj)]);
  } else if (obj) {
    opts.push(['Examine ' + obj.label, () => Game.log(`${obj.label}.`)]);
  }
  for (const g of (ground || [])) {
    const def = ITEMS[g.id];
    opts.push([`Take ${def.name}${g.qty > 1 ? ' x' + g.qty : ''}`, () => startPickup(tx, ty)]);
  }
  opts.push(['Walk here', () => walkTo(tx, ty)]);
  showContextMenu(pointer.event.clientX, pointer.event.clientY, opts);
}

function clearTargets(p) {
  p.combatTarget = null; p.interactTarget = null; p.pickupTarget = null; p.travelTarget = null;
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

function startPickup(tx, ty) {
  const p = Game.player;
  clearTargets(p);
  p.pickupTarget = { x: tx, y: ty };
  p.path = findPath(Game.world, p.tileX, p.tileY, tx, ty, false);
}

function talkTo(npc) {
  Game.log(`${npc.name}: "${npc.dialog}"`);
  if (npc.id === 'exchange_merchant') openExchange(); // [economy lane] open the GE
  if (npc.id && npc.id.startsWith('shopkeeper_')) openShop(npc.id.replace('shopkeeper_', '')); // [economy lane]
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
    if (n.dead && count >= n.respawnAt) reviveNpc(n);
  }
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

  // --- player movement target -> path ---
  if (p.combatTarget) {
    const t = p.combatTarget;
    // Stop approaching once the target is within the weapon's reach AND in
    // line-of-sight (1 tile for melee, up to 4 for ranged). Re-evaluated each
    // tick, so a ranged attacker halts at max range instead of walking into
    // melee — and keeps closing (routing around walls) until it can see the
    // target when a wall blocks the shot.
    if (t.dead) { p.combatTarget = null; p.path = []; }
    else if (canAttackFrom(world, p, t.tileX, t.tileY, playerAttackRange())) p.path = [];
    else p.path = findPath(world, p.tileX, p.tileY, t.tileX, t.tileY, true);
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
  stepAlongPath(p);
  let ran = false;
  if (running && p.path && p.path.length) { stepAlongPath(p); ran = true; }
  updateRunEnergy(ran);
  p._ranTick = ran; // render interpolates 2× faster on a run tick (see update())

  if (p.pickupTarget && p.tileX === p.pickupTarget.x && p.tileY === p.pickupTarget.y) {
    pickupGroundAt(p.tileX, p.tileY);
    p.pickupTarget = null;
  }

  // --- skilling ---
  if (p.interactTarget && !p.combatTarget) {
    const o = p.interactTarget;
    const dist = manhattan(p.tileX, p.tileY, o.x, o.y);
    // [economy lane] a temp fire is non-blocking, so cook while standing ON it
    // (dist 0) or beside it (dist 1); every other target stays adjacency-only.
    const inReach = o.fire ? dist <= 1 : dist === 1;
    if (!o.depleted && p.path.length === 0 && inReach) {
      performSkill(o, count);
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

  // --- NPC AI (only near the player) ---
  for (const n of Game.npcs) {
    if (n.dead) continue; // revival handled in worldUpkeep()
    if (n.type === 'elder') continue;
    if (manhattan(n.tileX, n.tileY, p.tileX, p.tileY) > ACTIVATE) continue;

    const distPlayer = manhattan(n.tileX, n.tileY, p.tileX, p.tileY);
    const distHome = manhattan(n.tileX, n.tileY, n.homeX, n.homeY);
    if (n.aggressive && distPlayer <= n.aggroRange && distHome <= n.leashRadius) n.target = p;
    if (n.target && (n.target.dead || distHome > n.leashRadius || distPlayer > n.aggroRange + 4)) n.target = null;

    if (n.target) {
      // NPCs attack from their own weapon reach too — a ranged/spear enemy can
      // strike before closing to melee, but ranged enemies still need line-of-
      // sight (they'll advance around cover otherwise). Re-checked each tick.
      const nRange = weaponRange(n);
      if (canAttackFrom(world, n, p.tileX, p.tileY, nRange)) {
        n.path = [];
        if (count - n.lastAttackTick >= n.attackSpeed) { n.lastAttackTick = count; npcAttack(n, count); }
      } else {
        n.path = findPath(world, n.tileX, n.tileY, p.tileX, p.tileY, true);
        stepAlongPath(n);
      }
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

  // --- location name ---
  const loc = regionAt(p.tileX, p.tileY);
  if (loc !== Game.location) { Game.location = loc; Game.log(`You enter: ${loc}.`); }

  // Refresh the DOM once per pump: a catch-up burst (returning to a throttled
  // tab) runs several ticks in a row, but the panels only need the final state.
  if (isLast) Game.refresh();
}

// Altars grant 2.5× the normal burying XP and refill prayer points.
const ALTAR_MULT = 2.5;

function performSkill(o, count) {
  const p = Game.player;

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
      Game.log(`You get ${ITEMS[o.drop].name}. (+${o.xp} ${o.skill} xp)`);
      if (o.deplete && Math.random() < o.deplete) {
        o.depleted = true; o.respawnAt = count + o.respawn; p.interactTarget = null;
        Game.log(`The ${o.label.toLowerCase()} is exhausted for now.`);
      }
    }
    return;
  }

  // Structures: Smithing / Cooking / Crafting
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
  if (weapon && weapon.weaponType === 'ranged') grantXp('Ranged', 4 * dmg);
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
  const r = resolveAttack(playerProfile(), { levels: npc.levels, bonuses: npc.bonuses });
  if (!npc.target) npc.target = Game.player;
  if (r.hit) {
    npc.hp = Math.max(0, npc.hp - r.damage);
    floatText(npc, '-' + r.damage, '#ffe14d');
    Game.log(`You swing at the ${npc.name}... and hit for ${r.damage} damage.`);
    if (r.damage > 0) grantCombatXp(r.damage);
  } else {
    floatText(npc, '0', '#cccccc');
    Game.log(`You swing at the ${npc.name}... but miss.`);
  }
  if (npc.hp <= 0) {
    npc.dead = true; npc.respawnAt = count + 16; npc.target = null;
    Game.log(`You have defeated the ${npc.name}!`);
    if (Game.player.combatTarget === npc) Game.player.combatTarget = null;
    dropLoot(npc, count);
  }
}

function dropLoot(npc, count) {
  // [economy lane] Prefer the database drop table (60 monsters / 302 entries)
  // when this spawn mapped to a monster_id; otherwise fall back to the legacy
  // hardcoded loot table. Item ids are all resolvable (registry hydration).
  const drops = npc.monsterId ? rollMonsterDrops(npc.monsterId)
    : (npc.lootTable ? rollLoot(npc.lootTable) : []);
  for (const d of drops) {
    spawnGroundItem(d.id, d.qty, npc.tileX, npc.tileY, count);
    const def = ITEMS[d.id] || { name: d.id };
    Game.log(`The ${npc.name} drops ${d.qty > 1 ? d.qty + ' ' : ''}${def.name}.`);
  }
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
    floatText(Game.player, '-' + dmg, '#ff5b5b');
    Game.log(`The ${n.name} hits you for ${dmg} damage.`);
  } else {
    floatText(Game.player, '0', '#cccccc');
    Game.log(`The ${n.name} attacks you, but misses.`);
  }
  if (Game.hp <= 0) playerDeath();
}

function playerDeath() {
  Game.log('Oh dear, you are dead! You wake back at the settlement.');
  Game.hp = Game.maxHp;
  Game.activePrayers = [];   // prayers switch off on death
  restorePrayer();           // ...and points recharge
  const s = Game.world.spawn;
  const p = Game.player;
  p.tileX = s.x; p.tileY = s.y; p.px = tilePx(s.x); p.py = tilePx(s.y);
  clearTargets(p); p.path = [];
  for (const n of Game.npcs) n.target = null;
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
  for (const n of Game.npcs) {
    if (n.dead) continue;
    if (manhattan(n.tileX, n.tileY, p.tileX, p.tileY) > ACTIVATE + 4) { n.px = tilePx(n.tileX); n.py = tilePx(n.tileY); continue; }
    approach(n, 'px', tilePx(n.tileX), speed * delta);
    approach(n, 'py', tilePx(n.tileY), speed * delta);
  }

  // Ease zoom/rotation toward their targets so wheel/key input feels smooth,
  // then re-centre on the player (rotation pivots about the view centre = player).
  const cam = this.cameras.main;
  cam.zoom = Phaser.Math.Linear(cam.zoom, targetZoom, 0.18);
  cam.rotation = Phaser.Math.Linear(cam.rotation, targetRot, 0.18);
  cam.centerOn(p.px, p.py);
  drawTerrain();
  drawObjects();
  drawGround();
  drawEntities();
  updateLabels();
  drawMinimap();
  updateRunHud();
}

function approach(o, key, target, maxStep) {
  const d = target - o[key];
  if (Math.abs(d) <= maxStep) o[key] = target;
  else o[key] += Math.sign(d) * maxStep;
}

function drawTerrain() {
  const g = terrainGfx; g.clear();
  const v = viewRange();
  const W = Game.world.W, ter = Game.world.terrain;
  for (let y = v.y0; y <= v.y1; y++) {
    for (let x = v.x0; x <= v.x1; x++) {
      g.fillStyle(TERRAIN_DEFS[ter[y * W + x]].color, 1);
      g.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
}

function drawObjects() {
  const g = objectsGfx; g.clear();
  const v = viewRange();
  for (const o of objectsInView(Game.world, v.x0, v.y0, v.x1, v.y1)) {
    const cx = o.x * TILE_SIZE, cy = o.y * TILE_SIZE;
    if (o.type === 'decor') {
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
    g.fillStyle(o.depleted ? 0x555555 : o.color, 1);
    g.fillRect(cx + 4, cy + 4, TILE_SIZE - 8, TILE_SIZE - 8);
    if (o.label === 'Range' && !o.depleted) { g.fillStyle(0xffd24d, 0.8); g.fillCircle(cx + 16, cy + 16, 5); }
  }

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
  for (const [tx, ty] of p.path || []) g.fillRect(tx * TILE_SIZE + 8, ty * TILE_SIZE + 8, 16, 16);
  if (p.interactTarget && !p.interactTarget.depleted) {
    const o = p.interactTarget;
    g.lineStyle(2, 0xffe14d, 0.9); g.strokeRect(o.x * TILE_SIZE + 1, o.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  }
  if (p.combatTarget && !p.combatTarget.dead) {
    const t = p.combatTarget;
    g.lineStyle(2, 0xff4d4d, 0.9); g.strokeRect(t.tileX * TILE_SIZE + 1, t.tileY * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  }
}

function drawGround() {
  const g = groundGfx; g.clear();
  for (const it of Game.groundItems) {
    const def = ITEMS[it.id];
    const cx = it.x * TILE_SIZE + 16, cy = it.y * TILE_SIZE + 16;
    g.fillStyle(def.color, 1); g.fillRect(cx - 6, cy - 6, 12, 12);
    g.lineStyle(1, 0xffffff, 0.85); g.strokeRect(cx - 6, cy - 6, 12, 12);
  }
}

// [character-render lane] — avatar sizing. The rig is ~30 local px tall and
// bottom-anchored, so we drop the feet a touch below the tile centre.
const AV_SCALE = TILE_SIZE / 26;
const AV_FEET = TILE_SIZE * 0.34;
const AV_TOP = 30 * AV_SCALE + 6;   // head-top offset for HP bars / labels

// NPCs carry no equipment map, so synthesise a light visual loadout by role.
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

function npcGear(n) {
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
function playerSkillTarget() {
  const p = Game.player;
  if (!p || !p.interactTarget || p.combatTarget) return null;
  const o = p.interactTarget;
  if (o.depleted || !o.skill) return null;
  if (manhattan(p.tileX, p.tileY, o.x, o.y) !== 1) return null;
  if (p.path && p.path.length) return null;
  return o;
}

// Gathering particle FX at the node (chips / sparks / ripple), drawn on the
// entity layer so it sits above the world objects.
function drawSkillFx(g, o, time) {
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
function avatarStateFor(e, isPlayer, time, skillObj = null) {
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
  for (const n of Game.npcs) {
    if (manhattan(n.tileX, n.tileY, p.tileX, p.tileY) > ACTIVATE + 4) continue;
    if (n.dead) {
      if (!n._wasDead) { n._wasDead = true; n._deathAt = time; }
      if ((time - n._deathAt) / 700 >= 1) continue; // topple finished; hidden until respawn
    } else if (n._wasDead) { n._wasDead = false; n._deathAt = null; } // revived
    list.push({ ent: n, y: n.py + AV_FEET });
  }
  list.push({ ent: p, y: p.py + AV_FEET });
  list.sort((a, b) => a.y - b.y); // farther (smaller y) first, nearer on top
  return list;
}

function drawCharacter(g, ent, time) {
  const p = Game.player, isP = ent === p;
  const feetY = ent.py + AV_FEET;
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

function updateLabels() {
  const p = Game.player;
  // World-space labels ride the rotating main camera; spin them back so the text
  // stays upright and readable at any camera angle (no-op when rotation is 0).
  const rot = -scene.cameras.main.rotation;
  // labels sit above the avatar head (feet + AV_FEET, up past the rig top)
  playerLabel.setText(`Gork (Lv ${playerCombatLevel()})`)
    .setPosition(p.px, p.py + AV_FEET - AV_TOP - 4).setRotation(rot);
  for (const n of Game.npcs) {
    if (!n._label) continue;
    const near = !n.dead && manhattan(n.tileX, n.tileY, p.tileX, p.tileY) <= 18;
    n._label.setVisible(near);
    if (near) n._label.setPosition(n.px, n.py + AV_FEET - AV_TOP - 2).setRotation(rot);
  }
  // Object labels: nearest labeled visible objects, pooled.
  const v = viewRange();
  const near = objectsInView(Game.world, v.x0, v.y0, v.x1, v.y1)
    .filter((o) => o.label && manhattan(o.x, o.y, p.tileX, p.tileY) <= 12)
    .sort((a, b) => manhattan(a.x, a.y, p.tileX, p.tileY) - manhattan(b.x, b.y, p.tileX, p.tileY))
    .slice(0, 40);
  for (let i = 0; i < near.length; i++) {
    let t = objLabelPool[i];
    if (!t) {
      t = scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '10px', color: '#d8d0b8' })
        .setOrigin(0.5, 0).setDepth(3);
      t.setStroke('#000', 3); objLabelPool.push(t);
      if (uiCam) uiCam.ignore(t); // HUD camera must not double-draw world labels
    }
    const o = near[i];
    t.setText(o.label).setPosition(o.x * TILE_SIZE + 16, o.y * TILE_SIZE + TILE_SIZE - 1)
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
    gi._text = scene.add.text(gi.x * TILE_SIZE + 16, gi.y * TILE_SIZE - 1,
      def.name + (gi.qty > 1 ? ' x' + gi.qty : ''), { fontFamily: 'monospace', fontSize: '10px', color: '#f2e3a0' })
      .setOrigin(0.5, 1).setDepth(41).setRotation(rot);
    gi._text.setStroke('#000', 3); gi._text.__g = gi;
    if (uiCam) uiCam.ignore(gi._text); // keep off the HUD camera
    groundLabels.push(gi._text);
  }
}

// ---------------------------------------------------------------- local minimap
// A zoomed view centered on the player — a bit wider than the screen view.
function drawMinimap() {
  const g = miniGfx; g.clear();
  const p = Game.player;
  const { ox, oy, cx, cy } = miniGeom();
  const ter = Game.world.terrain, W = Game.world.W, H = Game.world.H;
  const R = Math.ceil((MINI_SIZE / 2) / MINI_SPT) + 1;
  const inMini = (mx, my) => mx >= ox - MINI_SPT && mx <= ox + MINI_SIZE && my >= oy - MINI_SPT && my <= oy + MINI_SIZE;
  const toMiniX = (wpx) => cx + ((wpx - p.px) / TILE_SIZE) * MINI_SPT;
  const toMiniY = (wpy) => cy + ((wpy - p.py) / TILE_SIZE) * MINI_SPT;

  // terrain window
  for (let ty = p.tileY - R; ty <= p.tileY + R; ty++) {
    if (ty < 0 || ty >= H) continue;
    for (let tx = p.tileX - R; tx <= p.tileX + R; tx++) {
      if (tx < 0 || tx >= W) continue;
      const mx = toMiniX(tx * TILE_SIZE + 16) - MINI_SPT / 2;
      const my = toMiniY(ty * TILE_SIZE + 16) - MINI_SPT / 2;
      if (!inMini(mx, my)) continue;
      g.fillStyle(TERRAIN_DEFS[ter[ty * W + tx]].color, 1);
      g.fillRect(mx, my, MINI_SPT + 0.5, MINI_SPT + 0.5);
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
  // entities
  for (const n of Game.npcs) {
    if (n.dead) continue;
    if (manhattan(n.tileX, n.tileY, p.tileX, p.tileY) > R + 1) continue;
    const mx = toMiniX(n.px), my = toMiniY(n.py);
    if (!inMini(mx, my)) continue;
    g.fillStyle(n.type === 'elder' ? 0xc080ff : 0xff3030, 1); g.fillRect(mx - 1.5, my - 1.5, 3, 3);
  }
  // player at center
  g.fillStyle(0xffffff, 1); g.fillRect(cx - 2, cy - 2, 4, 4);
  // frame
  g.lineStyle(2, 0x000000, 0.85); g.strokeRect(ox - 1, oy - 1, MINI_SIZE + 2, MINI_SIZE + 2);
  g.lineStyle(1, 0xe0c050, 0.5); g.strokeRect(ox - 1, oy - 1, MINI_SIZE + 2, MINI_SIZE + 2);

  drawCompass(g);
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
  for (const n of Game.npcs) {
    if (n.dead || n.type === 'elder') continue;
    if (manhattan(n.tileX, n.tileY, p.tileX, p.tileY) > ACTIVATE + 4) continue;
    ctx.fillRect(n.tileX * sx - 1.5, n.tileY * sy - 1.5, 3, 3);
  }
  // player marker (white ring)
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(p.tileX * sx, p.tileY * sy, 5, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(p.tileX * sx - 1, p.tileY * sy - 1, 2, 2);
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
  if (Game.ticker) Game.ticker.stop();
  if (phaserGame) { phaserGame.destroy(true); phaserGame = null; }
  scene = null;
  Game.scene = null;
  // Drop handles to now-destroyed Phaser objects; create() rebuilds them.
  objLabelPool = [];
  groundLabels = [];
  projectiles = [];
  playerLabel = null;
}

// [economy lane] The shared GE world state is saved alongside every player save
// (autosave / tab-close / logout), so its `savedAt` stays fresh for offline drift.
registerSaver(saveWorldMarket);
initSession({ onStart: startGame, onStop: stopGame });
