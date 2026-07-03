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
- If it's blank: open devtools console. The usual culprit is a mid-edit
  import/export break — run `node scripts/smoke.mjs` locally first (it catches that).

## When the MMO server arrives
The above hosts the **client** (correct for today's single-player build). Once we
stand up the authoritative Node server (world + Grand Exchange + saves — see
[docs/MULTIPLAYER_ARCHITECTURE.md](docs/MULTIPLAYER_ARCHITECTURE.md) and the
transport seam in `src/net/marketTransport.js`), the *server* needs a dynamic host
(Render / Railway / Fly.io / a VPS), and the client points its
`NetworkMarketTransport` at that server's WebSocket URL. The static client host
stays; only the transport target changes.
