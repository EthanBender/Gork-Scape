// src/systems/cutscene.js
// A tiny, data-driven CUTSCENE player — the cinematic layer for quests. A
// cutscene is an array of "beats" declared in quest data; this module renders
// them over the game as letterboxed captions/title-cards with fades and an
// optional camera pan, then hands control back. Always skippable (click / Esc /
// Space), so it never traps the player.
//
// Beat shapes (any combination):
//   { title: 'The Hollow Idol', sub: 'A goblin tale' }   -> full title card
//   { who: 'Goblin Elder', say: 'You feel it too...' }    -> speaker caption
//   { say: 'The ground hums.' }                           -> narration caption
//   { pan: { x: 515, y: 490 } }                           -> camera drifts to a tile
//   { fade: 'out' | 'in' }                                -> black fade
//   { wait: 800 }                                         -> extra beat time (ms)
//   { shake: true } on any beat                           -> screen shake
//
// Camera pan is delegated to main.js via Game.cutsceneCam = {x,y} (tile coords);
// main.js centres there instead of on the player while it's set. The renderer is
// pure DOM so it works without touching Phaser.

// Base dwell time for a beat, scaled a little by caption length so long lines
// stay up long enough to read.
function beatDuration(b) {
  if (typeof b.wait === 'number' && !b.say && !b.title) return b.wait;
  let ms = 1500;
  if (b.title) ms = 2400;
  const text = b.say || b.title || '';
  ms += Math.min(2600, text.length * 45);
  if (typeof b.wait === 'number') ms += b.wait;
  return ms;
}

let overlay = null;
let activeToken = 0; // bumped on every play, so a skip/new play cancels old timers

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'cutscene';
  overlay.innerHTML = `
    <div class="cs-fade"></div>
    <div class="cs-bar cs-bar-top"></div>
    <div class="cs-bar cs-bar-bottom"></div>
    <div class="cs-stage">
      <div class="cs-title"></div>
      <div class="cs-caption"><span class="cs-who"></span><span class="cs-say"></span></div>
    </div>
    <div class="cs-skip">▸ click / Esc to skip</div>`;
  (document.getElementById('game-panel') || document.body).appendChild(overlay);
  return overlay;
}

function setBeat(o, b) {
  const titleEl = o.querySelector('.cs-title');
  const capEl = o.querySelector('.cs-caption');
  const whoEl = o.querySelector('.cs-who');
  const sayEl = o.querySelector('.cs-say');
  const fadeEl = o.querySelector('.cs-fade');

  if (b.title) {
    titleEl.innerHTML = `<div class="cs-title-main">${esc(b.title)}</div>`
      + (b.sub ? `<div class="cs-title-sub">${esc(b.sub)}</div>` : '');
    titleEl.classList.add('show');
  } else {
    titleEl.classList.remove('show');
  }

  if (b.say) {
    whoEl.textContent = b.who ? b.who : '';
    whoEl.style.display = b.who ? 'block' : 'none';
    sayEl.textContent = b.say;
    capEl.classList.add('show');
  } else {
    capEl.classList.remove('show');
  }

  if (b.fade === 'out') fadeEl.classList.add('black');
  else if (b.fade === 'in') fadeEl.classList.remove('black');

  o.classList.toggle('cs-shake', !!b.shake);
  if (b.shake) setTimeout(() => o.classList.remove('cs-shake'), 500);

  // Camera pan: hand a tile target to main.js's render loop.
  if (b.pan && typeof b.pan.x === 'number') window.__cutsceneCamSet && window.__cutsceneCamSet(b.pan.x, b.pan.y);
}

// Play a cutscene (array of beats). Returns a Promise that resolves when it ends
// (finished or skipped). Safe to call with an empty/invalid list (resolves next tick).
export function playCutscene(beats) {
  return new Promise((resolve) => {
    if (!Array.isArray(beats) || !beats.length) { resolve(); return; }
    const token = ++activeToken;
    const o = ensureOverlay();
    o.hidden = false;
    o.classList.add('on');
    let timer = null;
    let i = 0;

    const finish = () => {
      if (token !== activeToken) return; // superseded
      clearTimeout(timer);
      o.classList.remove('on');
      o.hidden = true;
      window.__cutsceneCamClear && window.__cutsceneCamClear();
      cleanup();
      resolve();
    };
    const skip = () => finish();
    const onKey = (e) => { if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); skip(); } };
    const cleanup = () => {
      o.removeEventListener('click', skip);
      window.removeEventListener('keydown', onKey, true);
    };
    o.addEventListener('click', skip);
    window.addEventListener('keydown', onKey, true);

    const step = () => {
      if (token !== activeToken) return;
      if (i >= beats.length) { finish(); return; }
      const b = beats[i++];
      setBeat(o, b);
      timer = setTimeout(step, beatDuration(b));
    };
    step();
  });
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
