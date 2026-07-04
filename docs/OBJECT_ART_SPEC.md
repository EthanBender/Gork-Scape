# Object Art Spec — the one-page style guide + object prompts

*The recipe every AI-generated world object (trees, rocks, stalls, barrels…)
follows so they sit on the ground and match the tiles, plus the 6 copy-paste
prompts for the first object test run.*

---

## The model in one line

Objects are single images that **stand on a tile**. Each object KIND (tree, ore,
stall…) is one PNG the engine draws bottom-anchored on the tile — so short things
sit in the tile and tall things (trees) rise above it. One image per kind, no
animation. Same easy pipeline as the ground tiles.

## Global rules — every object obeys these

| Rule | Value |
|---|---|
| **Anchor / scale** | **"128 px = one tile."** Draw the object **standing at the bottom-centre** of the canvas. A 1-tile rock = 128×128. A tree ~1 tile wide × 2 tall = 128×256. A wide stall = 160×128. |
| Background | **transparent PNG.** A soft contact-shadow ellipse **at the very base** is welcome (helps it sit on the ground); no other baked shadow. |
| View | slightly-top-down **¾** view, matching the tiles and the character. |
| Light | soft **top-left** key light + subtle rim light. Same as the tiles. |
| Content | **one object, centred horizontally, standing on the bottom edge.** No ground/tile underneath it (the tile shows through), no border. |
| Style | chunky hand-painted RPG, OSRS-inspired but crisper + saturated; cohesive with the terrain tiles. |

### Locked palette (matches the game's current objects)

- Foliage green **`#3E7A34`** (highlight `#5CA24A`) · trunk/wood brown **`#6A4A2A`** (dark `#4A3320`)
- Stone/ore grey **`#5F5F5F`** (ore fleck gold `#E3C45A`, copper `#B87333`, iron `#8F9196`)
- Awning red **`#B23B3B`** / blue `#3B6BB2` / green `#3B9B52` · cloth `#E8E0CF`
- Metal (chest strap / anvil) `#9AA0A6` · gold trim `#E3C45A`

## Folders & naming (where art goes)

- Drop PNGs in `assets/objects/` named after the object KIND:
  `tree.png`, `ore.png`, `stall.png`, `barrel.png`, `crate.png`, `chest.png`,
  `anvil.png`, `well.png`, `hut.png`, `banner.png`, … (structures use the game's
  built-in `propKind` vocabulary — anvil, chest, barrel, stall, weaponrack, tower,
  well, shrine, cauldron, fire, logpile, cart, table, hut, sign, crate…).
- Add each finished key to the `objects` list in
  [`assets/objects/manifest.json`](../assets/objects/manifest.json). Unlisted =
  procedural, so ship one kind at a time.

> **Status:** folder, manifest, loader (`src/render/objectArt.js`) **and the
> in-game display** (bottom-anchored, trees overhang upward) are wired + verified.
> *Note:* the player currently draws in front of trees (same as today); true
> walk-behind depth sorting is a later polish.

## Variation — so a forest isn't clones (built-in)

Three levers, in order of effort:

1. **Free, automatic (no extra art):** every organic object (trees, rocks, plants —
   not buildings) is drawn with a **stable per-tile mirror + gentle size jitter + a
   tiny lean**, and a soft **contact shadow** underneath. One `tree.png` already
   stops looking like a grid of identical stamps.
2. **Per-species art (the big one):** the world has **~10 tree species** and **~10
   ore types** and the game routes on them automatically. Author `tree_oak.png`,
   `tree_willow.png`, `tree_fungal.png`, … (and `copper.png`, `iron.png`,
   `coal.png`, `gold.png`, `meteor.png`, …), list them, and each region's trees/rocks
   look like themselves. Anything without species art falls back to `tree` / `ore`,
   so it always renders. Species keys = the node `resKey`:
   `tree, tree_oak, tree_willow, tree_dead, tree_dense_oak, tree_fungal,
   tree_blackroot, tree_ironbark, tree_rotwood, tree_moonwillow`.
3. **Per-key size:** a `scales` block in the manifest draws a kind bigger/smaller
   without re-authoring — e.g. `"scales": { "tree": 1.6, "tree_moonwillow": 1.8 }`.
   Fixes the "reads as a shrub" scale problem.

## On "lighting"

Each PNG carries its **own** baked light, so they must all be lit the **same way**
(soft light from the **top-left**, matte) or a grove looks inconsistent — that's a
prompt-consistency thing (generate a whole set in one session). The engine now adds
a contact shadow to ground each object; it does **not** re-light the sprite, so the
art has to bring consistent light itself.

---

## The 6 object prompts — copy one block per image

The highest-frequency props (wild + town). Paste a block into your generator; keep
the shared style so they cohere with the tiles. (Prefixed **[STYLE]** = "Single 2D
game world-object, hand-painted chunky RPG style (OSRS-inspired, crisper and more
saturated), slightly-top-down ¾ view, soft top-left light. Object centred and
STANDING ON THE BOTTOM EDGE of the frame, transparent background, only a soft
contact shadow at its base, no ground/tile, no border. Cohesive with painted
terrain tiles.")

**1 — Tree** → save as `tree.png` (author tall, e.g. 128×256)
> [STYLE]. A lush round-canopy deciduous tree: sturdy brown trunk (#6A4A2A) at the
> bottom, a full leafy green canopy (#3E7A34 with #5CA24A highlights) filling the
> upper two-thirds. Trunk base centred on the bottom edge; canopy overhangs above.

**2 — Ore rock** → `ore.png` (128×128)
> [STYLE]. A chunky grey stone boulder (#5F5F5F) embedded in the ground, with a few
> glinting metal-ore veins (gold #E3C45A and copper #B87333 flecks). Sits low, ~1
> tile, standing on the bottom edge.

**3 — Market stall** → `stall.png` (author wide, e.g. 160×128)
> [STYLE]. A wooden market stall: two posts, a plank counter with a few goods
> (fruit, a sack), and a striped red-and-cream awning (#B23B3B / #E8E0CF) on top.
> Standing on the bottom edge.

**4 — Barrel** → `barrel.png` (100×128)
> [STYLE]. A single wooden barrel (#6A4A2A staves, dark #4A3320 iron hoops), lightly
> weathered. Standing upright on the bottom edge.

**5 — Crate** → `crate.png` (110×120)
> [STYLE]. A single wooden shipping crate (#6A4A2A planks with #4A3320 edges and an
> X-brace on the front face). Standing on the bottom edge.

**6 — Chest (bank)** → `chest.png` (120×110)
> [STYLE]. A wooden treasure chest (#6A4A2A) with a rounded lid, gold metal straps
> and a lock (#E3C45A). Closed, seen ¾ from the front, standing on the bottom edge.

*Consistency tip:* generate all six in one session with the same style text +
palette. Reuse a terrain tile screenshot as an image reference so the objects match
the ground's look and scale. Author trees on a **taller** canvas than the ground
tiles — that vertical space is the overhang.
