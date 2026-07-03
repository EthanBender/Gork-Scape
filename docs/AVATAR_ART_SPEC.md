# Avatar Art Spec — the one-page style guide + pilot prompts

*Owner: character-render lane. This is the recipe every AI-generated avatar asset
follows so the pieces match, and the 6 copy-paste prompts for the first manual
test run (hopper GH-0012).*

---

## The model in one line

The goblin is a **cut-out puppet**: separate pieces (head, torso, arm, leg, gear,
weapon) pinned at their joints. The engine already animates by rotating the pieces
— so we **generate each piece once**, we do NOT draw animation frames. Swap the
plain shapes for gorgeous pieces and all the walking/swinging keeps working.

## Global rules — every piece obeys these

| Rule | Value |
|---|---|
| View | slightly-top-down **¾ FRONT** view (facing the camera). Later: back + side. |
| Pose | flat, neutral, straight (the engine bends it). No action poses. |
| Background | **fully transparent PNG.** No ground shadow (the engine draws that). No text, no border. |
| Light | soft **top-left** key light + a subtle rim light. Matte, not glossy. |
| Size | author big — ~**512 px** per piece — it's downscaled to ~32 px in-game. |
| Style | chunky hand-painted RPG, OSRS/RuneScape-inspired but crisper + more saturated, bold clean silhouette. |

### Locked palette (matches the game's real colors)

- Goblin skin green **`#6FBF3F`** (shaded limbs **`#4E9A2A`**)
- Leather / cloth brown **`#7A5230`**, boot brown **`#5A3A1E`**
- Bronze **`#B5793A`** (dark edge **`#8A5A2B`**) · Iron `#8F9196` · Steel `#C2C7CE` · Gold `#E3C45A`
- Dark outline **`#2B2B2B`**

### The pin (this is the important one)

Each piece has ONE joint the engine rotates it around — frame the art so that joint
is where the spec says:

| Piece | Put the pin here |
|---|---|
| **Torso** | hip line at the **bottom-center** |
| **Head** | neck at the **bottom-center** (keep ears inside the frame) |
| **Arm** | shoulder at the **top-center**; hand at the bottom |
| **Leg** | hip at the **top-center**; foot at the bottom |
| **Helm** | brow band across the **lower third** (sits on the forehead) |
| **Weapon** | grip/handle at the **bottom** (where the hand holds); tip at the top |

Exact numbers live in [`assets/avatar/pivots.json`](../assets/avatar/pivots.json)
(pulled straight from the rig, so art lines up automatically).

## Folders & naming (where art goes)

- Drop PNGs in `assets/avatar/` named `<group>_<part>[_<variant>]_<facing>.png`,
  facing = `s` (front) / `n` (back) / `e` (side; west reuses east mirrored).
  e.g. `body_torso_s.png`, `body_head_s.png`, `gear_helm_bronze_s.png`,
  `weapon_bronze_scimitar.png`.
- Add each finished key to the `parts` list in
  [`assets/avatar/manifest.json`](../assets/avatar/manifest.json). Anything not
  listed stays the procedural shape — so we ship piece by piece, nothing breaks.
- Approve every piece in **`avatar_preview.html`** (the test window) across
  facings/animations before it goes live.

> **Status:** the folder, manifest, pivots, and loader (`src/render/avatarArt.js`)
> are in place. The code that paints these PNGs onto the goblin on-screen is the
> next build step (it's easiest to write against one real test image) — but you can
> **generate all 6 below right now** in parallel.

---

## The 6 pilot prompts (GH-0012) — copy one block per image

They snap together into one complete front-facing armed goblin. Paste a block into
your generator; keep the shared style so they match. (Prefixed **[STYLE]** =
"Chunky hand-painted 2D RPG game asset, OSRS-inspired but crisper and more
saturated, bold clean silhouette, soft top-left light + subtle rim light, matte.
Slightly-top-down ¾ FRONT view, flat neutral pose, centered, fully transparent
background, NO ground shadow, no text, no border, ~512px.")

**1 — Torso** → save as `body_torso_s.png`
> [STYLE]. ONLY the torso of a cartoon goblin — chest, belly and hips — in a simple
> sleeveless brown leather jerkin (#7A5230) over green skin (#6FBF3F). No head, no
> arms, no legs. Short neck stub at top-center, flat hip line at the bottom edge,
> bare shoulder sockets at the top corners. Symmetrical, facing forward.

**2 — Head + face** → `body_head_s.png`
> [STYLE]. ONLY a cartoon goblin HEAD, front view: round green head (#6FBF3F), two
> large pointed ears sticking straight out left and right, big expressive eyes, a
> cheeky under-bite with one small tusk. No helmet, no neck or body. Friendly but
> mischievous. Center the face; keep both ears fully inside the frame.

**3 — Arm** (one, reused for both) → `body_arm_s.png`
> [STYLE]. ONE single goblin ARM only, green skin (#6FBF3F, shaded #4E9A2A),
> hanging relaxed and roughly straight with a slight elbow bend, open hand at the
> end ready to grip a weapon. No body. Vertical — shoulder at the TOP-CENTER of the
> image, hand at the bottom.

**4 — Leg** (one, reused for both) → `body_leg_s.png`
> [STYLE]. ONE single goblin LEG only, green skin (#6FBF3F), ending in a simple
> brown boot (#5A3A1E). Straight with a slight relaxed bend, no body. Vertical —
> hip at the TOP-CENTER of the image, foot at the bottom.

**5 — Bronze helm** (layers on the head) → `gear_helm_bronze_s.png`
> [STYLE]. ONLY a bronze open-face helmet (#B5793A, darker edges #8A5A2B, soft
> metal highlights) sized for a round goblin head, front view. Domed top, OPEN face
> (no visor) so eyes and mouth show, with clear GAPS at the sides for pointed ears
> to poke through. Just the helmet on transparent background; brow band across the
> lower third.

**6 — Bronze scimitar** (held) → `weapon_bronze_scimitar.png`
> [STYLE], but in PROFILE (side-on), blade pointing UP. A single bronze curved
> scimitar: polished bronze blade (#B5793A) with a darker edge (#8A5A2B), a
> leather-wrapped grip and a small pommel. Nothing else. Vertical — GRIP/handle at
> the very bottom (where a hand holds it), blade curving up to the tip.

*Tip for consistency:* generate all six in one session with the same model/seed and
the same [STYLE] text, and reference this palette in each. If your tool supports it,
feed the current procedural goblin (a screenshot from `avatar_preview.html`) as an
image reference so scale + proportions match.
