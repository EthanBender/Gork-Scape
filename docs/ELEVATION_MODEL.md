# Elevation model & 2.5D relief — render-lane handoff

The world now ships a **coherent, rule-based heightfield**. World-gen (`src/world/map.js`)
produces it; the **render lane owns turning it into visible 2.5D**. This doc is the
contract between the two.

## What you get

`generateWorld()` returns an extra field:

```js
world.elevation   // Uint8Array(W*H), one height 0–255 per tile, row-major (y*W + x)
```

Read it exactly like `world.terrain` / `world.collision`:

```js
const h = world.elevation[y * world.W + x];   // 0 = valley floor … 255 = peak
```

It is **data only** — nothing in the sim reads it yet, so you can shade from it
however you like without breaking gameplay. Collision is unchanged: elevation does
**not** gate movement (a mob walks up a hill the same as across a plain).

## The rules baked into the numbers

Seeded per-terrain targets are relaxed (4 blur passes) into a continuous field, with
mountain peaks and water valleys re-pinned each pass so ramps form *around* them
instead of averaging flat. Net result, verified by `scripts/audit_world.mjs`:

| Feature                     | Height band | Rule |
|-----------------------------|-------------|------|
| Deep water / rivers         | ~6–20       | **Lowest** — valley floors; banks slope down into them |
| Swamp / mud                 | ~30         | Low, wet lowland |
| Sand / shore                | ~46–52      | Just above the waterline |
| Roads / dirt / fields       | ~66–68      | Worn flat |
| **Grassland**               | ~66–92      | **Rolling** — gentle fbm swell, ramps up toward hills |
| **Settlement floor / walls**| ~92–98      | **Built up** a little proud of the plain |
| Cliff faces                 | ~122–132    | Terrace lips / mountain flanks |
| Rock / mountain             | ~158–196    | **Highest** — foothills ramp up to the peaks |

Measured on seed 1337: water ≈7.5 < grass ≈79 (rolls 14–176 with the ramps) < rock ≈183;
settlements ≈86, above the surrounding plain.

## Relief already applied to `terrain` (no work needed)

Two visual passes already run *before* you get the world, using the elevation field:

- **Terrace lips** — on high rock, each drop to a lower elevation band becomes a
  `CLIFF` tile, so mountains read as stacked climbable terraces, not one smooth dome.
- **Drop shadows** — ground sitting well below its northern neighbour is recolored to
  a `*_SHADOW` variant (`GRASS_SHADOW`, `DIRT_SHADOW`, `SAND_SHADOW`), a soft ~2-tile
  band at real steps. Light reads from the south.

These are baked into `world.terrain` as ordinary variant ids (see `TERRAIN_DEFS` in
`worldData.js`), so they render for free with the existing color-by-id draw.

## Full 2.5D draw — IMPLEMENTED (world-gen lane, `src/main.js`)

The per-tile vertical extrusion is live in `drawTerrain()` / `drawObjects()`:

- `elevLift(elev, i) = (elev[i] - 80) * 0.34` px — plains (~80) barely move, mountains
  (~196) lift ~40px, water (~6) sinks ~25px.
- Each tile's top face is drawn at `y*TILE - lift`; the **south-facing gap** below a
  raised tile is filled with a `shadeColor(color, 0.5)` side wall sized to the drop to
  the tile in front, so steps read as solid faces with no seams.
- Painter order (north→south) already draws front tiles last, so raised tiles occlude
  what's behind them. Objects (trees, ore) lift by their own tile's height so they stay
  planted. Collision / pathing / hit-testing are untouched — still the flat grid.

Verified in-game: mine-hills / Troll Ridge render as stacked terraces with shaded
faces, water sits in valleys, no gaps, no console errors.

## The one remaining cross-lane item — avatar lift (character-render seam)

The **player and NPC avatars are still drawn at flat height** in `drawEntities()`, which
is the character-render lane's seam (`drawAvatar(...)`). On steep ground they'll read
slightly off the lifted terrain. The fix is one line — offset the draw `y` by
`elevLift(world.elevation, ty*W + tx)` for each entity — but it lives in the avatar
draw call, so world-gen and character-render should sync on where it goes. On the flat
playable areas (town, farmland, plains) the offset is ≤ a couple px, so this is polish,
not a blocker.
