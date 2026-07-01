// src/systems/alchemy.js
// The Alchemy skill — a goblin blend of RuneScape's Magic (alching) and Herblore
// (potion-making), themed around mushroom-cap tonics. Two branches, one skill:
//
//   1. BREWING — combine ingredients in the cauldron to make tonics. Recipes are
//      DISCOVERED by experimentation: try a combo, and if it matches a hidden
//      recipe you learn it (permanent, bonus xp); otherwise it curdles to sludge.
//   2. TRANSMUTATION — "dissolve" any item into coins (High-Alch), a coin
//      source + item sink that feeds the Grand Exchange economy.
//
// Designed as a HUB skill: ingredients come from other skills (mushroom caps &
// spores foraged in the Mushroom Forest, bones from combat, more to come), and
// the tonics buff other systems back (Stamina Tonic restores the run energy the
// movement system tracks, Restore heals HP, Antidote cures poison).
//
// Self-contained by design (economy/items lane): registers its own items into
// the ITEMS registry at import time, persists discovered recipes to localStorage,
// and renders its own panel. See COORDINATION.md.

import { Game, addItem, grantXp } from '../engine/state.js';
import { ITEMS } from '../items/equipment.js';
import { ensureRun } from '../engine/run.js';
import { GameData } from '../data/gameData.js';

// ---- items (injected into the shared registry; won't clobber existing ids) ----
const A_ITEMS = {
  mushroom_cap: { name: 'Mushroom Cap', color: 0xb5794a, reagent: true, value: 4 },
  bright_spore: { name: 'Bright Spore', color: 0x7ad06a, reagent: true, value: 6 },
  glow_spore:   { name: 'Glow Spore',   color: 0xe0c050, reagent: true, value: 6 },
  murk_spore:   { name: 'Murk Spore',   color: 0x9a6abf, reagent: true, value: 6 },
  alchemical_sludge: { name: 'Alchemical Sludge', color: 0x5a5240, value: 2 },
  stamina_tonic: { name: 'Stamina Tonic', color: 0x4fae5a, tonic: 'stamina', value: 35 },
  restore_tonic: { name: 'Restore Tonic', color: 0xd23a3a, tonic: 'restore', value: 35 },
  antidote:      { name: 'Antidote',      color: 0x9a6abf, tonic: 'antidote', value: 25 },
};
for (const [id, d] of Object.entries(A_ITEMS)) {
  if (!ITEMS[id]) ITEMS[id] = { id, slot: null, stackable: true, value: d.value ?? 5, ...d };
}

// Existing items from OTHER skills that also work as reagents (cross-pollination).
const CROSS_REAGENTS = new Set(['bones']);
export function isReagent(id) {
  return !!(ITEMS[id] && ITEMS[id].reagent) || CROSS_REAGENTS.has(id);
}

// ---- recipes (discovered by experimentation) ----
// key = sorted ingredient ids joined; order-independent.
const RECIPES = [
  { id: 'stamina_tonic', out: 'stamina_tonic', xp: 30, ings: ['mushroom_cap', 'bright_spore'] },
  { id: 'restore_tonic', out: 'restore_tonic', xp: 35, ings: ['mushroom_cap', 'bones'] },        // bones ← combat/prayer
  { id: 'antidote',      out: 'antidote',      xp: 40, ings: ['mushroom_cap', 'murk_spore'] },
];
const keyOf = (ids) => ids.slice().sort().join('+');
const RECIPE_BY_KEY = new Map(RECIPES.map((r) => [keyOf(r.ings), r]));
export function allRecipes() { return RECIPES; }

// ---- discovered-recipe state (persisted per account) ----
function storeKey() { return 'ge_alchemy_' + (Game.account || 'default'); }
function loadDiscovered() {
  try { return JSON.parse(localStorage.getItem(storeKey()) || '[]'); } catch { return []; }
}
function saveDiscovered() {
  try { localStorage.setItem(storeKey(), JSON.stringify(Game.alchemy.discovered)); } catch { /* ignore */ }
}
export function ensureAlchemy() {
  if (!Game.alchemy) Game.alchemy = { discovered: loadDiscovered() };
  return Game.alchemy;
}
export function isDiscovered(id) { return ensureAlchemy().discovered.includes(id); }

// ---- inventory helpers (qty-aware; the base countItem counts slots not qty) ----
export function haveCount(id) {
  return Game.inventory.reduce((n, s) => n + (s && s.id === id ? (s.stackable ? s.qty : 1) : 0), 0);
}
function takeOne(id) {
  const inv = Game.inventory;
  const i = inv.findIndex((s) => s && s.id === id);
  if (i < 0) return false;
  const s = inv[i];
  if (s.stackable && s.qty > 1) s.qty -= 1;
  else { inv[i] = null; if (Game.selectedInv === i) Game.selectedInv = null; }
  return true;
}
function alchLevel() { return Game.skills.Alchemy ? Game.skills.Alchemy.level : 1; }

// ---- foraging: get a mushroom cap + a random spore (richer in the Mushroom Forest) ----
const SPORES = ['bright_spore', 'glow_spore', 'murk_spore'];
export function forageSpores() {
  ensureAlchemy();
  const inMushroom = /mushroom/i.test(Game.location || '');
  addItem('mushroom_cap', 1);
  const spore = SPORES[Math.floor(Math.random() * SPORES.length)];
  addItem(spore, 1);
  grantXp('Alchemy', inMushroom ? 8 : 4);
  Game.log(inMushroom
    ? `You forage a Mushroom Cap and a ${ITEMS[spore].name} from the fungal grove.`
    : `You scrape up a Mushroom Cap and a ${ITEMS[spore].name}. (Spores grow richer in the Mushroom Forest.)`);
  return { cap: 'mushroom_cap', spore };
}

// ---- brewing (experimentation) ----
export function brew(ids) {
  ensureAlchemy();
  if (!ids || ids.length < 2) return { ok: false, msg: 'Add at least two ingredients to the cauldron.' };
  const need = {};
  for (const id of ids) need[id] = (need[id] || 0) + 1;
  for (const id in need) {
    if (haveCount(id) < need[id]) return { ok: false, msg: `You don't have enough ${ITEMS[id]?.name || id}.` };
  }
  for (const id in need) for (let k = 0; k < need[id]; k++) takeOne(id);

  const r = RECIPE_BY_KEY.get(keyOf(ids));
  if (r) {
    addItem(r.out, 1);
    const already = Game.alchemy.discovered.includes(r.id);
    if (!already) {
      Game.alchemy.discovered.push(r.id);
      saveDiscovered();
      const xp = r.xp * 2; // discovery bonus
      grantXp('Alchemy', xp);
      Game.log(`✨ You discover a new brew — ${ITEMS[r.out].name}! (+${xp} Alchemy xp)`);
      return { ok: true, discovered: true, out: r.out };
    }
    grantXp('Alchemy', r.xp);
    Game.log(`You brew a ${ITEMS[r.out].name}. (+${r.xp} Alchemy xp)`);
    return { ok: true, out: r.out };
  }
  // no recipe → sludge, but you still learn a little from the attempt
  addItem('alchemical_sludge', 1);
  grantXp('Alchemy', 4);
  Game.log('The mixture curdles into useless sludge. (+4 Alchemy xp)');
  return { ok: true, out: 'alchemical_sludge', sludge: true };
}

// ---- drinking tonics ----
export function tonicDesc(id) {
  const k = ITEMS[id] && ITEMS[id].tonic;
  return k === 'stamina' ? '+40% run energy'
    : k === 'restore' ? '+8 HP'
    : k === 'antidote' ? 'cures poison' : '';
}
export function drinkTonic(id) {
  const def = ITEMS[id];
  const kind = def && def.tonic;
  if (!kind || haveCount(id) < 1) return { ok: false };
  takeOne(id);
  if (kind === 'stamina') {
    const r = ensureRun();
    r.energy = Math.min(100, r.energy + 40);
    Game.log('You down the Stamina Tonic — your legs feel fresh (+40% run energy).');
  } else if (kind === 'restore') {
    const heal = Math.max(0, Math.min(Game.maxHp - Game.hp, 8));
    Game.hp += heal;
    Game.log(`You drink the Restore Tonic (+${heal} HP).`);
  } else if (kind === 'antidote') {
    Game.poison = 0; Game.poisoned = false;
    Game.log('You drink the Antidote — any venom is neutralised.');
  }
  grantXp('Alchemy', 2);
  return { ok: true };
}

// ---- transmutation / High-Alch: dissolve an item into coins ----
export function alchValue(id) {
  const d = ITEMS[id];
  if (d && typeof d.value === 'number') return d.value;
  const gd = GameData && GameData.item && GameData.item(id);
  return (gd && (gd.gp_value || gd.shop_sell_price)) || 5;
}
export function dissolveValue(id) { return Math.max(1, Math.round(alchValue(id) * 0.5)); }
export function dissolve(id) {
  if (id === 'coins') return { ok: false, msg: "You can't dissolve coins." };
  if (haveCount(id) < 1) return { ok: false };
  takeOne(id);
  const coins = dissolveValue(id);
  addItem('coins', coins);
  const xp = Math.max(1, Math.round(alchValue(id) * 0.15) + 1);
  grantXp('Alchemy', xp);
  Game.log(`You dissolve the ${ITEMS[id]?.name || id} into ${coins} gp. (+${xp} Alchemy xp)`);
  return { ok: true, coins };
}

// ------------------------------------------------------------------ UI panel ----
let selReagents = []; // ingredient ids currently in the cauldron (max 3)

function invUnique(filter) {
  const map = new Map();
  for (const s of Game.inventory) if (s && filter(s.id)) map.set(s.id, haveCount(s.id));
  return [...map.entries()].map(([id, qty]) => ({ id, qty }));
}
function section(title) {
  const d = document.createElement('div');
  d.style.margin = '10px 0';
  const h = document.createElement('div');
  h.className = 'stat-title';
  h.textContent = title;
  d.appendChild(h);
  return d;
}

export function renderAlchemy(view) {
  if (!view) return;
  ensureAlchemy();
  view.innerHTML = '';

  // header: level + forage
  const head = document.createElement('div');
  head.className = 'ge-head';
  head.innerHTML = `<span class="stat-title" style="margin:0">⚗️ Alchemy · Lv ${alchLevel()}</span>`;
  const forage = document.createElement('button');
  forage.className = 'craft-btn';
  forage.textContent = '🍄 Forage';
  forage.onclick = () => { forageSpores(); Game.refresh(); };
  head.appendChild(forage);
  view.appendChild(head);

  // ---- Cauldron ----
  const cauldron = section('Cauldron — add 2–3 ingredients, then brew');
  const chips = document.createElement('div');
  chips.className = 'ge-chips';
  const reagents = invUnique(isReagent);
  if (!reagents.length) {
    chips.innerHTML = `<span class="recipe-inputs">No reagents yet — Forage for caps & spores, or gather bones.</span>`;
  }
  for (const { id, qty } of reagents) {
    const inCauldron = selReagents.filter((x) => x === id).length;
    const chip = document.createElement('button');
    chip.className = 'ge-chip' + (inCauldron ? ' active' : '');
    chip.textContent = `${ITEMS[id].name}${qty > 1 ? ' ×' + qty : ''}${inCauldron ? ' +' + inCauldron : ''}`;
    chip.onclick = () => {
      if (selReagents.length >= 3) { Game.log('The cauldron is full (3 ingredients max).'); return; }
      if (inCauldron >= qty) return; // can't add more than you own
      selReagents.push(id);
      Game.refresh();
    };
    chips.appendChild(chip);
  }
  cauldron.appendChild(chips);

  const selRow = document.createElement('div');
  selRow.className = 'recipe-row';
  selRow.innerHTML = `<div class="recipe-info"><div class="recipe-name">In the cauldron</div>`
    + `<div class="recipe-inputs">${selReagents.length ? selReagents.map((id) => ITEMS[id].name).join(' + ') : 'empty'}</div></div>`;
  const clearBtn = document.createElement('button');
  clearBtn.className = 'station-btn';
  clearBtn.textContent = 'Clear';
  clearBtn.onclick = () => { selReagents = []; Game.refresh(); };
  const brewBtn = document.createElement('button');
  brewBtn.className = 'craft-btn';
  brewBtn.textContent = 'Brew';
  brewBtn.disabled = selReagents.length < 2;
  brewBtn.onclick = () => {
    const res = brew(selReagents.slice());
    if (!res.ok && res.msg) Game.log(res.msg);
    selReagents = [];
    Game.refresh();
  };
  selRow.appendChild(clearBtn);
  selRow.appendChild(brewBtn);
  cauldron.appendChild(selRow);
  view.appendChild(cauldron);

  // ---- Grimoire (discovered recipes) ----
  const grim = section('Grimoire');
  for (const r of RECIPES) {
    const known = Game.alchemy.discovered.includes(r.id);
    const row = document.createElement('div');
    row.className = 'recipe-row' + (known ? '' : ' locked');
    row.innerHTML = `<div class="recipe-info">`
      + `<div class="recipe-name">${known ? ITEMS[r.out].name : '??? Unknown Brew'}</div>`
      + `<div class="recipe-inputs">${known ? r.ings.map((i) => ITEMS[i]?.name || i).join(' + ') : 'Experiment to discover…'}</div>`
      + `</div>`;
    grim.appendChild(row);
  }
  view.appendChild(grim);

  // ---- Tonics on hand ----
  const tonics = invUnique((id) => ITEMS[id] && ITEMS[id].tonic);
  if (tonics.length) {
    const box = section('Tonics');
    for (const { id, qty } of tonics) {
      const row = document.createElement('div');
      row.className = 'recipe-row';
      row.innerHTML = `<div class="recipe-info"><div class="recipe-name">${ITEMS[id].name}${qty > 1 ? ' ×' + qty : ''}</div>`
        + `<div class="recipe-inputs">${tonicDesc(id)}</div></div>`;
      const b = document.createElement('button');
      b.className = 'craft-btn';
      b.textContent = 'Drink';
      b.onclick = () => { drinkTonic(id); Game.refresh(); };
      row.appendChild(b);
      box.appendChild(row);
    }
    view.appendChild(box);
  }

  // ---- Transmute (High-Alch) ----
  const trans = section('Transmute — dissolve items into coins');
  const items = invUnique((id) => id !== 'coins' && !(ITEMS[id] && ITEMS[id].tonic));
  if (!items.length) {
    const p = document.createElement('div');
    p.className = 'recipe-inputs';
    p.textContent = 'Nothing to dissolve.';
    trans.appendChild(p);
  }
  for (const { id, qty } of items) {
    const row = document.createElement('div');
    row.className = 'recipe-row';
    row.innerHTML = `<div class="recipe-info"><div class="recipe-name">${ITEMS[id]?.name || id}${qty > 1 ? ' ×' + qty : ''}</div>`
      + `<div class="recipe-meta">${dissolveValue(id)} gp each</div></div>`;
    const b = document.createElement('button');
    b.className = 'craft-btn';
    b.textContent = 'Dissolve';
    b.onclick = () => { dissolve(id); Game.refresh(); };
    row.appendChild(b);
    trans.appendChild(row);
  }
  view.appendChild(trans);
}
