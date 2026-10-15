/**
 * GET /api/openapi.json
 *
 * Returns the NFT Data OpenAPI 3.1.0 specification as JSON.
 * No payment required — explicitly unauthenticated public endpoint.
 * Suitable for x402scan registration and agent discovery.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

// arc-studio-allow-onchain-literal
// Creator wallet declared in api/get-collection-data.ts (NFT Data Tool #778, Base).
const PAY_TO = "0x344143199642e87320785823c20c2df107d17534"; // arc-studio-allow-onchain-literal

// ---------------------------------------------------------------------------
// OpenAPI 3.1.0 specification — served from /api/openapi.json.
// Content matches public/openapi.json but is extended with accurate x402
// payment metadata and the /api/openapi.json self-reference.
// ---------------------------------------------------------------------------
const SPEC = {
  openapi: "3.1.0",
  info: {
    title: "NFT Data API",
    version: "1.0.0",
    description:
      "NFT collection analytics API. Returns structured market data for any OpenSea collection slug, including floor price, volume, sales, and ownership statistics. Requires a one-time x402 USDC micropayment per request.",
    "x-guidance":
      "POST /api/get-collection-data with a JSON body containing a 'collection' field set to an OpenSea collection slug (e.g. 'basedpunks'). Requires x402 USDC payment on Base Mainnet (0.002 USDC per request via ExactEvmScheme). Returns structured collection metadata, floor price, volume, sales, and owner data sourced from the OpenSea API v2.",
  },
  servers: [
    {
      url: "https://www.nftdata.app",
      description: "Production",
    },
  ],
  paths: {
    "/api/openapi.json": {
      get: {
        operationId: "get_openapi_spec",
        summary: "OpenAPI specification",
        description: "Returns this OpenAPI specification. No payment required.",
        tags: ["Meta"],
        security: [],
        responses: {
          "200": {
            description: "OpenAPI 3.1.0 specification.",
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
        },
      },
    },
    "/api/get-collection-data": {
      post: {
        operationId: "get_collection_data",
        summary: "Get NFT collection data",
        description:
          "Returns structured NFT collection and market data for a given OpenSea collection slug. " +
          "Requires an x402 v2 payment of 0.002 USDC on Base Mainnet (eip155:8453) via the ExactEvmScheme. " +
          "Send the request without a payment header first to receive the 402 challenge, then include the " +
          "X-PAYMENT header in the retry.",
        tags: ["NFT Data"],
        "x-payment-info": {
          protocols: [{ x402: {} }],
          price: {
            mode: "fixed",
            // The payment token is USDC. The amount below is in USD-equivalent
            // terms (1 USDC ≈ 1 USD); the actual on-chain payment is in USDC.
            currency: "USD",
            amount: "0.002",
          },
          network: "eip155:8453",
          payTo: PAY_TO,
          scheme: "exact",
          maxTimeoutSeconds: 60,
        },
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  collection: {
                    type: "string",
                    description:
                      "OpenSea collection slug (e.g. 'doodles-official'). " +
                      "The slug is the unique identifier visible in the collection's OpenSea URL.",
                    minLength: 1,
                    pattern: "^[a-z0-9][a-z0-9_-]*$",
                  },
                },
                required: ["collection"],
              },
              example: {
                collection: "doodles-official",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Successful response with structured NFT collection data.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Collection display name." },
                    slug: { type: "string", description: "OpenSea collection slug." },
                    contracts: {
                      type: "array",
                      description: "NFT contract addresses and their chains.",
                      items: {
                        type: "object",
                        properties: {
                          address: { type: "string" },
                          chain: { type: "string" },
                        },
                      },
                    },
                    floor_price: {
                      type: "number",
                      description: "Current floor price of the collection.",
                    },
                    floor_price_currency: {
                      type: "string",
                      description: "Currency symbol for the floor price (e.g. ETH, USDC).",
                    },
                    one_day_sales: {
                      type: "number",
                      description: "Number of sales in the last 24 hours.",
                    },
                    one_day_volume: {
                      type: "number",
                      description: "Trading volume in the last 24 hours.",
                    },
                    one_day_volume_currency: {
                      type: ["string", "null"],
                      description: "Currency symbol for 24-hour volume.",
                    },
                    seven_day_sales: {
                      type: ["number", "null"],
                      description: "Number of sales in the last 7 days.",
                    },
                    seven_day_volume: {
                      type: ["number", "null"],
                      description: "Trading volume in the last 7 days.",
                    },
                    seven_day_volume_currency: {
                      type: ["string", "null"],
                      description: "Currency symbol for 7-day volume.",
                    },
                    thirty_day_sales: {
                      type: ["number", "null"],
                      description: "Number of sales in the last 30 days.",
                    },
                    thirty_day_volume: {
                      type: ["number", "null"],
                      description: "Trading volume in the last 30 days.",
                    },
                    thirty_day_volume_currency: {
                      type: ["string", "null"],
                      description: "Currency symbol for 30-day volume.",
                    },
                    total_sales: {
                      type: "number",
                      description: "Total lifetime sales count.",
                    },
                    total_volume: {
                      type: "number",
                      description: "Total lifetime trading volume.",
                    },
                    total_volume_currency: {
                      type: ["string", "null"],
                      description: "Currency symbol for total lifetime volume.",
                    },
                    num_owners: {
                      type: "number",
                      description: "Current number of unique owners.",
                    },
                    total_supply: {
                      type: ["number", "null"],
                      description: "Total number of NFTs in the collection.",
                    },
                    created_date: {
                      type: ["string", "null"],
                      description: "Collection creation date (ISO 8601).",
                    },
                  },
                  required: [
                    "name",
                    "slug",
                    "contracts",
                    "floor_price",
                    "floor_price_currency",
                    "one_day_sales",
                    "one_day_volume",
                    "total_sales",
                    "total_volume",
                    "num_owners",
                  ],
                },
                example: {
                  name: "based punks",
                  slug: "basedpunks",
                  // arc-studio-allow-onchain-literal
                  contracts: [{ address: "0xcb28749c24af4797808364d71d71539bc01e76d4", chain: "base" }], // arc-studio-allow-onchain-literal
                  floor_price: 0.02391776,
                  floor_price_currency: "ETH",
                  one_day_sales: 1,
                  one_day_volume: 0.0185,
                  one_day_volume_currency: "ETH",
                  seven_day_sales: 16,
                  seven_day_volume: 0.34213836,
                  seven_day_volume_currency: "ETH",
                  thirty_day_sales: 217,
                  thirty_day_volume: 1.50135021,
                  thirty_day_volume_currency: "ETH",
                  total_sales: 18027,
                  total_volume: 4728.074488347124,
                  total_volume_currency: "ETH",
                  num_owners: 2408,
                  total_supply: 5000,
                  created_date: "2024-04-05",
                },
              },
            },
          },
          "402": {
            description:
              "Payment Required. No valid x402 payment header was included. " +
              "The response body contains the payment challenge with network, amount, and recipient details.",
          },
          "400": {
            description: "Bad request. Missing or invalid collection slug.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { error: { type: "string" } },
                },
              },
            },
          },
          "404": {
            description: "Collection not found on OpenSea.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { error: { type: "string" } },
                },
              },
            },
          },
          "429": {
            description: "Rate limit exceeded. Retry after the indicated delay.",
            headers: {
              "Retry-After": {
                schema: { type: "string" },
                description: "Seconds to wait before retrying.",
              },
            },
          },
          "500": {
            description: "Server error.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { error: { type: "string" } },
                },
              },
            },
          },
          "502": {
            description: "Upstream OpenSea API error.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { error: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Handler — GET/HEAD only; no payment gate; CORS-friendly for agent discovery
// ---------------------------------------------------------------------------
export default function handler(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  const body = JSON.stringify(SPEC, null, 2);

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "HEAD") {
    res.setHeader("Content-Length", Buffer.byteLength(body).toString());
    res.end();
    return;
  }

  res.end(body);
}

export const config = {
  runtime: "nodejs",
};
