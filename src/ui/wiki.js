// src/ui/wiki.js
// The Codex / Wiki — a searchable in-game reference for every item: what it is,
// its stats, WHERE IT COMES FROM (drops / gathering nodes / recipes / shops) and
// WHAT IT'S FOR (recipes it feeds, how it equips/eats). Self-contained overlay +
// injected CSS + a HUD button, so it does NOT touch the contested panels.js
// (same pattern as the Tinker workbench). Also opened from an inventory item's
// right-click "Look up" (panels.js adds that action).
//
// Everything is derived live from GameData (items/recipes/nodes/monsters/drops/
// shops) + the ITEMS registry + the Tinkering recipe web. Economy/items lane.

import { GameData, splitList, parseInputs } from '../data/gameData.js';
import { ITEMS, itemView } from '../items/equipment.js';
import { RECIPES as TINKER_RECIPES } from '../systems/tinkering.js';

let mounted = false;
let indexes = null;

const nameOf = (id) => {
  const it = ITEMS[id]; if (it && it.name) return it.name;
  const m = GameData.item && GameData.item(id); if (m && m.display_name) return m.display_name;
  return id;
};

// Build reverse lookups once: item id -> where it's from / what it's used in.
function buildIndexes() {
  if (indexes) return indexes;
  const dropsByItem = new Map();   // id -> [{ monster, chance }]
  const nodesByItem = new Map();   // id -> [node]
  const madeBy = new Map();        // id -> [recipe-ish]
  const usedIn = new Map();        // id -> [recipe-ish]
  const shopsByItem = new Map();   // id -> [{ shop, region, buy }]
  const push = (map, id, v) => { if (!map.has(id)) map.set(id, []); map.get(id).push(v); };

  for (const row of (GameData.dropTables || [])) {
    if (row.item_id) push(dropsByItem, row.item_id, { monster: row.monster_id, chance: row.chance_percent });
  }
  for (const n of (GameData.worldNodes || [])) {
    for (const out of splitList(n.outputs)) push(nodesByItem, out, n);
  }
  for (const r of (GameData.recipes || [])) {
    const out = r.output_item_id;
    const inputs = parseInputs(r.inputs) || [];
    const rec = { id: r.recipe_id, output: out, outQty: r.output_qty || 1, station: r.station, skill: r.related_skill, level: r.level_requirement, xp: r.xp_reward, inputs: inputs.map((i) => ({ id: i.id, qty: i.qty })) };
    if (out) push(madeBy, out, rec);
    for (const inp of inputs) if (inp.id) push(usedIn, inp.id, rec);
  }
  // Tinkering recipe web (separate registry): output + inputs.
  for (const r of Object.values(TINKER_RECIPES || {})) {
    const rec = { id: r.id, output: r.output, outQty: r.outQty || 1, station: 'workbench', skill: 'Tinkering', level: r.level, xp: r.xp, inputs: (r.inputs || []).map((i) => ({ id: i.id, any: i.any, qty: i.qty })) };
    push(madeBy, r.output, rec);
    for (const inp of (r.inputs || [])) if (inp.id) push(usedIn, inp.id, rec);
  }
  for (const row of (GameData.shops || [])) {
    if (row.item_id) push(shopsByItem, row.item_id, { shop: row.shop_name || row.shop_id, region: row.region, buy: row.buy_price });
  }
  indexes = { dropsByItem, nodesByItem, madeBy, usedIn, shopsByItem };
  return indexes;
}

function injectCss() {
  if (document.getElementById('wiki-css')) return;
  const s = document.createElement('style');
  s.id = 'wiki-css';
  s.textContent = `
  #wiki-btn { position:absolute; right:10px; top:10px; z-index:30; cursor:pointer;
    background:linear-gradient(#3a2c1e,#2e2417); color:#e0b44a; font-family:"Fredoka",sans-serif; font-weight:600;
    border:1px solid #6b4a2a; border-radius:10px; padding:6px 12px; font-size:12px;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.08), 0 2px 5px rgba(0,0,0,.4); transition:filter .1s; }
  #wiki-btn:hover { filter:brightness(1.12); }
  #wiki-overlay { position:absolute; inset:0; z-index:70; display:flex; align-items:center;
    justify-content:center; background:rgba(0,0,0,.6); }
  #wiki-overlay[hidden] { display:none; }
  .wk-panel { width:min(760px,94%); height:min(84%,720px); display:flex; flex-direction:column;
    background:linear-gradient(#2b2117,#211910); border:1px solid #4a3927; border-radius:16px;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.05), 0 26px 60px rgba(0,0,0,.6); color:#ebdfc8;
    font-family:"Nunito",sans-serif; }
  .wk-head { display:flex; align-items:center; gap:8px; padding:12px 14px; border-bottom:1px solid #3c2e1f; }
  .wk-head h2 { margin:0; font-family:"Fredoka",sans-serif; font-weight:600; font-size:16px; color:#e0b44a; white-space:nowrap; }
  .wk-search { flex:1; padding:9px 11px; font-size:13px; color:#ebdfc8; background:#120d08;
    border:1px solid #4a3927; border-radius:10px; }
  .wk-search:focus { outline:none; border-color:#9fb04e; box-shadow:0 0 0 2px rgba(159,176,78,.25); }
  .wk-x { cursor:pointer; color:#a89877; font-size:20px; background:none; border:none; transition:color .1s; }
  .wk-x:hover { color:#ebdfc8; }
  .wk-body { flex:1; display:flex; min-height:0; }
  .wk-list { width:44%; overflow-y:auto; border-right:1px solid #3c2e1f; padding:6px; }
  .wk-li { display:flex; align-items:center; gap:7px; padding:6px 8px; border-radius:9px; cursor:pointer; font-size:12px; }
  .wk-li:hover, .wk-li.sel { background:#3a2c1e; }
  .wk-sw { width:12px; height:12px; border-radius:99px; border:1px solid rgba(0,0,0,.4); flex:0 0 12px; }
  .wk-li .wk-cat { font-family:"Space Mono",monospace; color:#a89877; font-size:9px; text-transform:uppercase; letter-spacing:.3px; margin-left:auto; }
  .wk-detail { flex:1; overflow-y:auto; padding:14px 16px; }
  .wk-title { font-family:"Fredoka",sans-serif; font-size:18px; font-weight:600; color:#e0b44a; }
  .wk-sub { color:#a89877; font-size:12px; margin:2px 0 8px; }
  .wk-sec { margin-top:12px; }
  .wk-sec h3 { margin:0 0 5px; font-family:"Space Mono",monospace; font-size:10px; color:#c9a24a; text-transform:uppercase; letter-spacing:1px; }
  .wk-row { font-size:12px; color:#cdbf9e; padding:2px 0; line-height:1.45; }
  .wk-row b { color:#ebdfc8; }
  .wk-link { color:#9fb04e; cursor:pointer; }
  .wk-link:hover { text-decoration:underline; }
  .wk-none { color:#a89877; font-style:italic; font-size:12px; }
  .wk-pill { display:inline-block; font-size:10px; color:#cdbf9e; background:#17110a; border:1px solid #3c2e1f;
    border-radius:99px; padding:2px 8px; margin:1px 3px 1px 0; }
  `;
  document.head.appendChild(s);
}

const hex = (n) => '#' + ((n == null ? 0x8a8a8a : n) >>> 0).toString(16).padStart(6, '0').slice(-6);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const link = (id) => `<span class="wk-link" data-id="${esc(id)}">${esc(nameOf(id))}</span>`;

// The full item universe = the hydrated registry (DB stubs + hand-authored + tinker).
function allItemIds() {
  return Object.keys(ITEMS).filter((id) => id !== 'undefined');
}

function catOf(id) {
  const m = GameData.item && GameData.item(id);
  if (m && m.category) return m.subcategory ? `${m.category} · ${m.subcategory}` : m.category;
  const it = ITEMS[id];
  if (it && it.slot === 'weapon') return 'Weapon';
  if (it && it.slot) return 'Equipment';
  if (it && it.tool) return 'Tool';
  return 'Item';
}

let selectedId = null;

function renderList(overlay, query) {
  const q = (query || '').trim().toLowerCase();
  const list = overlay.querySelector('.wk-list');
  const ids = allItemIds()
    .filter((id) => !q || nameOf(id).toLowerCase().includes(q) || id.includes(q))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
    .slice(0, 400);
  list.innerHTML = '';
  for (const id of ids) {
    const it = ITEMS[id];
    const li = document.createElement('div');
    li.className = 'wk-li' + (id === selectedId ? ' sel' : '');
    li.innerHTML = `<span class="wk-sw" style="background:${hex(it && it.color)}"></span>
      <span>${esc(nameOf(id))}</span><span class="wk-cat">${esc(catOf(id).split(' · ')[0])}</span>`;
    li.onclick = () => renderDetail(overlay, id);
    list.appendChild(li);
  }
  if (!ids.length) list.innerHTML = `<div class="wk-none" style="padding:10px">No items match “${esc(q)}”.</div>`;
}

function statLines(id) {
  const it = ITEMS[id]; if (!it) return [];
  const out = [];
  const b = it.bonuses || {};
  const LAB = { stab_atk: 'Stab atk', slash_atk: 'Slash atk', crush_atk: 'Crush atk', range_atk: 'Ranged atk', tinker_atk: 'Tinker atk', melee_str: 'Melee str', range_str: 'Ranged str', tinker_str: 'Tinker str', stab_def: 'Stab def', slash_def: 'Slash def', crush_def: 'Crush def', range_def: 'Ranged def', tinker_def: 'Tinker def', magic_def: 'Magic def', prayer: 'Prayer' };
  const bonusBits = Object.keys(LAB).filter((k) => b[k]).map((k) => `<span class="wk-pill">${LAB[k]} ${b[k] > 0 ? '+' : ''}${b[k]}</span>`);
  if (bonusBits.length) out.push(bonusBits.join(''));
  if (it.weaponType) out.push(`<b>Type:</b> ${it.weaponType}${it.attackSpeed ? ` · speed ${it.attackSpeed}` : ''}${it.attackRange ? ` · reach ${it.attackRange}` : ''}${it.twoHanded ? ' · two-handed' : ''}`);
  if (it.reqSkill && it.reqLevel) out.push(`<b>Requires:</b> ${it.reqSkill} ${it.reqLevel} to wield`);
  if (it.effect) out.push(`<b>Gadget effect:</b> ${Object.entries(it.effect).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (it.effectMod) out.push(`<b>Mod:</b> ${it.blurb || Object.entries(it.effectMod).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (it.heal) out.push(`<b>Heals:</b> ${it.heal} HP`);
  if (it.buryXp) out.push(`<b>Bury:</b> +${it.buryXp} Prayer xp`);
  if (it.tool) out.push(`<b>Tool:</b> ${it.tool}${it.boosts ? ` (boosts ${it.boosts})` : ''}`);
  return out;
}

function renderDetail(overlay, id) {
  selectedId = id;
  const idx = buildIndexes();
  const it = ITEMS[id] || {};
  const meta = GameData.item && GameData.item(id);
  const d = overlay.querySelector('.wk-detail');
  overlay.querySelectorAll('.wk-li').forEach((el) => el.classList.remove('sel'));

  const sec = (title, rowsHtml) => `<div class="wk-sec"><h3>${title}</h3>${rowsHtml || '<div class="wk-none">—</div>'}</div>`;

  // --- how to get it ---
  const getRows = [];
  for (const dr of (idx.dropsByItem.get(id) || [])) getRows.push(`<div class="wk-row">Dropped by ${link(dr.monster)}${dr.chance != null ? ` <span class="wk-none">(${dr.chance}%)</span>` : ''}</div>`);
  for (const n of (idx.nodesByItem.get(id) || [])) getRows.push(`<div class="wk-row">Gather at <b>${esc(n.display_name)}</b> <span class="wk-none">(${esc(n.related_skill)} Lv ${n.level_requirement}${n.required_tool ? `, ${esc(n.required_tool)}` : ''} · ${esc(String(n.region).split(';')[0])})</span></div>`);
  for (const r of (idx.madeBy.get(id) || [])) getRows.push(`<div class="wk-row">Craft at <b>${esc(r.station || '?')}</b> <span class="wk-none">(${esc(r.skill || '?')} Lv ${r.level || 1})</span>: ${(r.inputs || []).map((i) => `${i.id ? link(i.id) : 'any ' + i.any} ×${i.qty}`).join(' + ') || '—'}${r.outQty > 1 ? ` → ×${r.outQty}` : ''}</div>`);
  for (const s of (idx.shopsByItem.get(id) || [])) getRows.push(`<div class="wk-row">Buy at <b>${esc(s.shop)}</b> <span class="wk-none">(${esc(s.region || '?')})${s.buy != null ? ` — ${s.buy} gp` : ''}</span></div>`);
  if (!getRows.length && meta) {
    if (meta.source_type) getRows.push(`<div class="wk-row">${esc(meta.source_type.replace(/;/g, ', '))}${meta.primary_source ? ` — from ${esc(meta.primary_source)}` : ''}</div>`);
    if (meta.dropped_by) getRows.push(`<div class="wk-row">Dropped by ${splitList(meta.dropped_by).map(link).join(', ')}</div>`);
  }

  // --- what it's for ---
  const useRows = [];
  const uses = idx.usedIn.get(id) || [];
  if (uses.length) {
    const byOut = uses.slice(0, 40).map((r) => link(r.output));
    useRows.push(`<div class="wk-row">Used to make: ${byOut.join(', ')}</div>`);
  }
  if (it.slot && it.slot !== null) useRows.push(`<div class="wk-row">Equips in the <b>${esc(it.slot)}</b> slot</div>`);
  if (it.heal) useRows.push(`<div class="wk-row">Eat to heal <b>${it.heal} HP</b></div>`);
  if (it.buryXp) useRows.push(`<div class="wk-row">Bury / offer at an altar for Prayer xp</div>`);
  if (it.tool) useRows.push(`<div class="wk-row">Used as a <b>${esc(it.tool)}</b> tool when gathering</div>`);
  if (it.ammoFamily) useRows.push(`<div class="wk-row">Ammo for <b>${esc(it.ammoFamily)}</b>-family tinker gadgets</div>`);
  if (it.gadgetMod) useRows.push(`<div class="wk-row">Install on your tinker rig to buff gadgets</div>`);
  if (meta && meta.used_in_recipes && !uses.length) useRows.push(`<div class="wk-row">${esc(splitList(meta.used_in_recipes).join(', '))}</div>`);

  const desc = (meta && meta.notes) ? esc(meta.notes) : (it.blurb ? esc(it.blurb) : '');
  const valueBits = [];
  if (meta && meta.gp_value) valueBits.push(`${Number(meta.gp_value).toLocaleString()} gp`);
  if (it.stackable) valueBits.push('stackable');

  d.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px">
      <span class="wk-sw" style="width:26px;height:26px;background:${hex(it.color)}"></span>
      <div><div class="wk-title">${esc(nameOf(id))}</div>
      <div class="wk-sub">${esc(catOf(id))}${valueBits.length ? ' · ' + valueBits.join(' · ') : ''}</div></div>
    </div>
    ${desc ? `<div class="wk-row" style="margin-top:8px">${desc}</div>` : ''}
    ${statLines(id).length ? sec('Details', statLines(id).map((l) => `<div class="wk-row">${l}</div>`).join('')) : ''}
    ${sec('How to get it', getRows.join(''))}
    ${sec("What it's for", useRows.join(''))}
    <div class="wk-sub" style="margin-top:14px;opacity:.6">id: ${esc(id)}</div>`;

  // cross-links jump to that item
  d.querySelectorAll('.wk-link').forEach((el) => { el.onclick = () => renderDetail(overlay, el.dataset.id); });
}

export function openWiki(focusId = null) {
  injectCss();
  let overlay = document.getElementById('wiki-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'wiki-overlay';
    overlay.innerHTML = `<div class="wk-panel">
      <div class="wk-head"><h2>Codex</h2>
        <input class="wk-search" placeholder="Search items…" />
        <button class="wk-x" title="Close">✕</button></div>
      <div class="wk-body"><div class="wk-list"></div>
        <div class="wk-detail"><div class="wk-none">Search or pick an item to see what it is, where it comes from, and what it's for.</div></div></div>
    </div>`;
    (document.getElementById('game-panel') || document.body).appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.hidden = true; });
    overlay.querySelector('.wk-x').onclick = () => { overlay.hidden = true; };
    const search = overlay.querySelector('.wk-search');
    search.oninput = () => renderList(overlay, search.value);
  }
  overlay.hidden = false;
  renderList(overlay, overlay.querySelector('.wk-search').value);
  if (focusId && ITEMS[focusId]) renderDetail(overlay, focusId);
}

export function initWiki() {
  if (mounted) return;
  mounted = true;
  injectCss();
  const host = document.getElementById('game-panel') || document.body;
  const btn = document.createElement('button');
  btn.id = 'wiki-btn';
  btn.textContent = 'Codex';
  btn.title = 'Open the item Codex — search any item to see what it is and where it comes from';
  btn.onclick = () => openWiki();
  host.appendChild(btn);
}
