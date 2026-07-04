// src/render/clay.js
// The ONE clay-shading primitive shared by the character rig (avatar.js) and the
// procedural world props/scenery (props.js). Extracting it here means creatures,
// gear, buildings and dressing all inherit a single cohesive warm-clay finish
// instead of drifting apart with per-file copies.
//
// Pure leaf module: no imports, no Phaser, no side effects — just colour math. It
// can't fail to load behind a dependency, so every caller stays fallback-safe.

// Clamp a channel to a valid 0..255 integer. This is what replaced the old
// `& 255` bit-wrap: `& 255` on an over-bright channel wrapped past 255 back
// toward near-black, so highlights on gold/bronze/lit surfaces could darken
// instead of brighten. Clamping saturates at white the way real light does.
export const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

// Warm clay ramp: darken (f<1) or lighten (f>1) a colour by f, biased WARM —
// shadows keep their red + lose blue, highlights push warm — and CLAMP (never
// wrap). Used everywhere, so every creature, piece of gear and world prop
// inherits one cohesive warm-clay finish.
export const shade = (c, f) => {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const k = Math.abs(f - 1);                     // distance from neutral
  return (clamp8(r * (f + k * 0.05)) << 16)      // faint warm bias — keeps metals reading as metal
       | (clamp8(g * f) << 8)
       |  clamp8(b * (f - k * 0.06));
};
