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
# disc images from .zip/.7z archives (Vimm serves disc games as .7z). openssl
# generates the AUTH_SECRET on first run (see entrypoint.sh).
RUN apk add --no-cache aria2 p7zip openssl

# Standalone server + static assets + migrations.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Persist DB + in-flight downloads. Run as a non-root user; it owns the data dir
# so the entrypoint can write the persisted AUTH_SECRET and the app can write the DB.
RUN mkdir -p /app/data/downloads \
    && addgroup -S app && adduser -S app -G app \
    && chown -R app:app /app/data
USER app
VOLUME ["/app/data"]

EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "server.js"]
