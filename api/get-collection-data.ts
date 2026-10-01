/**
 * POST /api/get-collection-data
 *
 * ERC-8257 tool invocation endpoint for the get_collection_data action.
 * Accepts JSON body: { "collection": "<opensea-slug>" }
 * Returns structured NFT collection and market data.
 */
import { toolHandler, handleToolError } from "../src/handler.js";

export default async function handler(req: Request): Promise<Response> {
  try {
    return await toolHandler(req);
  } catch (err) {
    return handleToolError(err);
  }
}

export const config = {
  runtime: "edge",
};
