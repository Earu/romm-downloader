#!/bin/sh
# Ensure a stable AUTH_SECRET exists before starting the server.
#
# Precedence:
#   1. AUTH_SECRET already set in the environment  -> use it (explicit override).
#   2. /app/data/.auth_secret exists               -> reuse the persisted secret.
#   3. otherwise                                   -> generate one, persist it (0600).
#
# Persisting to the /app/data volume keeps the secret stable across restarts, so
# existing sessions stay valid. session.ts is also imported by the edge middleware
# runtime, which is why this must be a real env var (inherited by both runtimes)
# rather than something generated inside the Node process.
set -e

SECRET_FILE="${AUTH_SECRET_FILE:-/app/data/.auth_secret}"

if [ -z "${AUTH_SECRET:-}" ]; then
  if [ -f "$SECRET_FILE" ]; then
    AUTH_SECRET="$(cat "$SECRET_FILE")"
  else
    mkdir -p "$(dirname "$SECRET_FILE")"
    AUTH_SECRET="$(openssl rand -hex 32)"
    # Write atomically-ish, then lock down permissions.
    printf '%s' "$AUTH_SECRET" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
    echo "[entrypoint] Generated a new AUTH_SECRET at $SECRET_FILE"
  fi
  export AUTH_SECRET
fi

exec "$@"
