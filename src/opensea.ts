/**
 * OpenSea API v2 client helpers.
 *
 * Only the fields needed for get_collection_data are requested and typed here.
 * Unused fields from the OpenSea response are intentionally omitted.
 */

const OPENSEA_BASE = "https://api.opensea.io";

/** Shape returned by GET /api/v2/collections/{slug} */
export interface OpenSeaCollection {
  collection: string;
  name: string;
  contracts: Array<{ address: string; chain: string }>;
  total_supply?: number | null;
  created_date?: string | null;
}

/** Shape of Total returned by GET /api/v2/collections/{slug}/stats */
export interface OpenSeaStatsTotal {
  volume: number;
  sales: number;
  num_owners: number;
  floor_price: number;
  floor_price_symbol: string;
}

/** Shape of IntervalStat returned by GET /api/v2/collections/{slug}/stats */
export interface OpenSeaIntervalStat {
  interval: string;
  volume: number;
  sales: number;
}

/** Full shape of GET /api/v2/collections/{slug}/stats */
export interface OpenSeaCollectionStats {
  total: OpenSeaStatsTotal;
  intervals: OpenSeaIntervalStat[];
}

/** Unified error thrown when the OpenSea API returns a non-2xx status. */
export class OpenSeaApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Value of the upstream Retry-After header, if present. */
    public readonly retryAfter?: string
  ) {
    super(message);
    this.name = "OpenSeaApiError";
  }
}

function buildHeaders(apiKey: string): HeadersInit {
  return {
    "x-api-key": apiKey,
    Accept: "application/json",
  };
}

// ---------------------------------------------------------------------------
// In-memory cache
//
// Vercel Edge functions may run in many isolated worker instances, so this
// cache is best-effort: it avoids redundant upstream calls within a single
// warm worker instance but does not guarantee deduplication across instances.
// TTL is 60 seconds.
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: [OpenSeaCollection, OpenSeaCollectionStats];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function getCached(slug: string): [OpenSeaCollection, OpenSeaCollectionStats] | undefined {
  const entry = cache.get(slug);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(slug);
    return undefined;
  }
  return entry.data;
}

function setCached(slug: string, data: [OpenSeaCollection, OpenSeaCollectionStats]): void {
  cache.set(slug, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Fetch collection metadata and stats for the given slug.
 * Results are cached in memory for 60 seconds per worker instance.
 * Throws OpenSeaApiError on non-2xx HTTP status.
 */
export async function fetchCollectionData(
  slug: string,
  apiKey: string
): Promise<[OpenSeaCollection, OpenSeaCollectionStats]> {
  const cached = getCached(slug);
  if (cached) return cached;

  const [collectionData, statsData] = await Promise.all([
    fetchCollection(slug, apiKey),
    fetchCollectionStats(slug, apiKey),
  ]);

  setCached(slug, [collectionData, statsData]);
  return [collectionData, statsData];
}

/**
 * Fetch basic collection metadata from OpenSea.
 * Throws OpenSeaApiError on non-2xx HTTP status.
 */
export async function fetchCollection(
  slug: string,
  apiKey: string
): Promise<OpenSeaCollection> {
  const url = `${OPENSEA_BASE}/api/v2/collections/${encodeURIComponent(slug)}`;
  const res = await fetch(url, { headers: buildHeaders(apiKey) });

  if (!res.ok) {
    const retryAfter = res.headers.get("Retry-After") ?? undefined;
    const body = await res.text().catch(() => "");
    throw new OpenSeaApiError(
      res.status,
      `OpenSea collection fetch failed (${res.status}): ${body}`,
      retryAfter
    );
  }

  const data = (await res.json()) as unknown;

  if (
    typeof data !== "object" ||
    data === null ||
    !("collection" in data) ||
    !("name" in data)
  ) {
    throw new OpenSeaApiError(502, "Unexpected response shape from OpenSea collection endpoint.");
  }

  return data as OpenSeaCollection;
}

/**
 * Fetch collection statistics (floor price, volume, owners) from OpenSea.
 * Throws OpenSeaApiError on non-2xx HTTP status.
 */
export async function fetchCollectionStats(
  slug: string,
  apiKey: string
): Promise<OpenSeaCollectionStats> {
  const url = `${OPENSEA_BASE}/api/v2/collections/${encodeURIComponent(slug)}/stats`;
  const res = await fetch(url, { headers: buildHeaders(apiKey) });

  if (!res.ok) {
    const retryAfter = res.headers.get("Retry-After") ?? undefined;
    const body = await res.text().catch(() => "");
    throw new OpenSeaApiError(
      res.status,
      `OpenSea stats fetch failed (${res.status}): ${body}`,
      retryAfter
    );
  }

  const data = (await res.json()) as unknown;

  if (
    typeof data !== "object" ||
    data === null ||
    !("total" in data) ||
    !("intervals" in data)
  ) {
    throw new OpenSeaApiError(502, "Unexpected response shape from OpenSea stats endpoint.");
  }

  return data as OpenSeaCollectionStats;
}
