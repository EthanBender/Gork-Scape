// src/ui/skillGuide.js
// The Skill Guide — click a skill in the Skills tab to open a per-skill reference:
// what you UNLOCK at each level, the RECIPES that skill makes (how to build them),
// and WHERE to train it (gathering nodes + their regions). RuneScape's skill guide,
// but wired to this game's real data.
//
// Self-contained overlay + injected CSS + a single exported entry point, the same
// pattern as wiki.js and the tinker workbench, so it stays out of the contested
// panels.js (which only calls openSkillGuide). Everything is derived live from
// GameData (level_unlocks / recipes / world_nodes / firemaking) plus the two code
// recipe webs the JSON doesn't carry: Tinkering (tinkering.js) and Alchemy's
// brew-to-discover grimoire (alchemy.js). Economy/items lane.

import { GameData, splitList, parseInputs } from '../data/gameData.js';
import { ITEMS } from '../items/equipment.js';
import { Game } from '../engine/state.js';
import { levelProgress } from '../engine/skills.js';
import { RECIPES as TINKER_RECIPES } from '../systems/tinkering.js';
import { allRecipes as alchRecipes, isDiscovered as alchDiscovered, tonicDesc } from '../systems/alchemy.js';
import { skillIcon } from './icons.js'; // crafted SVG skill glyphs — no emoji chrome (CLAUDE.md)

// A one-line "how you train it" blurb per skill so the guide reads as a guide,
// not just a data dump. Falls back to a generic line for anything unlisted.
const TRAIN_BLURB = {
  Woodcutting: 'Chop trees with a hatchet or battle axe. Higher tiers need a better tool and more levels.',
  Fishing: 'Fish at the spots below with the matching gear (net, rod, harpoon or cage).',
  Mining: 'Mine rocks and ore veins with a pickaxe. Gem nodes also want a chisel.',
  Farming: 'Plant seeds in allotment patches, then return once real time has passed to harvest.',
  Cooking: 'Cook raw food on a fire or range. Watch your level — low levels burn more.',
  Firemaking: 'Light logs with a tinderbox to make a fire. Better logs give more XP and burn longer.',
  Smithing: 'Smelt ore into bars at a furnace, then hammer bars into gear at an anvil.',
  Crafting: 'Turn raw materials into planks, gear and goods at the sawmill, loom and crafting bench.',
  Alchemy: 'Brew reagents in the cauldron to DISCOVER tonic recipes, and dissolve items for coins (High-Alch).',
  Tinkering: 'Scavenge and process odd materials, then build gadgets and ammo at the workbench.',
  Attack: 'Trained by landing melee hits. Unlocks let you wield stronger weapons.',
  Strength: 'Trained by dealing melee damage. Raises your max hit.',
  Defence: 'Trained by being attacked in melee. Unlocks heavier armour.',
  Ranged: 'Trained by landing ranged hits with a bow and arrows.',
  Prayer: 'Trained by burying bones or offering them at an altar.',
  Hitpoints: 'Trained automatically as you deal damage in any combat style. Level = your max HP.',
};

const nameOf = (id) => {
  const it = ITEMS[id]; if (it && it.name) return it.name;
  const m = GameData.item && GameData.item(id); if (m && m.display_name) return m.display_name;
  return id;
};
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// The database keys skill data lowercase (woodcutting). Game skill names are
// Capitalized. For every trainable skill the key is just the lowercase name;
// Alchemy and Tinkering carry no level_unlocks/recipes JSON (their content lives
// in code) and are handled by their own section builders below.
const dbKey = (name) => name.toLowerCase();

// ---- section data builders (each returns an array of row objects) ----------

function unlocksFor(name, level) {
  const key = dbKey(name);
  return (GameData.levelUnlocks || [])
    .filter((u) => u.skill === key && u.display_name)
    .sort((a, b) => a.level - b.level || String(a.display_name).localeCompare(b.display_name))
    .map((u) => ({
      level: u.level,
      name: u.display_name,
      kind: u.unlock_type === 'world_node' ? 'node' : 'item',
      open: level >= u.level,
    }));
}

// Normalize the various recipe shapes (recipes.json / firemaking.json /
// tinkering RECIPES / alchemy grimoire) into one row: { level, out, outName,
// station, xp, inputs:[{label, qty}], open, note }.
function recipesFor(name, level) {
  const key = dbKey(name);

  if (name === 'Tinkering') {
    return Object.values(TINKER_RECIPES || {})
      .map((r) => ({
        level: r.level || 1, out: r.output, outName: nameOf(r.output), station: 'workbench',
        xp: r.xp, outQty: r.outQty || 1,
        inputs: (r.inputs || []).map((i) => ({ label: i.id ? nameOf(i.id) : `any ${i.any}`, qty: i.qty || 1 })),
        open: level >= (r.level || 1),
      }))
      .sort((a, b) => a.level - b.level || a.outName.localeCompare(b.outName));
  }

  if (name === 'Alchemy') {
    // Brew-to-discover: undiscovered recipes stay secret (you learn them by
    // experimenting in the cauldron), so we tease them rather than spoil them.
    return (alchRecipes() || []).map((r) => {
      const known = alchDiscovered(r.id);
      return {
        level: 1, out: r.out, outName: known ? nameOf(r.out) : '??? — undiscovered',
        station: 'cauldron', xp: r.xp, outQty: 1,
        inputs: known ? r.ings.map((id) => ({ label: nameOf(id), qty: 1 })) : [{ label: 'brew to discover', qty: 0 }],
        open: true, note: known ? tonicDesc(r.out) : 'Combine reagents in the cauldron to learn this.',
      };
    });
  }

  if (name === 'Firemaking') {
    return (GameData.firemakingList() || [])
      .filter((f) => (f.related_skill || 'firemaking') === key)
      .map((f) => ({
        level: f.level_requirement || 1, out: f.log_id, outName: f.display_name || nameOf(f.log_id),
        station: f.station || 'fire', xp: f.xp_reward, outQty: 1,
        inputs: [{ label: f.display_name || nameOf(f.log_id), qty: 1 }],
        open: level >= (f.level_requirement || 1), note: f.fire_seconds ? `burns ${f.fire_seconds}s` : '',
      }))
      .sort((a, b) => a.level - b.level);
  }

  // Everything else reads recipes.json by related_skill.
  return (GameData.recipes || [])
    .filter((r) => r.related_skill === key)
    .map((r) => ({
      level: r.level_requirement || 1, out: r.output_item_id, outName: nameOf(r.output_item_id),
      station: r.station, xp: r.xp_reward, outQty: r.output_qty || 1,
      inputs: (parseInputs(r.inputs) || []).map((i) => ({ label: nameOf(i.id), qty: i.qty || 1 })),
      open: level >= (r.level_requirement || 1),
    }))
    .sort((a, b) => a.level - b.level || a.outName.localeCompare(b.outName));
}

function nodesFor(name, level) {
  const key = dbKey(name);
  return (GameData.worldNodes || [])
    .filter((n) => n.related_skill === key)
    .map((n) => ({
      level: n.level_requirement || 1,
      name: n.display_name || n.node_id,
      tool: n.required_tool || '',
      region: String(n.region || '').split(';')[0],
      yields: splitList(n.outputs).map(nameOf).join(', '),
      open: level >= (n.level_requirement || 1),
    }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

// ---- rendering -------------------------------------------------------------

function injectCss() {
  if (document.getElementById('skg-css')) return;
  const s = document.createElement('style');
  s.id = 'skg-css';
  s.textContent = `
  .skg-body { max-height:min(70vh,560px); overflow-y:auto; }
  .skg-blurb { color:#cdc3a6; font-size:12px; line-height:1.5; margin:2px 0 6px; }
  .skg-sec { margin-top:14px; }
  .skg-sec > h3 { margin:0 0 6px; font-size:11px; letter-spacing:.5px; text-transform:uppercase;
    color:#b8863a; border-bottom:1px solid #0d0c08; padding-bottom:3px; }
  .skg-rec { display:flex; align-items:baseline; gap:8px; font-size:12px; padding:3px 0; line-height:1.4; }
  .skg-rec.locked { opacity:.5; }
  .skg-rlvl { flex:0 0 34px; color:#8a8168; text-align:right; font-variant-numeric:tabular-nums; }
  .skg-rmain { flex:1; color:#d8d0be; }
  .skg-rmain b { color:#efe8d4; }
  .skg-rmeta { color:#8a8168; }
  .skg-rstate { flex:0 0 auto; }
  .skg-none { color:#8a8168; font-style:italic; font-size:12px; }
  `;
  document.head.appendChild(s);
}

function recipeRowHtml(r) {
  const ins = r.inputs.length
    ? r.inputs.map((i) => `${esc(i.label)}${i.qty > 1 ? ` ×${i.qty}` : ''}`).join(' + ')
    : '—';
  const meta = [r.station ? `at ${esc(r.station)}` : '', r.xp ? `+${r.xp} xp` : '', r.note ? esc(r.note) : '']
    .filter(Boolean).join(' · ');
  return `<div class="skg-rec ${r.open ? '' : 'locked'}">
    <span class="skg-rlvl">Lv ${r.level}</span>
    <span class="skg-rmain"><b>${esc(r.outName)}${r.outQty > 1 ? ` ×${r.outQty}` : ''}</b>
      — ${ins} <span class="skg-rmeta">${meta ? '· ' + meta : ''}</span></span>
    <span class="skg-rstate">${r.open ? '✓' : '·'}</span>
  </div>`;
}

function nodeRowHtml(n) {
  const meta = [n.tool ? esc(n.tool) : '', n.region ? esc(n.region) : '', n.yields ? '→ ' + esc(n.yields) : '']
    .filter(Boolean).join(' · ');
  return `<div class="skg-rec ${n.open ? '' : 'locked'}">
    <span class="skg-rlvl">Lv ${n.level}</span>
    <span class="skg-rmain"><b>${esc(n.name)}</b> <span class="skg-rmeta">${meta ? '· ' + meta : ''}</span></span>
    <span class="skg-rstate">${n.open ? '✓' : '·'}</span>
  </div>`;
}

function unlockRowHtml(u) {
  return `<div class="sg-row ${u.open ? 'sg-open' : 'sg-locked'}">
    <span class="sg-lvl">${u.level}</span>
    <span class="sg-name">${esc(u.name)}</span>
    <span class="sg-kind">${u.kind}</span>
    <span class="sg-state">${u.open ? '✓' : '·'}</span>
  </div>`;
}

function section(title, count, rowsHtml, emptyMsg) {
  return `<div class="skg-sec"><h3>${esc(title)}${count ? ` (${count})` : ''}</h3>${
    rowsHtml || `<div class="skg-none">${esc(emptyMsg || '—')}</div>`}</div>`;
}

export function openSkillGuide(name) {
  injectCss();
  const sk = name === 'Hitpoints' ? Game.hitpoints : Game.skills[name];
  const level = levelProgress((sk && sk.xp) || 0).level;
  const xp = Math.floor((sk && sk.xp) || 0);

  const unlocks = unlocksFor(name, level);
  const recipes = recipesFor(name, level);
  const nodes = nodesFor(name, level);
  const next = GameData.nextSkillUnlock(dbKey(name), level);

  // "Recipes" reads better as "Grimoire" for Alchemy and stays "Recipes" elsewhere.
  const recipeTitle = name === 'Alchemy' ? 'Grimoire' : 'Recipes you can make';
  const locTitle = name === 'Fishing' ? 'Fishing spots' : 'Where to train it';

  // Which sections carry content. A skill makes recipes if it has any, or is one
  // of the artisan/brew/tinker skills whose section we always surface.
  const showRecipes = recipes.length > 0
    || ['Cooking', 'Smithing', 'Crafting', 'Firemaking', 'Alchemy', 'Tinkering'].includes(name);
  const showNodes = nodes.length > 0;

  const bodyParts = [`<div class="skg-blurb">${esc(TRAIN_BLURB[name] || 'Train this skill to unlock more.')}</div>`];
  if (next) bodyParts.push(`<div class="skg-blurb">Next unlock: <b>${esc(next.display_name)}</b> at level ${next.level}.</div>`);
  // Show the unlocks section when it has rows, or as the fallback for a skill
  // with no recipes/locations (so the guide is never blank).
  if (unlocks.length || (!showRecipes && !showNodes)) {
    bodyParts.push(section('Unlocks by level', unlocks.length, unlocks.map(unlockRowHtml).join(''),
      'No level unlocks are recorded for this skill.'));
  }
  if (showRecipes) {
    bodyParts.push(section(recipeTitle, recipes.length, recipes.map(recipeRowHtml).join(''),
      'Nothing to craft with this skill.'));
  }
  if (showNodes) {
    bodyParts.push(section(locTitle, nodes.length, nodes.map(nodeRowHtml).join(''), ''));
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const panel = document.createElement('div');
  panel.className = 'modal-panel';
  panel.onclick = (e) => e.stopPropagation();
  panel.innerHTML = `
    <div class="modal-head">
      <span class="modal-title">${skillIcon(name)} ${esc(name)} — Level ${level}/99</span>
      <button class="modal-close" aria-label="Close">✕</button>
    </div>
    <div class="modal-sub">${xp.toLocaleString()} xp · ✓ available now · · locked</div>
    <div class="modal-body skill-guide skg-body">${bodyParts.join('')}</div>`;
  overlay.appendChild(panel);

  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  overlay.onclick = () => close();
  panel.querySelector('.modal-close').onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}
