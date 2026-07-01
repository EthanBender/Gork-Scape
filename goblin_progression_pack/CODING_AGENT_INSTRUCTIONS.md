# Coding Agent Instructions: Implement Goblin Empire Progression Data

You are working on a 2-D top-down tile RPG inspired by old-school skill-based games.

Your job is to wire the provided progression data into the existing game without inventing unrelated systems.

Do not redesign the whole game.

Do not replace the UI unless required.

Do not hardcode progression values if they exist in JSON.

Use the JSON files as source of truth.

---

# Files To Add

Place these files in the project:

```text
/src/data/skills.json
/src/data/items.json
/src/data/recipes.json
/src/data/monsters.json
/src/data/drop_tables.json
/docs/progression_brief.md
```

If the project has a different data folder, use the existing convention, but keep the file names the same.

---

# Required Implementation

## 1. Create Game Data Registry

Create or update a central game data loader.

Suggested shape:

```js
export const GameData = {
  skills,
  items,
  recipes,
  monsters,
  dropTables
}
```

The app should import from this registry instead of directly importing JSON all over the codebase.

---

## 2. Skill Panel

Update the skills panel so each skill can show:

- Current level
- Current XP
- XP progress bar
- Next unlock
- What the skill is used for

Use `skills.json`.

Add a helper:

```js
getNextSkillUnlock(skillId, currentLevel)
```

Return the next unlock with level greater than current level.

Example output:

```js
{
  level: 10,
  unlock: "oak_tree"
}
```

---

## 3. Inventory and Item Tooltips

Use `items.json` to power tooltips.

For each inventory item, show:

- Name
- Category
- Uses
- Requirements
- Stats
- Healing
- Effects
- Stackable or not

Do not leave items as anonymous icons only.

A player should understand why an item matters.

---

## 4. Recipe System

Use `recipes.json`.

Create a recipe resolver:

```js
getRecipesForStation(stationId)
```

The resolver should filter recipes by:

- Station
- Player skill level
- Available input items

A recipe can be shown as locked if the player lacks level or materials.

Do not hide all locked recipes. Showing some locked recipes helps progression.

---

## 5. Stations

Add or wire these station types:

```text
furnace
anvil
fire_or_range
range
crafting_bench
```

When the player interacts with a station:

1. Open station recipe UI.
2. Show available recipes.
3. Show missing materials.
4. Show required level.
5. Allow crafting if requirements are met.
6. Consume inputs.
7. Add outputs.
8. Award XP.

---

## 6. Gathering Nodes

Implement or update these node types:

```text
normal_tree
oak_tree
willow_tree
deadwood_tree
copper_rock
tin_rock
iron_rock
coal_rock
gold_rock
black_iron_rock
shrimp_fishing_spot
trout_fishing_spot
pike_fishing_spot
bog_eel_fishing_spot
```

Each node needs:

- Skill requirement
- Tool requirement
- Output item
- XP reward
- Respawn time
- Optional depleted state

Use the unlocks in `skills.json` and item definitions in `items.json`.

---

## 7. Monster System

Use `monsters.json`.

Each monster should have:

- Combat level
- Aggression flag
- Respawn time
- XP reward
- Drop table ID

When a monster dies:

1. Award XP based on monster XP data.
2. Roll drop table from `drop_tables.json`.
3. Spawn ground loot or add loot to inventory.
4. Respawn after `respawn_seconds`.

---

## 8. Drop Tables

Use `drop_tables.json`.

For first implementation, use independent drop rolls.

Example:

```js
function rollDrops(dropTable) {
  const drops = []

  for (const drop of dropTable.drops) {
    if (Math.random() * 100 < drop.chance_percent) {
      drops.push(drop.item_id)
    }
  }

  return drops
}
```

Later this can become weighted buckets, but do not overbuild it now.

---

## 9. Connected Economy

Make sure the following loops work in-game:

## Bow Loop

```text
Woodcutting -> logs
Monster combat -> spider silk
Crafting -> bowstring and bow
Mining -> ore
Smithing -> arrowheads
Ranged -> combat
```

## Smithing Loop

```text
Mining -> ore
Smithing -> bars
Woodcutting -> handles
Smithing -> tools/weapons
Gathering/combat improves
```

## Food Loop

```text
Fishing -> raw fish
Cooking -> cooked food
Combat/exploration -> survival
Combat -> materials
Materials -> crafting/smithing
```

## Swamp Loop

```text
Fishing -> bog eel
Farming/monsters -> swamp herbs
Cooking -> bog eel stew
Woodcutting -> deadwood
Crafting -> goblin charm
Exploration -> swamp access
```

## Rival Camp Loop

```text
Mining/smithing -> better gear
Fishing/cooking -> better food
Crafting -> charms/armour
Combat -> rival goblins
Drops -> unique weapon/armour components
```

---

# Do Not Do These

Do not make skills independent silos.

Do not make monsters only drop coins.

Do not make resource nodes decorative only.

Do not hardcode item stats in UI components.

Do not hide progression data inside components.

Do not invent a second item schema.

Do not remove existing game features unless they directly conflict.

---

# Minimum Acceptance Criteria

The implementation is acceptable when:

1. Skill panel reads unlocks from `skills.json`.
2. Inventory item tooltips read from `items.json`.
3. At least furnace, anvil, cooking, and crafting bench use `recipes.json`.
4. At least five gathering nodes use skill/tool checks.
5. At least five monsters use `monsters.json`.
6. Monster deaths roll `drop_tables.json`.
7. At least one full connected loop works:
   - mine ore
   - smelt bar
   - smith item
   - use item in gathering or combat

---

# Best First Vertical Slice

Build this exact playable loop first:

1. Player chops normal tree.
2. Player mines copper and tin.
3. Player smelts bronze bar at furnace.
4. Player smiths bronze spear at anvil.
5. Player catches shrimp.
6. Player cooks shrimp.
7. Player fights Training Rat.
8. Rat drops bones/meat.
9. Player cooks rat meat or uses bones in crafting.
10. Skill panel updates XP and next unlocks.

Once that works, expand outward.

---

# Final Instruction

Keep the system data-driven.

The JSON files are the design contract.

If something needs to change, change the JSON first, then make the game consume the change.
