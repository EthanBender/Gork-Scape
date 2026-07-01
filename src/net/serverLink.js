// src/net/serverLink.js
// The first real client→server connection (Phase 4, step 1 of wiring the client
// to the authoritative server). It makes the Grand Exchange guide prices the
// player sees the SHARED, always-on ones served by server/index.mjs — so two
// players (or a player and the 24/7 server) see the same market that keeps
// drifting whether or not anyone is online.
//
// Deliberately additive and NON-BREAKING: if no world server is reachable (e.g.
// the client is opened via the plain static dev server), it silently stays in
// LOCAL mode and the client behaves exactly as before. Trading escrow/settlement
// still runs locally for now; only the guide-price feed is networked here. Moving
// the order book + inventory server-side is a later step.

import { market } from '../systems/grandExchange.js';
import { Game } from '../engine/state.js';
import { api } from './config.js';

const PRICES_URL = '/api/prices';
const POLL_ONLINE_MS = 5000;   // stay fresh while connected
const POLL_OFFLINE_MS = 20000; // re-probe occasionally when standalone
const FETCH_TIMEOUT_MS = 3000;

let status = 'local';          // 'local' | 'online'
let timer = null;
let started = false;

export function serverLinkStatus() { return status; }

// Fetch with a hard timeout so a hung/absent server never stalls the poll.
async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(api(url), { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // no server / timeout / CORS — treat as offline
  } finally {
    clearTimeout(t);
  }
}

// Pull the authoritative guide table and mirror it into the local market so the
// GE panel shows shared prices. Returns true if the server answered.
async function syncPrices() {
  const data = await fetchJson(PRICES_URL);
  if (!data || !Array.isArray(data.guide)) { setStatus('local'); return false; }
  for (const [id, price] of data.guide) {
    if (price > 0) market.setGuide(id, price);
  }
  setStatus('online');
  // Refresh the Exchange tab if it's the one on screen.
  if (Game.ui && Game.ui.renderGrandExchange) Game.ui.renderGrandExchange();
  return true;
}

// Send a GE order to the shared server for execution against the shared book.
// Returns { side, itemId, filled, gross, fills, guide } or null if offline/failed.
// Callers (geActions online path) escrow locally first and settle from this result.
export async function postOrder(side, itemId, qty, limit, trader) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(api('/api/order'), {
      method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ side, itemId, qty, limit, trader }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function postJson(url, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(api(url), {
      method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; } finally { clearTimeout(t); }
}

// A trader's resting orders on the shared server (open + filled-but-uncollected).
export async function getOffers(trader) {
  const data = await fetchJson(`/api/offers?trader=${encodeURIComponent(trader)}`);
  return (data && Array.isArray(data.offers)) ? data.offers : [];
}
export function collectOrder(orderId, trader) { return postJson('/api/collect', { orderId, trader }); }
export function cancelOrder(orderId, trader) { return postJson('/api/cancel', { orderId, trader }); }

function setStatus(next) {
  if (next === status) return;
  status = next;
  updateHud();
  Game.log(next === 'online'
    ? 'Connected to the shared world — Grand Exchange prices are now live and shared.'
    : 'Lost the shared-world connection — the Grand Exchange is running locally.');
}

function schedule() {
  if (timer) clearTimeout(timer);
  const delay = status === 'online' ? POLL_ONLINE_MS : POLL_OFFLINE_MS;
  timer = setTimeout(async () => { await syncPrices(); schedule(); }, delay);
}

// Begin the price feed. Safe to call once at boot; idempotent across re-logins.
export async function connectServerLink() {
  if (timer) clearTimeout(timer);
  started = true;
  await syncPrices();  // initial probe + sync
  schedule();
  updateHud();
}

// A small topbar chip, shown ONLY when connected (standalone play sees nothing
// new). Sits with the other HUD readouts; the render lane can restyle freely.
function updateHud() {
  if (!started) return;
  const bar = document.getElementById('topbar');
  let el = document.getElementById('tb-netstatus');
  if (status === 'online') {
    if (!el && bar) {
      el = document.createElement('span');
      el.className = 'tb';
      el.id = 'tb-netstatus';
      el.style.color = 'var(--accent, #7bbf4a)';
      bar.insertBefore(el, document.getElementById('logout-btn'));
    }
    if (el) {
      el.textContent = '🌐 Shared World';
      el.title = 'Connected to the always-on world server — Grand Exchange prices are the live, shared ones.';
      el.style.display = '';
    }
  } else if (el) {
    el.style.display = 'none';
  }
}
