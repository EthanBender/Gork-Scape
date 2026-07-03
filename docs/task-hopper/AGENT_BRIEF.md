# Agent Brief — how to work the hopper

*Paste this (or point an agent at this file) to have it find, claim, do, and close a
task. This is the executor's entry point; the curator (planning agent) owns filing.*

---

## 0. Orient (read first, once)

- `CLAUDE.md` (repo root) — the binding session rules. **The hard "never touch" list and
  the gate discipline below come from it.**
- `docs/task-hopper/README.md` — the schema, eligibility routing, and guardrails.
- `docs/task-hopper/HOPPER.jsonl` — the task feed (one JSON task per line). **Source of truth.**
- `docs/task-hopper/BOARD.md` — the human dashboard (read-only mirror; the curator maintains it).

## 1. Find the next task

From `HOPPER.jsonl`, select the task with **`status: "ready"`**, honoring `depends_on`,
by priority `P0→P3`, ties broken toward `source: "owner"`. Only take a task whose
`eligibility` your agent class is allowed to run:

| Your agent class | May take |
|---|---|
| Overnight automated runner (Forge/Voyra) | `overnight-safe` **only** |
| Strong model / interactive dev | `overnight-safe` + `needs-strong-model` |
| Human / owner | anything, incl. `needs-owner` |

**Never auto-pick** `needs-owner`, `review-then-overnight`, or anything still `inbox`
(inbox = not yet triaged by a human; agent/gate-sourced items sit there until promoted).

## 2. Claim it (so two agents don't collide)

In `HOPPER.jsonl`, set that task's `status` to `"picked"` and add `"picked_by"` +
`"picked_at"` before doing any work. First writer wins the claim.

## 3. Do it — one small change, inside the rails

- Do **only** what the task's `interpreted` + `acceptance` describe. Don't refactor or scope-creep.
- Prefer the `files_likely` list; obey the task's `guardrails` **and** these repo-wide hard rules (from CLAUDE.md):
  - **No build tooling, ever.** Vanilla ES modules, Phaser from CDN, JSON data — files served as-is.
  - **Never touch** `src/world/geo2.js`, `src/main.js` scene/camera/input surgery, `server/**` beyond config, `src/engine/save.js`, `server/accounts.json`.
  - **Map fixes → `src/data/map_patches.json` typed ops only** (never generator code); `scripts/map_defects.mjs` budgets ratchet DOWN only.
  - Server calls via `api()` in `src/net/config.js`. No emoji in UI chrome (use `src/ui/icons.js`; item art via `src/data/itemIcons.js`). Anchor to region anchors, not raw coords.
  - "The realm is resting" on a static preview is **by design** — never edit client code to bypass it; preview via `node server/index.mjs` (launch `goblin-empire-worldserver`, http://localhost:5200).

## 4. Verify + ship (nothing red ever ships)

Prove the task with its `telemetry.gates`, then run the **full** pre-commit chain — all
green or nothing commits. Chain with `&&` (pipes mask exit codes; never `| tail`/`| grep`):

```
node scripts/smoke.mjs && node test/run.mjs && node scripts/economy_sim.mjs \
  && node scripts/quest_test.mjs && node scripts/pacing_sim.mjs \
  && node scripts/chain_audit.mjs && node scripts/audit_world.mjs \
  && node scripts/map_defects.mjs && node scripts/elevation_audit.mjs
```

- **All green** → commit per unit of work with a specific message (e.g. `map: c0r2 — cleared 12 wall_orphans`, or `hopper GH-0003 — 3 new Alchemy tonics`). Pushing `main` deploys gorkscape.ca in ~1 min.
- **Red > 15 min** → `git checkout -- <files>`, set the task's `status` back to `"ready"` with a `"notes"` line on what blocked, and stop. Don't dig.

## 5. Close out

- Set the task's `status` to `"done"` in `HOPPER.jsonl` (add the commit hash in `notes`).
- Report back to the curator: **task id + one line of what changed + commit**. The curator
  reconciles `BOARD.md` and does any follow-on filing.

---

**In one breath:** *Read CLAUDE.md + docs/task-hopper/README.md. In HOPPER.jsonl take the
highest-priority `status:ready` task your class may run (overnight ⇒ `overnight-safe`
only), mark it `picked`, make just that one change inside the guardrails, run the gate
chain green, commit per unit, mark it `done`, and report the id + commit.*
