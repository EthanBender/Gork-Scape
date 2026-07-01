# Goblin Empire Full Asset Database — Schema and Usage

## What This Pack Adds

This pack expands the previous item database into a full game asset database covering:

- terrain and textures
- world props
- fences, walls, bridges, docks and gates
- resource nodes
- multi-state nodes
- skill stations
- common mobs
- friendly mobs
- passive mobs
- NPCs
- four bosses
- drop tables
- animation requirements
- interaction rules
- region asset requirements

## Camera / Art Style

Assets are intended for a **straight top-down board-game camera**, not a 3/4 camera.

Recommended asset style:

> Top-down 3D rendered assets, baked into 2D sprites/tiles.

Base tile:
- 32 x 32 px logical tile
- larger props/buildings can occupy multiple tiles
- creatures are usually 32x32 to 64x64
- bosses can be 96x96 to 160x160

## Key Tables

### Asset Master
The full list of all asset records.

### World Nodes
Interactable world resource nodes:
- trees
- ore rocks
- fishing spots
- crop patches

These define:
- skill
- level requirement
- required tool
- output item
- regions
- interaction
- respawn
- state flow

### Multi-State Assets
Defines state transitions.

Examples:
- tree: full -> stump -> full
- ore: full -> depleted -> full
- crop: empty -> planted -> growing -> ready -> empty
- gate: closed -> open
- chest: closed -> open/looted

### Monsters NPCs
All creatures and characters:
- common mobs
- passive mobs
- friendly mobs
- NPCs
- bosses

### Drop Tables
Connects monsters to item outputs.

### Interactions
Defines item/world/station behaviour:
- hatchet on tree
- pickaxe on ore
- raw fish on range
- ore on furnace
- bar on anvil
- seed on patch
- planks/nails on broken bridge

## Implementation Rule

Do not hard-code these systems into UI components.

Create a data registry:

```js
GameData.assets
GameData.worldNodes
GameData.multiStateAssets
GameData.monsters
GameData.drops
GameData.interactions
GameData.stations
```

Then implement systems that consume the data.

## Multi-State Example

Tree:

```text
full -> on_successful_chop -> stump -> after_respawn_seconds -> full
```

Ore:

```text
full -> on_successful_mine -> depleted -> after_respawn_seconds -> full
```

Crop:

```text
empty -> plant_seed -> planted -> timer -> growing -> timer -> ready -> harvest -> empty
```

## Bosses

The first four bosses:

1. Red-Ear Captain — Rival Goblin Territory
2. Grub Bog Horror — Bog of Grub
3. Old Root Colossus — Old Forest Ruins
4. Troll King Grum — Troll Ridge

Each boss should:
- have a unique arena
- drop a unique crafting/unlock item
- unlock or improve a region loop
- connect back into crafting, equipment or travel
