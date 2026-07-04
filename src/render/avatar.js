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
import { shade } from './clay.js';   // shared warm-clay primitive (also drives props.js)

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
const HEAD_R = 5.4;       // slightly big cute head, toward the ref
const ARM_LEN = 8.5;
const LEG_LEN = 11;
const TORSO_W = 8;     // shoulder width (front view)

// ---- palette --------------------------------------------------------------
const SKIN = 0x6fbf3f;
// `shade` (warm-clay ramp + clamp) now lives in ./clay.js so the character rig
// and the procedural props render with one identical primitive. Imported above.

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
  const u = ctx.unit();
  if (r >= 3) { // body mass -> soft clay: shadow base, top-lit face, small highlight
    fill(ctx, shade(color, 0.7), alpha);        ctx.g.fillCircle(x, y, r * u);
    fill(ctx, color, alpha);                    ctx.g.fillCircle(x, y - r * 0.16 * u, r * 0.9 * u);
    fill(ctx, shade(color, 1.18), alpha * 0.5); ctx.g.fillCircle(x, y - r * 0.34 * u, r * 0.42 * u);
    return;
  }
  fill(ctx, color, alpha);
  ctx.g.fillCircle(x, y, r * u);
}
// thick capsule-ish limb between two local points
function seg(ctx, x1, y1, x2, y2, w, color, alpha = 1) {
  const [ax, ay] = ctx.P(x1, y1);
  const [bx, by] = ctx.P(x2, y2);
  const u = ctx.unit();
  if (w >= 2.2) { // thick limb -> soft clay: a deep shadow underlay for round volume
    ctx.g.lineStyle(w * u, shade(color, 0.6), alpha * ctx.a);
    ctx.g.beginPath(); ctx.g.moveTo(ax, ay + w * 0.26 * u); ctx.g.lineTo(bx, by + w * 0.26 * u); ctx.g.strokePath();
  }
  ctx.g.lineStyle(w * u, color, alpha * ctx.a);
  ctx.g.beginPath(); ctx.g.moveTo(ax, ay); ctx.g.lineTo(bx, by); ctx.g.strokePath();
  fill(ctx, color, alpha);
  ctx.g.fillCircle(ax, ay, (w / 2) * u);
  ctx.g.fillCircle(bx, by, (w / 2) * u);
  if (w >= 2.2) { // bright, wide top highlight — clear top-lit rounded clay read
    ctx.g.lineStyle(w * 0.52 * u, shade(color, 1.32), alpha * ctx.a * 0.75);
    ctx.g.beginPath(); ctx.g.moveTo(ax, ay - w * 0.26 * u); ctx.g.lineTo(bx, by - w * 0.26 * u); ctx.g.strokePath();
  }
}
function worldPts(ctx, pts) {
  return pts.map(([lx, ly]) => { const [x, y] = ctx.P(lx, ly); return { x, y }; });
}
// Soft-clay polygon. Big opaque masses (torso, cape, hood, shield, cobra-hood,
// moth-wing, frog-belly…) get the same 3-tone treatment as disc/seg — a shadow base,
// a top-lit core scaled toward the centroid and nudged UP toward the key light, and a
// small highlight — so nothing reads as a flat cut-out. Small accents (tusks, boots,
// nasal bars, snouts, markings) and anything translucent stay flat + crisp.
function poly(ctx, pts, color, alpha = 1) {
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, cx = 0, cy = 0;
  for (const [x, y] of pts) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; cx += x; cy += y; }
  cx /= pts.length; cy /= pts.length;
  const h = maxy - miny;
  if ((maxx - minx) * h >= 15 && alpha >= 0.9) {          // big + opaque -> clay
    const lay = (f, dy) => pts.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f + dy]);
    fill(ctx, shade(color, 0.74), alpha);       ctx.g.fillPoints(worldPts(ctx, pts), true);
    fill(ctx, color, alpha);                    ctx.g.fillPoints(worldPts(ctx, lay(0.90, h * 0.10)), true);
    fill(ctx, shade(color, 1.16), alpha * 0.5); ctx.g.fillPoints(worldPts(ctx, lay(0.55, h * 0.22)), true);
    return;
  }
  fill(ctx, color, alpha);
  ctx.g.fillPoints(worldPts(ctx, pts), true);
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

// Resting hold angle by weapon kind (local radians; +up, 0 = forward). At idle/walk
// a weapon should sit naturally, not jut straight out along the arm: poles stand
// UPRIGHT (tip up); blades/hafts hang LOWERED at the side. Ranged/fist → null
// (bows are drawn separately; fists have nothing to orient).
function weaponRestAngle(kind) {
  switch (kind) {
    case 'spear': case 'staff': return 1.45;   // upright pole
    case 'bow': case 'cbow': case 'fist': return null;
    default: return -1.15;                      // sword/dagger/axe/pick/mace/club: lowered
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
  seg(ctx, rootX, HIP_Y, kneeX, kneeY, 3.9, color);
  seg(ctx, kneeX, kneeY, footX, footY, 3.5, color);
  // boot — a chunky rounded clay boot
  poly(ctx, [[footX - 1.8, footY], [footX + 2.9, footY], [footX + 2.9, footY - 1.9], [footX - 1.8, footY - 1.9]], bootColor);
}

function drawArm(ctx, shoulderX, angle, color, len = ARM_LEN) {
  const elbowX = shoulderX + Math.cos(angle) * len * 0.55;
  const elbowY = SHOULDER_Y + Math.sin(angle) * len * 0.55;
  const handX = shoulderX + Math.cos(angle) * len;
  const handY = SHOULDER_Y + Math.sin(angle) * len;
  seg(ctx, shoulderX, SHOULDER_Y, elbowX, elbowY, 3.2, color);
  seg(ctx, elbowX, elbowY, handX, handY, 2.8, color);
  return [handX, handY];
}

function drawHead(ctx, skin, head, facing, feat = {}) {
  const back = facing === 'N';
  const dark = shade(skin, 0.85);
  // ---- ears (goblin points by default; bigger for 'goblin', none for humans) ----
  const ears = feat.ears || 'default';
  if (ears !== 'none') {
    const el = ears === 'goblin' ? 5 : 3;            // ear length
    const ey = ears === 'goblin' ? 4.5 : 3;
    poly(ctx, [[-HEAD_R, HEAD_Y + 1], [-HEAD_R - el, HEAD_Y + ey], [-HEAD_R, HEAD_Y + 3]], dark);
    poly(ctx, [[HEAD_R, HEAD_Y + 1], [HEAD_R + el, HEAD_Y + ey], [HEAD_R, HEAD_Y + 3]], dark);
  }
  disc(ctx, 0, HEAD_Y - HEAD_R * 0.85, HEAD_R * 0.42, shade(skin, 0.5), 0.28); // soft neck/chin contact AO
  disc(ctx, 0, HEAD_Y, HEAD_R, skin);
  if (!back) {
    const ex = facing === 'E' ? 1.6 : facing === 'W' ? -1.6 : 0;
    // heavy brow ridge (trolls / brutes) — a dark bar shading the eyes
    if (feat.brow) seg(ctx, ex - 2.2, HEAD_Y + 1.8, ex + 2.2, HEAD_Y + 1.8, 1.4, shade(skin, 0.6));
    const eyeWhite = feat.eyeGlow ? feat.eyeGlow : 0xf2e9c0;
    const pupil = feat.eyeGlow ? feat.eyeGlow : (feat.eyeColor || 0x1a1a12);
    const er = 1.15, pr = 0.72;                       // bigger, cuter eyes (the ref is big-eyed)
    disc(ctx, ex - 1.7, HEAD_Y + 0.5, er, eyeWhite, feat.eyeGlow ? 0.55 : 1);
    disc(ctx, ex + 1.7, HEAD_Y + 0.5, er, eyeWhite, feat.eyeGlow ? 0.55 : 1);
    disc(ctx, ex - 1.7, HEAD_Y + 0.4, pr, pupil);
    disc(ctx, ex + 1.7, HEAD_Y + 0.4, pr, pupil);
    if (!feat.eyeGlow) {                              // wet-clay catchlight (upper-left, matches the key light)
      disc(ctx, ex - 2.0, HEAD_Y + 0.85, 0.3, 0xffffff, 0.92);
      disc(ctx, ex + 1.4, HEAD_Y + 0.85, 0.3, 0xffffff, 0.92);
    }
    if (feat.eyeGlow) { // faint glow aura
      disc(ctx, ex - 1.6, HEAD_Y + 0.6, 1.4, feat.eyeGlow, 0.25);
      disc(ctx, ex + 1.6, HEAD_Y + 0.6, 1.4, feat.eyeGlow, 0.25);
    }
    if (facing === 'E' || facing === 'W') disc(ctx, ex * 1.8, HEAD_Y - 0.6, 1.1, shade(skin, 0.8)); // snout
    // tusks (trolls / ogres): two ivory tusks jutting up from the jaw
    if (feat.tusks) {
      poly(ctx, [[ex - 1.6, HEAD_Y - 2], [ex - 2.2, HEAD_Y - 4.5], [ex - 0.9, HEAD_Y - 2]], 0xe8e0c0);
      poly(ctx, [[ex + 1.6, HEAD_Y - 2], [ex + 2.2, HEAD_Y - 4.5], [ex + 0.9, HEAD_Y - 2]], 0xe8e0c0);
    } else if (feat.teeth) { // snaggle teeth (goblins)
      seg(ctx, ex - 0.8, HEAD_Y - 1.8, ex - 0.8, HEAD_Y - 3, 0.6, 0xf0ead0);
    }
    // warts (trolls): a couple of darker bumps
    if (feat.warts) { disc(ctx, ex - 2.4, HEAD_Y + 2.6, 0.7, dark); disc(ctx, ex + 2.6, HEAD_Y - 0.8, 0.6, dark); }
  } else {
    disc(ctx, 0, HEAD_Y + 1, HEAD_R * 0.8, shade(skin, 0.7)); // back of skull
  }
  // ---- horns (imps / demons): curved horns rising from the crown ----
  if (feat.horns) {
    const hc = feat.hornColor || shade(skin, 0.55);
    poly(ctx, [[-2.5, HEAD_Y + HEAD_R - 1], [-4.5, HEAD_Y + HEAD_R + 3.5], [-3, HEAD_Y + HEAD_R + 4], [-1.5, HEAD_Y + HEAD_R - 0.5]], hc);
    poly(ctx, [[2.5, HEAD_Y + HEAD_R - 1], [4.5, HEAD_Y + HEAD_R + 3.5], [3, HEAD_Y + HEAD_R + 4], [1.5, HEAD_Y + HEAD_R - 0.5]], hc);
  }
  // helm on top
  if (head) {
    if (head.kind === 'full') {
      // full helm: covers the whole head (only the ear tips poke out), domed
      // crown, with a dark visor slit + nasal bar on the front.
      disc(ctx, 0, HEAD_Y, HEAD_R + 0.4, head.color);                              // clay dome (already volumetric)
      disc(ctx, 0, HEAD_Y + HEAD_R * 0.5, 2.4, shade(head.color, 1.18), 0.6);       // soft crown highlight (flat, no wash)
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
  disc(ctx, -bw + 0.8, SHOULDER_Y - 0.6, 1.6, shade(col, 0.6), 0.2);   // shoulder AO
  disc(ctx,  bw - 0.8, SHOULDER_Y - 0.6, 1.6, shade(col, 0.6), 0.2);
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
      seg(ctx, hx - c * 3, hy - s * 3, tipX, tipY, 1.5, 0x6b4325);           // haft
      poly(ctx, [[tipX, tipY], [tipX - s * 3.4, tipY + c * 3.4], [tipX + c * 3.4 - s * 2, tipY + s * 3.4 + c * 2], [tipX + c * 3, tipY + s * 3]], grip); // single side blade
      break;
    case 'pick':
      seg(ctx, hx - c * 3, hy - s * 3, tipX, tipY, 1.5, 0x6b4325);           // haft
      // double-ended head: spikes out BOTH sides of the tip (perpendicular to the
      // haft) with a slight forward sweep — reads as a pick, not a one-sided axe
      // blade and not a spear point. (see COORDINATION.md: pickaxe-vs-axe.)
      poly(ctx, [
        [tipX - s * 5, tipY + c * 5],           // one spike tip
        [tipX + c * 1.6, tipY + s * 1.6],       // forward belly, ahead of the haft
        [tipX + s * 5, tipY - c * 5],           // other spike tip
        [tipX - c * 1.2, tipY - s * 1.2],       // back notch behind the tip
      ], grip);
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
// one leg: upper + lower with a knee bend; thickness varies by build
function qLeg(ctx, x, sw, col, len = 7, thick = 2.2) {
  const footX = x + Math.sin(sw) * 3, kneeX = x + Math.sin(sw) * 1.4;
  seg(ctx, x, len, kneeX, len * 0.5, thick, col);
  seg(ctx, kneeX, len * 0.5, footX, 0, thick * 0.85, col);
}

// Tail styles: each land-beast silhouette gets a recognisable tail.
function qTail(ctx, style, x, y, col, ls) {
  const w = Math.abs(ls) * 2;
  if (style === 'bushy') {                                   // wolf: thick sweeping brush
    seg(ctx, x + 1, y, x - 3, y + 3 + w, 3.4, col);
    seg(ctx, x - 1, y + 1.5, x - 4.5, y + 6 + w, 2.2, shade(col, 0.85));
  } else if (style === 'rope') {                             // rat: long thin naked tail
    seg(ctx, x + 1, y, x - 4, y + 1 + w, 1.0, col);
    seg(ctx, x - 4, y + 1 + w, x - 6.5, y - 2 + w, 0.8, col);
  } else if (style === 'curl') {                             // boar: little curl
    seg(ctx, x + 1, y + 1, x - 1.5, y + 3, 1.1, col);
  } else if (style === 'stub') {
    disc(ctx, x, y + 1, 1.6, col);
  } else if (style === 'long') {                             // lizard: long tapering
    for (let i = 0; i < 4; i++) disc(ctx, x - i * 2.4, y + i * 0.5 + w * 0.3, 2.0 - i * 0.42, col);
  } else if (style !== 'none') {
    seg(ctx, x + 1, y + 1, x - 3.5, y + 4 + w, 1.5, col);    // generic
  }
}

// Head detailing keyed to features: snout shape, ears, eyes, tusks/fangs.
function qHead(ctx, feat, hx, hy, skin, dark, ec, strike) {
  const snout = feat.snout || 'long', ears = feat.ears || 'pointed';
  // ears (behind the head disc)
  if (ears === 'pointed') {
    poly(ctx, [[hx - 1.5, hy + 2.5], [hx - 1, hy + 6.5], [hx + 1, hy + 3]], dark);
    poly(ctx, [[hx + 1.5, hy + 2.8], [hx + 2.5, hy + 6.5], [hx + 3.2, hy + 3]], dark);
  } else if (ears === 'round') {                             // rat: big round cups
    disc(ctx, hx - 1, hy + 3.6, 2.1, dark); disc(ctx, hx + 2.6, hy + 3.6, 2.1, dark);
    disc(ctx, hx - 1, hy + 3.6, 1.1, shade(skin, 1.2)); disc(ctx, hx + 2.6, hy + 3.6, 1.1, shade(skin, 1.2));
  } else if (ears === 'small') {
    disc(ctx, hx - 0.6, hy + 3.4, 1.2, dark); disc(ctx, hx + 2, hy + 3.4, 1.2, dark);
  }
  // head + snout
  disc(ctx, hx, hy, 3.2, skin);
  if (snout === 'long') {                                    // canine muzzle
    seg(ctx, hx + 1.5, hy - 0.2, hx + 5.2, hy - 1.2, 2.4, skin);
    disc(ctx, hx + 5.2, hy - 1.2, 1.1, dark);                // nose
  } else if (snout === 'pointed') {                          // rodent point
    poly(ctx, [[hx + 1, hy + 1.4], [hx + 5, hy - 0.3], [hx + 1, hy - 1.6]], skin);
    disc(ctx, hx + 4.7, hy - 0.3, 0.7, 0xd98a8a);
  } else if (snout === 'snout') {                            // boar disc-snout
    disc(ctx, hx + 3.2, hy - 0.4, 1.9, skin);
    disc(ctx, hx + 3.8, hy - 1.1, 0.45, dark); disc(ctx, hx + 3.8, hy + 0.3, 0.45, dark);
  } else if (snout === 'blunt') {                            // bear
    disc(ctx, hx + 2.8, hy - 0.6, 1.9, skin); disc(ctx, hx + 3.7, hy - 0.6, 0.8, dark);
  } else if (snout === 'wide') {                             // frog wide mouth
    seg(ctx, hx - 1, hy - 1.8, hx + 3.5, hy - 1.8, 1.4, dark, 0.85);
  }
  // eyes — frogs bulge on top, everyone else has a side eye
  if (feat.eyesTop) {
    disc(ctx, hx - 1.2, hy + 3, 1.5, skin); disc(ctx, hx + 1.4, hy + 3, 1.5, skin);
    disc(ctx, hx - 1.2, hy + 3.2, 0.7, ec); disc(ctx, hx + 1.4, hy + 3.2, 0.7, ec);
  } else {
    disc(ctx, hx + 1, hy + 0.7, 0.9, ec); disc(ctx, hx + 1, hy + 0.7, 0.4, 0x0a0a0a);
  }
  // tusks (boar) / fangs (wolf, bear) / buck teeth (rat)
  if (feat.tusks) {
    poly(ctx, [[hx + 3.4, hy - 1.6], [hx + 4.8, hy - 4], [hx + 4, hy - 1.2]], 0xe8e0c0);
    poly(ctx, [[hx + 2.2, hy - 1.6], [hx + 1.2, hy - 3.6], [hx + 1.7, hy - 1.2]], 0xe8e0c0);
  }
  if (feat.fangs && (snout === 'long' || snout === 'blunt')) {
    const mx = hx + (snout === 'long' ? 4.6 : 3.4);
    seg(ctx, mx, hy - 1.6, mx + 0.3, hy - 3.2, 0.7, 0xffffff);
    if (strike > 0.4) seg(ctx, mx - 1, hy - 1.6, mx - 0.7, hy - 3.4, 0.7, 0xffffff);
  }
  if (feat.teeth === 'buck') {
    seg(ctx, hx + 3.6, hy - 1, hx + 3.6, hy - 2.6, 0.8, 0xf0ead0);
  }
}

function drawQuadruped(ctx, skin, p, facing, t, feat = {}) {
  const dark = shade(skin, 0.76), fore = shade(skin, 0.9);
  const bY = 8, ls = p.legSwing || 0, strike = p.strike || 0;
  const build = feat.build || 'canine';
  const bodyLen = build === 'rodent' ? 6 : build === 'bulky' ? 8 : build === 'squat' ? 5.5 : 7;
  const bodyW = build === 'bulky' ? 9.5 : build === 'squat' ? 8.5 : build === 'rodent' ? 6.5 : 7.5;
  const legLen = build === 'squat' ? 5 : 7;
  const legThick = build === 'bulky' ? 2.8 : build === 'rodent' ? 1.7 : 2.2;
  const ec = feat.eyeColor || 0x141414;

  if (facing === 'E' || facing === 'W') {
    qTail(ctx, feat.tail || 'plain', -bodyLen - 1, bY, dark, ls);
    qLeg(ctx, -bodyLen + 1.5, -ls, dark, legLen, legThick);
    qLeg(ctx, -bodyLen + 3, ls * 0.7, dark, legLen, legThick);
    qLeg(ctx, bodyLen - 3, ls, fore, legLen, legThick);
    qLeg(ctx, bodyLen - 1.5, -ls * 0.7, fore, legLen, legThick);
    seg(ctx, -bodyLen, bY, bodyLen, bY, bodyW, skin);                       // barrel body
    if (build === 'bulky') disc(ctx, -1.5, bY + bodyW * 0.42, bodyW * 0.5, skin); // shoulder hump
    if (feat.build === 'squat') disc(ctx, 0, bY - 1, bodyW * 0.55, shade(skin, 1.12), 0.5); // frog belly
    qHead(ctx, feat, bodyLen + 1.5, bY + 1.5 - strike * 2, skin, dark, ec, strike);
  } else {
    const back = facing === 'N';
    qLeg(ctx, -bodyW * 0.5, ls, dark, legLen, legThick); qLeg(ctx, bodyW * 0.5, -ls, dark, legLen, legThick);
    qLeg(ctx, -bodyW * 0.25, -ls * 0.6, fore, legLen, legThick); qLeg(ctx, bodyW * 0.25, ls * 0.6, fore, legLen, legThick);
    seg(ctx, -bodyW * 0.6, bY, bodyW * 0.6, bY, bodyW + 1, skin);
    disc(ctx, 0, bY + 4.5, 3.6, skin);                                      // head / rump
    if (!back) {
      // ears by style, facing the camera
      if ((feat.ears || 'pointed') === 'round') { disc(ctx, -2.4, bY + 6.5, 1.8, dark); disc(ctx, 2.4, bY + 6.5, 1.8, dark); }
      else if (feat.ears !== 'none' && feat.ears !== 'small') { poly(ctx, [[-3, bY + 7], [-2, bY + 10], [-1, bY + 7]], dark); poly(ctx, [[3, bY + 7], [2, bY + 10], [1, bY + 7]], dark); }
      disc(ctx, -1.4, bY + 5, 0.8, ec); disc(ctx, 1.4, bY + 5, 0.8, ec);
      if (feat.tusks) { poly(ctx, [[-1.5, bY + 3], [-2.5, bY + 1], [-0.8, bY + 3.2]], 0xe8e0c0); poly(ctx, [[1.5, bY + 3], [2.5, bY + 1], [0.8, bY + 3.2]], 0xe8e0c0); }
    } else {
      qTail(ctx, feat.tail === 'none' ? 'plain' : (feat.tail || 'plain'), 0, bY + 3, dark, ls);
    }
  }
}
function drawInsectoid(ctx, skin, p, facing, t, feat = {}) {
  const dark = shade(skin, 0.6), mid = shade(skin, 0.8);
  const bY = 6;
  const wig = Math.sin(t / 130) * 0.5 + (p.legSwing || 0) * 0.5;
  const strike = p.strike || 0;
  const legPairs = feat.legPairs || 4;          // spiders 4, insects 3
  const legW = feat.legW || 1.0;
  const ab = feat.abdomen || 1;                 // abdomen bulk multiplier
  const abX = -2.5 * ab;

  // Legs: two-segment, bent-knee legs that splay out and taper. A subtle idle
  // ripple + the walk swing animate them; a strike braces the front pair.
  for (let i = 0; i < legPairs; i++) {
    const reach = 4.5 + i * 1.7, w = wig * (i % 2 ? -1 : 1);
    const kneeUp = 3.4 + w + strike * (i === legPairs - 1 ? -1.5 : 0);
    seg(ctx, 2, bY, 2 + reach * 0.55, bY + kneeUp, legW, dark);
    seg(ctx, 2 + reach * 0.55, bY + kneeUp, 2 + reach, bY - 0.5, legW, dark);
    seg(ctx, -2, bY, -2 - reach * 0.55, bY + kneeUp, legW, dark);
    seg(ctx, -2 - reach * 0.55, bY + kneeUp, -2 - reach, bY - 0.5, legW, dark);
  }

  // Abdomen (bulbous), with an optional glossy sheen highlight.
  disc(ctx, abX, bY + 1, 4.7 * ab, skin);
  if (feat.gloss) disc(ctx, abX - 1.3, bY + 2.8, 1.7 * ab, shade(skin, 1.5), feat.gloss);

  // Abdomen marking — e.g. a widow's red hourglass, unmistakably a spider.
  if (feat.mark === 'hourglass') {
    const mc = feat.markColor || 0xc0392b;
    poly(ctx, [[abX, bY + 1], [abX - 1.5, bY - 0.6], [abX + 1.5, bY - 0.6]], mc, 0.95);
    poly(ctx, [[abX, bY + 1], [abX - 1.5, bY + 2.6], [abX + 1.5, bY + 2.6]], mc, 0.95);
  } else if (feat.mark === 'stripes') {
    const mc = feat.markColor || shade(skin, 0.5);
    for (let s = -1; s <= 1; s++) seg(ctx, abX - 3, bY + 1 + s * 1.6, abX + 3, bY + 1 + s * 1.6, 0.7, mc, 0.7);
  }

  // Cephalothorax (front body segment).
  disc(ctx, 3, bY, 2.7, mid);

  // Eyes: a spider's glinting cluster, or a simple pair.
  const ec = feat.eyeColor || 0xcf2b2b;
  if (feat.eyes === 'cluster') {
    for (const [dx, dy] of [[3.4, 0.9], [4.3, 0.5], [3.4, -0.3], [4.3, -0.9], [2.8, 0.3], [2.8, -0.6]]) {
      disc(ctx, dx, bY + dy, 0.5, ec);
    }
  } else {
    disc(ctx, 4, bY + 1, 0.6, ec); disc(ctx, 4, bY - 0.6, 0.55, ec);
  }

  // Chelicerae / fangs — always shown for fanged creatures; snap forward on a bite.
  if (feat.fangs || strike > 0.3) {
    const lunge = strike * 2;
    seg(ctx, 4.6, bY + 1.4, 5.9 + lunge, bY + 2.7, 0.9, dark);
    seg(ctx, 4.6, bY - 1.4, 5.9 + lunge, bY - 2.7, 0.9, dark);
    if (strike > 0.3) {
      disc(ctx, 5.9 + lunge, bY + 2.7, 0.5, 0xffffff);
      disc(ctx, 5.9 + lunge, bY - 2.7, 0.5, 0xffffff);
    }
  }

  // Optional pincers (crabs/scorpions) — claw arms reaching forward.
  if (feat.pincers) {
    for (const s of [1, -1]) {
      seg(ctx, 4, bY + 2.2 * s, 7, bY + 3.2 * s, 1.3, mid);
      poly(ctx, [[7, bY + 2.2 * s], [9, bY + 3.5 * s], [7, bY + 4 * s]], mid);
    }
  }
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
function drawBlob(ctx, skin, p, facing, t, feat = {}) {
  const strike = p.strike || 0;
  const ex = facing === 'E' ? 1.6 : facing === 'W' ? -1.6 : 0;

  if (feat.blob === 'wisp') {
    // A floating spirit: a soft glowing orb hovering above trailing tendrils,
    // faintly translucent with a bright inner core. Reads as ghostly, not gooey.
    const floatY = 9 + Math.sin(t / 400) * 1.2;
    const glow = feat.glow || 0x9fe8ff;
    disc(ctx, 0, floatY, 8, glow, 0.14);                    // outer halo
    disc(ctx, 0, floatY, 5.5, glow, 0.18);
    // wispy tendrils drifting below
    for (let i = -1; i <= 1; i++) {
      const wob = Math.sin(t / 260 + i) * 1.5;
      seg(ctx, i * 2, floatY - 3, i * 2 + wob, floatY - 8, 1.4, skin, 0.5);
    }
    disc(ctx, 0, floatY, 4.2, skin, 0.6);                   // translucent body
    disc(ctx, 0, floatY, 2.0, feat.core || 0xffffff, 0.85); // bright core
    if (facing !== 'N') {
      disc(ctx, ex - 1.6, floatY + 0.5, 0.8, glow); disc(ctx, ex + 1.6, floatY + 0.5, 0.8, glow);
    }
    return;
  }

  // Gooey slime: a squashing translucent dome with an inner nucleus, a wet sheen,
  // and little drips at the base.
  const sq = 1 + Math.sin(t / 300) * 0.12 - strike * 0.18;
  const rx = 8 / sq, ry = 7 * sq;
  const alpha = feat.translucent || 0.9;
  poly(ctx, ellipsePts(0, ry * 0.9, rx, ry * 0.9, 16, 0.07, t), skin, alpha);
  if (feat.core) disc(ctx, ex * 0.5, ry * 0.8, rx * 0.35, feat.core, 0.6);  // nucleus
  disc(ctx, -1.5, ry * 1.25, rx * 0.4, shade(skin, 1.3), 0.45);             // wet sheen
  if (feat.drips !== false) {                                                // drips at base
    disc(ctx, -rx * 0.6, 1.2 + Math.sin(t / 500) * 0.6, 1.1, skin, alpha);
    disc(ctx, rx * 0.5, 1.0 + Math.sin(t / 500 + 2) * 0.6, 0.9, skin, alpha);
  }
  if (facing !== 'N') {
    disc(ctx, ex - 2.2, ry * 0.95, 1.2, 0xffffff); disc(ctx, ex + 2.2, ry * 0.95, 1.2, 0xffffff);
    disc(ctx, ex - 2.2, ry * 0.95, 0.55, 0x111111); disc(ctx, ex + 2.2, ry * 0.95, 0.55, 0x111111);
  }
}

// A winged flier that hovers above its ground shadow, wings beating with time
// (snapping on an attack). Feature-driven so a bat, a raven, a moth and a wasp
// each read distinctly: wing shape, head (ears/beak/antennae), and body markings.
function drawAvian(ctx, skin, p, facing, t, feat = {}) {
  const dark = shade(skin, 0.7);
  const bY = 9;                                   // body floats above the feet/shadow
  const flap = Math.sin(t / 90) * 1.0 + (p.strike || 0) * 0.6;
  const wy = bY + 1 + flap * 2.2;
  const wing = feat.wing || 'membrane';
  const ec = feat.eyeColor || 0xffd23a;

  // ---- wings (behind the body) ----
  if (wing === 'feather') {                       // bird: layered quills
    for (const s of [1, -1]) {
      poly(ctx, [[2 * s, bY + 1], [9 * s, wy + 1], [9 * s, wy - 3], [2.5 * s, bY - 1]], dark, 0.95);
      seg(ctx, 3 * s, bY - 0.2, 8.5 * s, wy - 1.4, 0.7, shade(skin, 0.85));
      seg(ctx, 3 * s, bY - 1, 8 * s, wy - 2.6, 0.6, shade(skin, 0.85));
    }
  } else if (wing === 'moth') {                    // moth: broad rounded, eyespots
    for (const s of [1, -1]) {
      poly(ctx, [[1.5 * s, bY + 2], [8 * s, bY + 5 + flap], [10 * s, bY + 1 + flap], [7 * s, bY - 3 + flap], [2 * s, bY - 1]], shade(skin, 1.08), 0.9);
      disc(ctx, 6.5 * s, bY + 1 + flap, 1.3, feat.eyeSpot || dark, 0.8);
    }
  } else if (wing === 'insect') {                  // wasp: narrow translucent
    for (const s of [1, -1]) poly(ctx, [[1.5 * s, bY + 1], [7 * s, wy + 2], [7.5 * s, wy - 1], [2 * s, bY - 0.5]], 0xdfeef5, 0.5);
  } else {                                         // bat: leathery membrane
    poly(ctx, [[-2, bY + 1], [-9, wy + 2], [-8, wy - 2.5], [-2.5, bY - 1]], dark, 0.95);
    poly(ctx, [[2, bY + 1], [9, wy + 2], [8, wy - 2.5], [2.5, bY - 1]], dark, 0.95);
  }

  // feet
  seg(ctx, -1, bY - 2, -1, bY - 4, 0.8, dark); seg(ctx, 1, bY - 2, 1, bY - 4, 0.8, dark);

  // ---- body + head ----
  disc(ctx, 0, bY, 3.0, skin);
  if (feat.stripes) for (let s = -1; s <= 1; s++) seg(ctx, -2.4, bY + s * 1.3, 2.4, bY + s * 1.3, 0.8, dark, 0.85);
  disc(ctx, 0, bY + 3, 2.2, skin);

  const head = feat.head || 'ears';
  if (head === 'ears') {
    poly(ctx, [[-1.4, bY + 5], [-2.6, bY + 8], [-0.5, bY + 5.5]], dark);
    poly(ctx, [[1.4, bY + 5], [2.6, bY + 8], [0.5, bY + 5.5]], dark);
  } else if (head === 'beak') {
    poly(ctx, [[-1, bY + 3], [1, bY + 3], [0, bY + 0.6]], 0xe8a83a);   // beak points down-forward
  } else if (head === 'antennae') {
    seg(ctx, -0.8, bY + 5, -2.2, bY + 8, 0.5, dark); disc(ctx, -2.2, bY + 8, 0.6, dark);
    seg(ctx, 0.8, bY + 5, 2.2, bY + 8, 0.5, dark); disc(ctx, 2.2, bY + 8, 0.6, dark);
  }

  if (facing !== 'N') { disc(ctx, -1, bY + 3.2, 0.6, ec); disc(ctx, 1, bY + 3.2, 0.6, ec); }

  // wasp stinger (below the abdomen)
  if (feat.stinger) poly(ctx, [[-1, bY - 2.5], [0, bY - 5 - (p.strike || 0) * 2], [1, bY - 2.5]], dark);
}

// A legless serpent: a chain of segments undulating in a sine wave; the head
// lunges forward on a strike. Feature-driven so a banded snake, a diamond-back
// viper, a hooded cobra, a finned eel, a fat segmented worm and a slug (eyestalks)
// all read distinctly.
function drawSerpent(ctx, skin, p, facing, t, feat = {}) {
  const worm = !!feat.segmented;
  const SEGS = worm ? 7 : 9, baseY = 4, lunge = (p.strike || 0) * 3;
  const amp = feat.fins ? 2.2 : 3.0;
  const ec = feat.eyeColor || 0x141414;
  let hx = 0, hy = baseY;
  for (let i = 0; i < SEGS; i++) {
    const lx = -12 + i * 3.0 + lunge;
    const ly = baseY + Math.sin(t / 150 + i * 0.7) * amp;
    const r = worm ? 2.0 : (1.0 + i * 0.24);       // worm = uniform fat; snake = tapered
    disc(ctx, lx, ly, r, i % 2 ? shade(skin, 0.86) : skin);
    // scale patterns
    if (feat.pattern === 'diamond' && i % 2 === 0) disc(ctx, lx, ly, r * 0.5, feat.markColor || shade(skin, 0.55), 0.85);
    else if (feat.pattern === 'bands' && i % 2 === 0) disc(ctx, lx, ly - r * 0.3, r * 0.45, feat.markColor || shade(skin, 0.5), 0.7);
    if (feat.fins) seg(ctx, lx, ly + r, lx, ly + r + 1.6, 0.8, shade(skin, 1.15), 0.6); // eel dorsal fin
    hx = lx; hy = ly;
  }
  if (feat.hood) { // cobra hood flaring behind the head
    poly(ctx, [[hx - 1, hy + 4], [hx + 3, hy + 1.5], [hx + 3, hy - 1.5], [hx - 1, hy - 4]], shade(skin, 0.92), 0.9);
  }
  const headX = hx + 2.3;
  disc(ctx, headX, hy, worm ? 2.0 : 2.9, skin);
  if (!worm) poly(ctx, [[headX + 1, hy + 1.7], [headX + 3.6, hy], [headX + 1, hy - 1.7]], skin); // snout
  if (facing !== 'N') disc(ctx, headX + 0.6, hy + 1.0, 0.55, ec);
  if (feat.eyestalks) {                            // slug eyestalks
    for (const dx of [0.4, 1.8]) { seg(ctx, headX + dx, hy + 1.5, headX + dx + 0.8, hy + 4, 0.5, skin); disc(ctx, headX + dx + 0.8, hy + 4, 0.7, skin); disc(ctx, headX + dx + 0.8, hy + 4, 0.3, ec); }
  }
  // forked tongue flick — snakes only (not eels/worms/slugs)
  if (feat.tongue !== false && !worm && !feat.fins && !feat.eyestalks && Math.sin(t / 200) > 0.4) {
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
  const feat = state.features || {};   // per-creature distinctive features (also used by humanoid head)
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
  // At rest (idle/walk) a weapon should sit naturally instead of jutting straight
  // out along the arm: poles upright, blades/hafts lowered. The arm keeps `swing`;
  // only the weapon draw uses `weapAng`. Mid-attack/skilling keep the real swing.
  const held = state.anim !== 'attack' && !skilling && drawWeap;
  const rest = held ? weaponRestAngle(drawWeap.kind) : null;
  const weapAng = rest != null ? rest : swing;

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
    if (bodyType === 'quadruped') drawQuadruped(ctx, skin, p, facing, t, feat);
    else if (bodyType === 'insectoid') drawInsectoid(ctx, skin, p, facing, t, feat);
    else if (bodyType === 'avian') drawAvian(ctx, skin, p, facing, t, feat);
    else if (bodyType === 'serpent') drawSerpent(ctx, skin, p, facing, t, feat);
    else drawBlob(ctx, skin, p, facing, t, feat);
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
    // off-arm (holds shield if any) behind torso. While skilling, BOTH hands grip
    // the tool (drawn on the weapon side), so skip the idle off-arm — otherwise the
    // rig shows three arms.
    if (!skilling) {
      const offAng = Math.PI - 0.4 + (p.armSwing || 0);
      drawArm(ctx, -TORSO_W / 2 + 0.5, offAng, armCol);
      if (gear.shield) drawShield(ctx, -TORSO_W / 2 - 1.5, gear.shield, back);
    }
    drawTorso(ctx, skin, gear.body, p);
    drawHead(ctx, skin, gear.head, facing, feat);
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
    drawHead(ctx, skin, gear.head, facing, feat);
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
