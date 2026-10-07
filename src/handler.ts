import { createToolHandler, ToolHandlerError } from "@opensea/tool-sdk";
import { z } from "zod/v4";
import { manifest } from "./manifest.js";
import { fetchCollectionData, OpenSeaApiError } from "./opensea.js";

const InputSchema = z.object({
  collection: z
    .string()
    .min(1, "collection slug must not be empty")
    .regex(
      /^[a-z0-9][a-z0-9_-]*$/,
      "collection slug must be lowercase alphanumeric with optional hyphens or underscores"
    ),
});

const OutputSchema = z.object({
  name: z.string(),
  slug: z.string(),
  contracts: z.array(
    z.object({
      address: z.string(),
      chain: z.string(),
    })
  ),
  floor_price: z.number(),
  floor_price_currency: z.string(),
  one_day_sales: z.number(),
  one_day_volume: z.number(),
  seven_day_sales: z.number().nullable(),
  seven_day_volume: z.number().nullable(),
  thirty_day_sales: z.number().nullable(),
  thirty_day_volume: z.number().nullable(),
  total_sales: z.number(),
  total_volume: z.number(),
  num_owners: z.number(),
  total_supply: z.number().nullable(),
  created_date: z.string().nullable(),
  one_day_volume_currency: z.string().nullable(),
  seven_day_volume_currency: z.string().nullable(),
  thirty_day_volume_currency: z.string().nullable(),
  total_volume_currency: z.string().nullable(),
});

export type CollectionDataOutput = z.infer<typeof OutputSchema>;

export const toolHandler = createToolHandler({
  manifest,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  gates: [],
  handler: async (input) => {
    const apiKey = process.env.OPENSEA_API_KEY;
    if (!apiKey) {
      throw new Error("OPENSEA_API_KEY environment variable is not configured.");
    }

    const { collection: slug } = input;

    try {
      const [collectionData, statsData] = await fetchCollectionData(slug, apiKey);

      const oneDayStat    = statsData.intervals.find((i) => i.interval === "one_day");
      const sevenDayStat  = statsData.intervals.find((i) => i.interval === "seven_day");
      const thirtyDayStat = statsData.intervals.find((i) => i.interval === "thirty_day");

      return {
        name: collectionData.name,
        slug: collectionData.collection,
        contracts: collectionData.contracts,
        floor_price: statsData.total.floor_price,
        floor_price_currency: statsData.total.floor_price_symbol,
        one_day_sales: oneDayStat?.sales ?? 0,
        one_day_volume: oneDayStat?.volume ?? 0,
        seven_day_sales:  sevenDayStat  ? sevenDayStat.sales   : null,
        seven_day_volume: sevenDayStat  ? sevenDayStat.volume  : null,
        thirty_day_sales:  thirtyDayStat ? thirtyDayStat.sales  : null,
        thirty_day_volume: thirtyDayStat ? thirtyDayStat.volume : null,
        total_sales: statsData.total.sales,
        total_volume: statsData.total.volume,
        num_owners: statsData.total.num_owners,
        total_supply:  collectionData.total_supply  ?? null,
        created_date:  collectionData.created_date  ?? null,
        one_day_volume_currency:    oneDayStat?.volume_symbol    ?? null,
        seven_day_volume_currency:  sevenDayStat?.volume_symbol  ?? null,
        thirty_day_volume_currency: thirtyDayStat?.volume_symbol ?? null,
        total_volume_currency:      statsData.total.volume_symbol ?? null,
      };
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
        // ToolHandlerError does not support custom headers, so 429 with
        // Retry-After is handled by the outer handleToolError fallback.
        // Re-throw the original OpenSeaApiError so Retry-After is preserved.
        if (err.status === 429) throw err;
        throw new ToolHandlerError(status, message);
      }
      throw err;
    }
  },
});

/**
 * Handle errors thrown by the tool handler and return structured JSON responses.
 * Maps OpenSeaApiError status codes to appropriate HTTP responses.
 */
export function handleToolError(err: unknown): Response {
  if (err instanceof OpenSeaApiError) {
    const status =
      err.status === 404
        ? 404
        : err.status === 401 || err.status === 403
          ? 502
          : err.status === 429
            ? 429
            : err.status >= 500
              ? 502
              : 400;

    const message =
      err.status === 404
        ? "Collection not found."
        : err.status === 429
          ? "Rate limit exceeded."
          : err.status >= 500
            ? "The upstream OpenSea API returned an error. Please try again later."
            : "Invalid request to the OpenSea API.";

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (err.status === 429 && err.retryAfter) {
      headers["Retry-After"] = err.retryAfter;
    }

    return new Response(JSON.stringify({ error: message }), { status, headers });
  }

  if (err instanceof z.ZodError) {
    return new Response(
      JSON.stringify({
        error: "Invalid input.",
        details: err.issues.map((e) => ({ path: (e.path as (string | number)[]).join("."), message: e.message })),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (err instanceof Error && err.message.includes("OPENSEA_API_KEY")) {
    return new Response(JSON.stringify({ error: "Server configuration error." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "An unexpected error occurred." }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}
