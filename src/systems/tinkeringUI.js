// src/systems/tinkeringUI.js
// The Tinker's Workbench — a self-contained overlay + HUD button for the
// Tinkering skill. Built with its own injected DOM + CSS so it does NOT touch the
// contested panels.js (same approach as travel.js). Lists every recipe grouped
// into Components / Ammo / Gadgets, shows have/need for each input (the cross-
// skill web made legible), and builds on click via tinkering.assemble().
//
// main.js create() calls initTinkerHud() once (one tagged line). Economy lane.

import { Game } from '../engine/state.js';
import { ITEMS } from '../items/equipment.js';
import { recipeGroups, canAssemble, assemble, countMaterial } from './tinkering.js';
import { hasUnlock } from './quests.js';

let mounted = false;

function injectCss() {
  if (document.getElementById('tinker-css')) return;
  const s = document.createElement('style');
  s.id = 'tinker-css';
  s.textContent = `
  #tinker-btn { position:absolute; left:10px; top:96px; z-index:30; cursor:pointer;
    background:linear-gradient(180deg,#3d3728,#26221a); color:#e8c65a; font-weight:700;
    border:1px solid #0d0c08; border-radius:6px; padding:6px 10px; font-size:12px;
    box-shadow:inset 1px 1px 0 #6b6144, inset -1px -1px 0 #0d0c08, 0 2px 5px rgba(0,0,0,.4); }
  #tinker-btn:hover { color:#fff; }
  #tinker-overlay { position:absolute; inset:0; z-index:60; display:flex;
    align-items:center; justify-content:center; background:rgba(0,0,0,.55); }
  #tinker-overlay[hidden] { display:none; }
  .tk-panel { width:min(560px,92%); max-height:86%; display:flex; flex-direction:column;
    background:linear-gradient(180deg,#26221a,#201d15); border:2px solid #4a4331;
    border-radius:10px; box-shadow:0 10px 40px rgba(0,0,0,.6); color:#efe8d4; }
  .tk-head { display:flex; align-items:center; justify-content:space-between; padding:10px 14px;
    border-bottom:2px solid #0d0c08; }
  .tk-head h2 { margin:0; font-size:16px; color:#e8c65a; }
  .tk-head .tk-lvl { color:#b8863a; font-size:12px; font-weight:700; }
  .tk-x { cursor:pointer; color:#a89c7d; font-size:20px; line-height:1; background:none; border:none; }
  .tk-tabs { display:flex; gap:4px; padding:8px 10px 0; }
  .tk-tab { flex:1; padding:6px; text-align:center; cursor:pointer; font-size:12px; font-weight:700;
    color:#a89c7d; background:#191710; border:1px solid #0d0c08; border-radius:5px 5px 0 0; }
  .tk-tab.active { color:#e8c65a; background:#322d21; }
  .tk-list { overflow-y:auto; padding:8px 10px 12px; }
  .tk-row { display:flex; align-items:center; gap:8px; padding:7px 8px; margin-bottom:6px;
    background:linear-gradient(180deg,#322d21,#26221a); border:1px solid #0d0c08; border-radius:6px; }
  .tk-row .tk-info { flex:1; min-width:0; }
  .tk-name { font-size:13px; font-weight:700; }
  .tk-name .tk-req { color:#b8863a; font-weight:600; font-size:11px; }
  .tk-inputs { font-size:11px; color:#a89c7d; margin-top:2px; }
  .tk-inputs .ok { color:#7bbf4a; } .tk-inputs .no { color:#c9556a; }
  .tk-make { background:linear-gradient(180deg,#4d7a2f,#3a5f22); color:#efe8d4; font-weight:700;
    border:1px solid #0d0c08; border-radius:5px; padding:6px 10px; cursor:pointer; font-size:12px; white-space:nowrap; }
  .tk-make:disabled { filter:grayscale(1) brightness(.7); cursor:default; }
  .tk-locked { padding:22px 18px; text-align:center; color:#c9b489; font-size:13px; line-height:1.5; }
  .tk-locked b { color:#e8c65a; }
  `;
  document.head.appendChild(s);
}

const nameOf = (id) => (ITEMS[id] && ITEMS[id].name) || id;
function inputLabel(inp) {
  const need = inp.qty;
  const have = countMaterial(inp);
  const nm = inp.id ? nameOf(inp.id) : (inp.any === 'log' ? 'any Logs' : inp.any === 'bar' ? 'any Bar' : inp.any === 'coal' ? 'Coal' : inp.any);
  const cls = have >= need ? 'ok' : 'no';
  return `<span class="${cls}">${nm} ${have}/${need}</span>`;
}

let activeTab = 'Gadgets';
function render() {
  const overlay = document.getElementById('tinker-overlay');
  if (!overlay || overlay.hidden) return;
  const lvl = Game.skills.Tinkering ? Game.skills.Tinkering.level : 1;
  overlay.querySelector('.tk-lvl').textContent = `Tinkering ${lvl}`;
  const list = overlay.querySelector('.tk-list');
  list.innerHTML = '';
  // Gate: the whole skill is locked until the intro quest grants it.
  if (!hasUnlock('tinkering')) {
    list.innerHTML = `<div class="tk-locked">🔒 You aren't a Tinkerer yet.<br><br>
      Find <b>Sprocket the Tinker</b> near the settlement and complete
      <b>"Sparks of Invention"</b> to learn the craft. Further gadgets unlock as you
      progress <b>The Tinkerer's Path</b> quest line.</div>`;
    return;
  }
  const groups = recipeGroups();
  for (const r of groups[activeTab]) {
    const chk = canAssemble(r.id);
    const row = document.createElement('div');
    row.className = 'tk-row';
    const out = nameOf(r.output);
    const gate = lvl < r.level ? ` <span class="tk-req">Lv ${r.level}</span>` : '';
    row.innerHTML = `<div class="tk-info">
      <div class="tk-name">${out}${r.outQty > 1 ? ` ×${r.outQty}` : ''}${gate}</div>
      <div class="tk-inputs">${r.inputs.map(inputLabel).join(' · ')} &nbsp;→&nbsp; +${r.xp} xp</div>
    </div>`;
    const btn = document.createElement('button');
    btn.className = 'tk-make';
    btn.textContent = 'Build';
    btn.disabled = !chk.ok;
    if (!chk.ok) btn.title = chk.why;
    btn.onclick = () => { assemble(r.id); Game.refresh(); render(); };
    row.appendChild(btn);
    list.appendChild(row);
  }
}

export function openWorkbench() {
  let overlay = document.getElementById('tinker-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'tinker-overlay';
    overlay.innerHTML = `<div class="tk-panel">
      <div class="tk-head"><h2>🔧 Tinker's Workbench <span class="tk-lvl"></span></h2>
        <button class="tk-x" title="Close">✕</button></div>
      <div class="tk-tabs"></div>
      <div class="tk-list"></div>
    </div>`;
    (document.getElementById('game-panel') || document.body).appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.hidden = true; });
    overlay.querySelector('.tk-x').onclick = () => { overlay.hidden = true; };
    const tabs = overlay.querySelector('.tk-tabs');
    for (const t of ['Gadgets', 'Ammo', 'Components']) {
      const b = document.createElement('div');
      b.className = 'tk-tab' + (t === activeTab ? ' active' : '');
      b.textContent = t;
      b.onclick = () => { activeTab = t; tabs.querySelectorAll('.tk-tab').forEach((x) => x.classList.toggle('active', x.textContent === t)); render(); };
      tabs.appendChild(b);
    }
  }
  overlay.hidden = false;
  render();
}

// Re-render on each game refresh if the workbench is open (live have/need).
export function refreshWorkbench() { render(); }

// [economy lane] The workbench is now a WORLD OBJECT you click (placed in map.js
// buildTown, opened via the main.js interaction hook) — matching the design doc's
// "Tinker's Workbench station", not a floating HUD button. This just readies the
// overlay's CSS at boot; openWorkbench() builds/opens the popup on demand.
export function initTinkerHud() {
  if (mounted) return;
  mounted = true;
  injectCss();
}
