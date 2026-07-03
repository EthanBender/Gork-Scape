# Goblin Empire — session rules (read this, then work)

Browser 2D tile RPG (OSRS-inspired), live at **gorkscape.ca**. Phaser 3 from
CDN, vanilla ES modules, JSON data files. **There is no build step and you
must never add one.**

## What to work on

**[docs/CRITICAL_PATH.md](docs/CRITICAL_PATH.md) is the authoritative task
order.** Unless the owner says otherwise in this session, take the topmost
unfinished item there. Do NOT invent architecture work. The "NOT for smaller
models" list in that doc is binding: don't touch `src/world/geo2.js`,
`server/index.mjs`, `src/engine/save.js`, or main.js scene/camera/input code.

For map work specifically, follow **[docs/MAP_DESIGN_PASS.md](docs/MAP_DESIGN_PASS.md)**
step by step — fixes go in `src/data/map_patches.json` as typed ops, never
into generator code. Crawl the map in a **center-out spiral** driven by
`node scripts/map_crawl.mjs` (it names the next chunk and shows defects +
elevation for each); check elevation logic on every chunk.

## The loop (every unit of work)

1. Make ONE small change (one chunk, one recipe family, one quest).
2. Run ALL the gates, chained so a failure stops the line:
   ```
   node scripts/smoke.mjs && node test/run.mjs && node scripts/economy_sim.mjs \
     && node scripts/quest_test.mjs && node scripts/pacing_sim.mjs \
     && node scripts/chain_audit.mjs && node scripts/audit_world.mjs \
     && node scripts/map_defects.mjs && node scripts/elevation_audit.mjs
   ```
   Never pipe gate output through `tail`/`grep` to check status — pipes mask
   exit codes.
3. All green → commit with a specific message ("map: c0r2 — cleared 12
   wall_orphans"). Red → fix it, or if not fixed in ~15 minutes, revert
   (`git checkout -- <files>`) and pick a different task. Never commit red.
4. Pushing `main` deploys the live site within ~1 minute. Only push a tree
   where every gate passed.

## Hard rules

- **"The realm is resting" on a static preview is BY DESIGN, not a bug.** The
  client requires the world server. To preview: `node server/index.mjs`
  (launch config `goblin-empire-worldserver`). Never edit client code to
  bypass the landing page.
- All server calls go through `api()` in `src/net/config.js`. Never hardcode
  a server URL.
- No emoji in UI chrome — use the SVG set in `src/ui/icons.js`
  (`icon(name)` / `skillIcon(Skill)`). Item art resolves through
  `src/data/itemIcons.js`.
- Anchor world content to region anchors / probed terrain, never raw
  coordinates (the world has been regenerated before; anchors survive).
- Real player accounts live in `server/accounts.json` — never delete,
  regenerate, or hand-edit it.
- If a validator seems wrong, it isn't. Fix your change, not the gate. Budget
  numbers in `scripts/map_defects.mjs` may only go DOWN.

## Orientation

| Where | What |
|---|---|
| `docs/CRITICAL_PATH.md` | task order + macro map plan (start here) |
| `docs/MAP_DESIGN_PASS.md` | map fix/decorate runbook + patch format |
| `ROADMAP.md` | what's done / backlog |
| `docs/VOYRA_HANDOFF.md` | ops: hosting, backups, deploys |
| `src/data/*.json` | items/monsters/recipes/quests — the safe editing surface |
| `scripts/` | the 8 gates + tools |
