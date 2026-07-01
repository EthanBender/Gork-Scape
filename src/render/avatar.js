// src/render/avatar.js
// The visible character: an articulated procedural "puppet" for the player
// (Gork) and NPCs. No sprite-sheet art required — the whole body is drawn from
// primitives each frame, so we get full control over facing, walk cycles,
// per-weapon-style attack swings, hit reactions, death, and equipped gear that
// visibly appears on the body (visual equip / unequip).
//
// PUBLIC API
//   drawAvatar(g, cx, cy, state)
//     g       : a Phaser Graphics object (already created & cleared by caller)
//     cx, cy  : the character's GROUND anchor in world px (feet / tile centre)
//     state   : {
//       facing:      'N' | 'E' | 'S' | 'W'      (default 'S')
//       anim:        'idle' | 'walk' | 'attack' | 'hit' | 'dead'
//       t:           ms, monotonic — drives cyclic motion (walk/idle breath)
//       phase:       0..1 progress for one-shot anims (attack / hit / death)
//       weaponStyle: 'stab' | 'slash' | 'crush' | 'ranged' | 'unarmed'
//       gear:        gearHints(equipment)  (see gear.js) — optional
//       skin:        base body colour (default Gork green) — recolour NPCs
//       scale:       size multiplier (default 1)
//     }
//
// Nothing here mutates game state; it only reads `state` and draws. The caller
// (main.js render loop) derives `state` from `Game` — see deriveAvatarState().

import { gearHints, weaponStyleFor } from './gear.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const easeOut = (p) => 1 - (1 - p) * (1 - p);
const lerp = (a, b, p) => a + (b - a) * p;

// ---- body proportions (local px; feet at y=0, +y is UP) ------------------
const HIP_Y = 11;      // hips / top of legs
const SHOULDER_Y = 20; // shoulder line
const NECK_Y = 21;
const HEAD_Y = 26;     // head centre
const HEAD_R = 5.2;
const ARM_LEN = 8.5;
const LEG_LEN = 11;
const TORSO_W = 8;     // shoulder width (front view)

// ---- palette --------------------------------------------------------------
const SKIN = 0x6fbf3f;
const shade = (c, f) => {          // darken a hex colour by factor f (0..1)
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return ((r * f) & 255) << 16 | ((g * f) & 255) << 8 | ((b * f) & 255);
};

// ---------------------------------------------------------------------------
// A tiny drawing context that maps LOCAL puppet coords -> world px, applying
// facing mirror, a vertical bob, a forward lunge, an optional whole-body
// rotation (death), and a global alpha (fades). Keeping the transform here
// means the limb code below reads in clean local space.
// ---------------------------------------------------------------------------
function makeCtx(g, cx, cy, opt) {
  const s = opt.scale;
  const mir = opt.mirror ? -1 : 1;       // flip X for west-facing / left profile
  const rot = opt.rot || 0;              // whole-body rotation (radians, death)
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  const lunge = opt.lunge || 0;          // forward shove during a strike
  const bob = opt.bob || 0;
  return {
    g,
    a: opt.alpha == null ? 1 : opt.alpha,
    // local (lx,ly) -> world [wx,wy]
    P(lx, ly) {
      let x = (lx + lunge) * mir;
      let y = ly + bob;
      // rotate about the feet origin (for the death topple)
      if (rot) { const rx = x * cosR - y * sinR, ry = x * sinR + y * cosR; x = rx; y = ry; }
      return [cx + x * s, cy - y * s];    // -y because local +y is up
    },
    unit() { return s; },
  };
}

function fill(ctx, color, alpha = 1) { ctx.g.fillStyle(color, alpha * ctx.a); }
function disc(ctx, lx, ly, r, color, alpha = 1) {
  const [x, y] = ctx.P(lx, ly);
  fill(ctx, color, alpha);
  ctx.g.fillCircle(x, y, r * ctx.unit());
}
// thick capsule-ish limb between two local points
function seg(ctx, x1, y1, x2, y2, w, color, alpha = 1) {
  const [ax, ay] = ctx.P(x1, y1);
  const [bx, by] = ctx.P(x2, y2);
  ctx.g.lineStyle(w * ctx.unit(), color, alpha * ctx.a);
  ctx.g.beginPath(); ctx.g.moveTo(ax, ay); ctx.g.lineTo(bx, by); ctx.g.strokePath();
  fill(ctx, color, alpha);
  ctx.g.fillCircle(ax, ay, (w / 2) * ctx.unit());
  ctx.g.fillCircle(bx, by, (w / 2) * ctx.unit());
}
function poly(ctx, pts, color, alpha = 1) {
  fill(ctx, color, alpha);
  const world = pts.map(([lx, ly]) => { const [x, y] = ctx.P(lx, ly); return { x, y }; });
  ctx.g.fillPoints(world, true);
}

// ---------------------------------------------------------------------------
// Motion model — returns the kinematic pose numbers for the current frame.
// Everything downstream reads from this so the same pose feeds every view.
// ---------------------------------------------------------------------------
function pose(state) {
  const anim = state.anim || 'idle';
  const t = state.t || 0;
  const phase = clamp01(state.phase || 0);

  const p = {
    bob: 0,            // whole-body vertical bob
    lunge: 0,          // forward shove (px, local +x)
    legSwing: 0,       // stride angle (rad); +front leg forward
    armSwing: 0,       // passive arm swing while walking (rad)
    breath: 0,         // torso breathing scale delta
    strike: 0,         // 0..1 how far into the active swing (for weapon angle)
    strikeStyle: state.weaponStyle || 'unarmed',
    recoil: 0,         // hit knock-back (px)
    flash: 0,          // red hit flash 0..1
    topple: 0,         // death rotation 0..~1.4 rad
    fade: 1,           // global alpha
    bowDraw: 0,        // ranged string pull 0..1
    released: false,   // ranged: arrow gone
  };

  if (anim === 'walk') {
    const w = (t / 460) * TAU;             // stride cycle
    p.legSwing = Math.sin(w) * 0.62;
    p.armSwing = Math.sin(w + Math.PI) * 0.5;
    p.bob = Math.abs(Math.sin(w)) * 1.4;   // rise at mid-stride
  } else if (anim === 'idle') {
    p.breath = Math.sin(t / 900) * 0.5;
    p.armSwing = Math.sin(t / 1100) * 0.08;
    p.bob = (Math.sin(t / 900) + 1) * 0.25;
  } else if (anim === 'attack') {
    // one-shot swing; wind-up then fast strike then recover
    if (p.strikeStyle === 'ranged') {
      p.bowDraw = phase < 0.6 ? easeOut(phase / 0.6) : Math.max(0, 1 - (phase - 0.6) / 0.15);
      p.released = phase >= 0.6;
      p.bob = 0.2;
    } else {
      // strike lands FAST (impact by ~0.22 so it syncs with the damage splat
      // that appears on the attack tick), then a slower follow-through / recover.
      let s;
      if (phase < 0.22) s = easeOut(phase / 0.22);             // quick strike to full
      else s = 1 - ((phase - 0.22) / 0.78) * 0.85;             // follow-through
      p.strike = clamp01(s);
      p.lunge = Math.sin(clamp01(phase * 1.7) * Math.PI) * 2.2; // step in on the strike
    }
  } else if (anim === 'hit') {
    p.recoil = (1 - phase) * 2.4;
    p.flash = 1 - phase;
    p.breath = Math.sin(phase * 10) * 0.3;
  } else if (anim === 'dead') {
    p.topple = easeInOut(phase) * 1.35;    // fall to the side
    p.fade = 1 - clamp01((phase - 0.55) / 0.45) * 0.85;
    p.bob = -easeInOut(phase) * 1.5;       // sink a touch
  } else if (anim === 'skill') {
    const st = state.skillType || 'chop';
    if (st === 'fish') {
      p.breath = Math.sin(t / 700) * 0.4;  // idle rod hold
    } else if (st === 'work') {
      const c = (t / 320) % 1;             // fast tapping (smith/craft/cook)
      p.strike = c < 0.5 ? easeOut(c / 0.5) : 1 - easeOut((c - 0.5) / 0.5);
      p.bob = Math.abs(Math.sin(t / 320)) * 0.4;
    } else {                               // chop / mine: quick strike, slow raise
      const c = (t / 640) % 1;
      p.strike = clamp01(c < 0.28 ? easeOut(c / 0.28) : 1 - (c - 0.28) / 0.72);
      p.lunge = Math.sin(clamp01(c * 2) * Math.PI) * 1.2;
    }
  }
  return p;
}

// weapon swing angle (local radians, 0 = pointing forward/along facing,
// +up, -down) as a function of style + strike progress.
function weaponAngle(style, strike) {
  const s = strike;
  switch (style) {
    case 'stab':  return lerp(0.15, -0.05, s);           // stays roughly level, thrusts
    case 'slash': return lerp(2.2, -0.7, s);             // up-behind sweeping down-front
    case 'crush': return lerp(2.6, -0.9, s);             // overhead chop
    default:      return lerp(1.4, -0.3, s);             // generic swing
  }
}

// arm/tool angle while skilling (chop & mine reuse the overhead swing).
function skillAngle(type, strike, t) {
  if (type === 'fish') return -0.35 + Math.sin(t / 700) * 0.06;  // rod held forward-down
  if (type === 'work') return -0.15 + strike * 0.5;              // hammer near the waist
  return weaponAngle('crush', strike);                           // chop / mine overhead
}

// ---------------------------------------------------------------------------
// Limb + gear drawing helpers. `dir` is +1 (front arm reaches screen-forward)
// used by the profile views; front/back views draw both arms symmetric.
// ---------------------------------------------------------------------------
function drawCape(ctx, hint, p, back) {
  if (!hint) return;
  const sway = (p.armSwing || 0) * 2 + (p.strike || 0) * -1.5;
  const bx = back * 1.5;
  poly(ctx, [
    [-2.5, SHOULDER_Y + 1], [2.5, SHOULDER_Y + 1],
    [3 + bx + sway, HIP_Y - 2], [-3 + bx + sway, HIP_Y - 3],
  ], hint.color, 0.95);
}

function drawLeg(ctx, rootX, angle, color, bootColor) {
  const kneeX = rootX + Math.sin(angle) * LEG_LEN * 0.5;
  const kneeY = HIP_Y - Math.cos(angle) * LEG_LEN * 0.5;
  const footX = rootX + Math.sin(angle) * LEG_LEN;
  const footY = HIP_Y - Math.cos(angle) * LEG_LEN;
  seg(ctx, rootX, HIP_Y, kneeX, kneeY, 3.2, color);
  seg(ctx, kneeX, kneeY, footX, footY, 3.0, color);
  // boot
  poly(ctx, [[footX - 1.4, footY], [footX + 2.4, footY], [footX + 2.4, footY - 1.6], [footX - 1.4, footY - 1.6]], bootColor);
}

function drawArm(ctx, shoulderX, angle, color, len = ARM_LEN) {
  const elbowX = shoulderX + Math.cos(angle) * len * 0.55;
  const elbowY = SHOULDER_Y + Math.sin(angle) * len * 0.55;
  const handX = shoulderX + Math.cos(angle) * len;
  const handY = SHOULDER_Y + Math.sin(angle) * len;
  seg(ctx, shoulderX, SHOULDER_Y, elbowX, elbowY, 2.6, color);
  seg(ctx, elbowX, elbowY, handX, handY, 2.4, color);
  return [handX, handY];
}

function drawHead(ctx, skin, head, facing) {
  const back = facing === 'N';
  // ears (goblin points)
  poly(ctx, [[-HEAD_R, HEAD_Y + 1], [-HEAD_R - 3, HEAD_Y + 3], [-HEAD_R, HEAD_Y + 3]], shade(skin, 0.85));
  poly(ctx, [[HEAD_R, HEAD_Y + 1], [HEAD_R + 3, HEAD_Y + 3], [HEAD_R, HEAD_Y + 3]], shade(skin, 0.85));
  disc(ctx, 0, HEAD_Y, HEAD_R, skin);
  if (!back) {
    // face: brow + eyes + snout, oriented by facing
    const ex = facing === 'E' ? 1.6 : facing === 'W' ? -1.6 : 0;
    disc(ctx, ex - 1.6, HEAD_Y + 0.6, 0.9, 0xf2e9c0);
    disc(ctx, ex + 1.6, HEAD_Y + 0.6, 0.9, 0xf2e9c0);
    disc(ctx, ex - 1.6, HEAD_Y + 0.6, 0.4, 0x1a1a12);
    disc(ctx, ex + 1.6, HEAD_Y + 0.6, 0.4, 0x1a1a12);
    if (facing === 'E' || facing === 'W') disc(ctx, ex * 1.8, HEAD_Y - 0.6, 1.1, shade(skin, 0.8)); // snout
  } else {
    disc(ctx, 0, HEAD_Y + 1, HEAD_R * 0.8, shade(skin, 0.7)); // back of skull
  }
  // helm on top
  if (head) {
    if (head.kind === 'full') {
      // full helm: covers the whole head (only the ear tips poke out), domed
      // crown, with a dark visor slit + nasal bar on the front.
      disc(ctx, 0, HEAD_Y, HEAD_R + 0.4, head.color);
      disc(ctx, 0, HEAD_Y + HEAD_R * 0.55, HEAD_R + 0.4, shade(head.color, 1.12));
      if (!back) {
        const ex = facing === 'E' ? 1.4 : facing === 'W' ? -1.4 : 0;
        poly(ctx, [[ex - 2.8, HEAD_Y - 0.8], [ex + 2.8, HEAD_Y - 0.8], [ex + 2.8, HEAD_Y + 0.7], [ex - 2.8, HEAD_Y + 0.7]], 0x141414); // visor slit
        seg(ctx, ex, HEAD_Y + 0.7, ex, HEAD_Y - HEAD_R + 0.6, 1, shade(head.color, 0.85)); // nasal bar
      }
    } else if (head.kind === 'hood') {
      poly(ctx, [[-HEAD_R - 1, HEAD_Y - 1], [HEAD_R + 1, HEAD_Y - 1], [HEAD_R, HEAD_Y + HEAD_R + 1.5], [-HEAD_R, HEAD_Y + HEAD_R + 1.5]], head.color);
    } else { // cap
      disc(ctx, 0, HEAD_Y + HEAD_R * 0.5, HEAD_R + 0.4, head.color);
      poly(ctx, [[-HEAD_R - 0.5, HEAD_Y + HEAD_R * 0.5], [HEAD_R + 0.5, HEAD_Y + HEAD_R * 0.5], [HEAD_R, HEAD_Y + HEAD_R * 0.5 + 1.4], [-HEAD_R, HEAD_Y + HEAD_R * 0.5 + 1.4]], shade(head.color, 0.8));
    }
  }
}

function drawTorso(ctx, skin, body, p) {
  const bw = TORSO_W / 2 + (p.breath || 0) * 0.3;
  const col = body ? body.color : shade(skin, 0.92);
  poly(ctx, [
    [-bw, HIP_Y], [bw, HIP_Y], [bw - 0.5, SHOULDER_Y + 0.5], [-bw + 0.5, SHOULDER_Y + 0.5],
  ], col);
  if (body && body.metal) { // a little plate highlight
    seg(ctx, -bw + 1, SHOULDER_Y - 1, -bw + 1, HIP_Y + 1, 1, shade(col, 1.25), 0.5);
  } else if (!body) {       // bare goblin loincloth
    poly(ctx, [[-bw, HIP_Y], [bw, HIP_Y], [bw - 1, HIP_Y + 3], [-bw + 1, HIP_Y + 3]], 0x6b4a2a);
  }
}

// draw a weapon in the hand, given the hand local point and the weapon angle
function drawWeapon(ctx, hx, hy, ang, w) {
  if (!w || w.kind === 'fist') return;
  const c = Math.cos(ang), s = Math.sin(ang);
  const tipX = hx + c * w.len, tipY = hy + s * w.len;
  const grip = w.color;
  switch (w.kind) {
    case 'spear':
      seg(ctx, hx - c * 4, hy - s * 4, tipX, tipY, 1.4, 0x8a5a2b);           // shaft
      poly(ctx, [[tipX, tipY], [tipX - c * 3 - s * 1.6, tipY - s * 3 + c * 1.6], [tipX - c * 3 + s * 1.6, tipY - s * 3 - c * 1.6]], 0xcfd3d8); // head
      break;
    case 'bow': break; // ranged handled separately (drawn as strung bow)
    case 'sword':
    case 'dagger':
      seg(ctx, hx, hy, tipX, tipY, 1.6, 0xd7dbe0);                            // blade
      seg(ctx, hx - s * 2, hy + c * 2, hx + s * 2, hy - c * 2, 1.4, 0x3a2a18); // crossguard
      break;
    case 'axe':
    case 'pick':
      seg(ctx, hx - c * 3, hy - s * 3, tipX, tipY, 1.5, 0x6b4325);           // haft
      poly(ctx, [[tipX, tipY], [tipX - s * 3.4, tipY + c * 3.4], [tipX + c * 3.4 - s * 2, tipY + s * 3.4 + c * 2], [tipX + c * 3, tipY + s * 3]], grip); // blade
      break;
    case 'mace':
      seg(ctx, hx - c * 3, hy - s * 3, tipX, tipY, 1.6, 0x4a3420);
      disc(ctx, tipX, tipY, 2.4, grip);
      break;
    case 'staff':
      seg(ctx, hx - c * 6, hy - s * 6, tipX, tipY, 1.4, 0x6b4325);
      disc(ctx, tipX, tipY, 1.8, 0x7fd0e0, 0.9);
      break;
    case 'rod':
      seg(ctx, hx - c * 3, hy - s * 3, tipX, tipY, 1.1, w.color);   // thin rod
      seg(ctx, tipX, tipY, tipX, tipY - 7, 0.6, 0xdfe7ef, 0.85);    // line hangs down
      break;
    default: // club
      seg(ctx, hx, hy, tipX, tipY, 2.2, grip);
  }
}

function drawBow(ctx, hx, hy, facingSign, draw, released) {
  // vertical-ish bow held in the lead hand; string pulls back with `draw`
  const top = [hx + facingSign * 1, hy + 7], bot = [hx + facingSign * 1, hy - 7];
  // limbs
  seg(ctx, hx + facingSign * 2, hy, top[0], top[1], 1.3, 0x6b4325);
  seg(ctx, hx + facingSign * 2, hy, bot[0], bot[1], 1.3, 0x6b4325);
  const pull = facingSign * (2 - draw * 5);
  ctx.g.lineStyle(0.8 * ctx.unit(), 0xe8e2c8, 0.9 * ctx.a);
  const [tx, ty] = ctx.P(top[0], top[1]); const [bx, by] = ctx.P(bot[0], bot[1]);
  const [nx, ny] = ctx.P(hx + pull, hy);
  ctx.g.beginPath(); ctx.g.moveTo(tx, ty); ctx.g.lineTo(nx, ny); ctx.g.lineTo(bx, by); ctx.g.strokePath();
  if (!released && draw > 0.05) seg(ctx, hx + pull, hy, hx + pull + facingSign * 5, hy, 0.9, 0x7a5230); // nocked arrow
}

function drawShield(ctx, sx, hint, back) {
  if (!hint) return;
  const c = hint.color;
  if (hint.shape === 'round') { disc(ctx, sx, SHOULDER_Y - 3, 3.6, c); disc(ctx, sx, SHOULDER_Y - 3, 1.4, shade(c, 1.3)); }
  else poly(ctx, [[sx - 2.6, SHOULDER_Y], [sx + 2.6, SHOULDER_Y], [sx + 2.6, HIP_Y + 1], [sx, HIP_Y - 3], [sx - 2.6, HIP_Y + 1]], c);
}

// ---------------------------------------------------------------------------
// Non-humanoid silhouettes. Each reads the same pose numbers (bob/legSwing/
// strike/topple/fade handled by the ctx transform) and draws in local space.
// ---------------------------------------------------------------------------
function qLeg(ctx, x, sw, col) {
  const footX = x + Math.sin(sw) * 3;
  seg(ctx, x, 7, footX, 0, 2.2, col);
}
function drawQuadruped(ctx, skin, p, facing, t) {
  const dark = shade(skin, 0.78), fore = shade(skin, 0.9);
  const bY = 8, ls = p.legSwing || 0, strike = p.strike || 0;
  if (facing === 'E' || facing === 'W') {
    seg(ctx, -8, bY + 1, -11.5, bY + 4 + Math.abs(ls) * 2, 1.4, dark);      // tail
    qLeg(ctx, -6, -ls, dark); qLeg(ctx, -4.5, ls * 0.7, dark);              // back pair
    qLeg(ctx, 4.5, ls, fore); qLeg(ctx, 6, -ls * 0.7, fore);               // front pair
    seg(ctx, -7, bY, 7, bY, 7.5, skin);                                     // body
    const hx = 9.5, hy = bY + 2 - strike * 2;                               // head dips on bite
    disc(ctx, hx, hy, 3.3, skin);
    poly(ctx, [[hx - 0.5, hy + 3], [hx + 1, hy + 6], [hx + 2, hy + 3]], dark); // ear
    disc(ctx, hx + 2.6, hy - 0.5, 1.5, dark);                               // snout
    disc(ctx, hx + 0.6, hy + 0.6, 0.7, 0x141414);                          // eye
  } else {
    const back = facing === 'N';
    qLeg(ctx, -4.5, ls, dark); qLeg(ctx, 4.5, -ls, dark);
    qLeg(ctx, -2, -ls * 0.6, fore); qLeg(ctx, 2, ls * 0.6, fore);
    seg(ctx, -5, bY, 5, bY, 8.5, skin);                                     // round body
    disc(ctx, 0, bY + 4.5, 3.6, skin);                                      // head / rump
    if (!back) {
      disc(ctx, -1.5, bY + 5, 0.7, 0x141414); disc(ctx, 1.5, bY + 5, 0.7, 0x141414);
      poly(ctx, [[-3, bY + 7], [-2, bY + 9.5], [-1, bY + 7]], dark);
      poly(ctx, [[3, bY + 7], [2, bY + 9.5], [1, bY + 7]], dark);
    } else {
      seg(ctx, 0, bY + 3, 0, bY + 8 + Math.abs(ls) * 2, 1.4, dark);        // tail up
    }
  }
}
function drawInsectoid(ctx, skin, p, facing, t) {
  const dark = shade(skin, 0.7);
  const bY = 6, wig = Math.sin(t / 130) * 0.5 + (p.legSwing || 0) * 0.5, strike = p.strike || 0;
  for (let i = 0; i < 4; i++) {
    const reach = 5 + i * 1.6, w = wig * (i % 2 ? -1 : 1);
    seg(ctx, 2, bY, 2 + reach * 0.5, bY + 3 + w, 1.0, dark);
    seg(ctx, 2 + reach * 0.5, bY + 3 + w, 2 + reach, 0, 1.0, dark);
    seg(ctx, -2, bY, -2 - reach * 0.5, bY + 3 - w, 1.0, dark);
    seg(ctx, -2 - reach * 0.5, bY + 3 - w, -2 - reach, 0, 1.0, dark);
  }
  disc(ctx, -2.5, bY + 1, 4.6, skin);   // abdomen
  disc(ctx, 3, bY, 2.6, dark);          // cephalothorax
  disc(ctx, 4, bY + 1, 0.6, 0xcf2b2b); disc(ctx, 4, bY - 0.6, 0.5, 0xcf2b2b); // eyes
  if (strike > 0.3) seg(ctx, 4.5, bY - 1, 5.8 + strike * 2, bY - 2, 0.9, 0xffffff); // fang lunge
}
function ellipsePts(cx, cy, rx, ry, n, wob, t) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const r = 1 + Math.sin(a * 3 + t / 200) * wob;
    pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
  }
  return pts;
}
function drawBlob(ctx, skin, p, facing, t) {
  const sq = 1 + Math.sin(t / 300) * 0.1 - (p.strike || 0) * 0.15;
  const rx = 8 / sq, ry = 7 * sq;
  poly(ctx, ellipsePts(0, ry * 0.9, rx, ry * 0.9, 16, 0.06, t), skin, 0.92);
  disc(ctx, -1.5, ry * 1.2, rx * 0.4, shade(skin, 1.18), 0.4);   // sheen
  if (facing !== 'N') {
    const ex = facing === 'E' ? 1.6 : facing === 'W' ? -1.6 : 0;
    disc(ctx, ex - 2.2, ry * 0.95, 1.1, 0xffffff); disc(ctx, ex + 2.2, ry * 0.95, 1.1, 0xffffff);
    disc(ctx, ex - 2.2, ry * 0.95, 0.5, 0x111111); disc(ctx, ex + 2.2, ry * 0.95, 0.5, 0x111111);
  }
}

// A winged flier (bats, etc.). Hovers above its ground shadow; membranous wings
// beat with time (and snap on an attack). Ears + glowing eyes read as "bat".
function drawAvian(ctx, skin, p, facing, t) {
  const dark = shade(skin, 0.7);
  const bY = 9;                                   // body floats above the feet/shadow
  const flap = Math.sin(t / 90) * 1.0 + (p.strike || 0) * 0.6;
  // wings first (behind body): membrane quads whose tips rise/fall with the beat
  const wy = bY + 1 + flap * 2.2;
  poly(ctx, [[-2, bY + 1], [-9, wy + 2], [-8, wy - 2.5], [-2.5, bY - 1]], dark, 0.95);
  poly(ctx, [[2, bY + 1], [9, wy + 2], [8, wy - 2.5], [2.5, bY - 1]], dark, 0.95);
  // dangling feet
  seg(ctx, -1, bY - 2, -1, bY - 4, 0.8, dark); seg(ctx, 1, bY - 2, 1, bY - 4, 0.8, dark);
  // body + head
  disc(ctx, 0, bY, 3.0, skin);
  disc(ctx, 0, bY + 3, 2.2, skin);
  poly(ctx, [[-1.4, bY + 5], [-2.6, bY + 8], [-0.5, bY + 5.5]], dark);  // ears
  poly(ctx, [[1.4, bY + 5], [2.6, bY + 8], [0.5, bY + 5.5]], dark);
  if (facing !== 'N') { disc(ctx, -1, bY + 3.2, 0.6, 0xffd23a); disc(ctx, 1, bY + 3.2, 0.6, 0xffd23a); }
}

// A legless serpent: a tapering chain of segments that undulates in a sine wave;
// the head (front) lunges forward on a strike, tongue flicking.
function drawSerpent(ctx, skin, p, facing, t) {
  const SEGS = 9, baseY = 4, lunge = (p.strike || 0) * 3;
  let hx = 0, hy = baseY;
  // long, thin, tapering body along a sine wave so it reads as a SNAKE, not a blob
  for (let i = 0; i < SEGS; i++) {
    const lx = -12 + i * 3.0 + lunge;
    const ly = baseY + Math.sin(t / 150 + i * 0.7) * 3.0;
    const r = 1.0 + i * 0.24;                      // thin tail -> thick neck
    disc(ctx, lx, ly, r, i % 2 ? shade(skin, 0.86) : skin);
    hx = lx; hy = ly;
  }
  const headX = hx + 2.3;                          // head just ahead of the neck
  disc(ctx, headX, hy, 2.9, skin);
  poly(ctx, [[headX + 1, hy + 1.7], [headX + 3.6, hy], [headX + 1, hy - 1.7]], skin); // snout
  if (facing !== 'N') disc(ctx, headX + 0.6, hy + 1.0, 0.55, 0x141414); // eye
  if (Math.sin(t / 200) > 0.4) {                   // forked tongue flick
    seg(ctx, headX + 3.6, hy, headX + 6, hy + 0.7, 0.5, 0xcf2b2b);
    seg(ctx, headX + 3.6, hy, headX + 6, hy - 0.7, 0.5, 0xcf2b2b);
  }
}

// ---------------------------------------------------------------------------
// The main entry point.
// ---------------------------------------------------------------------------
export function drawAvatar(g, cx, cy, state = {}) {
  const facing = state.facing || 'S';
  const skin = state.skin != null ? state.skin : SKIN;
  const gear = state.gear || gearHints(state.equipment || {});
  const p = pose(state);
  const isRanged = gear.weapon && (gear.weapon.kind === 'bow' || gear.weapon.kind === 'cbow');

  // ground shadow — drawn flat, before the (bobbing/toppling) body
  if (state.shadow !== false) {
    const u = state.scale || 1;
    g.fillStyle(0x000000, 0.26 * (p.fade == null ? 1 : p.fade));
    g.fillEllipse(cx, cy + 1.5 * u, 8 * u, 2.4 * u);
  }

  const profile = facing === 'E' || facing === 'W';
  const mirror = facing === 'W';                 // left-facing profile / west
  const facingSign = 1;                          // local +x is "forward" (mirror handles W)
  const bootCol = 0x3a2a1a;
  const legCol = shade(skin, 0.82);
  const armCol = skin;

  const ctx = makeCtx(g, cx, cy, {
    scale: state.scale || 1,
    mirror,
    bob: p.bob - (p.recoil || 0) * 0.2,
    lunge: (p.lunge || 0) - (p.recoil || 0),
    rot: p.topple ? (mirror ? p.topple : -p.topple) : 0,
    alpha: p.fade,
  });

  const wStyle = p.strikeStyle;
  const skilling = state.anim === 'skill';
  const drawWeap = skilling ? state.tool : gear.weapon;   // hold the tool while skilling
  const rangedNow = isRanged && !skilling;
  const swing = state.anim === 'attack' ? weaponAngle(wStyle, p.strike)
    : skilling ? skillAngle(state.skillType, p.strike, state.t || 0)
    : (p.armSwing || 0) * 0.4 - 0.2;
  // Pole weapons (spear/halberd) look wrong jutting straight out at rest — carry
  // a held spear UPRIGHT (near-vertical, tip up) while the arm keeps `swing`.
  // Mid-attack/skilling keep the real swing so the stab still reads.
  const spearUpright = state.anim !== 'attack' && !skilling && drawWeap && drawWeap.kind === 'spear';
  const weapAng = spearUpright ? 1.45 : swing;

  // ---- boss aura (all body types): a pulsing glow behind the rig ----------
  if (state.boss) {
    const tt = state.t || 0;
    const pulse = 0.5 + 0.5 * Math.sin(tt / 300);
    const [ax, ay] = ctx.P(0, 11);
    const a = (p.fade == null ? 1 : p.fade);
    const R = (18 + pulse * 4) * ctx.unit();
    g.fillStyle(0xffca3a, (0.16 + 0.12 * pulse) * a); g.fillCircle(ax, ay, R);
    g.fillStyle(0xff7a2a, (0.13 + 0.10 * pulse) * a); g.fillCircle(ax, ay, (11 + pulse * 3) * ctx.unit());
    g.lineStyle(1.5 * ctx.unit(), 0xffe08a, (0.45 + 0.3 * pulse) * a); g.strokeCircle(ax, ay, R);
  }

  // ---- non-humanoid silhouettes short-circuit here -----------------------
  const bodyType = state.bodyType || 'humanoid';
  if (bodyType !== 'humanoid') {
    const t = state.t || 0;
    if (bodyType === 'quadruped') drawQuadruped(ctx, skin, p, facing, t);
    else if (bodyType === 'insectoid') drawInsectoid(ctx, skin, p, facing, t);
    else if (bodyType === 'avian') drawAvian(ctx, skin, p, facing, t);
    else if (bodyType === 'serpent') drawSerpent(ctx, skin, p, facing, t);
    else drawBlob(ctx, skin, p, facing, t);
    if (p.flash > 0) {
      fill(ctx, 0xff4030, 0.5 * p.flash);
      const [hx, hy] = ctx.P(0, 7);
      g.fillCircle(hx, hy, 10 * ctx.unit());
    }
    return;
  }

  // ---- draw order depends on the view ------------------------------------
  if (!profile) {
    // FRONT (S) or BACK (N): symmetric, two legs, two arms
    const back = facing === 'N';
    drawCape(ctx, gear.cape, p, back ? 1 : -1);
    // legs
    drawLeg(ctx, -2.2, back ? p.legSwing : -p.legSwing, legCol, bootCol);
    drawLeg(ctx, 2.2, back ? -p.legSwing : p.legSwing, legCol, bootCol);
    // off-arm (holds shield if any) behind torso
    const offAng = Math.PI - 0.4 + (p.armSwing || 0);
    const [ohx, ohy] = drawArm(ctx, -TORSO_W / 2 + 0.5, offAng, armCol);
    if (gear.shield) drawShield(ctx, -TORSO_W / 2 - 1.5, gear.shield, back);
    drawTorso(ctx, skin, gear.body, p);
    drawHead(ctx, skin, gear.head, facing);
    // weapon arm (screen-right hand)
    if (rangedNow) {
      const draw = state.anim === 'attack' ? p.bowDraw : 0;   // 0 = bow at rest (held while walking)
      const rel = state.anim === 'attack' ? p.released : false;
      const [bhx, bhy] = drawArm(ctx, TORSO_W / 2 - 0.5, -0.2, armCol);
      if (draw > 0.05) drawArm(ctx, -TORSO_W / 2 + 1, 0.2 - draw * 0.6, armCol, ARM_LEN * (1 - draw * 0.2));
      drawBow(ctx, bhx, bhy, 1, draw, rel);
    } else {
      const wristAng = swing;
      const [whx, why] = drawArm(ctx, TORSO_W / 2 - 0.5, wristAng, armCol);
      if (skilling) drawArm(ctx, -TORSO_W / 2 + 1, wristAng - 0.15, armCol); // second hand on the tool
      drawWeapon(ctx, whx, why, weapAng, drawWeap);
    }
  } else {
    // PROFILE (E/W): far limbs first, then torso/head, then near limbs
    drawCape(ctx, gear.cape, p, -1);
    drawLeg(ctx, -1.5, -p.legSwing, shade(legCol, 0.85), shade(bootCol, 0.9)); // far leg
    // far/off arm
    const offAng = Math.PI - 0.5 + (p.armSwing || 0) * 0.6;
    drawArm(ctx, -1, offAng, shade(armCol, 0.85));
    if (gear.shield) drawShield(ctx, -2, gear.shield, false);
    drawTorso(ctx, skin, gear.body, p);
    drawHead(ctx, skin, gear.head, facing);
    drawLeg(ctx, 1.5, p.legSwing, legCol, bootCol);                            // near leg
    // near arm + weapon
    if (rangedNow) {
      const draw = state.anim === 'attack' ? p.bowDraw : 0;
      const rel = state.anim === 'attack' ? p.released : false;
      const [bhx, bhy] = drawArm(ctx, 1.5, -0.1, armCol);
      drawBow(ctx, bhx, bhy, facingSign, draw, rel);
    } else {
      const nearAng = swing;
      const [whx, why] = drawArm(ctx, 1.5, nearAng, armCol);
      drawWeapon(ctx, whx, why, weapAng, drawWeap);
    }
  }

  // ---- hit flash overlay --------------------------------------------------
  if (p.flash > 0) {
    fill(ctx, 0xff4030, 0.5 * p.flash);
    const [hx, hy] = ctx.P(0, SHOULDER_Y - 4);
    g.fillCircle(hx, hy, 9 * ctx.unit());
  }
}

// ---------------------------------------------------------------------------
// deriveAvatarState(entity, opts) — convenience so main.js can turn a Player /
// NPC + Game into an avatar `state` without duplicating the mapping logic.
// `entity` needs: px, py (render px), tileX, tileY, plus we read facing/anim
// hints off it (see below). This is intentionally forgiving: any missing field
// falls back to a sane default so it also works for simple NPCs.
// ---------------------------------------------------------------------------
export function deriveAvatarState(entity, opts = {}) {
  const now = opts.now || 0;
  // --- facing: prefer an explicit entity.facing, else infer from last move ---
  let facing = entity.facing;
  if (!facing && entity._lastTileX != null) {
    const dx = entity.tileX - entity._lastTileX, dy = entity.tileY - entity._lastTileY;
    if (dx || dy) facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
  }
  facing = facing || 'S';

  // --- animation state ---
  let anim = 'idle';
  let phase = 0;
  if (opts.dead) { anim = 'dead'; phase = clamp01(opts.deadPhase == null ? 1 : opts.deadPhase); }
  else if (opts.attacking) { anim = 'attack'; phase = clamp01(opts.attackPhase || 0); }
  else if (opts.hit) { anim = 'hit'; phase = clamp01(opts.hitPhase || 0); }
  else if (opts.moving) anim = 'walk';

  return {
    facing, anim, phase, t: now,
    weaponStyle: opts.weaponStyle || (opts.equipment ? weaponStyleFor(opts.equipment.weapon) : 'unarmed'),
    gear: opts.gear || gearHints(opts.equipment || {}),
    skin: opts.skin, scale: opts.scale || 1,
  };
}
