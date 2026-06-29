import "server-only";
import { normalizeBaseUrl } from "@/lib/config";

const TOKEN_NAME = "RomM Downloader";
// Scopes the app needs: read/write ROMs + platforms + assets + firmware, run scans.
const TOKEN_SCOPES = [
  "me.read",
  "roms.read",
  "roms.write",
  "platforms.read",
  "platforms.write",
  "assets.read",
  "assets.write",
  "firmware.read",
  "firmware.write",
  "tasks.run",
];

function basic(username: string, password: string): string {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

export interface RommUser {
  username: string;
  role?: string;
  /** RomM avatar asset path (relative to /api/raw/assets); empty when unset. */
  avatarPath?: string;
}

/** Validate username/password against RomM. Returns the user, or null if invalid. */
export async function rommValidateLogin(
  baseUrl: string,
  username: string,
  password: string,
): Promise<RommUser | null> {
  const base = normalizeBaseUrl(baseUrl);
  const auth = basic(username, password);
  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { Authorization: auth },
    cache: "no-store",
  });
  if (!login.ok) return null;
  const me = await fetch(`${base}/api/users/me`, {
    headers: { Authorization: auth },
    cache: "no-store",
  });
  if (!me.ok) return { username };
  const u = (await me.json()) as { username?: string; role?: string; avatar_path?: string };
  return { username: u.username ?? username, role: u.role, avatarPath: u.avatar_path || undefined };
}

/** Whether an existing client token still authenticates against RomM. */
export async function rommTokenValid(baseUrl: string, token: string): Promise<boolean> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return res.ok;
}

/**
 * Whether the token carries the firmware scope (added after some tokens were
 * issued). Probes the firmware list endpoint, which requires `firmware.read`:
 * 200 = has it, 403 = lacks it → the caller re-provisions to upgrade scopes.
 */
export async function rommTokenCanFirmware(baseUrl: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/firmware`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    return res.ok; // 403 (scope missing) or any non-2xx → treat as "needs upgrade"
  } catch {
    return true; // network blip: don't force a needless re-provision
  }
}

/**
 * Provision a single non-expiring client token for the app, cleaning up any
 * previous "RomM Downloader" tokens first so exactly one exists. Returns the raw
 * token value (only available at creation).
 */
export async function rommProvisionToken(
  baseUrl: string,
  username: string,
  password: string,
): Promise<string> {
  const base = normalizeBaseUrl(baseUrl);
  const auth = basic(username, password);

  // Remove stale tokens of ours so they don't accumulate.
  const list = await fetch(`${base}/api/client-tokens`, {
    headers: { Authorization: auth },
    cache: "no-store",
  });
  if (list.ok) {
    const tokens = (await list.json()) as { id: number; name?: string }[];
    await Promise.all(
      (Array.isArray(tokens) ? tokens : [])
        .filter((t) => t.name === TOKEN_NAME)
        .map((t) =>
          fetch(`${base}/api/client-tokens/${t.id}`, {
            method: "DELETE",
            headers: { Authorization: auth },
            cache: "no-store",
          }).catch(() => {}),
        ),
    );
  }

  const res = await fetch(`${base}/api/client-tokens`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ name: TOKEN_NAME, scopes: TOKEN_SCOPES }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`RomM token provisioning failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { raw_token?: string };
  if (!data.raw_token) throw new Error("RomM did not return a token value");
  return data.raw_token;
}
