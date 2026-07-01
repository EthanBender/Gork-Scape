// src/systems/homeTeleport.js
// A free "Home Teleport" modelled on OSRS: costs nothing, but a ~10-second
// CHANNELED cast that any action or damage interrupts, followed by a cooldown.
// It whisks the player back to the settlement spawn — the universal "get home"
// safety net. The channel (not the cost) is the anti-abuse mechanic: you can't
// use it to blink out of a fight, because getting hit cancels it.
//
// Tick-based: the sim runs on the 600ms wall-clock ticker, so the channel and the
// cooldown advance with game time (and pause while the player is frozen). All
// state is module-local; main.js drives it from gameTick and the HUD button.

export const HOME_CHANNEL_TICKS = 16;    // ~9.6s channel (OSRS ≈ 10s), interruptible
export const HOME_COOLDOWN_TICKS = 500;  // ~5 min cooldown (OSRS ≈ 30 min; tuned to this game's faster pace)
export const TICK_SECONDS = 0.6;

const st = { channelStart: -1, cooldownUntil: -1 };

export function resetHomeTeleport() { st.channelStart = -1; st.cooldownUntil = -1; }

// State for the HUD/logic:
//   { status: 'ready' }
//   { status: 'channeling', progress: 0..1 }
//   { status: 'cooldown', remaining: <ticks> }
export function homeState(tick) {
  if (st.channelStart >= 0) {
    return { status: 'channeling', progress: Math.min(1, (tick - st.channelStart) / HOME_CHANNEL_TICKS) };
  }
  if (tick < st.cooldownUntil) return { status: 'cooldown', remaining: st.cooldownUntil - tick };
  return { status: 'ready' };
}

export function isChanneling() { return st.channelStart >= 0; }
export function canHomeTeleport(tick) { return homeState(tick).status === 'ready'; }

// Begin channeling if ready. Returns true if it started.
export function beginHomeTeleport(tick) {
  if (!canHomeTeleport(tick)) return false;
  st.channelStart = tick;
  return true;
}

// Interrupt an in-progress channel (movement / combat / damage). Returns true if
// a channel was actually cancelled (so the caller can log the interruption).
export function cancelHomeTeleport() {
  if (st.channelStart < 0) return false;
  st.channelStart = -1;
  return true;
}

// Advance the channel one tick; returns true on the exact tick it COMPLETES —
// the caller then teleports the player. The cooldown starts here.
export function tickHomeTeleport(tick) {
  if (st.channelStart < 0) return false;
  if (tick - st.channelStart >= HOME_CHANNEL_TICKS) {
    st.channelStart = -1;
    st.cooldownUntil = tick + HOME_COOLDOWN_TICKS;
    return true;
  }
  return false;
}
