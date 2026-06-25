import "server-only";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Stream a remote URL to a local file, reporting progress. Used to pull the
 * file from the debrid provider's short-lived CDN link down to the app's tmp dir
 * before uploading into RomM.
 */
export async function streamUrlToFile(
  url: string,
  destPath: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<number> {
  await mkdir(dirname(destPath), { recursive: true });
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status}`);
  }
  const total = Number(res.headers.get("content-length") ?? 0);

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
  return downloaded;
}
