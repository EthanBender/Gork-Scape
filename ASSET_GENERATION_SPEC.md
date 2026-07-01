# Goblin Empire — Asset Generation Spec

Single source of truth for generating **every** art asset in the game in **one
consistent style**. Hand this to the pipeline agent. It defines: (1) the master
style, (2) the hard technical requirements, (3) the prompt formula, (4) the full
asset catalog with per-class prompt templates, (5) how consistency is enforced at
scale, (6) how assets drop into the game.

The game currently renders everything as **placeholder procedural art** (code
shapes / emoji / colored rects). Real art replaces it through existing seams —
nothing in the game code needs to change except dropping files in + updating the
manifest (see §6).

---

## 1. Master style ("style bible") — goes on EVERY prompt, verbatim

> **STYLE =** *"isometric low-poly 3D render, clean stylized fantasy game asset,
> matte surfaces with soft ambient occlusion and gentle bevels, single object
> centered and isolated, three-quarter top-down isometric camera at a fixed ~35°
> elevation, soft neutral studio key light from the upper-left, cohesive warm
> earthy goblin palette (mossy/forest greens, goblin-skin green #6fbf3f, warm
> browns, muted bronze and steel, gold accents, bog purples for magic), crisp
> readable silhouette, no outline, no text, no watermark, on a fully transparent
> background."*

Everything shares: the same **camera** (fixed iso ~35°), the same **light** (soft,
upper-left), the same **palette**, the same **finish** (matte low-poly, soft AO).
That sameness is what makes 1000+ assets read as one game instead of a clip-art
grab-bag.

**Palette anchors** (keep every asset inside this):
`#14130f` bg-dark · `#6fbf3f` goblin skin · `#4a7c3a`/`#3f6b30` grass · `#9a6a3a`
wood · `#c2cad2`/`#7b8894` steel · `#a8842a`/`#e8c65a` bronze/gold · `#2e5e8c`
water · `#8a6fbf` bog-magic purple · `#c1554b` blood/meat red.

---

## 2. Technical requirements (hard — reject any asset that violates these)

- **Format:** PNG-32 with a real **alpha channel** (true transparency).
- **Background:** **fully transparent. NO scene, NO ground plane, NO backdrop, NO
  baked drop-shadow, NO vignette, NO border/frame.** One isolated object floating on
  nothing. (The game draws its own slot frames, tiles, and contact shadows.)
- **One fixed camera per asset CLASS** so a class tiles together (see per-class
  sizes below). Do not vary the angle within a class.
- **Framing:** object centered, ~10–15% even padding on all sides; consistent
  scale within a class (a dagger and a greatsword share the class camera, but the
  greatsword fills more of the frame).
- **Render 2× then downscale** for crisp edges. Ship the size in the table.
- **No text, numerals, letters, glyphs, UI, or borders** anywhere in the image.
- **Naming = the in-code id, exactly.** File name IS the key the game looks up
  (see §6). `bronze_pickaxe.png`, not `pickaxe (1).png`.
- **Consistency lock:** fixed seed + sampler + steps, or a trained style LoRA (see
  §5). Same STYLE string on every prompt.

| Asset class | Render → ship | Bg | Framing | Folder |
|---|---|---|---|---|
| Item icons | 512² → **128²** | transparent | centered object, even pad | `assets/items/<item_id>.png` |
| Terrain tiles | 256² → **128²** | **OPAQUE** | seamless, edge-wrapping, top-down | `assets/tiles/<terrain_id>.png` |
| World objects / props | 512² → **192²** | transparent | **bottom-anchored** (base at bottom-center) | `assets/objects/<key>.png` |
| Characters / monsters | 512×768 → **192×288** | transparent | **bottom-anchored**, facing SE (3/4) | `assets/chars/<id>.png` |
| Skill icons | 256² → **48²** | transparent | simple emblem, centered | `assets/skills/<skill>.png` |
| UI / FX | varies | transparent | — | `assets/ui/<key>.png` |

Note the two exceptions: **terrain tiles are OPAQUE and seamlessly tileable**
(they wrap edge-to-edge); **objects and characters are bottom-anchored** (their
base sits on the tile they occupy).

---

## 3. The prompt formula

```
<STYLE §1> , <ASSET SUBJECT> , <CLASS TECH from §2>
```

Example (item):
> *"isometric low-poly 3D render, clean stylized fantasy game asset, matte surfaces
> … transparent background. **A bronze pickaxe, wooden haft with a forged bronze
> head, mining tool.** single centered object, ~128px game inventory icon,
> transparent background, no shadow."*

The pipeline (`tools/gen_assets.py`) already builds `STYLE + subject + tech` per
item from `items.json`. This doc defines the **SUBJECT templates** below; the
script expands them across every id. Keep STYLE identical everywhere.

---

## 4. Asset catalog

### 4.1 Item icons — **1072 items** (`assets/items/`, 128², transparent)
Source of truth + batch driver: `src/data/items.json` (each `item_id`) via
`tools/gen_assets.py`. Do **not** hand-write 1072 prompts — use the per-category
SUBJECT template, filled with the item's `display_name` + `subcategory`:

`SUBJECT = "<display_name> — <category hint>, single game item icon"`

| Category (count) | Category hint appended to the item name |
|---|---|
| Equipment (176) | detailed weapon or armour piece, metal & leather, forged craftsmanship |
| Quest/Build Item (170) | special ornate quest object / build component |
| Unique Drop (148) | rare glowing artifact, ornate, faint magic sheen |
| Resource (122) | raw natural material, rough organic texture |
| Consumable (114) | small food item or glass potion, appetizing |
| Tool (97) | sturdy handcrafted tool, wood + metal |
| Processed Material (78) | refined crafted material, smooth (bar / plank / cloth) |
| Utility (75) | small utilitarian object |
| Drop Material (50) | organic monster-drop part (bone / hide / tooth) |
| Junk (32) | worn, broken, scrap |
| Ammo (10) | a small bundle of projectiles (arrows / bolts) |

Run `python3 tools/gen_assets.py --probe` to emit ~10 representative prompts (one
per category) to lock the look before the full batch.

### 4.2 Terrain tiles — **~22** (`assets/tiles/`, 128², **OPAQUE, seamless**)
Top-down, edge-wrapping so they tile infinitely. From `TERRAIN_DEFS`:
`grass, grass2, grass3, grass_shadow, water, water_deep, water_shallow, rock,
rock2, cliff, road, dirt, dirt_shadow, swamp, mud, sand, wet_sand, sand_shadow,
bridge, field, floor, wall`.
`SUBJECT = "seamless top-down <name> ground texture tile, tileable, matte
low-poly game terrain"` (e.g. grass = "lush mossy grass"; water = "rippling blue
water"; bridge = "wooden plank bridge"; wall = "goblin palisade / stone wall").
**These are opaque and must tile with no visible seam** — that fixes the "blocky
tile edges" look.

### 4.3 World objects / props — **~25** (`assets/objects/`, 192², transparent, bottom-anchored)
Full id list in `src/data/world_nodes.json` (64 nodes) + stations. Representative set:
- **Trees:** `normal_tree, oak_tree, willow_tree, deadwood_tree` (+ `*_stump` depleted)
- **Rocks/ore:** `copper_rock, tin_rock, iron_rock, coal_rock, gold_rock, black_iron_rock` (+ spent)
- **Fishing spots:** `shrimp_fishing_spot, trout_fishing_spot, pike_fishing_spot, bog_eel_fishing_spot` (water ripple markers)
- **Stations:** `furnace, anvil, range` (cooking fire), `crafting_bench, sawmill`
- **Settlement props:** market stall, cart, fountain, bones altar, bank chest, exchange stall, blood portal, signpost, fence
`SUBJECT = "a <thing>, standalone game world prop, bottom-anchored"`. Trees/large
props render taller (512×768 → 192×288). Fire/water props may get 2–3 anim frames.

### 4.4 Characters & monsters — **~66** (`assets/chars/`, 192×288, transparent, bottom-anchored, 3/4 iso facing SE)
- **Player + NPCs:** `gork` (player goblin, skin #6fbf3f), `goblin_guard` (armed,
  hostile), `goblin_elder` (purple robe, non-combat), `banker`, `exchange_merchant`,
  `tinker`. Plus the visible-bot roster later (generic goblin adventurers).
- **Monsters — 60**, batch from `src/data/monsters.json` by `render.bodyType`:
  - `humanoid` ×32 → "a <name>, humanoid goblin-world creature"
  - `insectoid` ×12 → "a <name>, chitinous insectoid creature, many legs"
  - `quadruped` ×11 → "a <name>, four-legged beast"
  - `amorphous` ×5 → "a <name>, gelatinous blob creature"
- **Boss:** `hoard_dragon` (Goldscale) — large gold-scaled dragon, its own hero asset.
> **Scope note:** a single SE-facing static iso sprite per character is the cheap
> first pass and matches the current fixed-camera look. Full 4-direction + walk/
> attack frames are a big multiplier (×~12 per character) — defer unless the
> character-render lane wants to swap the procedural rig entirely. Recommend
> starting static.

### 4.5 Skill icons — **18** (`assets/skills/`, 48², transparent)
Simple emblems, one per skill, same palette: `Woodcutting, Fishing, Mining,
Farming, Cooking, Firemaking, Smithing, Crafting, Alchemy, Tinkering, Hitpoints,
Attack, Strength, Defence, Ranged, Prayer` (+ Combat).
`SUBJECT = "a <skill> skill emblem icon, single symbolic object (e.g. axe for
Woodcutting, fish for Fishing, pickaxe for Mining, heart for Hitpoints)"`.

### 4.6 UI / FX (`assets/ui/`) — mostly EXISTS already
Present in `goblin_empire_assets/assets/ui/`: equipment slot frames, `coin`,
`heart`, `hitsplat_hit`, `hitsplat_miss`. Gaps to add if desired: xp-drop sparkle,
level-up burst, run/energy icon, currency stack variants (1/5/25/100 coins).

---

## 5. Consistency at scale (the hard part — architected here)

Generation is easy; **one coherent style across ~1180 assets is the real job.**
Lock it, then batch:

1. **Fix the STYLE string** (§1) on every prompt — never paraphrase it.
2. **Lock the render controls:** one model, one **fixed seed + sampler + steps +
   resolution**, or — stronger — **train a style LoRA** on 15–30 curated reference
   images and trigger it on every prompt (see `tools/README.md` research: SDXL /
   FLUX-schnell + LoRA is the cheapest consistent path; Tripo seed-lock for 3D→render).
3. **Do a 10-image style probe first** (`--probe`) and get sign-off on the look
   before spending on the full batch.
4. **Over-generate ×2–4 and cull.** Per-item variance is inevitable; keep the best.
5. **Fixed camera + light + palette per class** (§2). Never let the angle drift.
6. **Batch per class, not all at once** — items, then tiles, then props, then chars.
   Each class has different sizing/anchoring, so run them as separate passes.

---

## 6. Delivery & integration (how art reaches the game — already wired)

The seams exist; art drops in with **zero code changes**:

- **Items:** put `assets/items/<item_id>.png` files in, then rebuild the manifest:
  `python3 tools/gen_assets.py --manifest-only`. `src/data/itemIcons.js`
  (`loadItemArtManifest` → `itemIconHTML`) auto-swaps SVG → the PNG for every id in
  `assets/items/manifest.json`. **Partial delivery is fine** — missing items keep
  the placeholder, so ship in waves.
- **Tiles / objects / characters:** these render on the Phaser canvas (world-gen +
  character-render lanes). Coordinate the loader with them — the file keys must match
  `TERRAIN_DEFS` ids, `world_nodes.json` node ids, and the char ids in §4.4. Flag
  in `COORDINATION.md` when a batch is ready so they wire the sprite swap.
- **Licensing (from the research):** ship only from commercially-clean sources —
  SDXL (OpenRAIL) or FLUX.1-**schnell** (Apache-2.0); avoid FLUX-dev in a for-profit
  pipeline; free tiers of Meshy/Tripo are attribution/non-commercial. See
  `tools/README.md`.

### Priority order (biggest visual win first)
1. **Terrain tiles (~22)** — they fill the whole screen; seamless tiles kill the
   "blocky / early-internet" look fastest for the least assets.
2. **Characters/NPCs (~10 you actually see)** — Gork + the settlement NPCs.
3. **Item icons (1072)** — batched; already fully wired via the manifest seam.
4. **Props (~25)**, then **monsters (60)**, then **skill icons (18)**.

~22 tiles + ~10 chars is a tiny batch that transforms the look — do those first.
