import "server-only";
import { getConfig } from "@/lib/config";
import { IgdbProvider } from "./igdb";
import type { CatalogProvider } from "./types";

export type { CatalogGame, CatalogProvider } from "./types";

/**
 * Resolve the active catalog provider. Currently IGDB; the CatalogProvider
 * interface leaves room for additional metadata sources later.
 */
export async function getCatalogProvider(): Promise<CatalogProvider> {
  const cfg = await getConfig();
  return new IgdbProvider(cfg.igdbClientId, cfg.igdbClientSecret);
}
