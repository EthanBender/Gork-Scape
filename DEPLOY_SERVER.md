# Making the server live at gorkscape.ca

The game has two halves:

| Half | Where it runs | How it deploys |
|------|---------------|----------------|
| **Client** (the game UI) | Cloudflare Pages → **gorkscape.ca** | Automatic: every green commit auto-pushes and Pages republishes. Nothing to do. |
| **Server** (`server/index.mjs`: accounts, login, always-on economy) | **Your laptop**, for now | Exposed to the internet with a **Cloudflare Tunnel** at **api.gorkscape.ca**. Steps below. |

The client (on gorkscape.ca) is already wired to call **`https://api.gorkscape.ca`**
for everything server-side (`src/net/config.js`). So once the tunnel is up:

- **Laptop on + server running** → visitors get the real game (Sign In / Create Account, saved characters).
- **Laptop closed / server stopped** → visitors get the **“server resting — back soon”** page automatically. No broken screen, no offline mode.

There is **no paid hosting** in this setup — it uses your existing Cloudflare account and your laptop.

---

## One-time setup (~10 min)

Everything runs on **your laptop**. `gorkscape.ca` must already be on Cloudflare (it is).

### 1. Install cloudflared
```bash
brew install cloudflared
```

### 2. Log in (opens a browser — pick the gorkscape.ca zone)
```bash
cloudflared tunnel login
```

### 3. Create the tunnel
```bash
cloudflared tunnel create goblin-empire
```
This prints a **tunnel UUID** and writes a credentials file to
`~/.cloudflared/<UUID>.json`. Note the path.

### 4. Point api.gorkscape.ca at the tunnel (creates the DNS record for you)
```bash
cloudflared tunnel route dns goblin-empire api.gorkscape.ca
```

### 5. Write the tunnel config
Create `~/.cloudflared/config.yml` (replace `<UUID>` with yours):
```yaml
tunnel: goblin-empire
credentials-file: /Users/ethanbender/.cloudflared/<UUID>.json

ingress:
  - hostname: api.gorkscape.ca
    service: http://localhost:5200
  - service: http_status:404
```

---

## Running it (each time you want the game live)

Two processes, two terminals:

```bash
# Terminal 1 — the game server (from the RGS folder). Defaults to port 5200.
node server/index.mjs

# Terminal 2 — the tunnel that publishes it at api.gorkscape.ca
cloudflared tunnel run goblin-empire
```

Leave both running. Close the laptop / stop them → gorkscape.ca shows the
“server resting” page until you start them again.

### Optional: keep the tunnel running as a background service
```bash
sudo cloudflared service install     # runs the tunnel on login, no terminal needed
```
(You'd still start `node server/index.mjs` yourself, or wrap it in `pm2` / a
launchd job later.)

---

## Where the data lives

Accounts and world state are files **on your laptop**, created next to the server:

- `server/accounts.json` — usernames, hashed passwords, and each player's save
- `server/world-state.json` — the shared economy (guide prices)

Both are git-ignored (they're live data, not source). **Back them up** before you
eventually migrate to a paid host — that's the whole player base.

---

## Quick test

1. Start `node server/index.mjs` + the tunnel.
2. Open **https://api.gorkscape.ca/api/world** in a browser — you should see JSON
   (world clock / prices). That confirms the tunnel reaches your laptop.
3. Open **https://gorkscape.ca** — you should get the Sign In / Create Account
   screen (not the “server resting” page).
4. Stop the server → reload gorkscape.ca → you get the “server resting” page.

---

## Moving to a real host later

When you outgrow the laptop: run `server/index.mjs` on any Node host (Fly.io /
Render / Railway / a VPS) with a persistent disk for the two JSON files, point
`api.gorkscape.ca` at it, and you're done. If you want a different API hostname,
change `PROD_API_BASE` in `src/net/config.js` — that's the only client change.
