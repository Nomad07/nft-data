/**
 * GET /.well-known/ai-tool/[slug].json
 *
 * Serves the ERC-8257 Tool Manifest so that AI agents and the onchain
 * ToolRegistry can discover and verify this tool's capabilities.
 *
 * The manifest is served at the well-known path on the same origin as the
 * tool endpoint, satisfying the ERC-8257 origin-binding requirement.
 */
import { createWellKnownHandler } from "@opensea/tool-sdk";
import { manifest } from "../../src/manifest.js";

const wellKnownHandler = createWellKnownHandler(manifest);

export default async function handler(req: Request): Promise<Response> {
  return wellKnownHandler(req);
}

export const config = {
  runtime: "edge",
};
