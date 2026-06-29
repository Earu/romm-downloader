import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption-at-rest for secret settings columns (RomM token, debrid API key,
 * IGDB client secret). AES-256-GCM with a key derived from AUTH_SECRET.
 *
 * Scope of protection: this guards the DB row against casual inspection and DB-only
 * leaks. It is NOT a substitute for securing the data volume — the key is derived
 * from AUTH_SECRET, which (in Docker) is persisted alongside the DB, so a full
 * volume/backup capture is not mitigated by this. Lock down the volume too.
 *
 * Backward compatible: values without the {@link PREFIX} are returned as-is, so
 * pre-existing plaintext rows keep working and get re-encrypted on next write.
 */
const PREFIX = "enc:v1:";

function key(): Buffer {
  // session.ts guarantees AUTH_SECRET is set in production; mirror its dev fallback.
  const s =
    process.env.AUTH_SECRET ||
    (process.env.NODE_ENV !== "production"
      ? "romm-downloader-insecure-dev-secret-change-me"
      : "");
  if (!s) throw new Error("AUTH_SECRET is required to encrypt/decrypt secrets");
  return createHash("sha256").update(s).digest(); // 32 bytes
}

/** Encrypt a secret for storage. Empty/undefined passes through unchanged. */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (!plain) return plain ?? null;
  if (plain.startsWith(PREFIX)) return plain; // already encrypted
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a stored secret. Plaintext (legacy) values pass through unchanged. */
export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (e) {
    // Wrong key (e.g. AUTH_SECRET rotated) or corruption — fail closed to "unset".
    console.error("[secrets] failed to decrypt a stored secret:", e);
    return "";
  }
}
