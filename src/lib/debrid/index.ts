import "server-only";
import type { AppConfig } from "@/lib/config";
import { AllDebridProvider } from "./alldebrid";
import { PremiumizeProvider } from "./premiumize";
import { RealDebridProvider } from "./realdebrid";
import { TorboxProvider } from "./torbox";
import { type DebridProvider, type DebridProviderId, isDebridProviderId } from "./types";

export * from "./types";

/**
 * Build the configured debrid provider, or null if none is set up (in which
 * case the app downloads via the built-in torrent client instead).
 */
export function getDebridProvider(cfg: AppConfig): DebridProvider | null {
  const id = cfg.debridProvider;
  if (!id || id === "none" || !cfg.debridApiKey || !isDebridProviderId(id)) return null;
  return makeProvider(id, cfg.debridApiKey);
}

export function makeProvider(id: DebridProviderId, apiKey: string): DebridProvider {
  switch (id) {
    case "torbox":
      return new TorboxProvider(apiKey);
    case "realdebrid":
      return new RealDebridProvider(apiKey);
    case "alldebrid":
      return new AllDebridProvider(apiKey);
    case "premiumize":
      return new PremiumizeProvider(apiKey);
  }
}
