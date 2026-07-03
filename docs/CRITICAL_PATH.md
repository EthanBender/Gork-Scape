# Critical Path — for the local models taking over

*Written 2026-07-03, at the Fable handoff. Two paths: what the smaller models
should work on (and in what order), and how the map gets fixed at the macro
level. Every step here is bounded, machine-verifiable, and safe to do without
Fable — that's the selection criterion, not difficulty.*

## The rules that keep the game alive (read first)

1. **Run the gates before every commit.** All eight, strictly — pipes mask
   exit codes, so chain with `&&`:
   ```
   node scripts/smoke.mjs && node test/run.mjs && node scripts/economy_sim.mjs \
     && node scripts/quest_test.mjs && node scripts/pacing_sim.mjs \
     && node scripts/chain_audit.mjs && node scripts/audit_world.mjs \
     && node scripts/map_defects.mjs
   ```
   Green tree = live site (push to `main` auto-deploys gorkscape.ca).
   Red gate = nothing ships. The Stop-hook (`scripts/autocommit.sh`) enforces
   this when driven by Claude Code; enforce it manually otherwise.
2. **No build tooling, ever.** The browser gets files as-is. Vanilla ES
   modules, Phaser from CDN, JSON data files.
3. **Preview against the real server** (`node server/index.mjs`, launch config
   `goblin-empire-worldserver`). A static file server shows the "realm is
   resting" page — that is BY DESIGN, not a bug. Never "fix" it in client code.
4. **Commit per unit of work** (one chunk, one recipe family, one quest).
   Never batch a day's work into one commit.
5. **One small change → gates → commit → next.** If a gate goes red and the
   fix isn't obvious in 15 minutes, `git checkout` the change and pick a
   different task. Don't dig.

---

## Part 1 — Critical path for the smaller models

Ordered by (value ÷ risk). Each stream is independent; work them top-down.

### 1. Map design pass  ← START HERE
The fully-tooled workstream. **[MAP_DESIGN_PASS.md](MAP_DESIGN_PASS.md) is the
runbook — follow it exactly.** Crawl the whole map in a **center-out spiral**
so nothing is missed, checking defects AND elevation on each chunk:

```
node scripts/map_crawl.mjs              # spiral worklist → the NEXT chunk (defects + elevation)
node scripts/map_defects.mjs 0 2        # per-chunk defect detail (col 0, row 2)
node scripts/elevation_audit.mjs 0 2    # per-chunk elevation detail
# → write a typed patch into src/data/map_patches.json
node scripts/map_defects.mjs            # prove the number went DOWN
# → ratchet the BUDGET in scripts/map_defects.mjs down to the new count
# → commit ("map: c0r2 — cleared N wall_orphans")
```

Current queue (2026-07-03): **475 defects** — wall_orphan 226,
dead_pocket 166, sealed_obj 80, sealed_room 3. Worst chunks first:
c0,r2 (51) → c0,r1 (39) → c1,r3 (22) → c1,r2 (20) → c3,r3 (19).
Target: **all classes to 0**, budgets ratcheted to 0 so they can never grow
back. The town chunk (c4,r3) is the finished reference — zero defects.

Then the **decorating brief** (also in the runbook): give each of the ~99
wilderness chunks one identity beat — a ruin, a grove, a camp — using the
same patch ops. One chunk per commit.

### 2. Data balancing & content grinding
Everything in `src/data/*.json` is inside validator rails — pacing_sim's 19
checks, economy_sim, chain_audit (every item must be sourced AND consumed),
quest_test. That makes tuning safe for a small model: change numbers, run
gates, the sim tells you if the curve broke. Good tasks:
- New recipes / shop stock / drop-table entries (chain_audit catches orphans).
- Monster stat smoothing where the CL ladder has gaps.
- More Slayer contract variety (`src/systems/contracts.js` reads monsters.json
  directly — new monsters automatically become contracts).

### 3. Quest content
Author new quests as data following the existing shapes in
`src/data/quests.json` + `src/systems/quests.js`. `quest_test.mjs` simulates
every quest start-to-finish headlessly — if it passes, the quest works. Use
region anchors, not raw coordinates (coords survived one world migration
already; anchors are the stable API).

### 4. Item art swaps (when the asset lane delivers)
`src/data/itemIcons.js` resolves real art → crafted svg → emoji. Dropping in
art is a data change, not a code change. Same for the UI icon set
(`src/ui/icons.js`) — the login crest is one `icon('goblin')` swap.

### 5. Copy & flavor
Wiki/codex text, NPC dialogue, examine lines, event flavor. Zero risk; gates
don't even notice.

### NOT for the smaller models (wait for a strong model, or the owner)
- `src/world/geo2.js` (heightfield/hydrology core) — one wrong threshold
  reshapes the continent.
- `src/main.js` scene-graph / input / camera surgery.
- Server Phase 4 (server-authoritative player state) and anything in
  `server/index.mjs` beyond config.
- Save-format changes (`src/engine/save.js`) — real player progress is live.

---

## Part 2 — Critical path for fixing the map at the MACRO level

The geo2 core is sound: rivers provably drain, the coast is fractal, biomes
follow moisture, roads follow slope. What's left is making the map *play* as
well as it *generates*. In dependency order:

### Step 1 — Zero the defect scanner (local, no design judgment)
Part 1 §1 above. This must come first because every later step edits terrain,
and a zeroed, ratcheted scanner is what proves those edits didn't regress
anything. **Exit: `map_defects.mjs` TOTAL 0, all budgets 0.**

### Step 2 — Chunk coherence pass (10×10 grid, one chunk at a time)
Task #20. For each chunk: does the terrain read as ONE place (a bog, a pine
shelf, a meadow), do its edges blend into neighbours (no biome hard-cuts mid-
chunk), does it have its identity beat? The decorating brief in the runbook is
the per-chunk checklist. **Exit: every chunk has a one-line identity written
into the runbook's chunk table, and it's visible in a `geo2_preview.mjs`
render.**

### Step 3 — Settlement architecture rollout (pattern replication)
Gorkholm (c4,r3) is the proof: canal + embankments, lamped avenues, door
spurs, corner gardens, orchard, plaza. Apply the same *pattern* to the other
hubs — quarry, farmlands, lake dock, bog heart, forest camps — via
`map_patches.json` ops (NOT by editing map.js generators). Each hub: streets
connect doors to the road network, workplaces sit beside their resource,
decoration says what the place is for. One hub per commit, defect scan green
after each. **Exit: every hub chunk is defect-zero and has streets/decor/
purpose like the town does.**

### Step 4 — Verticality as movement (the one macro GAMEPLAY change)
Task #15. Steep elevation steps become impassable except at ramps and
shortcuts, which turns the heightfield into routing — passes matter, cliffs
protect, the map plays 3D. **This is the riskiest step**: it must ship with an
`audit_world.mjs` extension that flood-fills the walkable graph and proves no
region/quest-target/shop is soft-locked. Land the audit FIRST (red on
soft-lock), then flip the movement rule. A smaller model may attempt it only
because the audit gate makes failure loud. **Exit: cliffs block, every anchor
reachable, audit_world green.**

### Step 5 — Remaining shortcuts + agility crossings
Task #14: Grublake boat, Mine Cart, plus elevation-based agility crossings
(cliff scrambles that skip the long way around — they only mean something
after Step 4). Data stubs exist in `worldData.js SHORTCUTS`; anchor to
*generated* terrain by probing (the Troll Gate pattern in map.js), never to
fixed coordinates. **Exit: all SHORTCUTS entries interactable + persisted.**

### Step 6 — Interactive wonders
Task #16: the 14 authored landmarks do things — search the graveyard, spring
buff, fairy-ring teleports, lore drops. Pure content on top of the finished
terrain; templates are the existing examine/loot/altar object flags in
main.js `performSkill`. **Exit: every wonder has at least one interaction.**

### Step 7 — Progression-geography audit (the final read)
One pass to confirm difficulty reads geographically: the deep wilds sit
behind passes/rivers/gates, mob CL rises with distance and elevation, and the
region rings match the terrain barriers Steps 4–5 created. Produce a
`geo2_preview.mjs` overlay render as the artifact. **Exit: a worldmap render
where the danger gradient and the terrain barriers visibly agree.**

### Tools that keep all of this safe
| Tool | What it proves |
|---|---|
| `scripts/map_defects.mjs` | no local breakage (7 classes, ratcheted budgets) |
| `scripts/audit_world.mjs` | invariants + (after Step 4) no soft-locks |
| `scripts/geo2_preview.mjs` | before/after BMP renders of the whole world |
| `src/data/map_patches.json` | all hand-fixes as typed data ops, no code edits |
| deterministic seed | same world every run — diffs are yours, not noise |
