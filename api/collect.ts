/**
 * POST /api/collect
 *
 * Free endpoint for the NFT Data browser web UI.
 * Uses the same collection-data logic as /api/get-collection-data
 * but requires no x402 payment.
 *
 * Origin checking provides basic scraping resistance only — it is not
 * real authentication. The URL is visible in browser DevTools and can
 * be called from any HTTP client. Rate limiting at the edge is the
 * appropriate control for volume abuse.
 */
import { toolHandlerFree, handleToolError } from "../src/handler.js";

const ALLOWED_ORIGINS = new Set([
  "https://nftdata.app",
  "https://www.nftdata.app",
]);

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    return await toolHandlerFree(req);
  } catch (err) {
    return handleToolError(err);
  }
}

export const config = {
  runtime: "edge",
};
