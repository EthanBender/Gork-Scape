// src/ui/loginFx.js — the living background behind the login screen. A single
// full-viewport canvas painting a low-poly night valley: layered triangle
// ridges that drift in parallax, a faceted moon, slow fog bands, and fireflies.
// Pure canvas 2D, ~1ms/frame, started when any login page shows and fully torn
// down on entry to the world (rAF cancelled, canvas removed) so it costs the
// game nothing.

let canvas = null, ctx = null, raf = 0, t0 = 0;
let W = 0, H = 0, dpr = 1;
let ridges = [], flies = [], stars = [];
let seedState = 7;

// Deterministic rand so resizes rebuild the same valley (no visual pop).
const rand = () => { seedState = (seedState * 16807) % 2147483647; return (seedState - 1) / 2147483646; };

function build() {
  seedState = 7;
  W = window.innerWidth; H = window.innerHeight;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Star field (twinkle phase per star).
  stars = [];
  for (let i = 0; i < 90; i++) {
    stars.push({ x: rand() * W, y: rand() * H * 0.55, r: 0.5 + rand() * 1.1, p: rand() * Math.PI * 2 });
  }

  // Three parallax ridge layers, far → near. Each is a jagged polyline of
  // triangle peaks; drawn as one filled polygon per layer, plus darker facet
  // triangles on alternating slopes for the low-poly read.
  const layers = [
    { base: 0.58, amp: 0.10, seg: 90, col: '#1d2a18', facet: '#16210f', speed: 4 },
    { base: 0.70, amp: 0.13, seg: 130, col: '#243620', facet: '#1b2a16', speed: 9 },
    { base: 0.84, amp: 0.15, seg: 180, col: '#2f4629', facet: '#25381f', speed: 16 },
  ];
  ridges = layers.map((L) => {
    const pts = [];
    const n = Math.ceil(W / L.seg) + 4; // +wrap margin so drift can scroll
    for (let i = 0; i <= n; i++) {
      pts.push(H * L.base - rand() * H * L.amp);
    }
    return { ...L, pts, n };
  });

  // Fireflies: drifting glow dots in the near foreground.
  flies = [];
  const nf = Math.min(26, Math.max(12, (W / 60) | 0));
  for (let i = 0; i < nf; i++) {
    flies.push({
      x: rand() * W, y: H * (0.55 + rand() * 0.4),
      vx: (rand() - 0.5) * 8, vy: (rand() - 0.5) * 5,
      r: 1.2 + rand() * 1.6, p: rand() * Math.PI * 2, s: 0.6 + rand() * 0.9,
    });
  }
}

function drawRidge(L, dx) {
  const { pts, seg, n } = L;
  const off = -((dx / 1000) * L.speed % seg) - seg * 2;
  ctx.beginPath();
  ctx.moveTo(off, H);
  for (let i = 0; i <= n; i++) ctx.lineTo(off + i * seg, pts[i]);
  ctx.lineTo(off + n * seg, H);
  ctx.closePath();
  ctx.fillStyle = L.col;
  ctx.fill();
  // Facet shading: darker triangle on the right slope of each peak.
  ctx.fillStyle = L.facet;
  for (let i = 1; i < n; i += 2) {
    const x0 = off + i * seg, x1 = off + (i + 1) * seg;
    if (x1 < 0 || x0 > W) continue;
    ctx.beginPath();
    ctx.moveTo(x0, pts[i]);
    ctx.lineTo(x1, pts[i + 1]);
    ctx.lineTo(x1, Math.max(pts[i], pts[i + 1]) + (H - Math.max(pts[i], pts[i + 1])) * 0.35);
    ctx.closePath();
    ctx.fill();
  }
}

function frame(now) {
  raf = requestAnimationFrame(frame);
  const t = (now - t0) / 1000;

  // Sky: deep night gradient with a green aurora tint low on the horizon.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0a0e14');
  sky.addColorStop(0.5, '#101822');
  sky.addColorStop(0.78, '#18251c');
  sky.addColorStop(1, '#0e1410');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Stars (gentle twinkle).
  for (const s of stars) {
    const a = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 0.8 + s.p));
    ctx.globalAlpha = a;
    ctx.fillStyle = '#dfe8f2';
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;

  // Faceted moon, top-right, with a soft halo.
  const mx = W * 0.78, my = H * 0.2, mr = Math.min(W, H) * 0.07;
  const halo = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 3.2);
  halo.addColorStop(0, 'rgba(232,224,180,.22)');
  halo.addColorStop(1, 'rgba(232,224,180,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(mx - mr * 3.4, my - mr * 3.4, mr * 6.8, mr * 6.8);
  ctx.beginPath(); // hexagonal low-poly moon
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 12;
    ctx[i ? 'lineTo' : 'moveTo'](mx + Math.cos(a) * mr, my + Math.sin(a) * mr);
  }
  ctx.closePath();
  ctx.fillStyle = '#e8e0b4';
  ctx.fill();
  ctx.beginPath(); // shaded half facet
  for (let i = 2; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 12;
    ctx[i === 2 ? 'moveTo' : 'lineTo'](mx + Math.cos(a) * mr, my + Math.sin(a) * mr);
  }
  ctx.closePath();
  ctx.fillStyle = '#cfc389';
  ctx.fill();

  // Parallax ridges (far → near), drifting slowly right-to-left.
  for (const L of ridges) drawRidge(L, t * 1000);

  // Fog bands: two translucent sine-wobbling strips between ridge layers.
  for (let b = 0; b < 2; b++) {
    const fy = H * (0.62 + b * 0.16) + Math.sin(t * 0.24 + b * 2) * 8;
    const g = ctx.createLinearGradient(0, fy - 26, 0, fy + 26);
    g.addColorStop(0, 'rgba(150,180,140,0)');
    g.addColorStop(0.5, `rgba(150,180,140,${0.05 + b * 0.02})`);
    g.addColorStop(1, 'rgba(150,180,140,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, fy - 26, W, 52);
  }

  // Fireflies: drift + wrap, pulsing glow.
  for (const f of flies) {
    f.x += f.vx * 0.016; f.y += f.vy * 0.016 + Math.sin(t * f.s + f.p) * 0.12;
    if (f.x < -10) f.x = W + 10; if (f.x > W + 10) f.x = -10;
    if (f.y < H * 0.5) f.y = H * 0.98; if (f.y > H + 6) f.y = H * 0.55;
    const glow = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.6 * f.s + f.p));
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 5);
    g.addColorStop(0, `rgba(190,240,120,${0.5 * glow})`);
    g.addColorStop(1, 'rgba(190,240,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(f.x - f.r * 5, f.y - f.r * 5, f.r * 10, f.r * 10);
    ctx.fillStyle = `rgba(225,255,170,${glow})`;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
  }
}

let resizeHandler = null;

export function startLoginFx(host) {
  // Re-showing a login page replaces the overlay's innerHTML, which detaches a
  // previously-started canvas — restart cleanly rather than painting into a
  // node that's no longer in the DOM.
  if (canvas && canvas.isConnected) return;
  stopLoginFx();
  canvas = document.createElement('canvas');
  canvas.id = 'login-fx';
  canvas.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;';
  host.prepend(canvas);
  ctx = canvas.getContext('2d');
  build();
  resizeHandler = () => build();
  window.addEventListener('resize', resizeHandler);
  t0 = performance.now();
  raf = requestAnimationFrame(frame);
}

export function stopLoginFx() {
  if (!canvas) return;
  cancelAnimationFrame(raf);
  window.removeEventListener('resize', resizeHandler);
  canvas.remove();
  canvas = null; ctx = null; raf = 0; resizeHandler = null;
}
