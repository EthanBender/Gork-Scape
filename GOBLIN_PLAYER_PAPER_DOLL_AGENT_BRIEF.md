# CODING AGENT BRIEF — 8-Direction Top-Down Paper-Doll Player System

You are building the player character system for a top-down tile-based RPG called Goblin Empire.

The player must be able to:
- stand idle
- walk around the map
- face 8 directions
- visually equip and unequip items
- show equipped armour, helmets, weapons, shields, and tools as separate visual layers
- keep the system scalable so hundreds of equipment items can be added later without rewriting the player renderer

The game camera is a straight top-down / board-game view.

Do not build this like a platformer.
Do not build this like a 3/4 RPG character.
Do not bake armour/weapons into the player sprite.

The player is a layered paper-doll character.

---

## 1. Core Direction System

The player must support 8 facing directions:

```text
n
ne
e
se
s
sw
w
nw
```

The player entity should store its current facing direction.

Example player state:

```js
const player = {
  position: { x: 0, y: 0 },
  facing: "s",
  movementState: "idle", // "idle" | "walking"
  animationFrame: 0,

  equipment: {
    head: null,
    body: null,
    legs: null,
    main_hand: null,
    off_hand: null,
    tool: null,
    back: null
  },

  selected: false,
  hitFlashActive: false
};
```

---

## 2. Facing Direction Logic

When the player moves, update facing from the movement vector.

```js
function getFacingFromDelta(dx, dy) {
  if (dx === 0 && dy < 0) return "n";
  if (dx > 0 && dy < 0) return "ne";
  if (dx > 0 && dy === 0) return "e";
  if (dx > 0 && dy > 0) return "se";
  if (dx === 0 && dy > 0) return "s";
  if (dx < 0 && dy > 0) return "sw";
  if (dx < 0 && dy === 0) return "w";
  if (dx < 0 && dy < 0) return "nw";

  return null;
}
```

If the player uses click-to-move pathing, facing should update based on the next step in the path, not the final clicked destination.

Example:

```js
const nextStep = path[0];
const dx = nextStep.x - player.position.x;
const dy = nextStep.y - player.position.y;
const facing = getFacingFromDelta(dx, dy);

if (facing) {
  player.facing = facing;
}
```

---

## 3. Player Render Philosophy

The player is not one sprite.

The player is assembled from multiple layers:

```text
shadow
base body
legs equipment
body equipment
head equipment
back item
main hand weapon
off hand shield
tool overlay
selection/effects
```

Equipping an item should not create or swap to a new full-body player image.

Equipping an item only changes the overlay layer for that item slot.

---

## 4. Required Render Layer Order

Render the player in this exact order:

```text
1. shadow
2. base goblin body
3. legs overlay
4. body overlay
5. head equipment
6. back item / cape / backpack
7. main hand weapon
8. off hand shield
9. active tool overlay
10. selection outline / hover effect
11. hit flash / damage effect
```

Every player body sprite and equipment overlay must share:
- the same canvas size
- the same anchor point
- the same direction naming
- the same camera angle
- the same visual scale

Recommended:

```text
Logical tile size: 32 x 32 px
Player sprite canvas: 96 x 96 px
Collision footprint: 1 tile
Anchor point: center-foot or exact canvas center, but it must be consistent
```

The visual sprite can be larger than one tile, but collision is based on the player's logical tile position.

---

## 5. Asset Naming Convention

Use this direction order everywhere:

```text
n, ne, e, se, s, sw, w, nw
```

Base player idle sprites:

```text
/assets/player/base/goblin_base_idle_n.png
/assets/player/base/goblin_base_idle_ne.png
/assets/player/base/goblin_base_idle_e.png
/assets/player/base/goblin_base_idle_se.png
/assets/player/base/goblin_base_idle_s.png
/assets/player/base/goblin_base_idle_sw.png
/assets/player/base/goblin_base_idle_w.png
/assets/player/base/goblin_base_idle_nw.png
```

Future walking sprites:

```text
/assets/player/base/goblin_base_walk_n_0.png
/assets/player/base/goblin_base_walk_n_1.png
/assets/player/base/goblin_base_walk_n_2.png
/assets/player/base/goblin_base_walk_n_3.png
```

Equipment examples:

```text
/assets/player/equipment/head/bronze_helmet_idle_n.png
/assets/player/equipment/head/bronze_helmet_idle_ne.png
/assets/player/equipment/head/bronze_helmet_idle_e.png
/assets/player/equipment/head/bronze_helmet_idle_se.png
/assets/player/equipment/head/bronze_helmet_idle_s.png
/assets/player/equipment/head/bronze_helmet_idle_sw.png
/assets/player/equipment/head/bronze_helmet_idle_w.png
/assets/player/equipment/head/bronze_helmet_idle_nw.png
```

Body:

```text
/assets/player/equipment/body/leather_body_idle_s.png
```

Main hand:

```text
/assets/player/equipment/main_hand/bronze_spear_idle_s.png
```

Off hand:

```text
/assets/player/equipment/off_hand/wooden_shield_idle_s.png
```

Tools:

```text
/assets/player/equipment/tool/bronze_hatchet_idle_s.png
/assets/player/equipment/tool/bronze_pickaxe_idle_s.png
```

---

## 6. Equipment Slots

Create these equipment slots:

```text
head
body
legs
main_hand
off_hand
tool
back
```

For version 1, these are enough:

```text
head
body
legs
main_hand
off_hand
tool
```

Do not create a separate rendered player for every equipment combination.

The same base player must work with all equipment combinations.

---

## 7. Equipment Item Data Contract

Every equippable item must include equipment and visual metadata.

Example helmet item:

```js
{
  id: "bronze_helmet",
  name: "Bronze Helmet",
  itemType: "equipment",
  equipmentSlot: "head",

  equipRequirements: {
    defence: 1
  },

  visualAsset: {
    layer: "head",
    spriteId: "bronze_helmet",
    supportsDirections: ["n", "ne", "e", "se", "s", "sw", "w", "nw"],
    supportsStates: ["idle"]
  }
}
```

Example weapon item:

```js
{
  id: "bronze_spear",
  name: "Bronze Spear",
  itemType: "equipment",
  equipmentSlot: "main_hand",

  equipRequirements: {
    attack: 1
  },

  combatStyle: "stab",

  visualAsset: {
    layer: "main_hand",
    spriteId: "bronze_spear",
    supportsDirections: ["n", "ne", "e", "se", "s", "sw", "w", "nw"],
    supportsStates: ["idle"]
  }
}
```

Example shield item:

```js
{
  id: "wooden_shield",
  name: "Wooden Shield",
  itemType: "equipment",
  equipmentSlot: "off_hand",

  equipRequirements: {
    defence: 1
  },

  visualAsset: {
    layer: "off_hand",
    spriteId: "wooden_shield",
    supportsDirections: ["n", "ne", "e", "se", "s", "sw", "w", "nw"],
    supportsStates: ["idle"]
  }
}
```

Example tool item:

```js
{
  id: "bronze_hatchet",
  name: "Bronze Hatchet",
  itemType: "equipment",
  equipmentSlot: "tool",

  equipRequirements: {
    woodcutting: 1
  },

  toolType: "hatchet",

  visualAsset: {
    layer: "tool",
    spriteId: "bronze_hatchet",
    supportsDirections: ["n", "ne", "e", "se", "s", "sw", "w", "nw"],
    supportsStates: ["idle"]
  }
}
```

---

## 8. Equip Logic

When the player equips an item:

```text
1. Check that the item exists.
2. Check that item.itemType === "equipment".
3. Check equipmentSlot.
4. Check the player's skill requirements.
5. If there is already an item in that slot, move it back to inventory.
6. Remove the new item from inventory.
7. Set player.equipment[slot] = itemId.
8. Re-render the player layers immediately.
```

Pseudocode:

```js
function equipItem(player, inventory, itemId) {
  const item = GameData.items[itemId];

  if (!item) return { ok: false, reason: "Item does not exist." };
  if (item.itemType !== "equipment") return { ok: false, reason: "Item is not equipment." };

  const slot = item.equipmentSlot;
  if (!slot) return { ok: false, reason: "Item has no equipment slot." };

  const requirementsMet = checkEquipRequirements(player, item);
  if (!requirementsMet.ok) return requirementsMet;

  const currentlyEquipped = player.equipment[slot];

  if (currentlyEquipped) {
    inventory.add(currentlyEquipped);
  }

  inventory.remove(itemId);
  player.equipment[slot] = itemId;

  return { ok: true };
}
```

---

## 9. Unequip Logic

When the player unequips an item:

```text
1. Check the slot has an equipped item.
2. Check inventory has room.
3. Move equipped item back into inventory.
4. Set player.equipment[slot] = null.
5. Re-render the player layers immediately.
```

Pseudocode:

```js
function unequipItem(player, inventory, slot) {
  const itemId = player.equipment[slot];

  if (!itemId) return { ok: false, reason: "Nothing equipped in this slot." };
  if (!inventory.hasSpace()) return { ok: false, reason: "Inventory is full." };

  inventory.add(itemId);
  player.equipment[slot] = null;

  return { ok: true };
}
```

---

## 10. Player Visual Renderer

Create a dedicated player renderer.

Do not hard-code visual equipment logic inside the inventory UI or player movement code.

Suggested function:

```js
function renderPlayer(ctx, player) {
  const direction = player.facing;
  const state = player.movementState;
  const frame = player.animationFrame;
  const screenPos = worldToScreen(player.position);

  drawLayer(ctx, getPlayerShadowSprite(), screenPos);

  drawLayer(
    ctx,
    getBasePlayerSprite("goblin_base", state, direction, frame),
    screenPos
  );

  const equipmentLayerOrder = [
    "legs",
    "body",
    "head",
    "back",
    "main_hand",
    "off_hand",
    "tool"
  ];

  for (const slot of equipmentLayerOrder) {
    const itemId = player.equipment[slot];
    if (!itemId) continue;

    const item = GameData.items[itemId];
    if (!item || !item.visualAsset) continue;

    const sprite = getEquipmentSprite(
      item.visualAsset.spriteId,
      state,
      direction,
      frame
    );

    if (sprite) {
      drawLayer(ctx, sprite, screenPos);
    }
  }

  if (player.selected) {
    drawLayer(ctx, getSelectionOutlineSprite(direction), screenPos);
  }

  if (player.hitFlashActive) {
    drawLayer(ctx, getHitFlashSprite(direction), screenPos);
  }
}
```

---

## 11. Sprite Resolver With Fallbacks

The game must not crash if a sprite direction or animation frame is missing.

Use fallback resolution:

```text
1. exact state + direction + frame
2. idle + direction
3. idle + south
4. null / no render
```

Example:

```js
function getEquipmentSprite(spriteId, state, direction, frame) {
  const candidates = [
    `${spriteId}_${state}_${direction}_${frame}.png`,
    `${spriteId}_${state}_${direction}.png`,
    `${spriteId}_idle_${direction}.png`,
    `${spriteId}_idle_s.png`
  ];

  for (const filename of candidates) {
    const sprite = AssetRegistry.get(filename);
    if (sprite) return sprite;
  }

  return null;
}
```

Base player fallback:

```js
function getBasePlayerSprite(spriteId, state, direction, frame) {
  const candidates = [
    `${spriteId}_${state}_${direction}_${frame}.png`,
    `${spriteId}_${state}_${direction}.png`,
    `${spriteId}_idle_${direction}.png`,
    `${spriteId}_idle_s.png`
  ];

  for (const filename of candidates) {
    const sprite = AssetRegistry.get(filename);
    if (sprite) return sprite;
  }

  throw new Error(`Missing required base player sprite: ${spriteId}`);
}
```

---

## 12. Version 1 Requirements

For the first implementation, do not build everything.

Build the smallest complete working version.

Version 1 must support:

```text
Base player:
- idle_n
- idle_ne
- idle_e
- idle_se
- idle_s
- idle_sw
- idle_w
- idle_nw

Equipment overlays:
- leather_body, 8 idle directions
- bronze_helmet, 8 idle directions
- bronze_spear, 8 idle directions
- wooden_shield, 8 idle directions
- bronze_pickaxe, 8 idle directions
- bronze_hatchet, 8 idle directions

Movement:
- player can walk on the map
- player facing updates to movement direction
- base sprite changes direction
- equipment overlays change direction with base sprite

Inventory/equipment:
- click equip item
- click unequip item
- equipment visually appears/disappears
```

Version 1 does not need walking animation.

Idle directional sprites are enough to prove the equipment system.

---

## 13. Version 2 Requirements

Once version 1 works, add walking animation.

Base goblin walking animation:

```text
goblin_base_walk_n_0.png
goblin_base_walk_n_1.png
goblin_base_walk_n_2.png
goblin_base_walk_n_3.png
```

Repeat for all 8 directions.

Equipment walking animation can be added later.

Version 2 fallback rule:

```text
If matching equipment walk frame exists, use it.
If it does not exist, use idle equipment overlay for that direction.
```

This allows the body to animate while gear remains directionally correct.

---

## 14. Collision and Movement Rules

The player occupies one logical tile.

```text
Logical tile: 32 x 32 px
Sprite canvas: 96 x 96 px
Collision footprint: 1 tile
```

Collision must be based on the player's logical tile position, not the visual bounds of the sprite.

This prevents ears, weapons, shields, or large visual overlays from blocking pathing.

---

## 15. Data Registry Requirement

Do not hardcode equipment visuals in the player component.

Create or use a central data registry:

```js
GameData.items
GameData.assets
GameData.player
GameData.equipment
```

The renderer should:
- read equipped item IDs from player.equipment
- look up item visual data in GameData.items
- resolve sprites through AssetRegistry
- draw layers in the correct order

---

## 16. Acceptance Tests

The system is working when all of these are true:

```text
1. Player can face all 8 directions.
2. Player facing updates when walking.
3. Base goblin sprite changes direction correctly.
4. Equipping bronze helmet shows helmet overlay.
5. Unequipping bronze helmet removes helmet overlay.
6. Equipping leather body shows body overlay.
7. Equipping bronze spear shows main-hand overlay.
8. Equipping wooden shield shows off-hand overlay.
9. Equipment overlays rotate/change with facing direction.
10. Missing equipment direction does not crash the game.
11. Inventory item moves into equipment slot when equipped.
12. Equipped item returns to inventory when unequipped.
13. Collision remains one tile even if sprite is larger.
14. Player renderer is separate from inventory and movement logic.
15. No full-body equipment combinations are hardcoded.
```

---

## 17. First Asset List Needed

Create placeholder assets first if final art is not ready.

Required placeholder names:

```text
/assets/player/base/goblin_base_idle_n.png
/assets/player/base/goblin_base_idle_ne.png
/assets/player/base/goblin_base_idle_e.png
/assets/player/base/goblin_base_idle_se.png
/assets/player/base/goblin_base_idle_s.png
/assets/player/base/goblin_base_idle_sw.png
/assets/player/base/goblin_base_idle_w.png
/assets/player/base/goblin_base_idle_nw.png

/assets/player/equipment/head/bronze_helmet_idle_n.png
/assets/player/equipment/head/bronze_helmet_idle_ne.png
/assets/player/equipment/head/bronze_helmet_idle_e.png
/assets/player/equipment/head/bronze_helmet_idle_se.png
/assets/player/equipment/head/bronze_helmet_idle_s.png
/assets/player/equipment/head/bronze_helmet_idle_sw.png
/assets/player/equipment/head/bronze_helmet_idle_w.png
/assets/player/equipment/head/bronze_helmet_idle_nw.png

/assets/player/equipment/body/leather_body_idle_n.png
/assets/player/equipment/body/leather_body_idle_ne.png
/assets/player/equipment/body/leather_body_idle_e.png
/assets/player/equipment/body/leather_body_idle_se.png
/assets/player/equipment/body/leather_body_idle_s.png
/assets/player/equipment/body/leather_body_idle_sw.png
/assets/player/equipment/body/leather_body_idle_w.png
/assets/player/equipment/body/leather_body_idle_nw.png

/assets/player/equipment/main_hand/bronze_spear_idle_n.png
/assets/player/equipment/main_hand/bronze_spear_idle_ne.png
/assets/player/equipment/main_hand/bronze_spear_idle_e.png
/assets/player/equipment/main_hand/bronze_spear_idle_se.png
/assets/player/equipment/main_hand/bronze_spear_idle_s.png
/assets/player/equipment/main_hand/bronze_spear_idle_sw.png
/assets/player/equipment/main_hand/bronze_spear_idle_w.png
/assets/player/equipment/main_hand/bronze_spear_idle_nw.png

/assets/player/equipment/off_hand/wooden_shield_idle_n.png
/assets/player/equipment/off_hand/wooden_shield_idle_ne.png
/assets/player/equipment/off_hand/wooden_shield_idle_e.png
/assets/player/equipment/off_hand/wooden_shield_idle_se.png
/assets/player/equipment/off_hand/wooden_shield_idle_s.png
/assets/player/equipment/off_hand/wooden_shield_idle_sw.png
/assets/player/equipment/off_hand/wooden_shield_idle_w.png
/assets/player/equipment/off_hand/wooden_shield_idle_nw.png
```

---

## 18. Final Instruction

Build this as a reusable system.

Do not build a one-off goblin sprite.

The player must be a scalable 8-direction paper-doll renderer that can support:
- different helmets
- different body armour
- different weapons
- different shields
- tools
- future walking animations
- future attack animations
- future cosmetic items

The immediate goal is not perfect art.

The immediate goal is proving that:
- the goblin can turn
- the goblin can move
- equipped items appear visually
- equipped items disappear when unequipped
- all of this works through data, not hardcoded image swaps
