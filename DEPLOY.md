# Deploying Goblin Empire

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

## Option B — GitHub Pages with the smoke gate (recommended for the team) ⏱️ ~5 min
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

## Option C — Vercel ⏱️ ~2 min
"Add New → Project" → import the repo → Framework preset **"Other"**, build command
**empty**, output dir **`.`** → Deploy.

## Option D — Your own static host / VPS
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
