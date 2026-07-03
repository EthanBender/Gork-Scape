// src/ui/loginFx.js — the living background behind the login screen. A warm
// low-poly dusk scene built as light DOM + CSS keyframes (no canvas, no rAF):
// a radial dusk sky, a faceted cream moon with halo, drifting aurora bands and
// clouds, twinkling stars, floating gold fireflies, three clip-path hill
// ridges, and a tiny hooded-goblin silhouette wandering the far ridge. Matches
// the AAA redesign handoff. Started when any login page shows and removed on
// entry to the world so it costs the running game nothing.

const HERO = 'assets/ui/goblin_hero.png';
let scene = null;

// Small DOM helper: a <div> (or given tag) with inline cssText.
function node(css, tag = 'div') {
  const n = document.createElement(tag);
  n.style.cssText = css;
  return n;
}

// Deterministic-ish randoms are unnecessary here (CSS-driven, no resize rebuild),
// so plain Math.random for the star/firefly scatter.
function buildScene() {
  // Fixed to the viewport so it stays put while a tall login card scrolls over it.
  const root = node('position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;');
  root.id = 'login-scene';

  // Dusk sky.
  root.appendChild(node('position:absolute;inset:0;background:radial-gradient(120% 90% at 78% 12%,#3a3350 0%,#2b2740 34%,#241d2e 60%,#20191f 100%);'));
  // Warm moon glow + faceted cream disc (top-right).
  root.appendChild(node('position:absolute;right:16%;top:14%;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,rgba(244,231,200,.5) 0%,rgba(224,180,74,.16) 32%,transparent 66%);filter:blur(4px);'));
  root.appendChild(node('position:absolute;right:22%;top:20%;width:132px;height:132px;border-radius:50%;background:linear-gradient(135deg,#f6eccf 0 50%,#e6d5a4 50% 100%);box-shadow:0 0 60px 12px rgba(244,231,200,.35),inset -10px -10px 0 rgba(0,0,0,.06);'));
  // Drifting aurora bands.
  root.appendChild(node('position:absolute;left:-15%;top:6%;width:75%;height:44%;background:radial-gradient(60% 60% at 50% 50%,rgba(159,176,78,.18),transparent 70%);filter:blur(46px);animation:gob-aurora 20s ease-in-out infinite;'));
  root.appendChild(node('position:absolute;right:-12%;top:0;width:68%;height:40%;background:radial-gradient(60% 60% at 50% 50%,rgba(124,59,78,.16),transparent 70%);filter:blur(54px);animation:gob-aurora 27s ease-in-out infinite reverse;'));
  // Drifting clouds.
  root.appendChild(node('position:absolute;top:16%;left:0;width:210px;height:22px;border-radius:99px;background:rgba(18,14,24,.55);filter:blur(8px);animation:gob-drift 62s linear infinite;'));
  root.appendChild(node('position:absolute;top:27%;left:0;width:150px;height:16px;border-radius:99px;background:rgba(18,14,24,.4);filter:blur(7px);animation:gob-drift 84s linear -30s infinite;'));
  // Occasional shooting star.
  root.appendChild(node('position:absolute;top:11%;left:24%;width:120px;height:2px;border-radius:99px;background:linear-gradient(90deg,transparent,#f6ecd0);opacity:0;animation:gob-shoot 15s ease-in 5s infinite;'));

  // Twinkling stars (upper sky).
  for (let i = 0; i < 18; i++) {
    const t = Math.random() * 68, l = Math.random() * 100, s = 1 + Math.random() * 2.4, d = Math.random() * 3;
    root.appendChild(node(`position:absolute;top:${t}%;left:${l}%;width:${s}px;height:${s}px;border-radius:50%;background:#f6ecd0;opacity:.6;animation:gob-tw ${2 + d}s ease-in-out ${d}s infinite;`));
  }
  // Floating gold fireflies (lower half).
  for (let i = 0; i < 10; i++) {
    const t = 44 + Math.random() * 46, l = Math.random() * 100, d = Math.random() * 4;
    root.appendChild(node(`position:absolute;top:${t}%;left:${l}%;width:6px;height:6px;border-radius:50%;background:radial-gradient(#fff6c0,#e0b44a);box-shadow:0 0 10px 3px rgba(224,180,74,.7);animation:gob-fire ${4 + d}s ease-in-out ${d}s infinite;z-index:4;`));
  }

  // Low-poly hills (far → near).
  root.appendChild(node('position:absolute;left:0;right:0;bottom:0;height:42%;background:linear-gradient(#4d5c30,#3c4a26);clip-path:polygon(0 55%,10% 32%,22% 52%,34% 24%,48% 50%,60% 26%,72% 52%,84% 30%,94% 48%,100% 34%,100% 100%,0 100%);opacity:.9;'));
  root.appendChild(node('position:absolute;left:0;right:0;bottom:0;height:33%;background:linear-gradient(#3e4d27,#2d3a1d);clip-path:polygon(0 46%,14% 24%,28% 50%,40% 20%,54% 46%,68% 22%,82% 48%,92% 26%,100% 44%,100% 100%,0 100%);'));
  // Wandering hooded-goblin silhouette on the far ridge.
  const walkTrack = node('position:absolute;left:0;right:0;bottom:26%;height:0;z-index:2;pointer-events:none;');
  const walker = node('position:absolute;bottom:0;animation:gob-walk 40s linear infinite;');
  walker.appendChild(node(`width:36px;display:block;filter:brightness(0) opacity(.42);animation:gob-step 1s ease-in-out infinite;`, 'img'));
  walker.firstChild.src = HERO;
  walker.firstChild.alt = '';
  walkTrack.appendChild(walker);
  root.appendChild(walkTrack);
  // Nearest ridge (in front of the walker).
  root.appendChild(node('position:absolute;left:0;right:0;bottom:0;height:22%;background:linear-gradient(#33421f,#222d15);clip-path:polygon(0 40%,18% 18%,36% 44%,52% 16%,70% 42%,86% 20%,100% 40%,100% 100%,0 100%);z-index:3;'));

  return root;
}

export function startLoginFx(host) {
  // Re-showing a login page replaces the overlay's innerHTML, detaching a
  // previously-built scene — rebuild cleanly rather than leaving a stray node.
  if (scene && scene.isConnected) return;
  stopLoginFx();
  scene = buildScene();
  host.prepend(scene);
}

export function stopLoginFx() {
  if (scene) scene.remove();
  scene = null;
}
