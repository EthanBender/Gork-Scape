# Deploying Goblin Empire

> ✅ **LIVE STATUS (resolved 2026-07-03): the game is deployed via _Option C —
> Cloudflare Pages_ at <https://gorkscape.ca>, auto-publishing on every push to
> `main`.** The world server runs on the owner's laptop behind a Cloudflare Tunnel
> (`api.gorkscape.ca`) — see [docs/VOYRA_HANDOFF.md](docs/VOYRA_HANDOFF.md). The
> options below were scaffolded so the owner could pick one; **C is the chosen one.**
> The green-gate protection lives in [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
> (runs the gates on every push + PR). The old GitHub Pages workflow (Option B,
> `deploy.yml`) was **removed** — it auto-ran on every push and always failed because
> Pages was never enabled (we went Cloudflare, not Pages), producing a misleading red
> "Deploy ✗" that had nothing to do with the live site. Don't re-add it.

## ⚠️ Deploy gating — red CI does NOT stop a deploy (2026-07-04 outage)

**The risk:** Cloudflare Pages' Git integration publishes every push to `main` on
its own schedule — it never looks at GitHub Actions. A commit that fails CI (or
whose CI hasn't finished) is live at gorkscape.ca ~1 minute after the push.

**How it bit us:** on 2026-07-04 the game was down **all day**. `src/ui/wiki.js`
contained a `\'` escape inside a single-quoted string inside a template
expression — browser V8 rejects it (`SyntaxError: Missing } in template
expression`) but `node --check` accepts the full file (context-dependent parser
divergence: the extracted line alone *fails* `node --check`; the whole file
passes). So `scripts/smoke.mjs` green-lit the commit, Pages published it, and
`main.js`'s static import graph failed to parse — black canvas for every player.
Hotfix: `1d509ad`.

**What's fixed in-repo:** CI now runs
[`scripts/browser_parse_check.mjs`](scripts/browser_parse_check.mjs) — headless
Chromium (playwright) dynamically imports `/src/main.js` and fails the build on
any `SyntaxError` in the module graph (runtime errors like `Phaser is not
defined` are expected and pass — the check page loads no CDN scripts). A real
browser engine, not `node --check`, is now the authority on "will the browser
parse this". Verified against the actual outage commit: the gate fails `1d509ad^`
and pinpoints `wiki.js`. Playwright is CI-only (`npm i --no-save`) — the game
itself stays zero-build. Run it locally the same way CI does:
`npm install --no-save playwright && npx playwright install chromium && node scripts/browser_parse_check.mjs`.

**What's still open (needs the owner's Cloudflare dashboard — I can't reach it):**
Pages will still publish a red push. Two ways to close it, pick one:

1. **Quick (~1 min):** Pages project → *Settings → Builds & deployments → Build
   command* → set to
   `node scripts/smoke.mjs && node scripts/economy_sim.mjs && node scripts/quest_test.mjs && node scripts/pacing_sim.mjs`.
   A failing command aborts the publish, so the four pure-Node gates become
   deploy-blocking. **Limit:** the browser parse gate is NOT in that chain — the
   Pages build image isn't guaranteed to run playwright's Chromium, so the exact
   2026-07-04 class is still only caught in GitHub CI (visible red ✗, but not
   blocking).
2. **Full (recommended when there's an ops window):** stop Pages from watching
   Git, and publish *from* GitHub Actions after CI is green:
   `npx wrangler pages deploy . --project-name gork-scape` in a job with
   `needs: test`, using `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repo
   secrets. Note Cloudflare doesn't allow direct-upload deploys to a
   Git-connected Pages project, so this means disconnecting the Git integration
   (or recreating the project as direct-upload; the custom domain re-attaches).
   Don't add that workflow before the secrets exist — a permanently red deploy
   job is exactly the misleading-✗ problem we removed `deploy.yml` over.

Until one of these lands: **treat a red CI on `main` as a live-site incident** —
the bad commit is already deployed; revert or hotfix immediately.

The game is a **static site** — vanilla ES modules + JSON, Phaser from a CDN, no
build step. That means it deploys to any static host with zero configuration. This
also gives everyone **one shared URL** instead of fighting over local preview servers.

> ⚠️ **What I (the agent) can and can't do:** I've set up all the config so going
> live is a connect-and-go for you. I **cannot** push the final button — publishing
> needs your hosting account and network access I don't have. The last step (auth +
> "deploy") is yours. Pick one option below.

---

## Option A — Netlify drop (fastest, no git needed) ⏱️ ~1 min
1. Go to <https://app.netlify.com/drop>.
2. Drag the **RGS** project folder onto the page.
3. It's live at a `*.netlify.app` URL. Done.

`netlify.toml` is already set (`publish = "."`, no build). To auto-redeploy on every
change, instead use "Add new site → Import from Git" once the repo is on GitHub.

## Option B — GitHub Pages with the smoke gate ⏱️ ~5 min — ⛔ NOT USED (workflow removed)
> This was never adopted (we use Option C / Cloudflare). Its `deploy.yml` workflow
> was deleted because it auto-ran on every push and always failed at
> `actions/configure-pages` — GitHub Pages was never enabled. If you ever *do* want a
> Pages mirror, re-create the workflow **and** complete step 2 below, or it will just
> fail again.

This wires the **"green master → live" rule** into CI: every push runs the boot
smoke-check and only publishes if it passes.
1. Create a GitHub repo and push this project to it:
   ```bash
   git remote add origin https://github.com/<you>/goblin-empire.git
   git push -u origin master
   ```
2. On GitHub: **Settings → Pages → Source = "GitHub Actions"**.
3. Every push to `master` now runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):
   it runs `node scripts/smoke.mjs` and, if green, publishes to
   `https://<you>.github.io/goblin-empire/`.
   A broken push (bad import/export) **fails the gate and never goes live.**

## Option C — Cloudflare Pages + custom domain (recommended if you own a domain) ⏱️ ~5 min
Best pick for a custom domain, and it's the same platform we'd host the future
server on (Workers + Durable Objects).
1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick the repo.
2. Build settings: **Framework preset = None**, **Build command = `node scripts/smoke.mjs`**
   (this makes the smoke-check a deploy gate — a broken push won't publish),
   **Build output directory = `/`** (repo root).
3. Deploy → live at `*.pages.dev`.
4. **Custom domain:** Pages → your project → **Custom domains → Set up a domain**.
   If your domain's DNS is already on Cloudflare it's ~1 click + auto SSL.

`_headers` (Cloudflare-native) is already set to avoid stale-module caching.

> Future server: host the authoritative Grand Exchange / world as a **Cloudflare
> Worker + Durable Object** (a DO is a single-threaded stateful object — ideal for
> an order book). The `Market` class ports in nearly as-is; the client's
> `NetworkMarketTransport` points at the Worker's WebSocket. Same domain, via a route.

## Option D — Vercel ⏱️ ~2 min
"Add New → Project" → import the repo → Framework preset **"Other"**, build command
**empty**, output dir **`.`** → Deploy.

## Option E — Your own static host / VPS
Serve the repo root over HTTP: `python3 -m http.server 8080` (that's literally what
our preview does), or drop the files behind nginx/Caddy. Any static file server works.

---

## Verifying a deploy
- Open the URL; you should see the world load and the tabbed panel.
- If it's blank: open devtools console. The usual culprits are a mid-edit
  import/export break — `node scripts/smoke.mjs` catches that — or a
  browser-only parse error `node --check` can't see —
  `node scripts/browser_parse_check.mjs` catches that (see "Deploy gating" above).

## When the MMO server arrives
The above hosts the **client** (correct for today's single-player build). Once we
stand up the authoritative Node server (world + Grand Exchange + saves — see
[docs/MULTIPLAYER_ARCHITECTURE.md](docs/MULTIPLAYER_ARCHITECTURE.md) and the
transport seam in `src/net/marketTransport.js`), the *server* needs a dynamic host
(Render / Railway / Fly.io / a VPS), and the client points its
`NetworkMarketTransport` at that server's WebSocket URL. The static client host
stays; only the transport target changes.
