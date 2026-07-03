// src/engine/session.js
// Player session lifecycle for the (client-side) hosted world: a login gate,
// autosave, save-on-close, and a 5-minute idle auto-logout. The Phaser game is
// only created after login and destroyed on logout, so the "world" the player
// sees always matches the account they're signed into.
//
// This module owns *when* to start/stop the game and *when* to persist; the
// actual start/stop is delegated back to main.js via the {onStart,onStop}
// hooks, and persistence lives in save.js. Keeping those seams clean is what
// makes a later swap to a real server backend a localized change.

import { Game } from './state.js';
import { loadSave, saveGame, serialize } from './save.js';
import * as authClient from '../net/authClient.js';
import { startLoginFx, stopLoginFx } from '../ui/loginFx.js';

export const IDLE_LOGOUT_MS = 10 * 60 * 1000;  // auto-logout after 10 min idle
const AUTOSAVE_MS = 20 * 1000;                 // periodic background save
const IDLE_CHECK_MS = 15 * 1000;               // how often we test for idleness

let hooks = { onStart: () => {}, onStop: () => {} };
const extraSavers = []; // extra persistence callbacks (e.g. shared world state)
let account = null;
let serverAvailable = false;       // is the authoritative server reachable this session?
let running = false;               // true between game-ready and logout
let lastActivity = 0;
let autosaveTimer = null;
let idleTimer = null;
let listenersWired = false;

// ---------------------------------------------------------------- public API
export function currentAccount() { return account; }

// Called once at boot. Wires the login screen and window-level listeners, then
// shows the login gate. `onStart` should create the Phaser game; `onStop`
// should tear it down. Both are invoked with no arguments.
export async function initSession({ onStart, onStop }) {
  hooks = { onStart, onStop };
  injectStyles();
  wireGlobalListeners();
  await gateOnServer();
}

// Boot / refresh gate. The game REQUIRES the authoritative server — there is no
// local, this-device play mode (that dual state was confusing). If the server is
// up, resume a held token (refresh stays signed in) or show the login. If it's
// down, show the "server resting" landing page — an ad for the game with a Retry
// — never a throwaway local character. The Retry button calls this again.
async function gateOnServer() {
  showConnecting();
  const resumed = await authClient.resume();
  if (resumed.ok) { serverAvailable = true; beginSession(resumed.username, resumed.save); return; }
  // resume() only reports `offline` when it actually tried (had a token). With no
  // token it returns {ok:false}; probe to see whether a server is there at all.
  serverAvailable = resumed.offline ? false : await authClient.probe();
  if (serverAvailable) showLogin();
  else showComingSoon();
}

// Called by main.js create() once the game has finished loading/applying the
// save. Only now is it safe to start autosaving (before this, we'd overwrite a
// good save with default state) and to reveal the in-game chrome.
export function notifyGameReady() {
  running = true;
  Game.playerFrozen = document.visibilityState === 'hidden'; // freeze if launched hidden
  bumpActivity();
  hideLogin();
  showLogoutButton();
  startAutosave();
  startIdleWatch();
}

// Register an extra persistence callback run on every save (autosave, tab close,
// logout) — e.g. shared world state that isn't part of the per-account player
// save. Keeps session.js decoupled from what else needs persisting.
export function registerSaver(fn) {
  if (typeof fn === 'function' && !extraSavers.includes(fn)) extraSavers.push(fn);
}
function runExtraSavers() {
  for (const fn of extraSavers) { try { fn(); } catch { /* best-effort */ } }
}

// Persist the current character + any registered world state. The server is the
// source of truth (pushSave); localStorage is kept only as a silent crash-safety
// cache, never surfaced as a separate "local character".
export function save() {
  if (!(account && running)) return;
  saveGame(account);
  runExtraSavers();
  authClient.pushSave(serialize()); // async, best-effort
}

export function logout(reason) {
  if (!running) return;
  // persist BEFORE flipping `running`
  if (account) {
    saveGame(account);
    runExtraSavers();
    authClient.pushSave(serialize());
  }
  running = false;
  stopAutosave();
  stopIdleWatch();
  hideLogoutButton();
  hooks.onStop();
  const who = account;
  account = null;
  Game.account = null;
  Game.pendingSave = null;
  authClient.logout();   // drop the server session token (best-effort)
  showLogin(reason ? { notice: reasonText(reason, who) } : undefined);
}

// ---------------------------------------------------------------- login flow
// Enter the world as a signed-in server account. The save comes from the server
// (source of truth); localStorage is only a fallback if the server had none yet.
function beginSession(username, serverSave) {
  account = username;
  Game.account = username;
  Game.pendingSave = serverSave || loadSave(username);
  hooks.onStart();  // create the Phaser game; create() calls notifyGameReady()
}

function reasonText(reason, who) {
  if (reason === 'idle') return `${who ? `${who} was` : 'You were'} logged out after ${IDLE_LOGOUT_MS / 60000} minutes of inactivity. Your progress was saved.`;
  return '';
}

// ---------------------------------------------------------------- activity / idle
function bumpActivity() { lastActivity = Date.now(); }

function wireGlobalListeners() {
  if (listenersWired) return;
  listenersWired = true;

  const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
  for (const ev of activityEvents) {
    window.addEventListener(ev, () => { if (running) bumpActivity(); }, { passive: true });
  }

  // Persist on tab close / hide. pagehide + the hidden visibility state are the
  // reliable signals across browsers (beforeunload isn't fired on mobile);
  // include beforeunload as a desktop backstop. These SAVE but do not log out —
  // the page is going away, and offline catch-up will reconcile time on return.
  const flush = () => {
    if (!(running && account)) return;
    saveGame(account);
    runExtraSavers();
    // An async fetch can't be awaited during unload — use a queued beacon that
    // survives the page going away.
    authClient.beaconSave(serialize());
  };
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => {
    const hidden = document.visibilityState === 'hidden';
    // [world-continuity] Freeze the player while the tab is hidden — nothing
    // happens TO the character when nobody's watching — but the world sim keeps
    // ticking. main.js gameTick() honours this flag. Also persist on hide.
    Game.playerFrozen = hidden;
    if (hidden) flush();
    else bumpActivity();
  });
}

function startIdleWatch() {
  stopIdleWatch();
  idleTimer = setInterval(() => {
    if (running && Date.now() - lastActivity >= IDLE_LOGOUT_MS) logout('idle');
  }, IDLE_CHECK_MS);
}
function stopIdleWatch() { if (idleTimer) { clearInterval(idleTimer); idleTimer = null; } }

function startAutosave() {
  stopAutosave();
  autosaveTimer = setInterval(() => save(), AUTOSAVE_MS);
}
function stopAutosave() { if (autosaveTimer) { clearInterval(autosaveTimer); autosaveTimer = null; } }

// ---------------------------------------------------------------- login UI
function el(id) { return document.getElementById(id); }

function ensureOverlay() {
  let overlay = el('login-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'login-overlay';
    document.body.appendChild(overlay);
  }
  return overlay;
}

// The masthead every login page shares: goblin crest + wordmark. Sits above
// whatever card the page renders into #login-card. setStage() paints it AND
// (re)starts the animated valley — innerHTML replacement detaches the old
// canvas, so the FX must start after the markup lands.
function setStage(overlay, cardHTML) {
  overlay.innerHTML = stageHTML(cardHTML);
  startLoginFx(overlay);
}

function stageHTML(cardHTML) {
  return `
    <div class="login-stage">
      <div class="login-mast">
        <div class="login-crest"><div class="login-crest-inner"><img src="assets/ui/goblin_hero.png" alt="Goblin Empire crest"></div></div>
        <h1 class="login-wordmark">Goblin <span>Empire</span></h1>
        <div class="login-tagline">A living low-poly world that keeps its own time</div>
      </div>
      <div id="login-card">${cardHTML}</div>
      <div class="login-foot">gorkscape.ca</div>
    </div>`;
}

// A brief interstitial while we probe the server / resume a session at boot, so
// the player never sees a flash of the wrong login form.
function showConnecting() {
  const overlay = ensureOverlay();
  overlay.hidden = false;
  setStage(overlay, `
    <div class="login-panel login-connecting">
      <div class="conn-spinner"></div>
      <p class="login-sub">Connecting to the world…</p>
    </div>`);
}

function showLogin(opts = {}) {
  const overlay = ensureOverlay();
  overlay.hidden = false;
  setStage(overlay, '');
  renderAuthLogin(el('login-card'), opts.notice || '');
}

// The "server is resting" landing page — shown whenever the authoritative server
// can't be reached (e.g. the host laptop is closed). It's an ad for the game, not
// an error: title, tagline, and a Retry that re-probes. There is deliberately no
// way to "play offline" from here — one canonical world, hosted by the server.
function showComingSoon() {
  const overlay = ensureOverlay();
  overlay.hidden = false;
  setStage(overlay, `
    <div class="login-panel coming-soon">
      <p class="cs-tagline">Mine, craft, trade, and fight in a goblin realm that keeps living whether you're watching or not.</p>
      <div class="cs-status">
        <span class="cs-dot"></span>
        <span>The realm is resting — the server is offline right now.</span>
      </div>
      <p class="cs-sub">Come back soon. Your character and everything you've built are safe on the server.</p>
      <button id="cs-retry" class="login-primary">Try again</button>
    </div>`);
  const retry = el('cs-retry');
  if (retry) retry.onclick = () => { retry.disabled = true; retry.textContent = 'Checking…'; gateOnServer(); };
}

function hideLogin() {
  const overlay = el('login-overlay');
  if (overlay) overlay.hidden = true;
  stopLoginFx(); // tear the background animation down — it must cost the game nothing
}

// The account screen: Sign In / Create Account, username + password. The username
// IS the in-game character name (created accounts are told so). If the server
// drops between the boot probe and submit, we fall through to the coming-soon page.
let authFormMode = 'signin'; // 'signin' | 'create'

function renderAuthLogin(card, notice) {
  const isCreate = authFormMode === 'create';
  const keySvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#8b5a2b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="8" r="3.5"/><path d="M10 10.5 19 19.5"/><path d="M17 17.5 19.5 15"/><path d="M14.5 15 16.5 13"/></svg>';
  const label = isCreate ? 'Create Account & Enter' : 'Sign In';
  card.innerHTML = `
    <div class="login-panel">
      ${notice ? `<div class="login-notice"><span class="login-notice-coin">!</span><span>${escapeHtml(notice)}</span></div>` : ''}
      <div class="login-tabs" role="tablist">
        <button class="login-tab ${isCreate ? '' : 'active'}" data-mode="signin">Sign In</button>
        <button class="login-tab ${isCreate ? 'active' : ''}" data-mode="create">Create Account</button>
      </div>
      <div class="login-form">
        <label class="login-field">
          <span>Username${isCreate ? ' <em>— your name in the world</em>' : ''}</span>
          <div class="login-inputwrap">
            <input id="auth-user" type="text" maxlength="16" autocomplete="username"
                   autocapitalize="off" spellcheck="false" placeholder="e.g. Grukthar" />
            <span class="login-key" aria-hidden="true">${keySvg}</span>
          </div>
        </label>
        <label class="login-field">
          <span>Password</span>
          <div class="login-inputwrap">
            <input id="auth-pass" type="password" autocomplete="${isCreate ? 'new-password' : 'current-password'}"
                   placeholder="${isCreate ? 'At least 6 characters' : 'Your password'}" />
          </div>
        </label>
        ${isCreate ? `<label class="login-field">
          <span>Confirm password</span>
          <div class="login-inputwrap">
            <input id="auth-pass2" type="password" autocomplete="new-password" placeholder="Re-enter password" />
          </div>
        </label>` : ''}
        <button id="auth-submit" class="login-primary">
          <span class="lp-label">${label}</span>
          <span class="lp-sheen" aria-hidden="true"></span>
        </button>
      </div>
      <div id="login-error" class="login-error"></div>
      <div class="login-hint">${isCreate
        ? 'Your username is your character name — every other player sees it in the world.'
        : 'Your character is saved to your account — sign in from any device to keep playing.'}</div>
    </div>`;

  const userInput = el('auth-user');
  const passInput = el('auth-pass');
  const errBox = el('login-error');
  const submitBtn = el('auth-submit');
  const showErr = (m) => { if (errBox) errBox.textContent = m; };
  // Update only the label span — the button also holds the sheen sweep element,
  // so setting the button's textContent would wipe it.
  const lpLabel = submitBtn && submitBtn.querySelector('.lp-label');
  const setBusy = (b) => {
    if (!submitBtn) return;
    submitBtn.disabled = b;
    if (lpLabel) lpLabel.textContent = b ? 'Please wait…' : label;
  };

  card.querySelectorAll('.login-tab').forEach((btn) => {
    btn.onclick = () => { authFormMode = btn.dataset.mode; renderAuthLogin(card, ''); };
  });

  const submit = async () => {
    const username = (userInput.value || '').trim();
    const password = passInput.value || '';
    if (!validName(username)) { showErr('Username must be 2–16 letters, numbers, spaces, - or _.'); return; }
    if (password.length < 6) { showErr('Password must be at least 6 characters.'); return; }
    if (isCreate && password !== (el('auth-pass2').value || '')) { showErr('Passwords don’t match.'); return; }

    setBusy(true);
    const res = isCreate
      ? await authClient.register(username, password)
      : await authClient.login(username, password);

    if (res.offline) {
      // Server dropped between the boot probe and this submit → the realm is
      // resting. Show the coming-soon page (no local play).
      serverAvailable = false;
      setBusy(false);
      showComingSoon();
      return;
    }
    if (!res.ok) { showErr(res.error || 'Sign-in failed.'); setBusy(false); return; }
    beginSession(res.username, res.save);
  };

  submitBtn.onclick = submit;
  const onEnter = (e) => { if (e.key === 'Enter') submit(); };
  userInput.onkeydown = onEnter;
  passInput.onkeydown = onEnter;
  if (isCreate) el('auth-pass2').onkeydown = onEnter;
  // preventScroll: focusing the field must not scroll the tall card container
  // and push the crest/wordmark off the top on short viewports.
  userInput.focus({ preventScroll: true });
}

function validName(name) {
  return /^[A-Za-z0-9 _-]{2,16}$/.test(name);
}

// ---------------------------------------------------------------- logout button
function showLogoutButton() {
  let btn = el('logout-btn');
  const bar = el('topbar');
  if (!btn && bar) {
    btn = document.createElement('button');
    btn.id = 'logout-btn';
    btn.textContent = 'Log out';
    btn.title = 'Save and return to the sign-in screen';
    btn.onclick = () => logout('manual');
    bar.appendChild(btn);
  }
  if (btn) {
    btn.hidden = false;
    btn.textContent = account ? `Log out (${account})` : 'Log out';
  }
}
function hideLogoutButton() {
  const btn = el('logout-btn');
  if (btn) btn.hidden = true;
}

// ---------------------------------------------------------------- helpers
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function injectStyles() {
  if (el('session-styles')) return;
  const style = document.createElement('style');
  style.id = 'session-styles';
  style.textContent = `
    /* ============================================================
       Login / Landing — AAA redesign (parchment + wood + juicy olive).
       Warm dusk scene is painted behind by src/ui/loginFx.js.
       ============================================================ */
    #login-overlay {
      position: fixed; inset: 0; z-index: 3000;
      display: block; overflow: auto; overscroll-behavior: contain;
      background: #20191f;
      font-family: "Nunito", "Segoe UI", Tahoma, sans-serif;
    }
    #login-overlay[hidden] { display: none; }
    /* min-height:100% + centering means the card sits centered when it fits and
       simply grows the scroll area (crest never clipped) when the viewport is
       too short — the overlay scrolls, the fixed scene stays put behind. */
    .login-stage {
      position: relative; z-index: 5; box-sizing: border-box;
      min-height: 100%; width: min(440px, 92vw); margin: 0 auto;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 28px 0 36px;
      animation: stageIn .7s cubic-bezier(.2,.9,.3,1) both;
    }
    @keyframes stageIn { 0% { opacity: 0; transform: translateY(16px); }
      100% { opacity: 1; transform: none; } }
    /* Masthead: PNG crest in a gold-ringed roundel + stacked wordmark. */
    .login-mast { text-align: center; }
    .login-crest {
      width: 104px; height: 104px; margin: 0 auto; border-radius: 50%;
      padding: 5px; background: linear-gradient(#e7c76b, #b7862f);
      box-shadow: 0 12px 26px rgba(0,0,0,.45), inset 0 2px 0 rgba(255,255,255,.5);
      animation: crestBob 4.6s ease-in-out infinite;
    }
    .login-crest-inner {
      width: 100%; height: 100%; border-radius: 50%; overflow: hidden;
      background: #2c2438; box-shadow: inset 0 0 0 3px #3e2a18;
    }
    .login-crest-inner img {
      width: 150%; height: 150%; object-fit: cover; object-position: 50% 8%;
      transform: translate(-16%, -4%);
    }
    @keyframes crestBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    .login-wordmark {
      margin: 18px 0 0; font-family: "Fredoka", sans-serif; font-weight: 700;
      font-size: clamp(40px, 9vw, 66px); line-height: .95; letter-spacing: .5px; color: #f4e7c8;
      text-shadow: 0 2px 0 #8b5a2b, 0 4px 0 #5c3a1c, 0 8px 18px rgba(0,0,0,.5);
    }
    .login-wordmark span { color: #c3d46a; }
    .login-tagline {
      margin: 14px 0 0; font-family: "Space Mono", monospace; font-size: 12px;
      letter-spacing: 3px; text-transform: uppercase; color: #b8a988;
    }
    /* #login-card is the WOOD FRAME; .login-panel is the parchment card inside. */
    #login-card {
      width: min(440px, 92vw); margin-top: 30px; border-radius: 26px; padding: 5px;
      background: linear-gradient(#7a5324, #4e3319); box-shadow: 0 26px 60px rgba(0,0,0,.55);
    }
    .login-foot {
      margin-top: 20px; font-family: "Space Mono", monospace; font-size: 12px;
      letter-spacing: 1px; color: #6b5a44;
    }
    .login-panel {
      padding: 24px; border-radius: 22px; color: #4a3524;
      background: linear-gradient(#f7edd4, #eaddb8); border: 1px solid #d9c39a;
      box-shadow: inset 0 2px 0 rgba(255,255,255,.7);
    }
    .login-sub { margin: 0; text-align: center; color: #6b5240; font-size: 13px; }
    .login-connecting { display: flex; flex-direction: column; align-items: center; gap: 12px;
      padding-top: 30px; padding-bottom: 30px; }
    .conn-spinner { width: 30px; height: 30px; border-radius: 50%;
      border: 3px solid rgba(159,176,78,.28); border-top-color: #7d8a44;
      animation: connSpin .9s linear infinite; }
    @keyframes connSpin { to { transform: rotate(360deg); } }
    /* Inactivity notice — gold ribbon with a "!" coin. */
    .login-notice {
      display: flex; gap: 10px; align-items: flex-start; margin: 0 0 16px;
      padding: 12px 14px; border-radius: 14px; font-size: 13px; line-height: 1.4;
      font-weight: 600; color: #6f531f;
      background: linear-gradient(#f6e5b4, #f0d998); border: 1px solid #e0bf6f;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.6);
    }
    .login-notice-coin {
      flex: none; width: 22px; height: 22px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(#e7c76b, #c99a2f); color: #5c3a1c; font-weight: 900; font-size: 13px;
    }
    /* Segmented Sign In / Create Account toggle. */
    .login-tabs {
      display: flex; gap: 5px; margin: 0; padding: 5px; border-radius: 15px;
      background: #e2cfa4; box-shadow: inset 0 2px 4px rgba(94,58,28,.28);
    }
    .login-tab {
      flex: 1; padding: 11px 0; cursor: pointer; border: none; border-radius: 11px;
      background: transparent; font-family: "Fredoka", sans-serif; font-weight: 600;
      font-size: 15px; color: #4a3524; transition: filter .12s;
    }
    .login-tab.active {
      background: linear-gradient(#c3d46a, #9fb04e);
      box-shadow: inset 0 2px 0 rgba(255,255,255,.55), 0 3px 0 #5c6b2c;
    }
    .login-tab:not(.active):hover { filter: brightness(.97); }
    .login-form { display: flex; flex-direction: column; gap: 14px; margin-top: 18px; }
    .login-field { display: flex; flex-direction: column; }
    .login-field > span {
      font-family: "Fredoka", sans-serif; font-weight: 600; font-size: 13px;
      color: #6b5240; margin-bottom: 6px;
    }
    .login-field > span em { font-style: italic; font-weight: 400; color: #8b5a2b; }
    .login-inputwrap {
      display: flex; align-items: center; gap: 8px; padding: 0 12px; border-radius: 13px;
      background: #fffdf6; border: 2px solid #dcc79f;
      box-shadow: inset 0 2px 4px rgba(94,58,28,.12); transition: border-color .14s, box-shadow .14s;
    }
    .login-inputwrap:focus-within {
      border-color: #9fb04e;
      box-shadow: inset 0 2px 4px rgba(94,58,28,.12), 0 0 0 3px rgba(159,176,78,.25);
    }
    .login-inputwrap input {
      flex: 1; padding: 13px 0; border: none; outline: none; background: transparent;
      font-family: "Nunito", sans-serif; font-weight: 700; font-size: 16px; color: #4a3524;
    }
    .login-inputwrap input::placeholder { color: #b6a487; font-weight: 600; }
    .login-key {
      flex: none; width: 26px; height: 26px; border-radius: 8px; background: #efe0bd;
      display: flex; align-items: center; justify-content: center;
    }
    .login-key svg { display: block; }
    /* Juicy olive CTA with a lip + sweeping sheen. */
    .login-primary {
      position: relative; overflow: hidden; width: 100%; margin-top: 20px; padding: 16px;
      border: none; border-radius: 16px; cursor: pointer;
      font-family: "Fredoka", sans-serif; font-weight: 600; font-size: 20px; letter-spacing: .3px;
      color: #2f3a12; background: linear-gradient(#c9db72, #9fb04e);
      box-shadow: inset 0 2px 0 rgba(255,255,255,.55), 0 6px 0 #5c6b2c, 0 12px 20px rgba(0,0,0,.35);
      transition: transform .07s, box-shadow .07s, filter .12s;
    }
    .login-primary:hover { filter: brightness(1.04); }
    .login-primary:active {
      transform: translateY(4px);
      box-shadow: inset 0 2px 0 rgba(255,255,255,.45), 0 2px 0 #5c6b2c, 0 6px 12px rgba(0,0,0,.3);
    }
    .login-primary:disabled { cursor: default; filter: grayscale(.25) brightness(.98); }
    .lp-label { position: relative; z-index: 1; }
    .lp-sheen {
      position: absolute; top: 0; bottom: 0; left: 0; width: 40%; z-index: 0; pointer-events: none;
      background: linear-gradient(100deg, transparent, rgba(255,255,255,.5), transparent);
      animation: gob-sheen 4.5s ease-in-out infinite;
    }
    .login-hint { margin: 16px 4px 2px; text-align: center; font-size: 12.5px; line-height: 1.5; color: #8a704f; }
    /* "Server resting" landing / ad page (on parchment). */
    .login-panel.coming-soon { text-align: center; }
    .cs-tagline { margin: 2px 2px 16px; font-size: 13.5px; line-height: 1.55; color: #4a3524; font-weight: 600; }
    .cs-status {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      margin: 0 0 12px; padding: 10px 12px; border-radius: 11px; font-size: 12.5px; font-weight: 700;
      background: linear-gradient(#f6e5b4, #f0d998); border: 1px solid #e0bf6f; color: #6f531f;
    }
    .cs-dot {
      width: 9px; height: 9px; border-radius: 50%; background: #c99a2f;
      box-shadow: 0 0 0 0 rgba(201,154,47,.6); animation: cs-pulse 1.8s infinite;
    }
    @keyframes cs-pulse {
      0% { box-shadow: 0 0 0 0 rgba(201,154,47,.5); }
      70% { box-shadow: 0 0 0 8px rgba(201,154,47,0); }
      100% { box-shadow: 0 0 0 0 rgba(201,154,47,0); }
    }
    .cs-sub { margin: 0 0 16px; font-size: 12px; line-height: 1.5; color: #6b5240; }
    .login-error { min-height: 16px; margin-top: 10px; font-size: 12.5px; font-weight: 700; color: #b34a4a; text-align: center; }
    #logout-btn {
      margin-left: auto; padding: 9px 16px; cursor: pointer;
      font-family: "Fredoka", sans-serif; font-weight: 600; font-size: 13px; color: #f0d9c0;
      border: none; border-radius: 12px; background: linear-gradient(#5a3a3f, #482e33);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.15), 0 3px 0 #331f23;
      transition: transform .07s, box-shadow .07s, filter .12s;
    }
    #logout-btn:hover { filter: brightness(1.1); }
    #logout-btn:active { transform: translateY(2px);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.15), 0 1px 0 #331f23; }
    #logout-btn[hidden] { display: none; }
    /* Login scene keyframes (consumed by loginFx.js DOM nodes). */
    @keyframes gob-aurora { 0%,100% { opacity:.45; transform:translateX(0) scale(1); }
      50% { opacity:.95; transform:translateX(34px) scale(1.08); } }
    @keyframes gob-drift { from { transform:translateX(-260px); } to { transform:translateX(112vw); } }
    @keyframes gob-shoot { 0% { opacity:0; transform:translate(0,0) rotate(24deg); }
      4% { opacity:1; } 13%,100% { opacity:0; transform:translate(260px,110px) rotate(24deg); } }
    @keyframes gob-tw { 0%,100% { opacity:.2; } 50% { opacity:.9; } }
    @keyframes gob-fire { 0%,100% { transform:translate(0,0); opacity:.45; }
      50% { transform:translate(7px,-16px); opacity:1; } }
    @keyframes gob-walk { from { transform:translateX(-9vw); } to { transform:translateX(112vw); } }
    @keyframes gob-step { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-2.5px); } }
    @keyframes gob-sheen { 0% { transform:translateX(-120%); } 60%,100% { transform:translateX(240%); } }
    /* Short screens (landscape phones): compress the masthead so the card fits. */
    @media (max-height: 600px) {
      .login-stage { padding: 16px 0 24px; }
      .login-crest { width: 66px; height: 66px; }
      .login-wordmark { font-size: clamp(30px, 7vw, 40px); margin-top: 12px; }
      .login-tagline { display: none; }
      #login-card { margin-top: 16px; }
      .login-panel { padding: 18px; }
    }
  `;
  document.head.appendChild(style);
}
