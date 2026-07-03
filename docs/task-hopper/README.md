# Goblin Empire — Task Hopper

*The GORT archival-planning subsystem. Owned and curated by the planning agent; it
holds small, well-scoped units of feedback so they can be executed later — most of
them overnight by the Forge runner inside Voyra — without interrupting live work.*

**This subsystem only records and organizes work. It never does the work, and it
never touches application code or any pre-existing document.** New files live only
under `docs/task-hopper/`.

---

## What lives here

| File | Role | Audience |
|---|---|---|
| `README.md` | This manual: schema, taxonomy, telemetry, curation + consumption protocol. | Humans + the runner |
| `HOPPER.jsonl` | **Canonical feed** — one JSON object per task, one per line. Source of truth. | Forge / Voyra runner |
| `BOARD.md` | Human-readable dashboard rendered from the feed (status × eligibility × priority). | Owner |

The runner reads `HOPPER.jsonl`. The owner reads `BOARD.md`. The curator keeps both
in sync.

---

## How a task flows (the pipeline this subsystem exists to serve)

```
owner voices a bug / change  ─►  CURATOR (this agent)  ─►  HOPPER.jsonl (+ BOARD.md)  ─►  Forge picks eligible tasks overnight  ─►  gates green  ─►  commit per unit
        raw, tiny, mid-flow        interpret · optimize          organized backlog             filter: ready & overnight-safe        self-verified
                                    classify · scope telemetry
```

The curator turns each raw scrap into an **executor-ready** record: a crisp problem
statement, the *kind* of work, where it's safe to do it, and exactly which gate(s)
prove it's done. That's what lets a runner act on it unattended and safely.

---

## Task schema (fields in each `HOPPER.jsonl` record)

| Field | Meaning |
|---|---|
| `id` | `GH-####` stable id. Never reused. |
| `created` | ISO date the item entered the hopper. |
| **`source`** | **Who raised it** — `owner` (a human voiced it) \| `agent` (an AI generated/observed it) \| `gate` (surfaced by a failing/near-limit gate or audit). The anti-overshadow field. |
| `source_detail` | Attribution: who/when/where (e.g. `owner — 2026-07-03 voice`, `agent: economy lane — spawn-visual session`). |
| `status` | `inbox` → `triaged` → `ready` → `picked` → `done` \| `parked` \| `wontfix`. |
| `title` | One-line imperative ("Add N…", "Fix…", "Audit…"). |
| `raw` | The owner's words, **verbatim** — provenance / traceability. |
| `interpreted` | Rewritten for an executor: the real problem + the desired outcome, unambiguous. |
| `area` | `map` \| `economy` \| `quests` \| `items` \| `combat` \| `render` \| `ui` \| `net` \| `server` \| `world-gen` \| `docs` \| `content`. |
| `lane` | COORDINATION.md ownership lane: `economy` \| `world-gen` \| `character-render` \| `ops` \| `shared`. |
| `files_likely` | Best-guess candidate files (read-only guess; the executor confirms). |
| **`telemetry`** | The initial scoping block — see below. This is the field group the owner asked for. |
| `eligibility` | Routing gate for the overnight runner — see below. |
| `priority` | `P0` (live game broken / blocks others) → `P3` (someday). |
| `effort` | `XS` (<15m) \| `S` (<1h) \| `M` (half-day) \| `L` (multi-session). |
| `guardrails` | Inherited hard "do-not-touch" that applies to this task (see Guardrails). |
| `depends_on` | Ids that must land first (`[]` if none). |
| `notes` | Context, links, open questions, split suggestions. |

### `telemetry` block — "what kind of work, and how do we know it's done"

```json
"telemetry": {
  "work_kind": "fix | tune | content | copy | art | audit | research | design-spike | perf | chore",
  "signals":   ["the observable(s) that prove the issue is real AND fixed"],
  "gates":     ["which of the 8 gates must be green"],
  "acceptance":["concrete done-criteria, checkable without judgment where possible"]
}
```

- **audit** = go measure/enumerate the current state; output is a finding, not a fix.
- **research** = answer an open question / compare options; output is a recommendation.
- **design-spike** = the owner must make a direction call before code can be written.
- everything else = a direct change (fix/tune/content/copy/art/perf/chore).

---

## Eligibility — the routing gate for the overnight runner

Derived from `CLAUDE.md` + `CRITICAL_PATH.md` ("NOT for the smaller models" list).
**Forge overnight may only pick `overnight-safe` tasks.** Everything else waits.

| `eligibility` | Meaning | Surface |
|---|---|---|
| `overnight-safe` | A small model can do it unattended; the gates catch mistakes. | `src/data/*.json` (items/monsters/recipes/drops/shops/quests/level_unlocks), `src/data/map_patches.json` (typed ops only), `src/data/itemIcons.js`, `src/ui/icons.js` swaps, copy/flavor/wiki/dialogue. |
| `review-then-overnight` | Mechanically small + gate-safe, but needs an owner **decision** first (a number, a direction). After the call, it's an `overnight-safe` data edit. | A design-spike that resolves into a data change. |
| `needs-strong-model` | Touches engine/scene/render/systems logic — a wrong edit isn't caught by a gate. | `src/main.js` render/scene/input/camera, `src/systems/*` logic, `src/engine/*` (non-save), `src/render/*`. |
| `needs-owner` | Human-only: irreversible, live-data, architectural, or policy. | `src/world/geo2.js`, `server/**`, `src/engine/save.js`, `server/accounts.json`, hosting/deploy, "should we…" calls. |

---

## Provenance & the anti-overshadow rule

**Everything gets captured — nothing is dropped for being small or auto-generated —
but `source` keeps human intent from being buried under agent noise:**

- Every record is tagged `source: owner | agent | gate`.
- **Owner-raised items are never outranked by agent/gate items of equal priority.** The
  board lists `owner` items in their own section, first, with their own count; agent/gate
  items sit in a separate "Agent/auto-raised" section below.
- Priority is set independently of source, but when the runner or a human picks the next
  task, ties break toward `owner`.
- Agent/gate items default to `status: inbox` (they do **not** become `ready` — i.e.
  overnight-runnable — until a human triages them). This makes promotion into the
  overnight queue a human act, so the auto pile can grow without ever crowding the
  live overnight workload.

## Guardrails every task inherits (from CLAUDE.md — non-negotiable)

- **No build tooling, ever.** Vanilla ES modules, Phaser from CDN, JSON data. The browser gets files as-is.
- **Never touch:** `src/world/geo2.js`, `src/main.js` scene/camera/input surgery, `server/index.mjs` beyond config, `src/engine/save.js`, `server/accounts.json`.
- **Map fixes go into `src/data/map_patches.json` as typed ops** — never into generator code. Ratchet `scripts/map_defects.mjs` budgets DOWN only.
- **All server calls via `api()` in `src/net/config.js`** — never hardcode a URL.
- **No emoji in UI chrome** — use the SVG set (`src/ui/icons.js`: `icon(name)` / `skillIcon(Skill)`); item art via `src/data/itemIcons.js`.
- **Anchor world content to region anchors / probed terrain, never raw coordinates.**
- **"The realm is resting" on a static preview is BY DESIGN** — never edit client code to bypass it; preview via `node server/index.mjs` (launch `goblin-empire-worldserver`, http://localhost:5200).

## The 8 gates (a task's `telemetry.gates` names the subset that must pass)

`smoke` (boot) · `test/run` (61 unit) · `economy_sim` · `quest_test` · `pacing_sim`
(XP curve) · `chain_audit` (every item sourced + consumed) · `audit_world` (map
invariants + soft-locks) · `map_defects` (7 defect classes, ratcheted budgets).
Chain with `&&`; never pipe through `tail`/`grep` (pipes mask exit codes).
`elevation_audit` runs alongside for map/terrain work.

---

## Curator protocol (what the planning agent does per incoming item)

1. **Capture** the words verbatim → `raw`, and stamp `source` (+ `source_detail`): `owner` when a human voiced it, `agent` when I noticed/derived it, `gate` when a validator surfaced it. Nothing is dropped for being small or auto-generated.
2. **Interpret**: restate the real problem + desired outcome, unambiguous → `interpreted`.
3. **Classify**: `area`, `lane`, `priority`, `effort`, and `eligibility` (route it).
4. **Scope telemetry**: `work_kind`, `signals`, `gates`, `acceptance`.
5. **Locate**: `files_likely` + inherited `guardrails` + `depends_on`.
6. **Dedup** against the hopper; merge if it's the same root.
7. **Archive**: assign the next id as **`max(existing ids in HOPPER.jsonl) + 1`** — always re-read the feed immediately before appending; **never assume a running counter** (multiple curators may append concurrently, so a stale counter collides). Append to `HOPPER.jsonl`, then mirror a row into `BOARD.md`. If you ever find a duplicate id, renumber the newer one to `max+1` and fix its cross-references.

The curator does **not** edit application files, run gates, or execute tasks — it
only files them. When a raw item is ambiguous, it's still captured (`status: inbox`)
with the open question in `notes` rather than guessed into the wrong scope.

## Runner protocol (how Forge/Voyra consumes it overnight)

1. Read `HOPPER.jsonl`; select `status: ready` **and** `eligibility: overnight-safe`, highest `priority` first, respecting `depends_on`.
2. Do the one task within its `guardrails`; run its `telemetry.gates` (all green or revert).
3. Commit per unit (specific message). Never pick `needs-owner` / `needs-strong-model` / `review-then-overnight`.
4. Report back what it marked `done` so the curator can reconcile the board.
