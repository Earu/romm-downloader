import "server-only";
import type { CatalogGame, CatalogProvider } from "./types";

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_URL = "https://api.igdb.com/v4";

interface IgdbCover {
  image_id?: string;
}
interface IgdbPlatform {
  id: number;
  name: string;
  slug?: string;
}
interface IgdbGame {
  id: number;
  name: string;
  summary?: string;
  first_release_date?: number; // unix seconds
  cover?: IgdbCover;
  platforms?: IgdbPlatform[];
}

function coverUrl(cover?: IgdbCover): string | undefined {
  return cover?.image_id
    ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${cover.image_id}.jpg`
    : undefined;
}

function toCatalogGame(g: IgdbGame): CatalogGame {
  return {
    id: String(g.id),
    name: g.name,
    summary: g.summary,
    coverUrl: coverUrl(g.cover),
    releaseYear: g.first_release_date
      ? new Date(g.first_release_date * 1000).getUTCFullYear()
      : undefined,
    platforms: (g.platforms ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
    })),
  };
}

/**
 * IGDB catalog provider. Authenticates via Twitch client-credentials (IGDB is
 * a Twitch product), caching the app access token until expiry. Queries use
 * IGDB's apicalypse query language posted as the request body.
 */
export class IgdbProvider implements CatalogProvider {
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  isEnabled(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }
    const qs = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
    });
    const res = await fetch(`${TOKEN_URL}?${qs.toString()}`, { method: "POST" });
    if (!res.ok) {
      throw new Error(`IGDB token request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return this.token.value;
  }

  private async query<T>(endpoint: string, body: string): Promise<T> {
    const token = await this.accessToken();
    const res = await fetch(`${IGDB_URL}/${endpoint}`, {
      method: "POST",
      headers: {
        "Client-ID": this.clientId,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      body,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`IGDB ${endpoint} failed: ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  private static readonly FIELDS =
    "fields name,summary,first_release_date,cover.image_id,platforms.name,platforms.slug;";

  async search(term: string): Promise<CatalogGame[]> {
    const trimmed = term.trim();
    const body = trimmed
      ? `search "${trimmed.replace(/"/g, '\\"')}"; ${IgdbProvider.FIELDS} where cover != null; limit 36;`
      : // Popular/trending fallback when there is no search term.
        `${IgdbProvider.FIELDS} where cover != null & total_rating_count != null & total_rating != null; sort total_rating_count desc; limit 36;`;
    const games = await this.query<IgdbGame[]>("games", body);
    return games.map(toCatalogGame);
  }

  async getById(id: string): Promise<CatalogGame | null> {
    const numeric = Number(id);
    if (!Number.isFinite(numeric)) return null;
    const games = await this.query<IgdbGame[]>(
      "games",
      `${IgdbProvider.FIELDS} where id = ${numeric}; limit 1;`,
    );
    return games[0] ? toCatalogGame(games[0]) : null;
  }
}
