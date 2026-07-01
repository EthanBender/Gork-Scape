// src/systems/travel.js
// Fast travel — mine carts, cart rides, and a magic portal that whisk the player
// between the hub and the far corners of the world.
//
// TESTING CONVENIENCE for now: instant, free, and always available so you can get
// around the 1000×1000 map quickly. The owner plans to nerf these later — likely
// gate behind fares/unlocks/cooldowns and turn each into a physical boarding point
// (a cart station, a portal tile) you have to reach and interact with.
//
// Self-contained (economy/items lane): builds its own HUD button + popup menu and
// teleports the player, so it needs no panels.js tab. Destination coords come from
// the world's REGION_ANCHORS; we snap to the nearest walkable tile on arrival.

import { Game } from '../engine/state.js';
import { isWalkable, regionAt, TILE_SIZE, WORLD_W, WORLD_H } from '../world/map.js';

const tilePx = (t) => t * TILE_SIZE + TILE_SIZE / 2;

// Destinations (x/y = region centre from worldData REGION_ANCHORS).
export const DESTINATIONS = [
  { id: 'hub',       name: 'Goblin Settlement',    sub: 'Home hub',               icon: '🏠', x: 500, y: 462 },
  { id: 'minehills', name: 'Northern Mine Hills',   sub: 'Mine cart · Mining',     icon: '🛒', x: 610, y: 190 },
  { id: 'choppers',  name: "Chopper's Hollow",      sub: 'Cart · Woodcutting',     icon: '🛒', x: 335, y: 370 },
  { id: 'grublake',  name: 'Grublake',              sub: 'Cart · Fishing',         icon: '🛒', x: 735, y: 495 },
  { id: 'mushroom',  name: 'Mushroom Forest',       sub: 'Magic portal · Alchemy', icon: '🌀', x: 250, y: 800 },
];

// Region centres can land on a tree/rock/water tile — spiral out to the nearest
// walkable tile so the player never arrives stuck inside terrain.
function nearestWalkable(tx, ty) {
  if (!Game.world) return { x: tx, y: ty };
  for (let r = 0; r <= 60; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const x = tx + dx, y = ty + dy;
        if (x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H && isWalkable(Game.world, x, y)) return { x, y };
      }
    }
  }
  return { x: tx, y: ty };
}

export function travelTo(id) {
  const d = DESTINATIONS.find((z) => z.id === id);
  const p = Game.player;
  if (!d || !p) return false;
  const { x, y } = nearestWalkable(d.x, d.y);
  p.tileX = x; p.tileY = y; p.px = tilePx(x); p.py = tilePx(y);
  // cancel anything in progress so the player doesn't immediately path away
  p.path = []; p.combatTarget = null; p.interactTarget = null; p.pickupTarget = null; p.travelTarget = null;
  if (Game.scene && Game.scene.cameras && Game.scene.cameras.main) Game.scene.cameras.main.centerOn(p.px, p.py);
  Game.location = regionAt(x, y);
  const verb = d.icon === '🌀' ? 'step through the shimmering portal to'
    : d.icon === '🏠' ? 'head home to'
    : 'ride the cart to';
  Game.log(`${d.icon} You ${verb} ${d.name}.`);
  if (Game.refresh) Game.refresh();
  closeMenu();
  return true;
}

// ------------------------------------------------------- HUD button + menu ----
let btnEl = null;
let menuEl = null;

function injectStyles() {
  if (document.getElementById('travel-css')) return;
  const s = document.createElement('style');
  s.id = 'travel-css';
  s.textContent = `
  #travel-btn { position:absolute; top:316px; right:12px; width:168px; z-index:6;
    box-sizing:border-box; padding:8px 0; color:#bfe0ff; border:1px solid #3f5a78;
    border-radius:5px; background:linear-gradient(180deg,#2a3446,#1d2532); cursor:pointer;
    font-size:12px; font-weight:700; letter-spacing:.5px; box-shadow:0 2px 6px rgba(0,0,0,.4); }
  #travel-btn:hover { color:#eaf4ff; border-color:#6a90bf; }
  #travel-btn:active { transform:translateY(1px); }
  #travel-menu { position:absolute; top:352px; right:12px; width:212px; z-index:20;
    box-sizing:border-box; background:rgba(18,20,26,.97); border:1px solid #3f5a78;
    border-radius:6px; padding:6px; box-shadow:0 6px 20px rgba(0,0,0,.55); }
  #travel-menu[hidden] { display:none; }
  #travel-menu .tv-title { font-size:11px; color:#8fb0d8; text-transform:uppercase;
    letter-spacing:.5px; padding:4px 6px 6px; }
  .tv-row { display:flex; align-items:center; gap:8px; width:100%; text-align:left;
    padding:7px 8px; margin:2px 0; background:#222a38; border:1px solid #33465e;
    border-radius:4px; color:#e9eef6; cursor:pointer; font-size:12px; }
  .tv-row:hover { background:#2c3a4e; border-color:#5a7ba6; }
  .tv-ico { font-size:16px; }
  .tv-name { font-weight:700; }
  .tv-sub { display:block; font-size:10px; color:#93a3b8; font-weight:400; }
  `;
  document.head.appendChild(s);
}

export function initTravel() {
  if (btnEl) return;
  injectStyles();
  const host = document.getElementById('game-panel') || document.body;

  btnEl = document.createElement('button');
  btnEl.id = 'travel-btn';
  btnEl.title = 'Fast travel (testing)';
  btnEl.textContent = '🧭 TRAVEL';
  btnEl.onclick = toggleMenu;
  host.appendChild(btnEl);

  menuEl = document.createElement('div');
  menuEl.id = 'travel-menu';
  menuEl.hidden = true;
  host.appendChild(menuEl);

  // dismiss when clicking outside the button/menu
  document.addEventListener('pointerdown', (e) => {
    if (!menuEl || menuEl.hidden) return;
    if (e.target === btnEl || menuEl.contains(e.target)) return;
    closeMenu();
  });
}

function buildMenu() {
  menuEl.innerHTML = '<div class="tv-title">Fast Travel</div>';
  for (const d of DESTINATIONS) {
    const row = document.createElement('button');
    row.className = 'tv-row';
    row.innerHTML = `<span class="tv-ico">${d.icon}</span>`
      + `<span><span class="tv-name">${d.name}</span><span class="tv-sub">${d.sub}</span></span>`;
    row.onclick = () => travelTo(d.id);
    menuEl.appendChild(row);
  }
}
export function toggleMenu() {
  if (!menuEl) return;
  if (menuEl.hidden) { buildMenu(); menuEl.hidden = false; } else closeMenu();
}
function closeMenu() { if (menuEl) menuEl.hidden = true; }
