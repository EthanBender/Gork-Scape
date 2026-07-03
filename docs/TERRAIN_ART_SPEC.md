# Terrain Art Spec — the one-page style guide + tile prompts

*The recipe every AI-generated ground tile follows so the map reads as one world,
plus the 5 copy-paste prompts for the first terrain test run.*

---

## The model in one line

The ground is a **grid of square tiles**. Each ground type (grass, water, dirt…)
is ONE seamless image the engine repeats across the map. So we **generate one tile
per ground type** and the whole world re-skins. No animation, no edges to draw
(for now) — the easiest art in the game.

## Global rules — every tile obeys these

| Rule | Value |
|---|---|
| **Seamless** | The #1 rule. The tile must **tile/repeat with no visible seam** — left edge meets right edge, top meets bottom. |
| **Flat, even light** | NO single light source, NO baked shadow or gradient (a gradient shows the grid when it repeats). Even ambient light. |
| View | straight **top-down** (looking down at the ground). |
| Fill | **opaque**, fills the whole square edge-to-edge. No transparency, no border, no vignette. |
| Content | just the ground texture — **no objects** (no rocks/plants/props sitting on it; those are separate). |
| Variation | subtle organic detail so a big field doesn't look like flat paint — but low-contrast, or it'll look noisy when tiled. |
| Size | **256×256 px**, square (downscaled to 32 px in-game). |
| Style | chunky hand-painted RPG, OSRS-inspired but crisper + more saturated; cohesive across all tiles. |

### Locked palette (matches the game's current ground colors)

- Grass **`#4A7C3A`** (lighter patch variant **`#54864A`**, darker **`#3F6B30`**)
- Water **`#2E5E8C`** (deep `#244F78`, shallow `#3F77A6`)
- Dirt / path **`#7D6A48`** · Road `#8A7A52` · Sand `#C7B487`
- Rock / stone **`#5F5F5F`** (lighter `#6D6D6D`, cliff `#484848`)
- Floor `#8A7A58` · Wall `#4A3F30` · Field (tilled) `#6E5A2E` · Swamp `#47512C`

## Folders & naming (where art goes)

- Drop PNGs in `assets/terrain/` named after the ground type: `grass.png`,
  `grass2.png`, `water.png`, `dirt.png`, `rock.png`, …
- Add each finished key to the `tiles` list in
  [`assets/terrain/manifest.json`](../assets/terrain/manifest.json). Anything not
  listed stays the procedural tile — so we ship one ground at a time, nothing breaks.
- The game keeps its 2.5D cliff-shadows and day-lighting working over the new tiles.

> **Status:** folder, manifest, loader (`src/render/terrainArt.js`) **and the
> in-game display** are wired. Drop a `grass.png` in, list it in the manifest, and
> the grass re-skins across the whole map. Verified with a placeholder tile.

---

## The 5 tile prompts — copy one block per image

The 4 grounds that cover ~all of the screen (+ a grass variant so fields don't
repeat). Paste a block into your generator; keep the shared style so they cohere.
(Prefixed **[STYLE]** = "Seamless tileable top-down 2D game GROUND texture,
hand-painted chunky RPG style (OSRS-inspired, crisper and more saturated), FLAT
even ambient light — no directional shadow, no gradient — fills the whole square
edge-to-edge, no objects, no border. Must tile with no visible seam. 256×256,
square, opaque.")

**1 — Grass (base)** → save as `grass.png`
> [STYLE]. Lush green meadow grass, base color #4A7C3A, tiny blades and tufts, a
> few slightly lighter and darker patches for organic variation — but low contrast
> so it reads clean when repeated. Top-down.

**2 — Grass (variant)** → `grass2.png`
> [STYLE]. The SAME grass style as grass.png but a slightly lighter, drier patch,
> base color #54864A, with a touch more yellow-green and a few tiny wildflowers.
> Must sit seamlessly next to the base grass. Top-down.

**3 — Water** → `water.png`
> [STYLE]. Calm fresh water seen from directly above, base color #2E5E8C, gentle
> ripples and a few soft foam highlights, subtle depth variation. Flat even light
> (no sun glare that would reveal the grid). Top-down.

**4 — Dirt / path** → `dirt.png`
> [STYLE]. Packed earthen dirt path/ground, base color #7D6A48, small embedded
> pebbles, faint ruts and cracks, dry and trodden. Low contrast. Top-down.

**5 — Rock / stone** → `rock.png`
> [STYLE]. Rough grey stone ground, base color #5F5F5F, subtle cracks and mineral
> flecks, a couple of lighter (#6D6D6D) worn patches. Cohesive with the dirt tile.
> Top-down.

*Consistency tip:* generate all five in one session with the same model/seed and
the same [STYLE] text. If your tool has a "tileable / seamless" or "tiling" toggle,
turn it ON — that guarantees the edges wrap. Test one by tiling it 3×3: if you can
spot where the copies meet, regenerate.
