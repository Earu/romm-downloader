# RomM Downloader

A self-hosted web app that pulls retro games into your [RomM](https://romm.app)
library. Browse a game catalog (IGDB), pick the exact ROM from the
[Minerva Archive](https://minerva-archive.org) index (the community successor to
Myrient), and the app downloads it via [TorBox](https://torbox.app) and uploads it
into RomM — collapsing "find → download → place → rescan" into one click.

## How it works

```
Browser ─► Next.js (App Router) ─► IGDB     (catalog metadata / discovery)
                  │              ─► Minerva  (ROM file index + per-ROM magnet)
                  │              ─► TorBox   (download the magnet to cloud, fetch)
                  └─ worker      ─► RomM     (chunked upload + scan)
                  └─ SQLite (jobs, settings) via Drizzle
```

Why this combination: Myrient (direct-HTTP ROM sets) shut down in March 2026; its
full backup lives on **Minerva Archive**, which distributes via **torrents**. So we
use Minerva to find the ROM and its magnet, then **TorBox** as a debrid downloader
to turn that magnet into a direct file — no local torrent client needed.

A queued download advances through a state machine driven by a background worker:

`requested → resolving (Minerva magnet) → adding (TorBox) → caching (TorBox cloud) → fetching (to local tmp) → uploading (chunked into RomM) → done`

The Downloads page polls job state live; failed jobs can be retried.

## The Minerva index

Minerva has no public API, so the app caches it locally:

- A ~25 MB search index (every ROM path) — powers in-app search.
- A ~1.76 GB SQLite database (`hashes.db`) mapping each ROM to its magnet.

Both are synced on first run and auto-refreshed about monthly; **Settings → Minerva
ROM index → Update now** forces a refresh. Search needs only the index; resolving a
download needs the database.

## Requirements / configuration

Set these as environment variables (see `.env.example`) or in the in-app
**Settings** page (which overrides env and persists to the DB):

| Variable | Purpose |
| --- | --- |
| `ROMM_URL` | Base URL of your RomM server, e.g. `http://localhost:8080` |
| `ROMM_TOKEN` | RomM **Client API Token** (Administration → Client API Tokens, `rmm_…`) |
| `TORBOX_API_KEY` | TorBox API key — used as the debrid downloader for Minerva magnets |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | Twitch app credentials — required for the catalog ([guide](https://api-docs.igdb.com/#getting-started)) |
| `DATABASE_URL` | libSQL/SQLite URL (default `file:./data/app.db`) |
| `DOWNLOAD_TMP_DIR` | Where files are staged before upload (default `./data/downloads`) |
| `MINERVA_DIR` | Where the Minerva index + `hashes.db` are cached (default `./data/minerva`) |

The **Settings** page shows live connection status for RomM, TorBox, and IGDB.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in tokens
npm run dev                  # http://localhost:3000
```

DB migrations are applied automatically on server start (see
`src/instrumentation.ts`). To regenerate migrations after schema changes:
`npm run db:generate`.

### Local RomM for testing

`romm/docker-compose.yml` stands up a disposable RomM + MariaDB stack to develop
against (web UI on `http://localhost:8080`). See that file's header for bring-up
commands. After it's up: create a user, add a platform, and mint a Client API
Token to use as `ROMM_TOKEN`.

## Deployment (standalone container)

```bash
cp .env.example .env         # fill in connections
docker compose -f docker-compose.example.yml up -d --build
```

The container talks to RomM and TorBox over HTTP only; no volume sharing with
RomM is needed. The `/app/data` volume persists the job database and in-flight
downloads.

## Project layout

```
src/
  app/                 # routes: catalog (/), /game/[id], /downloads, /settings, /api/*
  components/          # GameCard, DownloadPanel, ...
  lib/
    romm/client.ts     # RomM API client (platforms, chunked upload, scan)
    torbox/client.ts   # TorBox API client (createtorrent, mylist, requestdl)
    minerva/           # search index + hashes.db sync + magnet resolution
    catalog/           # CatalogProvider interface + IGDB implementation
    jobs/              # queue, orchestrator (state machine), worker, download streamer
    db/                # Drizzle schema + libsql client + migrator
    config.ts          # effective config (DB settings over env)
  instrumentation.ts   # runs migrations + starts the worker on boot
romm/                  # dev-only local RomM docker stack
```

## Notes

- RomM auth uses a Client API Token as a Bearer header, which bypasses RomM's
  CSRF protection, so all reads/writes work statelessly.
- RomM's own search API is ROM-centric (needs an existing ROM), so the browsable
  catalog uses IGDB directly. RomM still performs its own metadata matching when
  it scans the uploaded file.
- Minerva has no public API; the client in `src/lib/minerva/` reverse-engineers it
  (static gzipped index for search + `hashes.db` SQLite for magnets, read exactly
  like Minerva's own browser client). If Minerva changes its asset layout, update
  the URLs/queries in `src/lib/minerva/`.
- TorBox is used only as a debrid downloader (`createTorrent`/`mylist`/`requestdl`).
  Its search API is not used (it has no retro ROM content).
