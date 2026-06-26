# --- deps: install production + build dependencies ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# --- builder: compile the standalone Next.js bundle ---
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Data dir must exist so libsql can open the DB during build page-data collection.
RUN mkdir -p data && npm run build

# --- runner: minimal runtime image ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/app/data/app.db \
    DOWNLOAD_TMP_DIR=/app/data/downloads

# aria2 powers the built-in torrent fallback (selective single-file download
# from Minerva's bundle torrents, which TorBox can't serve). p7zip (7za) extracts
# disc images from .zip/.7z archives (Vimm serves disc games as .7z).
RUN apk add --no-cache aria2 p7zip

# Standalone server + static assets + migrations.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle

# Persist DB + in-flight downloads.
RUN mkdir -p /app/data/downloads
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "server.js"]
