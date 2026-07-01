# Tinkering Expansion — ~200 items + ~100 world nodes (PLAN)

Goal: make Tinkering a *deep* skill by adding a big raw-material economy that reaches
into every other skill and every region of the map. ~200 new items and ~100 new
world nodes, obtained five different ways so it never feels like one grind.

This is a **planning doc**. Nothing is built yet — it sets the taxonomy, where things
live on the map, how you get them, and the exact files/phases to implement.

## How the world is wired (what makes this cheap to build)

- **Nodes auto-place.** `map.js populateNodesFromDb()` scatters ANY non-baseline row
  in `world_nodes.json` into its `region` (semicolon list → REGMAP → REGION_ANCHORS).
  So adding a node = adding a JSON row with the right `region`. World-gen owns the
  placement pass; I only add data (JSON-first), and ping them to confirm volume + any
  new `node_type`/`region`/terrain rules.
- **Gathering already works by `nodeId`.** `gathering.gather(nodeId)` reads `outputs`,
  grants the engine-skill XP, adds the item. New nodes are gatherable for free as long
  as `related_skill` maps to an engine skill and the `required_tool` is wired.
- **Drops are flat rows** in `drop_tables.json` (`drop_table_id, monster_id, item_id,
  chance_percent, qty_min/max`). Add rows to existing monster tables.
- **Byproducts** hook cleanly into `gather()` (one place) — a small chance to *also*
  yield a Tinkering material when you chop/mine/fish/farm.

## The 13 regions (existing) and their Tinkering theme

| Region | Lvl band | Tinkering theme / node types |
|--------|----------|------------------------------|
| Goblin Settlement | 1–15 | teaser scrap pile, a resin tree |
| Grubpit Quarry | 1–25 | starter minerals: saltpeter, raw sulfur, scrap seam |
| Choppers Hollow | 1–20 | resin taps, pitch pine, sapwood |
| Willow Riverlands | 10–30 | reed fibre, river clay (casings), rubber-sap |
| Farmlands | 1–35 | cotton (fuse cord), compost→charcoal, chalk (flux) |
| Grublake | 15–45 | **salvage fishing** (dredge cogs/wire/oil), oil slicks |
| Grubpit / Mine Hills | 20–55 | **mineral hub**: saltpeter, sulfur, sparkstone, quicksilver, flux, lodestone |
| Eastern Oakwoods | 20–50 | hardwood resin, gall-nut (acid), amber |
| Mushroom Forest | 25–55 | fungal rubber, spore-oil, glowcap (voltaic) |
| Old Forest Ruins | 20–45 | **salvage**: scrap heaps, ancient clockwork, ruined golems |
| Bog of Grub | 30–60 | tar seeps, sulfur pools, swamp-gas vents, oily muck |
| Rival Goblin Territory | 45–70 | **war salvage**: powder caches, rival debris, cannon scrap |
| Troll Ridge | 50–80+ | volcanic: ember vents, obsidian, magnetite, steam vents |

## ~200 new items — taxonomy (by how they behave)

1. **Raw minerals (mined / vent-gathered)** ~30 — saltpeter, sulfur, sparkstone,
   quicksilver, flux stone, lodestone, obsidian shard, magnetite, oilsand, tar,
   chalk, niter crystal, ember glass… (tiered where sensible: crude/pure/refined).
2. **Botanical raws (woodcutting / farming taps & byproducts)** ~25 — tree resin,
   pine pitch, rubber-sap, gall-nut, amber, sapwood, cork bark, reed fibre, cotton
   boll, fungal rubber, spore-oil, gum.
3. **Salvage & junk (scavenged / dredged / dropped)** ~25 — scrap metal (tiers),
   bent cog, rusted spring, cracked casing, wrecked barrel, clockwork remains,
   frayed wire, oily rag, ruined gyroscope, war debris, spent shell.
4. **Monster-derived raws (drops)** ~25 — spark gland (tesla), oil sac, powder
   gland, sinew (springs), chitin plate (armour mods), troll grease, bog-gas
   bladder, hardened carapace, static scale, ember heart.
5. **Processed chemicals** ~25 — charcoal, blackpowder, refined powder, high-grade
   powder, nitro paste, incendiary gel, acid vial, coolant, lubricant, flux paste,
   conductive gel, primer compound.
6. **Processed components (tiered)** ~35 — casings/barrels/springs/cogs/pistons/
   plating/flywheels/capacitors/coils/valves/firing-pins/breeches in bronze→voltaic.
7. **Gadget mods / attachments** ~20 — scope, extended mag, bipod, incendiary
   rounds kit, AP core, cooling jacket, overclock chip, shock capacitor, blast
   funnel, recoil damper (modify an equipped gadget).
8. **Tinker-made tools for OTHER skills (cross-pollination OUT)** ~15 — powered
   pickaxe (mining speed), clockwork hatchet (woodcutting), auto-bellows
   (firemaking/smithing), seed spreader (farming), fishing drone, spring-hammer
   (smithing), prospector's lens (find rarer mineral nodes).

Total ≈ 200. Categories 5–8 are **crafted at the workbench** (extends the existing
tinkering.js recipe web); 1–4 come from the world (nodes/byproducts/drops).

## ~100 new world nodes — archetypes × tiers × regions

~20 node archetypes, each in 3–5 level tiers, distributed by region theme = ~100.

| Archetype | Skill / tool | Interaction | Example tiers |
|-----------|--------------|-------------|---------------|
| Saltpeter deposit | mining / pickaxe | mine | crude→pure |
| Sulfur vent | tinkering / chisel | vent | low→rich |
| Sparkstone node | mining / pickaxe | mine | spark→voltaic |
| Quicksilver seep | tinkering / chem_kit | tap | — |
| Flux / chalk seam | mining / pickaxe | mine | — |
| Lodestone / magnetite | mining / pickaxe | mine | — |
| Ember / obsidian vent | tinkering / heat_tongs | vent | troll ridge |
| Resin tap | woodcutting / tap | tap | pine→hardwood |
| Rubber-sap tree | woodcutting / tap | tap | — |
| Gall / amber oak | woodcutting / tap | tap | — |
| Reed / cotton patch | farming / — | forage | — |
| Scrap heap | tinkering / scavenge | salvage | small→war-grade |
| Wrecked machine | tinkering / wrench | salvage | clockwork→golem |
| Powder cache | tinkering / — | salvage | rival territory |
| Tar seep | tinkering / chem_kit | tap | bog |
| Swamp-gas vent | tinkering / chisel | vent | bog |
| Oil slick / salvage spot | fishing / rod-net | dredge | grublake |
| Steam vent | tinkering / chisel | vent | troll |

New tool types to register + gate (`hasTool`): `tap`, `chisel` (exists in data),
`chem_kit`, `scavenge`/`wrench`, `heat_tongs`. New interactions: `tap`, `vent`,
`salvage`, `dredge` (all route through the same `gather()` path).

## Acquisition matrix — five ways, on purpose

| Method | Share | What | Cross-skill hook |
|--------|-------|------|------------------|
| **Gather** (node+tool) | ~45% | mineral veins, resin taps, vents, scrap heaps | uses Mining/Woodcutting/Fishing tools; a few train those skills, a few train Tinkering |
| **Byproduct** | ~20% | chop→resin, mine→saltpeter, fish→junk cog, cook→grease, smith→slag, farm→cotton | one hook in `gather()` + skill-success points; the biggest cross-pollinator |
| **Drop** | ~15% | spark glands, oil sacs, sinew, chitin, powder glands | region-appropriate monsters (drop_tables.json) |
| **Craft** | ~15% | chemicals, components, mods, tools | the workbench recipe web (tinkering.js) |
| **Reward** | ~5% | rare boss gadgets/components, quest unlocks | boss tables + quest rewards |

## Cross-skill web (every skill feeds Tinkering, and Tinkering feeds back)

- **Mining** → saltpeter/sulfur/sparkstone/flux (+ byproduct while mining any rock).
- **Woodcutting** → resin/pitch/rubber (taps) + byproduct while chopping.
- **Fishing** → dredge junk cogs/wire/oil at salvage spots + byproduct.
- **Farming** → cotton (fuse cord), compost→charcoal, gall (acid).
- **Firemaking** → char logs into charcoal (already) → blackpowder keystone.
- **Smithing** → bars→casings/barrels; slag byproduct while smithing.
- **Cooking** → grease/oil byproduct (lubricant).
- **Crafting** → leather grips, canvas, fuse cord.
- **Tinkering → OUT**: powered tools that speed up Mining/WC/Smithing/Farming/Fishing
  and a prospector's lens that reveals rarer mineral nodes. This is the payoff loop.

## Implementation phases (JSON-first, my lane; ping world-gen before map work)

**Phase 1 — Item registry (~200 items).** Extend `tinkering.js` generation for the
tiered components/chemicals/mods/tools; add raw-material + drop items (generated from
tables, not hand-authored). Register outputs so `addItem`/tooltips/GE all work.

**Phase 2 — Nodes (~100).** Add rows to `world_nodes.json` (region, outputs, level,
tool, interaction). Register new tool items + wire `hasTool` for `tap/chem_kit/
scavenge/heat_tongs`. Confirm `engineSkill('tinkering')` grants Tinkering XP for
tinker-skill nodes. **Ping world-gen** to confirm `populateNodesFromDb` handles the
new volume + node_types + any terrain rules (tar pits on swamp, vents on mountain).

**Phase 3 — Drops.** Add ~40 rows to `drop_tables.json` on region-matched monsters
(spark glands from tesla-y bugs, oil sacs from bog things, sinew from beasts, powder
glands from rival goblins, etc.).

**Phase 4 — Byproducts.** Extend `gathering.gather()` (and skill-success points in
smithing/cooking) with a small level-scaled chance to also yield a themed Tinkering
material tied to the node's region/skill. One tunable table.

**Phase 5 — Crafting web + mods + out-tools.** Recipes for every processed item; a
gadget-mod/attachment mechanic (equip a mod onto a gadget); powered tools that boost
other skills' success/speed.

**Phase 6 — Verify.** Headless: item/node counts, gather resolves, drops roll,
byproduct rates. Browser: gather a new node, dredge a salvage spot, craft up a
chain, see a byproduct fire.

## Files touched

- `src/systems/tinkering.js` — items + recipes (generation). **[economy, mine]**
- `src/data/world_nodes.json` — ~100 node rows. **[economy, mine]**
- `src/data/drop_tables.json` — ~40 drop rows. **[economy, mine]**
- `src/systems/gathering.js` — byproduct hook + new tool/interaction handling. **[economy]**
- `src/systems/tinkeringUI.js` / a small tools panel — mods + out-tools UI. **[economy, self-contained]**
- `src/world/map.js` `populateNodesFromDb` / `RESOURCE_TYPES` — **world-gen** confirms
  placement of the new node_types/regions/terrain; I stay JSON-first and ping first.
- `src/main.js` — only if a new interaction verb needs a tiny hook (tagged).

## DECISIONS (owner, 2026-07-01)

- **Rollout:** proof slice first (~60 items / ~30 nodes across a few regions + a
  couple byproducts + the kit tools + an out-tool), then phase to the full 200/100.
- **Node tools:** YES — craft your own kit (tap / chem_kit / scavenge / heat_tongs)
  at the workbench to unlock the gathering.
- **Out-tools:** YES, now — powered tools that speed up other skills.
- **QUEST-GATED PROGRESSION (new):** the Tinkering skill is UNLOCKED by an intro
  quest — you can't tinker until you've done it. Then a **quest line** progressively
  unlocks expansions of the skill (blackpowder → gadget classes → higher tiers →
  out-tools). Content is locked behind quest milestones, not just level.

### Quest-gating design

- A lightweight **unlock registry**: `Game.unlocks` (a Set of unlock ids, persisted
  with the save). `hasUnlock(id)` checks it; quests grant unlocks via a new reward
  type `unlock: <id>`.
- Recipes/nodes/skill carry an optional `unlock` requirement; the workbench, the
  skill, and specific recipes are hidden/locked until their unlock is granted.
- **Intro quest "Sparks of Invention"** → grants `tinkering` (skill + workbench).
- **Quest line "The Tinkerer's Path"** (stages) → `tinkering_powder` (blackpowder +
  bombs), `tinkering_cannons` (Hand Cannon line), `tinkering_voltaic` (top tier),
  `tinkering_tools` (powered out-tools). Each stage is a real quest with objectives
  (gather X, build Y, defeat Z) and the unlock as its reward.

## Proof slice (this build)

Spine that proves the whole loop end-to-end:
1. Unlock registry + `unlock` reward type in the quest engine + save persistence.
2. Intro quest unlocking the skill + workbench (locked before it).
3. Kit tools (tap/chem_kit/scavenge) craftable; ~30 nodes in ~4 regions needing them.
4. One byproduct (mine→saltpeter) and one out-tool (prospector's lens or powered
   pickaxe) as the payoff.
5. A 3-stage quest line expanding the skill (powder → cannons → tools).
6. Verify end-to-end in the browser.
