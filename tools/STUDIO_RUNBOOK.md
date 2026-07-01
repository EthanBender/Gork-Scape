# Studio Runbook — generate the item icons locally

Hand this to the agent on the Studio (more RAM than the 16 GB dev Mac). Goal: batch
~1063 isometric-low-poly item PNGs with zero per-asset cost, then hand them back to
the game. The game already auto-loads any art you produce — see "Deliver" below.

The whole pipeline is `tools/gen_assets.py` (Python stdlib only, no pip installs).
It reads `src/data/items.json` and writes `assets/items/<item_id>.png` + a manifest.

## 0. Prereqs on the Studio
- Clone/sync this repo. Confirm: `python3 tools/gen_assets.py --dry-run` writes
  `tools/out/prompts.jsonl` with one style-locked prompt per item.
- Apple Silicon: image gen runs on MPS. 32 GB+ makes SDXL comfortable and Flux
  feasible (Flux still wants GGUF quantization).

## 1. Stand up ONE image server (pick a lane)

**Easy lane — Draw Things (GUI, Mac-native):**
1. Install Draw Things (Mac App Store, free).
2. Download an **SDXL** checkpoint + an **isometric/low-poly style LoRA** (Civitai).
3. Settings → enable the **API Server** (serves the SD-WebUI `/sdapi/v1/txt2img`
   endpoint). Note the port.

**Power lane — ComfyUI (best for LoRA control):**
1. `git clone https://github.com/comfyanonymous/ComfyUI && cd ComfyUI`
2. `python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt`
   (Torch ships MPS support; no CUDA needed on Apple Silicon.)
3. Drop an SDXL checkpoint in `models/checkpoints/`, the style LoRA in `models/loras/`.
4. `python main.py` → serves on `:8188`.
   > Note: ComfyUI's API is graph-based, NOT `/sdapi`. Either (a) use ComfyUI's own
   > CSV-batch nodes (CSV Loader + Auto Queue) feeding `tools/out/prompts.jsonl`, or
   > (b) ask me to add a ComfyUI graph backend to `gen_assets.py` (needs your exported
   > workflow-API JSON).

## 2. Lock the style (do NOT skip — drift is the real risk)
```
python3 tools/gen_assets.py --probe        # ~10 prompts, one per category
```
Generate those 10 in your server. Tune the `STYLE` string in `gen_assets.py` and/or
the LoRA strength until the 10 look like one set. The `<lora:...>` tag + fixed
seed/sampler/steps is what enforces consistency across all 1063.

## 3. Batch (SD-WebUI-compatible servers: Draw Things / A1111 / Forge / SD.Next)
```
export SD_API_URL="http://127.0.0.1:7860"   # Draw Things/A1111 port
export SD_SIZE=512 SD_STEPS=26 SD_SAMPLER="DPM++ 2M Karras"
python3 tools/gen_assets.py --backend local --limit 20   # smoke test
python3 tools/gen_assets.py --backend local              # full run
```
Re-run to fill failures (existing PNGs are skipped unless `--overwrite`). Over-generate
~2–4× and cull the misses. The local coding LLM (Qwen coder via Ollama) can babysit
this loop: run, check `done/failed`, retry.

## 4. Post-process to clean icons
Transparent background + trim/pad to square. Options:
- ComfyUI: **ComfyUI-RMBG** / **BEN2** nodes (batch).
- CLI: `pip install rembg pillow` then wire it into `postprocess()` in `gen_assets.py`.
Name every file `<item_id>.png`.

## 5. Deliver back to the game (the seam is already built)
1. Put the PNGs in `assets/items/` in THIS repo (sync from the Studio if separate).
2. `python3 tools/gen_assets.py --manifest-only`  → rebuilds `assets/items/manifest.json`.
3. Done. `src/data/itemIcons.js` reads the manifest at load and swaps SVG → PNG for
   every listed id, everywhere in the game. No code changes. Missing items keep the
   crafted SVG/emoji, so a PARTIAL set ships fine — you can deliver in waves.

## Licensing (don't skip — from the research)
Ship only from PAID/permissive sources. SDXL (OpenRAIL) and FLUX.1-**schnell**
(Apache-2.0) are commercial-clean. Avoid FLUX.1-**dev** for a for-profit pipeline.
Free tiers of Meshy/Tripo are attribution/non-commercial. See `tools/README.md`.
