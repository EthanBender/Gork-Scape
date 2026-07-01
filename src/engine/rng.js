// src/engine/rng.js
// Tiny shared randomness helpers.

// Uniform integer in [min, max] inclusive.
export function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
