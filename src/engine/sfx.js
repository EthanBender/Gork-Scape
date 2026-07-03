// src/engine/sfx.js — the game's first AUDIO. A tiny dependency-free Web Audio
// synth: pure oscillators, no asset files, no build step (matches the repo's
// no-tooling rule). Each effect is a recipe of 1-6 short tones — chiptune-
// adjacent, tuned so the level-up hits the same dopamine nerve OSRS's does.
//
// Browser autoplay policy: the AudioContext starts suspended until a user
// gesture — main.js calls unlockAudio() on the first pointerdown. `M` mutes.

let ctx = null, master = null, muted = false;

function ensure() {
  if (ctx) return true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.16;              // modest by default — game audio, not a siren
    master.connect(ctx.destination);
  } catch { return false; }
  return true;
}

export function unlockAudio() { if (ensure() && ctx.state === 'suspended') ctx.resume(); }
export function toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.16; return muted; }

function tone(freq, t0, dur, type = 'square', vol = 1, slide = 0) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

const RECIPES = {
  hit:     (t) => { tone(160, t, 0.09, 'square', 0.9, -60); tone(80, t, 0.12, 'triangle', 0.7, -30); },
  miss:    (t) => tone(300, t, 0.06, 'sine', 0.25, 120),
  hurt:    (t) => tone(110, t, 0.14, 'sawtooth', 0.8, -50),
  slam:    (t) => { tone(70, t, 0.30, 'sawtooth', 1.0, -30); tone(45, t + 0.04, 0.35, 'triangle', 0.8); },
  gather:  (t) => tone(520, t, 0.05, 'triangle', 0.5, 40),
  eat:     (t) => tone(220, t, 0.08, 'sine', 0.5, -80),
  coins:   (t) => { tone(988, t, 0.05, 'square', 0.4); tone(1319, t + 0.05, 0.08, 'square', 0.4); },
  levelup: (t) => [392, 523, 659, 784].forEach((f, i) => tone(f, t + i * 0.09, 0.22, 'triangle', 0.8)),
  quest:   (t) => [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, t + i * 0.11, 0.25, 'triangle', 0.8)),
  death:   (t) => [330, 262, 196, 131].forEach((f, i) => tone(f, t + i * 0.16, 0.30, 'sawtooth', 0.6, -20)),
};

export function playSfx(name) {
  if (muted || !ensure() || ctx.state !== 'running') return;
  const r = RECIPES[name];
  if (r) { try { r(ctx.currentTime); } catch { /* audio is never worth a crash */ } }
}
