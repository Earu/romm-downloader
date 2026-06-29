# RomM Downloader

A self-hosted web app that pulls retro games into your [RomM](https://romm.app)
library. Sign in with your RomM account, browse a game catalog (IGDB), pick the
exact ROM from the [Minerva Archive](https://minerva-archive.org) index, and the
app fetches it — via your debrid service or a built-in torrent client — and
uploads it into RomM. It collapses "find → download → place → rescan" into one
click, behind a SteamOS Big Picture–style UI.

## How it works

```
Browser ─► Next.js (App Router, login-gated by middleware)
                  ├─► IGDB     catalog metadata / discovery
                  ├─► Minerva  ROM file index + per-ROM magnet / .torrent
                  ├─► Debrid   TorBox / Real-Debrid / AllDebrid / Premiumize — magnet ➜ direct file
                  ├─► aria2    built-in torrent client — selective single-file fallback
                  └─ worker ─► RomM   chunked upload + metadata scan
                  └─ SQLite (jobs, settings) via Drizzle
```

The app finds the ROM and its magnet on **Minerva Archive** (a torrent-distributed
ROM archive), uses a **debrid service** to turn the magnet into a direct download,
and uploads the file into RomM. When no debrid service is configured — or it can't
serve the specific file — a **built-in aria2 torrent client** fetches just that
one file.

A queued download advances through a background-worker state machine:

`requested → resolving (Minerva) → adding (debrid) → caching (debrid cloud) → fetching (to local tmp) → uploading (chunked into RomM) → done`

with two branches:

- **No debrid provider configured** → `resolving → local_fetching → uploading` (straight to the built-in torrent client).
- **Debrid can't serve the file, or it's over the size limit** → `unavailable`: the Downloads page shows a prompt to use the built-in torrent client, copy the magnet, or discard.

The Downloads page polls live (network/peak speed, ETA, a speed graph, and
separate download/install bars); failed jobs can be retried.

## Authentication

The entire app is gated behind your RomM login (Next.js `middleware.ts`). On the
login screen you enter your **RomM URL**, **username**, and **password**. The app
validates them against RomM (`POST /api/login`) and **auto-provisions a
non-expiring client token**. A signed JWT session cookie (7 days,
`HttpOnly`/`SameSite=Strict`) keeps you logged in; the nav shows your username and
a **Log out** button.

Access to stored credentials and settings (**Settings → Connections**, and the
`/api/settings` endpoint) is **admin-only** — non-admin RomM users can use the app
but can't read secrets or change global configuration. Secrets (RomM token, debrid
key, IGDB secret) are **encrypted at rest** in the SQLite DB.

**`AUTH_SECRET`** signs the session cookies. In the Docker image it's
**auto-generated and persisted** to `/app/data/.auth_secret` on first run, so no
setup is needed and sessions survive restarts. Set it explicitly via env to
override (e.g. to share one secret across replicas). For local `npm run dev`
(outside Docker) a static dev fallback is used if it's unset.

> ⚠️ **Once configured, the RomM URL is pinned to server config.** To prevent SSRF
> on the public login endpoint, the URL typed on the login form is only honored on
> a fresh install; after the first successful login (or if `ROMM_URL` is set) the
> app always uses the configured RomM URL and ignores the form value.

### Exposing this publicly

This app can be put on the internet, but only behind a **TLS-terminating reverse
proxy** (the `Secure` cookie flag is set only when the request is HTTPS). The
proxy must forward `X-Forwarded-Proto` and `X-Forwarded-For` (the login endpoint
rate-limits per client IP). Set `ROMM_URL` so the RomM target is pinned, and keep
the `/app/data` volume (which holds `AUTH_SECRET` and the encrypted DB) private.

## Debrid providers

Choose your service in **Settings → Connections** (or via env): **TorBox**,
**Real-Debrid**, **AllDebrid**, **Premiumize**, or **none**. They sit behind a
small `DebridProvider` interface (add magnet → poll status → direct link), so
switching is just a dropdown + key.

**Bundle torrents:** many retro sets are a single torrent containing an entire
platform's library. When the provider can't hand back the one file you want, or
it's larger than your limit (**Settings → Max size**, default **30 GB**), the app
falls back to the built-in torrent client, which downloads just that file using
the `.torrent`'s tracker list.

The built-in torrent client uses **aria2** (run as a child process). It must be
installed (`apk add aria2` in the container image — already in the Dockerfile;
`winget install aria2.aria2` on Windows for local dev).

## The Minerva index

Minerva has no public API, so the app caches it locally:

- A ~25 MB search index (every ROM path) — powers in-app search, filtered to games
  on platforms the app can actually acquire for.
- A ~1.76 GB SQLite database (`hashes.db`) mapping each ROM to its magnet/`.torrent`.

Both sync on first run and auto-refresh about monthly; **Settings → Minerva ROM
index → Update now** forces a refresh. Search needs only the index; resolving a
download needs the database.

## Library

- **All** — the IGDB catalog (filtered to platforms you can acquire). Games already
  in RomM get a check-mark badge.
- **Installed** — everything in your RomM library. Each game opens a detail page
  with its metadata and an **Uninstall** button (removes it from RomM + disk).

## Requirements / configuration

Set these as environment variables (see `.env.example`) or in the in-app
**Settings** page (which overrides env and persists to the DB):

| Variable | Purpose |
| --- | --- |
| `ROMM_URL` | Default RomM URL shown on the login screen (you sign in there) |
| `AUTH_SECRET` | Secret used to sign login session cookies (`openssl rand -hex 32`). **Required in production.** |
| `DEBRID_PROVIDER` | `none` \| `torbox` \| `realdebrid` \| `alldebrid` \| `premiumize` (also selectable in Settings) |
| `DEBRID_API_KEY` | API key for the selected debrid provider |
| `MAX_DEBRID_GB` | Files larger than this skip the debrid provider and offer the torrent fallback (default `30`) |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | Twitch app credentials — required for the catalog ([guide](https://api-docs.igdb.com/#getting-started)) |
| `DATABASE_URL` | libSQL/SQLite URL (default `file:./data/app.db`) |
| `DOWNLOAD_TMP_DIR` | Where files are staged before upload (default `./data/downloads`) |
| `MINERVA_DIR` | Where the Minerva index + `hashes.db` are cached (default `./data/minerva`) |
| `ROMM_LIBRARY_PATH` | RomM's ROMs directory, shared with this app on disk (e.g. `<romm-library>/roms`). When set, files are written straight to disk and multi-file releases are grouped into one library entry. See [Hosting](#hosting). |

No `ROMM_TOKEN` is needed — logging in provisions one automatically. The
**aria2** binary is required for the built-in torrent client.

The **Settings** page shows live connection status for RomM, the debrid provider,
and IGDB, and lets you change the provider/key, size limit, IGDB credentials, temp
dir, and manage the Minerva index.

## Local development

```bash
npm install
cp .env.example .env.local       # set AUTH_SECRET, IGDB creds; debrid is optional
winget install aria2.aria2       # (Windows) for the built-in torrent fallback
npm run dev                      # http://localhost:3000 — you'll be sent to /login
```

DB migrations are applied automatically on server start (see
`src/instrumentation.ts`).

### Local RomM for testing

`romm/docker-compose.yml` stands up a disposable RomM + MariaDB stack to develop
against (web UI on `http://localhost:8080`). See that file's header for bring-up
commands. After it's up, create a user — then log into RomM Downloader with that
RomM URL + username + password.

## Hosting

```bash
docker pull ghcr.io/earu/romm-downloader:latest

docker run -d --name romm-downloader \
  -p 3000:3000 \
  -e ROMM_URL=http://your-romm:8080 \
  -e AUTH_SECRET="$(openssl rand -hex 32)" \
  -e IGDB_CLIENT_ID=... -e IGDB_CLIENT_SECRET=... \
  -e DEBRID_PROVIDER=torbox -e DEBRID_API_KEY=... \
  -v romm_downloader_data:/app/data \
  ghcr.io/earu/romm-downloader:latest
```

Or with Compose:

```yaml
services:
  romm-downloader:
    image: ghcr.io/earu/romm-downloader:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - ROMM_URL=http://your-romm:8080
      - AUTH_SECRET=change-me           # openssl rand -hex 32
      - IGDB_CLIENT_ID=...
      - IGDB_CLIENT_SECRET=...
      - DEBRID_PROVIDER=torbox
      - DEBRID_API_KEY=...
    volumes:
      - romm_downloader_data:/app/data
volumes:
  romm_downloader_data:
```

### Build from source

```bash
cp .env.example .env             # set AUTH_SECRET (+ IGDB / debrid as desired)
docker compose -f docker-compose.example.yml up -d --build
```

## Project layout

```
src/
  middleware.ts        # gates the whole app behind a login session
  app/
    login/             # login screen (RomM URL + username + password)
    page.tsx           # library: All / Installed tabs
    game/[id]/         # catalog game detail + download panel
    rom/[id]/          # installed ROM detail + uninstall
    downloads/         # live download manager
    settings/          # connections, debrid provider, size limit, Minerva index
    api/               # auth, catalog, platforms, roms, downloads, minerva, settings, health
  components/          # GameCard, DownloadPanel, LoginForm, TopNav, icons, ...
  lib/
    auth/session.ts    # signed JWT session (jose)
    romm/              # client.ts (platforms, roms, chunked upload, scan) + auth.ts (login + token)
    debrid/            # DebridProvider interface + torbox/realdebrid/alldebrid/premiumize + factory
    minerva/           # search index + hashes.db sync, magnet resolution, platform inference
    catalog/           # CatalogProvider interface + IGDB implementation
    jobs/              # queue, orchestrator (state machine), worker, download streamer, torrent (aria2)
    db/                # Drizzle schema + libsql client + migrator
    config.ts          # effective config (DB settings over env)
  instrumentation.ts   # runs migrations + starts the worker on boot
romm/                  # dev-only local RomM docker stack
```

## Notes

- **Auth:** login validates credentials against RomM and provisions a single
  reused "RomM Downloader" client token (Bearer header, bypasses RomM's CSRF). The
  app session is a signed JWT cookie verified in edge middleware.
- **Debrid:** all providers sit behind `lib/debrid` (`DebridProvider`: add magnet
  → poll → direct link).
- **Built-in torrent:** aria2 with `--select-file` downloads only the requested
  file from a bundle torrent, using the `.torrent`'s tracker list.
- **Catalog:** the browsable catalog uses IGDB; RomM does its own metadata matching
  when it scans the uploaded file. The post-upload scan is triggered over socket.io
  with the enabled metadata sources.
- **Minerva** reads its static assets directly (gzipped index for search +
  `hashes.db` SQLite for magnets) via `src/lib/minerva/`. If Minerva changes its
  asset layout, update the URLs/queries there.
