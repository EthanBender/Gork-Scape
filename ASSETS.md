# Goblin Empire — Visual Asset Manifest

Everything is currently drawn as labeled colored rectangles. This is the list of
real art to replace them with. Drop files into `assets/<folder>/<key>.png` using
the **key** names below and I can wire up a Phaser loader + sprite swap in one
pass (the keys already match the in-code identifiers).

**Format:** PNG, transparent background (except full-tile terrain). Pixel-art
friendly. Color in parentheses = the current placeholder color, i.e. the
identity to keep.

---

## 1. Terrain tiles — `assets/tiles/` (32×32, tileable, opaque)

| key | description |
|-----|-------------|
| `grass`  | base grass ground (green #4a7c3a) |
| `water`  | water; ideally also 4–8 edge/shore variants later (blue #2e5e8c) |
| `rock`   | impassable rocky wall / cliff (gray #6b6b6b) |
| `floor`  | goblin forge stone floor (tan #7a6a4a) |

*(Optional polish: dirt path, grass variants for visual noise.)*

## 2. World objects — `assets/objects/` (32×32, transparent; some can be larger and bottom-anchored)

| key | description |
|-----|-------------|
| `tree`         | full leafy tree (dark green #1f5c1f) |
| `tree_stump`   | depleted tree (chopped stump) |
| `fishing`      | fishing spot / water ripple marker (cyan #57b9d6) |
| `rockore`      | minable copper ore rock (brown #9c6b3a) |
| `rockore_spent`| depleted/empty rock |
| `anvil`        | blacksmith anvil (dark #3a3a3a) |
| `fire`         | campfire / cooking range (orange #d2691e) — 2–3 frame flame anim welcome |
| `craft`        | crafting table (brown #8b5a2b) |

## 3. Characters — `assets/chars/` (32×32 or 32×48, bottom-anchored)

Minimum: one idle frame each. Ideal: a 4-direction (down/up/left/right) walk
cycle of 2–4 frames as a sprite sheet — tell me the frame size/layout and I'll
configure the animation.

| key | description |
|-----|-------------|
| `gork`         | the player goblin, Gork (green-skinned #6fbf3f) |
| `goblin_guard` | hostile goblin guard, armed (military green #4f8f3a) |
| `goblin_elder` | robed elder goblin, non-combat (purple robe #8a6fbf) |

## 4. Item icons — `assets/items/` (32×32, transparent)

These show in inventory, equipment paperdoll, and on the ground when dropped.

| key | description |
|-----|-------------|
| `goblin_spear`      | crude spear (weapon) |
| `goblin_hide_armor` | hide body armor |
| `goblin_shortbow`   | short bow (2h) |
| `bronze_hatchet`    | bronze axe (also a woodcutting tool) |
| `bronze_pickaxe`    | bronze pickaxe (also a mining tool) |
| `logs`              | bundle of logs |
| `raw_fish`          | raw fish |
| `cooked_fish`       | cooked fish |
| `burnt_fish`        | burnt fish |
| `ore`               | copper ore chunk |
| `bronze_bar`        | smelted bronze bar |
| `bones`             | bones (guard drop) |
| `coins`             | gold coin pile — optional 3–4 stack-size variants (1, 5, 25, 100+) |

## 5. Skill icons — `assets/skills/` (24×24 or 32×32, transparent)

For the Skills tab grid (one per skill):

`woodcutting`, `fishing`, `mining`, `cooking`, `smithing`, `crafting`,
`attack`, `strength`, `defence`, `ranged` — plus optional `hitpoints`.

## 6. UI / FX — `assets/ui/` (optional, nice-to-have)

| key | description |
|-----|-------------|
| `slot`        | inventory/equipment slot background (square) |
| `hitsplat_hit`| red damage splat behind the number |
| `hitsplat_miss`| blue "0"/miss splat |
| `heart`       | HP icon |
| `coin`        | small coin for the qty badge |
| 13× `slot_<name>` | faint slot silhouettes for empty equipment slots (head, cape, neck, ammo, weapon, body, shield, legs, hands, feet, ring) |

---

### Priority order (if commissioning incrementally)
1. **Characters** (`gork`, `goblin_guard`, `goblin_elder`) — biggest legibility win.
2. **World objects** — so trees/rocks/anvil/etc. read at a glance.
3. **Item icons** — inventory + ground loot.
4. **Terrain tiles** — replace the flat color fills.
5. **Skill + UI icons** — final polish.

When you have even folder #1, hand it over and I'll add the loader and swap the
rectangle renderer for sprites.
