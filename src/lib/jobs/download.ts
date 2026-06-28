import "server-only";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fetchWithRetry } from "@/lib/http/retry";

/** Pull the server-suggested filename out of a Content-Disposition header. */
function filenameFromDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const m = /filename="?([^";]+)"?/i.exec(cd);
  return m ? m[1].trim() : null;
}

/**
 * Stream a remote URL to a local file, reporting progress. Used to pull the file
 * from a debrid CDN link or a direct HTTP source (Vimm's Lair) down to the app's
 * tmp dir before uploading into RomM. Returns the bytes written and the
 * server-suggested filename (Content-Disposition), since a source like Vimm only
 * reveals the real name/extension (e.g. `.7z`) at download time.
 */
export async function streamUrlToFile(
  url: string,
  destPath: string,
  onProgress?: (downloaded: number, total: number) => void,
  headers?: Record<string, string>,
): Promise<{ bytes: number; filename: string | null }> {
  await mkdir(dirname(destPath), { recursive: true });
  const res = await fetchWithRetry(url, { cache: "no-store", headers }, { label: "download" });
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status}`);
  }
  const total = Number(res.headers.get("content-length") ?? 0);
  const filename = filenameFromDisposition(res.headers.get("content-disposition"));

  const out = createWriteStream(destPath);
  const reader = res.body.getReader();
  let downloaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        downloaded += value.length;
        await new Promise<void>((resolve, reject) =>
          out.write(value, (err) => (err ? reject(err) : resolve())),
        );
        onProgress?.(downloaded, total);
      }
    }
  } finally {
    await new Promise<void>((resolve) => out.end(resolve));
  }
  return { bytes: downloaded, filename };
}
