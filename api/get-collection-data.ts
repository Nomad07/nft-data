/**
 * POST /api/get-collection-data
 *
 * ERC-8257 paid tool endpoint — x402 v2, ExactEvmScheme, Base mainnet.
 * Payment: 0.01 USDC (10000 atomic units) on Base via PayAI facilitator.
 * Discovery: extensions.bazaar declared for x402 Bazaar cataloging.
 *
 * The NFT/OpenSea data logic lives entirely in src/handler.ts and is unchanged.
 */

import { x402HTTPResourceServer, HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { HTTPAdapter } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { handleToolError } from "../src/handler.js";
import { fetchCollectionData, OpenSeaApiError } from "../src/opensea.js";

// arc-studio-allow-onchain-literal
// payTo: declared creator wallet for this project (NFT Data Tool #778, Base).
const PAY_TO = "0x344143199642e87320785823c20c2df107d17534"; // arc-studio-allow-onchain-literal

// ---------------------------------------------------------------------------
// PayAI facilitator client (same facilitator used by the previous v1 gate)
// ---------------------------------------------------------------------------
const facilitatorClient = new HTTPFacilitatorClient({
  url: "https://facilitator.payai.network",
});

// ---------------------------------------------------------------------------
// x402 resource server — ExactEvmScheme covers all eip155 chains incl. Base
// ---------------------------------------------------------------------------
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  "eip155:*",
  new ExactEvmScheme(),
);

// ---------------------------------------------------------------------------
// Bazaar discovery extension (POST JSON, bodyType required per README)
// Method is inferred from the route key "POST /api/get-collection-data"
// ---------------------------------------------------------------------------
const bazaarExtension = declareDiscoveryExtension({
  bodyType: "json",
  input: {
    collection: "basedpunks",
  },
  inputSchema: {
    type: "object",
    properties: {
      collection: {
        type: "string",
        description: "OpenSea collection slug",
      },
    },
    required: ["collection"],
  },
  output: {
    example: {
      name: "Based Punks",
      slug: "basedpunks",
      contracts: [
        // arc-studio-allow-onchain-literal
        { address: "0xcb28749c24af4797808364d71d71539bc01e76d4", chain: "base" }, // arc-studio-allow-onchain-literal
      ],
      floor_price: 0.0045,
      floor_price_currency: "ETH",
      one_day_sales: 12,
      one_day_volume: 0.054,
      one_day_volume_currency: "ETH",
      seven_day_sales: 84,
      seven_day_volume: 0.38,
      seven_day_volume_currency: "ETH",
      thirty_day_sales: 310,
      thirty_day_volume: 1.39,
      thirty_day_volume_currency: "ETH",
      total_sales: 45200,
      total_volume: 203.4,
      total_volume_currency: "ETH",
      num_owners: 1842,
      total_supply: 10000,
      created_date: "2022-08-15T00:00:00Z",
    },
  },
});

// ---------------------------------------------------------------------------
// Route config — the route key MUST match "METHOD /path" for method inference
// ---------------------------------------------------------------------------
const ROUTE_KEY = "POST /api/get-collection-data";

const httpServer = new x402HTTPResourceServer(resourceServer, {
  [ROUTE_KEY]: {
    accepts: {
      scheme: "exact",
      price: "$0.01",
      network: "eip155:8453",
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
    },
    resource: "https://www.nftdata.app/api/get-collection-data",
    description: "NFT Data — get_collection_data (0.01 USDC). Returns structured NFT collection and market data for any OpenSea collection slug.",
    mimeType: "application/json",
    serviceName: "NFT Data",
    tags: ["nft", "opensea", "market-data", "collection"],
    iconUrl: "https://www.nftdata.app/nft-data-logo.jpg",
    extensions: {
      ...bazaarExtension,
    },
  },
});

// ---------------------------------------------------------------------------
// Lazy initialization — deferred until the first real request.
// Module-level network calls timeout in Vercel's cold-start sandbox before the
// network stack is ready. The promise is created once and reused on all
// subsequent invocations so /supported is fetched exactly once per instance.
// ---------------------------------------------------------------------------
let initPromise: Promise<void> | null = null;

function getInitPromise(): Promise<void> {
  if (!initPromise) {
    initPromise = httpServer.initialize();
  }
  return initPromise;
}

// ---------------------------------------------------------------------------
// Minimal WHATWG Request → HTTPAdapter bridge
// ---------------------------------------------------------------------------
const CANONICAL_ORIGIN = "https://www.nftdata.app";

function makeFetchAdapter(req: Request): HTTPAdapter {
  // Vercel Node.js runtime may pass a relative URL (e.g. "/api/get-collection-data").
  // URL constructor requires an absolute URL, so resolve against the canonical origin.
  const url = new URL(req.url, CANONICAL_ORIGIN);
  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { queryParams[k] = v; });

  return {
    getHeader:       (name: string) => req.headers.get(name) ?? undefined,
    getMethod:       () => req.method,
    getPath:         () => url.pathname,
    getUrl:          () => req.url,
    getAcceptHeader: () => req.headers.get("Accept") ?? "",
    getUserAgent:    () => req.headers.get("User-Agent") ?? "",
    getQueryParams:  () => queryParams,
    getQueryParam:   (name: string) => queryParams[name],
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export default async function handler(req: Request): Promise<Response> {
  // Lazy init: fires on first request, cached promise reused on all subsequent calls.
  await getInitPromise();

  const adapter = makeFetchAdapter(req);
  const context = { adapter, path: adapter.getPath(), method: adapter.getMethod() };

  let processResult;
  try {
    processResult = await httpServer.processHTTPRequest(context);
  } catch (err) {
    return handleToolError(err);
  }

  // ── No route matched or payment not required ──────────────────────────────
  if (processResult.type === "no-payment-required") {
    return await invokeDataLogic(req);
  }

  // ── Payment validation failed → return 402 challenge ─────────────────────
  if (processResult.type === "payment-error") {
    const { status, headers, body } = processResult.response;
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  // ── Payment verified → run business logic then settle ────────────────────
  const { paymentPayload, paymentRequirements, declaredExtensions } = processResult;

  let dataResponse: Response;
  try {
    dataResponse = await invokeDataLogic(req);
  } catch (err) {
    return handleToolError(err);
  }

  // Only settle when business logic succeeded (status < 400)
  if (!dataResponse.ok) {
    return dataResponse;
  }

  const settleResult = await httpServer.processSettlement(
    paymentPayload,
    paymentRequirements,
    declaredExtensions,
  );

  if (!settleResult.success) {
    return new Response(
      JSON.stringify({ error: "settlement_failed", reason: settleResult.errorReason }),
      { status: 402, headers: { "Content-Type": "application/json" } },
    );
  }

  // Attach settlement headers (PAYMENT-RESPONSE) to the data response
  const finalHeaders = new Headers(dataResponse.headers);
  if (settleResult.headers) {
    for (const [k, v] of Object.entries(settleResult.headers)) {
      finalHeaders.set(k, v);
    }
  }

  return new Response(dataResponse.body, {
    status: dataResponse.status,
    headers: finalHeaders,
  });
}

// ---------------------------------------------------------------------------
// Business logic — same 20-field output as collectionDataHandler in src/handler.ts
// Called directly here so we control the full Response lifecycle.
// ---------------------------------------------------------------------------
async function invokeDataLogic(req: Request): Promise<Response> {
  try {
    const apiKey = process.env.OPENSEA_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Server configuration error." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    let body: unknown;
    try {
      body = await req.clone().json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>)["collection"] !== "string"
    ) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid 'collection' field." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const slug = ((body as Record<string, unknown>)["collection"] as string).trim();
    if (!slug || !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
      return new Response(
        JSON.stringify({ error: "Invalid collection slug format." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const [collectionData, statsData] = await fetchCollectionData(slug, apiKey);

    const oneDayStat    = statsData.intervals.find((i) => i.interval === "one_day");
    const sevenDayStat  = statsData.intervals.find((i) => i.interval === "seven_day");
    const thirtyDayStat = statsData.intervals.find((i) => i.interval === "thirty_day");

    const result = {
      name:                       collectionData.name,
      slug:                       collectionData.collection,
      contracts:                  collectionData.contracts,
      floor_price:                statsData.total.floor_price,
      floor_price_currency:       statsData.total.floor_price_symbol,
      one_day_sales:              oneDayStat?.sales ?? 0,
      one_day_volume:             oneDayStat?.volume ?? 0,
      seven_day_sales:            sevenDayStat  ? sevenDayStat.sales   : null,
      seven_day_volume:           sevenDayStat  ? sevenDayStat.volume  : null,
      thirty_day_sales:           thirtyDayStat ? thirtyDayStat.sales  : null,
      thirty_day_volume:          thirtyDayStat ? thirtyDayStat.volume : null,
      total_sales:                statsData.total.sales,
      total_volume:               statsData.total.volume,
      num_owners:                 statsData.total.num_owners,
      total_supply:               collectionData.total_supply  ?? null,
      created_date:               collectionData.created_date  ?? null,
      one_day_volume_currency:    oneDayStat?.volume_symbol    ?? null,
      seven_day_volume_currency:  sevenDayStat?.volume_symbol  ?? null,
      thirty_day_volume_currency: thirtyDayStat?.volume_symbol ?? null,
      total_volume_currency:      statsData.total.volume_symbol ?? null,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    if (err instanceof OpenSeaApiError) {
      const status =
        err.status === 404 ? 404
        : err.status === 429 ? 429
        : err.status === 401 || err.status === 403 ? 502
        : err.status >= 500 ? 502
        : 400;

      const message =
        err.status === 404 ? "Collection not found."
        : err.status === 429 ? "Rate limit exceeded."
        : err.status >= 500 ? "The upstream OpenSea API returned an error. Please try again later."
        : "Invalid request to the OpenSea API.";

      const responseHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (err.status === 429 && err.retryAfter) {
        responseHeaders["Retry-After"] = err.retryAfter;
      }
      return new Response(JSON.stringify({ error: message }), { status, headers: responseHeaders });
    }

    return new Response(JSON.stringify({ error: "An unexpected error occurred." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const config = {
  runtime: "nodejs",
};
