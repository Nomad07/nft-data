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
    message: string
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
    const body = await res.text().catch(() => "");
    throw new OpenSeaApiError(res.status, `OpenSea collection fetch failed (${res.status}): ${body}`);
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
    const body = await res.text().catch(() => "");
    throw new OpenSeaApiError(res.status, `OpenSea stats fetch failed (${res.status}): ${body}`);
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
