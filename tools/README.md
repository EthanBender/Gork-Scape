# Item Asset Pipeline

Generate a **consistent** icon set for all ~1063 items with minimal babysitting.
The game already resolves art automatically: drop `assets/items/<item_id>.png`
files in, list their ids in `assets/items/manifest.json`, and
`src/data/itemIcons.js` swaps SVG → PNG everywhere. No code changes when art lands.

## The one insight

Generation is easy; **consistency across 1000+ items is the hard part.** Every
route below solves it the same way: *lock the style once, then batch.* You already
have the batch manifest — `src/data/items.json` (1063 items + categories).

## Workflow (any backend)

```bash
python3 tools/gen_assets.py --probe        # ~10 test prompts to lock a look first
python3 tools/gen_assets.py --dry-run      # write ALL prompts, no API, no cost
python3 tools/gen_assets.py --backend tripo --limit 50   # test batch
python3 tools/gen_assets.py --backend tripo              # full run → writes manifest
python3 tools/gen_assets.py --manifest-only              # rebuild manifest from disk
```

Tune `STYLE` in `gen_assets.py` **once** against the probe — that string on every
prompt is what makes 1063 items look like one set. Backends are stubbed; plug the
endpoint for whichever tool you pick (see below).

## Which tool? (researched June 2026 — verify current pricing before you commit)

Your goal: **isometric low-poly, consistent, cheap, commercial-safe.** For a 3D-iso
look on a 2D web engine you generate 3D → **pre-render each at a fixed iso camera**
→ 2D sprite. You never ship the mesh.

| Route | ~Cost for 1063 | Style-lock | License | Notes |
|---|---|---|---|---|
| **Tripo (Max/API)** text→3D low-poly → iso render | **~$60–90** | `model_seed` + `texture_seed` + presets (best in class) | paid = you own it | **Best value.** Cheapest per-asset (~$0.05–0.09), real batch API, Smart Low-Poly. |
| **Meshy-6** Low Poly Mode → iso render | ~$few hundred | seed ("usually"), no true style-lock | paid = you own it | Cleanest low-poly *look*, but ~10× Tripo and top-up pricing is opaque. |
| **Local SDXL / FLUX.1-schnell + style LoRA** (ComfyUI) | **~$10–30 compute** | trained LoRA = tightest lock | SDXL OpenRAIL / schnell Apache-2.0, both commercial-clean | Cheapest at scale, but a few days of setup + a learning curve. Rent a RunPod 4090 (~$0.34/hr), don't buy. |
| **Scenario (Pro/Max, $45–75/mo)** | ~$75 (one batch) | **custom-trained style model** | paid = full commercial | Only 2D tool with real trained style models + batch API. Great if you'd rather stay 2D-rendered than 3D. |
| **Kenney CC0 kits** (Food/Survival/Medieval) → iso render | **$0** | one render rig = consistent | **CC0**, no attribution | Free, cohesive — but item-icon depth is low-hundreds, not 1063. Best for a fast partial start. |
| game-icons.net | $0 | one bold mono style | **CC BY** (attribution) | The only single source with 1000+ consistent RPG icons — needs a credits page. Not low-poly. |

**Avoid for a scripted batch:** Midjourney (no real API), Luma Genie (opaque/stale).
General image APIs (gpt-image-1, Imagen, Ideogram) work and Imagen offers IP
indemnification, but their style-lock across 1000+ is weaker than a LoRA or Tripo seeds.

## Recommended plan (cheapest path to a cohesive set)

1. **Free start:** grab **Kenney** Food/Survival/Retro-Medieval CC0 kits, render at
   one iso camera → covers a few hundred items today at $0.
2. **Style probe:** run `--probe`, generate those ~10 in **Tripo** (or a local LoRA),
   lock the `STYLE` string / seed / render rig you like.
3. **Batch the rest:** `--backend tripo` (or local SDXL) over the full manifest.
   Over-generate ~2–4× and cull — drift is the real risk, not price.
4. **Post-process:** background-removal + trim/pad to square (ComfyUI-RMBG/BEN2, or
   `rembg` in `postprocess()`), name `<item_id>.png`, drop in `assets/items/`, run
   `--manifest-only`. Icons appear in-game on the next refresh.

Realistic all-in: **$0 (Kenney only) → ~$60–90 (Tripo full set) → a weekend of
culling.** vs. the 40 days of manual prompting you were dreading.

## Licensing landmines (from the research)

- **Ship only from PAID tiers.** Meshy/Tripo *free* tiers are CC BY 4.0 (attribution)
  and Tripo free is *non-commercial* — do not ship free-tier output.
- **FLUX.1 [dev]** model is non-commercial (outputs are OK, but running dev in a
  for-profit pipeline is the gray zone) — prefer **schnell (Apache-2.0)** or **SDXL**.
- **Stable Fast 3D** commercial use is capped at <$1M revenue; **TripoSR** is MIT
  (unrestricted) but lower quality.
- Pure AI output has weak US copyright protection unless a human meaningfully edits it.
