# Character-Render Lane — Roadmap to Completion

Owner: 🧍 Character-Render agent. Scope: *how characters look and move* — the
player, NPCs, monsters, their gear, and character-driven FX. Pure rendering:
reads sim state, draws pixels, never mutates game data. New data fields go
**JSON-first via the Economy lane**; FX that draws on world tiles gets a **ping
to World-Gen** before wiring.

**Guiding rule:** every phase stays verifiable in `avatar_preview.html` (add a
toggle) *and* is checked live in-game before it's called done.

---

## ✅ Phase 0 — Foundation (DONE)
Articulated procedural rig live in-game: 4-dir facing, walk cycle, per-weapon
attack swings (stab/slash/crush/ranged), hit-flash, death topple, gear overlays
(weapon/shield/helm/cape/armour), ground shadow. Player + NPCs draw through it.
`avatar.js` + `gear.js` + the single marked hook in `main.js drawEntities()`.

## ✅ Phase 1 — Close the combat loop (DONE, verified in-game)
- **Death in-game:** slain NPCs play the ~700ms topple+fade before being culled.
- **Swing sync:** melee strike retuned to land by ~0.22 of the swing, ≈ the
  damage tick / hitsplat. (Render-side `lastAttackTick` detection; no combat edit.)
- **Hitsplats:** damage numbers now render as OSRS-style diamond splats (red hit
  / blue miss) — drawn procedurally, so no asset-load wiring needed. Inferred
  from the string in `floatText`, so combat call-sites are untouched.
- **Ranged projectile:** arrow travels shooter→target on a ranged swing.
- *Deferred:* defensive/block pose (minor); player-death flourish (respawn is
  instant). Touchpoints all render-side in `main.js`, marked.

## ✅ Phase 2 — Tool-in-hand skilling animations (DONE, verified in-game)
- Woodcutting: axe overhead-chop loop + chip particles. Mining: pickaxe, same
  chop + spark particles. Fishing: rod held out with a line + ripple ring.
  Smithing/Cooking/Crafting: two-handed "work" tapping motion at the station.
- Driven by `playerSkillTarget()` → `SKILL_TOOL` (tool + motion) → the rig's new
  `skill` anim; FX (`drawSkillFx`) draws on the entity layer (depth 2, above the
  object layer) so no World-Gen depth coordination was needed after all.
- *DoD met:* each gather action shows the right tool + motion + FX, facing the node.

## ✅ Phase 3 — Creature identity (DONE, verified in-game)
- `bodyTypeFor(name)` in `gear.js` classifies the whole bestiary by keyword →
  `{type, size}`: **quadruped** (rat/wolf/boar…), **insectoid** (spider/bug/crab/
  grub…), **amorphous** (slime/wisp/spirit…), **humanoid** (default; trolls/golems
  scale up). Cached per NPC as `e._body`; elders/friendlies forced humanoid.
- Three new silhouettes in `avatar.js` (`drawQuadruped`/`drawInsectoid`/`drawBlob`)
  that reuse the shared pose numbers (walk/attack/hit/death/shadow all apply).
  Verified: rat, cave bug, giant spider (8 legs + eyes), bog slime, oak boar all
  render distinctly; Gork stays humanoid.
- **Extra forms (DONE, verified in harness):** added `avian` (bats — hovering,
  flapping membrane wings) and `serpent` (snakes/eels — undulating tapering body
  with a lunging head), plus a **boss aura** (pulsing gold ring) that layers under
  any silhouette for named bosses (`boss` flag from `bodyTypeFor`). `avatar_preview.html`
  now has a body-type gallery + cache-busted module imports (no more stale-preview).
- *Still open (later):* authoritative `render.bodyType` on `monsters.json`
  (JSON-first, would override the keyword guess); boss phase-transition FX.

## ✅ Phase 4 — NPC & world-character variety (DONE, verified in-game)
- `npcLoadout(name, type)` in `main.js` picks a role loadout by name keyword →
  fake equipment ids → `gearHints`: elder/witch/shaman (staff + hood),
  prospector/foreman (pickaxe), woodcutter (axe), bait-seller (rod), hunter/
  archer (bow), warrior/captain (sword + helm), scout/bandit (dagger). NPC weapon
  *style* now derives from the gear, so archers actually draw a bow.
- **Attention facing:** guards in combat face their target; idle townsfolk face
  the player when within 6 tiles (verified — a whole lineup turned to Gork).
- **Staggered timing:** `tOffFor(id)` gives each NPC a stable ms offset so crowds
  don't animate in lockstep. Gear/body/offset cached per NPC.
- *DoD met:* elder, witch, prospector, huntsman, rival archer, rival warrior,
  swamp shaman all render with distinct kit, facing the player.

## Phase 5 — Sprite-sheet upgrade path *(optional, art-gated)*
- A loader that swaps the procedural rig for real sheets when art lands (the
  module already anticipates a frame source); procedural stays the always-there
  default/fallback. Wire `assets/chars/*` first.
- *DoD:* dropping in a valid sheet upgrades a character with no other changes.

## ◑ Phase 6 — Depth, performance & final polish (my-lane parts DONE, verified)
- **Entity y-sort:** `drawEntities` now builds one draw list (nearby NPCs +
  player) sorted by feet-y, so nearer characters correctly overlap farther ones
  instead of drawing in spawn order. Preserves World-Gen's `upright()` wrapper.
- **Aggro indicator:** a red "!" marker over any NPC whose target is the player.
- **Hit-flash** (from Phase 1) doubles as a readability cue — verified Gork
  red-tints when struck.
- **Occlusion seam PREPPED for World-Gen (done):** `drawEntities` refactored into
  `collectCharacters(time)` → `[{ent, y}]` y-sorted, `drawCharacter(g, ent, time)`
  (self-contained: avatar + hp bar + aggro + player projectile/skill-fx), and
  `drawProjectiles(g, time)`. World-Gen merges the character items with their
  object items by feet-y in one pass to get true behind-trees occlusion — recipe
  is in the big comment above `collectCharacters` + in COORDINATION.md. Behaviour
  unchanged until they wire it.
- *Deferred — optional:* viewport-cull of off-screen entities (current manhattan
  cull is adequate; skipped to avoid camera-rotation pop). LOD for huge crowds.

## ✅ Creature variation (owner request) — DONE, visual verified
Per-enemy tint + size so a herd isn't identical clones. Fewer looks the tougher
the foe: **combat lvl ≤12 → 6 variants, ≤45 → 4, else → 3**, stable-random per
NPC id. `CREATURE_VARIANTS` + `creatureVariant()`/`tintColor()` in `main.js`,
applied in `avatarStateFor` (guards only; townsfolk/player stay uniform). Verified
in `avatar_preview.html` — 6 distinct rats (base/ruddy/ashen/tan/green/violet,
each a different size). Live-game confirmation pending a boot-chain fix (below).

## Phase 5 — Sprite-sheet path — PARKED (blocked)
No per-direction sprite art exists; the procedural rig is the agreed look. Unparks
only if real sheets are produced.

---

### Recommended order
1 → 2 first (combat then skilling: the two things the player does most), then
3 (correctness across the bestiary), then 4, with 5/6 as polish. 5 is optional
and only unblocks if real sprite art is ever produced.
