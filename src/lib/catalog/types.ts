/** A game in the browsable catalog (provider-agnostic, currently IGDB-backed). */
export interface CatalogGame {
  /** Provider id, stringified (e.g. IGDB game id). */
  id: string;
  name: string;
  summary?: string;
  coverUrl?: string;
  releaseYear?: number;
  /** Platforms this game released on (IGDB platform name + slug). */
  platforms: { id: number; name: string; slug?: string }[];
}

export interface CatalogProvider {
  /** Whether the provider has the credentials it needs to operate. */
  isEnabled(): boolean;
  /** Free-text search, or trending/popular when term is empty. */
  search(term: string): Promise<CatalogGame[]>;
  getById(id: string): Promise<CatalogGame | null>;
}
