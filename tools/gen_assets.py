#!/usr/bin/env python3
"""
gen_assets.py — batch item-icon asset pipeline for Goblin Empire.

The whole point: generate a CONSISTENT icon set for all ~1063 items with almost
no babysitting. It reads the item catalogue you already have (src/data/items.json),
builds one style-locked prompt per item, runs a pluggable backend to render each,
drops the result at assets/items/<item_id>.png, and writes a manifest the game
reads. The game's resolver (src/data/itemIcons.js) auto-swaps SVG → PNG for every
id in the manifest — no code changes when art lands.

USAGE
  # 1. Dry run — no API, no cost. Writes every prompt to tools/out/prompts.jsonl
  #    so you can eyeball the style before spending anything.
  python3 tools/gen_assets.py --dry-run

  # 2. Style probe — emit ~10 representative prompts (one per category) to lock a
  #    look in whatever tool you're testing.
  python3 tools/gen_assets.py --probe

  # 3. Real batch — pick a backend and go. Reads the API key from the env var.
  python3 tools/gen_assets.py --backend meshy --limit 50      # test 50 first
  python3 tools/gen_assets.py --backend meshy                 # full catalogue

  # 4. Rebuild just the manifest from whatever PNGs already exist on disk.
  python3 tools/gen_assets.py --manifest-only

The backend calls are intentionally STUBBED (marked TODO) — plug in the endpoint
for whichever tool the research pass picks. Everything else (prompting, batching,
skip-existing, retries, manifest, post-processing hook) is done.
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ITEMS_JSON = ROOT / "src" / "data" / "items.json"
ASSETS_DIR = ROOT / "assets" / "items"
OUT_DIR = ROOT / "tools" / "out"
MANIFEST = ASSETS_DIR / "manifest.json"

# --- STYLE LOCK -------------------------------------------------------------
# This is the single most important knob: the same style string on every prompt
# is what makes 1063 items look like one set. Tune it ONCE against the probe.
STYLE = (
    "isometric low-poly 3D game item icon, single object centered, "
    "soft studio lighting, subtle ambient occlusion, clean flat background, "
    "transparent background, warm earthy fantasy palette, crisp edges, "
    "no text, no watermark, consistent 45-degree camera"
)

# Per-category hints nudge the model toward the right silhouette/material.
CATEGORY_HINTS = {
    "Equipment": "detailed craftsmanship, metal and leather materials",
    "Resource": "raw natural material, rough texture",
    "Consumable": "small glass or food object, appetizing",
    "Tool": "sturdy handcrafted tool",
    "Processed Material": "refined crafted material, smooth",
    "Utility": "small utilitarian object",
    "Drop Material": "organic monster-drop material",
    "Unique Drop": "rare glowing artifact, ornate",
    "Junk": "worn broken scrap",
    "Ammo": "small projectile, set of a few",
    "Quest/Build Item": "special ornate quest object",
}


def load_items():
    data = json.loads(ITEMS_JSON.read_text())
    items = data if isinstance(data, list) else (data.get("items") or list(data.values())[0])
    return items


def build_prompt(item):
    name = item.get("display_name") or item["item_id"]
    cat = item.get("category", "")
    sub = item.get("subcategory", "")
    hint = CATEGORY_HINTS.get(cat, "")
    subject = name if not sub else f"{name} ({sub})"
    parts = [subject, hint, STYLE]
    return ", ".join(p for p in parts if p)


# --- Backends ---------------------------------------------------------------
# Each backend takes (item_id, prompt, out_path) and must write a PNG to out_path.
# Return True on success. Stubbed calls raise so you notice before a big run.

def backend_dryrun(item_id, prompt, out_path):
    return False  # never writes; used only to emit prompts


def backend_meshy(item_id, prompt, out_path):
    # TODO: text-to-3D → render. Meshy REST: POST /openapi/v2/text-to-3d, poll,
    # then render the mesh to a PNG at a fixed iso camera (their render or Blender).
    # key = os.environ["MESHY_API_KEY"]
    raise NotImplementedError("Plug in the Meshy endpoint (see tools/README.md).")


def backend_tripo(item_id, prompt, out_path):
    # TODO: Tripo3D text/image-to-3D API, then iso render.
    raise NotImplementedError("Plug in the Tripo endpoint (see tools/README.md).")


def backend_pixellab(item_id, prompt, out_path):
    # TODO: PixelLab image API (isometric preset) — returns a PNG directly.
    raise NotImplementedError("Plug in the PixelLab endpoint (see tools/README.md).")


# Negatives + size for the local SD backend (override via env).
SD_NEG = os.environ.get(
    "SD_NEG",
    "text, watermark, blurry, multiple objects, cropped, extra objects, "
    "background clutter, jpeg artifacts, low quality",
)


def backend_local(item_id, prompt, out_path):
    """Stable-Diffusion-WebUI-compatible txt2img — works with Automatic1111, Forge,
    SD.Next, and Draw Things' API server. Uses only the Python stdlib (no pip installs).
    Configure via env: SD_API_URL (default http://127.0.0.1:7860), SD_SIZE, SD_STEPS,
    SD_CFG, SD_SAMPLER. A style LoRA loaded in the server (or a <lora:...> tag in the
    prompt) is what locks the look across the whole batch."""
    base = os.environ.get("SD_API_URL", "http://127.0.0.1:7860").rstrip("/")
    size = int(os.environ.get("SD_SIZE", "512"))
    payload = {
        "prompt": prompt,
        "negative_prompt": SD_NEG,
        "width": size, "height": size,
        "steps": int(os.environ.get("SD_STEPS", "26")),
        "cfg_scale": float(os.environ.get("SD_CFG", "7")),
        "sampler_name": os.environ.get("SD_SAMPLER", "DPM++ 2M Karras"),
    }
    req = urllib.request.Request(
        base + "/sdapi/v1/txt2img",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.loads(r.read())
    imgs = data.get("images") or []
    if not imgs:
        raise RuntimeError("server returned no image")
    png = base64.b64decode(imgs[0].split(",", 1)[-1])
    out_path.write_bytes(png)
    return True


BACKENDS = {
    "dry-run": backend_dryrun, "meshy": backend_meshy, "tripo": backend_tripo,
    "pixellab": backend_pixellab, "local": backend_local,
}


def postprocess(out_path):
    """Optional: transparent-bg cleanup + trim + downscale. Wire in `rembg`/PIL.
    Left as a no-op so the script runs with zero extra deps; enable when ready."""
    return


def write_manifest():
    ids = sorted(p.stem for p in ASSETS_DIR.glob("*.png"))
    MANIFEST.write_text(json.dumps(ids, indent=0))
    print(f"manifest: {len(ids)} items -> {MANIFEST.relative_to(ROOT)}")


def main():
    ap = argparse.ArgumentParser(description="Batch item-icon generator")
    ap.add_argument("--backend", choices=list(BACKENDS), default="dry-run")
    ap.add_argument("--limit", type=int, default=0, help="cap items (0 = all)")
    ap.add_argument("--dry-run", action="store_true", help="write prompts only, no API")
    ap.add_argument("--probe", action="store_true", help="emit ~10 probe prompts and exit")
    ap.add_argument("--manifest-only", action="store_true", help="rebuild manifest from disk")
    ap.add_argument("--overwrite", action="store_true", help="regen even if PNG exists")
    args = ap.parse_args()

    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.manifest_only:
        write_manifest(); return

    items = load_items()

    if args.probe:
        seen, probe = set(), []
        for it in items:
            c = it.get("category")
            if c and c not in seen:
                seen.add(c); probe.append(it)
        path = OUT_DIR / "probe_prompts.txt"
        path.write_text("\n\n".join(
            f"# {it['item_id']} [{it.get('category')}]\n{build_prompt(it)}" for it in probe))
        print(f"probe: {len(probe)} prompts -> {path.relative_to(ROOT)}")
        return

    backend = backend_dryrun if args.dry_run else BACKENDS[args.backend]
    if args.limit:
        items = items[:args.limit]

    prompts_out = (OUT_DIR / "prompts.jsonl").open("w")
    done = skipped = failed = 0
    for i, it in enumerate(items, 1):
        iid = it["item_id"]
        prompt = build_prompt(it)
        prompts_out.write(json.dumps({"item_id": iid, "prompt": prompt}) + "\n")
        out_path = ASSETS_DIR / f"{iid}.png"
        if out_path.exists() and not args.overwrite:
            skipped += 1; continue
        if backend is backend_dryrun:
            continue
        try:
            if backend(iid, prompt, out_path):
                postprocess(out_path); done += 1
                if i % 25 == 0:
                    print(f"  {i}/{len(items)} … {done} generated")
                time.sleep(0.2)  # be nice to the API
        except NotImplementedError as e:
            print(f"!! backend not wired: {e}"); sys.exit(2)
        except Exception as e:  # noqa
            failed += 1
            print(f"  fail {iid}: {e}")
    prompts_out.close()

    print(f"prompts -> {(OUT_DIR / 'prompts.jsonl').relative_to(ROOT)}")
    if backend is not backend_dryrun:
        print(f"done={done} skipped={skipped} failed={failed}")
        write_manifest()
    else:
        print(f"dry-run: wrote {len(items)} prompts (skipped {skipped} already on disk)")


if __name__ == "__main__":
    main()
