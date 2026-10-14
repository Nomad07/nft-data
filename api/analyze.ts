/**
 * POST /api/analyze
 *
 * Server-side AI analysis route for the NFT Data browser UI.
 * Calls BlockRun's free nvidia/nemotron-3.5-lightning model with the
 * collection data already retrieved from OpenSea — no API key required,
 * no payment credentials, no OpenSea key forwarded.
 *
 * Security conventions match /api/collect:
 *   - Origin-checked to nftdata.app domains only.
 *   - Body size-bounded before parsing.
 *   - No stack traces or internal details returned to the client.
 */

const ALLOWED_ORIGINS = new Set([
  "https://nftdata.app",
  "https://www.nftdata.app",
]);

const BLOCKRUN_ENDPOINT = "https://blockrun.ai/api/v1/chat/completions";
const MODEL = "nvidia/nemotron-3.5-lightning";

// Maximum body size accepted from the browser (bytes).
// A full collection payload is ~500 bytes; 8 KB is a generous ceiling.
const MAX_BODY_BYTES = 8_192;

// BlockRun upstream timeout — set below Vercel Edge's ~25s execution limit.
const UPSTREAM_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CollectionData {
  name: string;
  slug: string;
  floor_price: number;
  floor_price_currency: string;
  one_day_sales: number;
  one_day_volume: number;
  one_day_volume_currency: string | null;
  seven_day_sales: number | null;
  seven_day_volume: number | null;
  seven_day_volume_currency: string | null;
  thirty_day_sales: number | null;
  thirty_day_volume: number | null;
  thirty_day_volume_currency: string | null;
  total_sales: number;
  total_volume: number;
  total_volume_currency: string | null;
  num_owners: number;
  total_supply: number | null;
  created_date: string | null;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isNumber(v: unknown): v is number {
  return typeof v === "number" && isFinite(v);
}

function isNullableNumber(v: unknown): v is number | null {
  return v === null || isNumber(v);
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

/**
 * Validate the incoming collection data object.
 * Returns a typed CollectionData or null if any required field is invalid.
 */
function validateCollectionData(obj: Record<string, unknown>): CollectionData | null {
  if (
    typeof obj["name"] !== "string" || obj["name"].trim() === "" ||
    typeof obj["slug"] !== "string" || obj["slug"].trim() === "" ||
    !isNumber(obj["floor_price"]) ||
    typeof obj["floor_price_currency"] !== "string" ||
    !isNumber(obj["one_day_sales"]) ||
    !isNumber(obj["one_day_volume"]) ||
    !isNullableString(obj["one_day_volume_currency"]) ||
    !isNullableNumber(obj["seven_day_sales"]) ||
    !isNullableNumber(obj["seven_day_volume"]) ||
    !isNullableString(obj["seven_day_volume_currency"]) ||
    !isNullableNumber(obj["thirty_day_sales"]) ||
    !isNullableNumber(obj["thirty_day_volume"]) ||
    !isNullableString(obj["thirty_day_volume_currency"]) ||
    !isNumber(obj["total_sales"]) ||
    !isNumber(obj["total_volume"]) ||
    !isNullableString(obj["total_volume_currency"]) ||
    !isNumber(obj["num_owners"]) ||
    !isNullableNumber(obj["total_supply"]) ||
    !isNullableString(obj["created_date"])
  ) {
    return null;
  }
  return {
    name:                       obj["name"] as string,
    slug:                       obj["slug"] as string,
    floor_price:                obj["floor_price"] as number,
    floor_price_currency:       obj["floor_price_currency"] as string,
    one_day_sales:              obj["one_day_sales"] as number,
    one_day_volume:             obj["one_day_volume"] as number,
    one_day_volume_currency:    obj["one_day_volume_currency"] as string | null,
    seven_day_sales:            obj["seven_day_sales"] as number | null,
    seven_day_volume:           obj["seven_day_volume"] as number | null,
    seven_day_volume_currency:  obj["seven_day_volume_currency"] as string | null,
    thirty_day_sales:           obj["thirty_day_sales"] as number | null,
    thirty_day_volume:          obj["thirty_day_volume"] as number | null,
    thirty_day_volume_currency: obj["thirty_day_volume_currency"] as string | null,
    total_sales:                obj["total_sales"] as number,
    total_volume:               obj["total_volume"] as number,
    total_volume_currency:      obj["total_volume_currency"] as string | null,
    num_owners:                 obj["num_owners"] as number,
    total_supply:               obj["total_supply"] as number | null,
    created_date:               obj["created_date"] as string | null,
  };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function na(value: number | null | undefined): string {
  return value === null || value === undefined ? "N/A" : value.toLocaleString("en-US");
}

function naStr(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "N/A" : value;
}

function buildPrompt(d: CollectionData): string {
  const cur = (val: number | null, sym: string | null) =>
    val === null ? "N/A" : `${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${naStr(sym)}`;

  const lines = [
    `NFT collection: ${d.name} (slug: ${d.slug})`,
    `Floor price: ${cur(d.floor_price, d.floor_price_currency)}`,
    `Unique owners: ${na(d.num_owners)}`,
    `Total supply: ${na(d.total_supply)}`,
    `Created: ${naStr(d.created_date)}`,
    ``,
    `Sales and volume:`,
    `  24h  — sales: ${na(d.one_day_sales)},   volume: ${cur(d.one_day_volume, d.one_day_volume_currency)}`,
    `  7d   — sales: ${na(d.seven_day_sales)},   volume: ${cur(d.seven_day_volume, d.seven_day_volume_currency)}`,
    `  30d  — sales: ${na(d.thirty_day_sales)},  volume: ${cur(d.thirty_day_volume, d.thirty_day_volume_currency)}`,
    `  All-time — sales: ${na(d.total_sales)}, volume: ${cur(d.total_volume, d.total_volume_currency)}`,
  ];

  return `You are a concise NFT market analyst. Analyse the following OpenSea collection data and produce a brief written analysis.

Data:
${lines.join("\n")}

Instructions:
- Base your analysis only on the data provided above.
- If a metric is listed as N/A it is unavailable; do not invent or estimate it.
- Clearly separate observations (what the numbers show) from interpretations (what they might mean).
- Include short sections: Market Activity, Ownership & Supply, Key Observations.
- End with a one-sentence summary.
- Do not present this as financial advice.
- Keep the response concise — under 300 words.
- Use plain prose, not bullet-heavy lists. Short paragraphs preferred.`;
}

// ---------------------------------------------------------------------------
// BlockRun API call
// ---------------------------------------------------------------------------

interface BlockRunChoice {
  message?: { content?: string };
}

interface BlockRunResponse {
  choices?: BlockRunChoice[];
  error?: { code?: string; message?: string } | string;
}

/**
 * Call BlockRun's free nvidia/nemotron-3.5-lightning model.
 * Returns the completion text, or throws a typed error.
 */
async function callBlockRun(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(BLOCKRUN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new UpstreamError("timeout", "The AI request timed out.");
    }
    throw new UpstreamError("network", "Could not reach the AI service.");
  } finally {
    clearTimeout(timer);
  }

  // Free-tier rate limit — BlockRun returns 429 with code FREE_TIER_RATE_LIMITED
  if (res.status === 429) {
    let code: string | undefined;
    try {
      const body = (await res.json()) as BlockRunResponse;
      const errField = body.error;
      if (typeof errField === "object" && errField !== null) {
        code = errField.code;
      }
    } catch {
      // ignore parse failure — still a 429
    }
    // Show the free-tier limit message only when BlockRun explicitly identifies it.
    // Any other 429 (missing code, unknown code, generic rate limit) is a temporary
    // upstream error and must not be presented as the user's personal free-tier limit.
    if (code === "FREE_TIER_RATE_LIMITED") {
      throw new UpstreamError("free_tier_rate_limited", "Free tier rate limit reached.");
    }
    throw new UpstreamError("rate_limited", "Rate limit reached. Please try again later.");
  }

  if (!res.ok) {
    throw new UpstreamError("upstream_error", `Upstream returned ${res.status}.`);
  }

  let body: BlockRunResponse;
  try {
    body = (await res.json()) as BlockRunResponse;
  } catch {
    throw new UpstreamError("parse_error", "Unexpected response from AI service.");
  }

  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new UpstreamError("empty_response", "AI service returned an empty response.");
  }

  return content.trim();
}

// ---------------------------------------------------------------------------
// Typed upstream error
// ---------------------------------------------------------------------------

class UpstreamError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

// ---------------------------------------------------------------------------
// Vercel Edge handler
// ---------------------------------------------------------------------------

export default async function handler(req: Request): Promise<Response> {
  // Method guard
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  // Origin check — same convention as /api/collect
  const origin = req.headers.get("origin");
  if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
    return json({ error: "Forbidden." }, 403);
  }

  // Body size guard — read raw text first to bound memory usage
  const contentLength = req.headers.get("content-length");
  if (contentLength !== null && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return json({ error: "Request body too large." }, 413);
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return json({ error: "Failed to read request body." }, 400);
  }

  if (rawBody.length > MAX_BODY_BYTES) {
    return json({ error: "Request body too large." }, 413);
  }

  // JSON parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return json({ error: "Request body must be a JSON object." }, 400);
  }

  // Validate collection data payload
  const body = parsed as Record<string, unknown>;
  const data = validateCollectionData(body);
  if (!data) {
    return json({ error: "Invalid or incomplete collection data." }, 400);
  }

  // Build prompt and call BlockRun
  const prompt = buildPrompt(data);

  try {
    const analysis = await callBlockRun(prompt);
    return json({ analysis }, 200);
  } catch (err) {
    if (err instanceof UpstreamError) {
      if (err.code === "free_tier_rate_limited") {
        return json({ error: "free_tier_rate_limited" }, 429);
      }
      if (err.code === "timeout") {
        return json({ error: "The AI request timed out. Please try again." }, 504);
      }
      // Other upstream errors — generic message, no internal details
      return json({ error: "The AI analysis service is temporarily unavailable. Please try again." }, 502);
    }
    // Unexpected — log nothing sensitive, return generic 500
    return json({ error: "An unexpected error occurred." }, 500);
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const config = {
  runtime: "edge",
};
