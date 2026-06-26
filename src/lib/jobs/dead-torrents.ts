import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { type DeadTorrent, deadTorrents } from "@/lib/db/schema";

/**
 * Stable identity for a torrent's swarm. Prefer the BitTorrent info hash (same
 * across magnet/Minerva re-resolutions); fall back to the raw torrent URL, then
 * the Minerva path. Null if none is known.
 */
export function torrentIdentity(src: {
  magnetOrHash?: string | null;
  minervaPath?: string | null;
}): string | null {
  const m = src.magnetOrHash;
  if (m) {
    const btih = /xt=urn:btih:([a-z0-9]+)/i.exec(m);
    if (btih) return `btih:${btih[1].toLowerCase()}`;
    return `src:${m}`;
  }
  if (src.minervaPath) return `minerva:${src.minervaPath}`;
  return null;
}

/** Look up a previously-recorded dead torrent by its swarm identity. */
export async function getDeadTorrent(id: string): Promise<DeadTorrent | undefined> {
  return db.select().from(deadTorrents).where(eq(deadTorrents.id, id)).get();
}

/** Forget a recorded dead torrent (e.g. the user pasted its magnet to retry). */
export async function clearDeadTorrent(id: string): Promise<void> {
  await db.delete(deadTorrents).where(eq(deadTorrents.id, id));
}

/**
 * Record (or refresh) a torrent whose swarm was found dead, so the next attempt
 * on the same swarm can warn immediately. Upserts on the identity key.
 */
export async function recordDeadTorrent(
  id: string,
  title: string | null,
  reason: string,
): Promise<void> {
  await db
    .insert(deadTorrents)
    .values({ id, title, reason })
    .onConflictDoUpdate({
      target: deadTorrents.id,
      set: { title, reason, detectedAt: new Date() },
    });
}
