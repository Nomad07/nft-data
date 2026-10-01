import { defineManifest } from "@opensea/tool-sdk";

/**
 * ERC-8257 Tool Manifest for NFT Data.
 *
 * The endpoint field must be updated to the actual deployed origin before
 * onchain registration. The creatorAddress must be replaced with the wallet
 * address that will call registerTool on the ToolRegistry contract.
 */
export const manifest = defineManifest({
  type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
  name: "NFT Data",
  description:
    "Provides structured NFT collection and market data for AI agents. " +
    "Given an OpenSea collection slug, returns collection metadata, contract " +
    "information, floor price, 24-hour sales and volume, total lifetime " +
    "statistics, and owner count sourced directly from the OpenSea API v2.",
  version: "1.0.0",
  endpoint: process.env.TOOL_ENDPOINT ?? "https://your-deployment-url.vercel.app",
  inputs: {
    type: "object",
    properties: {
      collection: {
        type: "string",
        description:
          "OpenSea collection slug (e.g. 'doodles-official'). " +
          "The slug is the unique identifier visible in the collection's OpenSea URL.",
      },
    },
    required: ["collection"],
  },
  outputs: {
    type: "object",
    properties: {
      name: { type: "string", description: "Collection display name." },
      slug: { type: "string", description: "Collection slug." },
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
        description: "Currency symbol for the floor price.",
      },
      one_day_sales: {
        type: "number",
        description: "Number of sales in the last 24 hours.",
      },
      one_day_volume: {
        type: "number",
        description: "Trading volume in the last 24 hours (in ETH).",
      },
      total_sales: {
        type: "number",
        description: "Total lifetime sales count.",
      },
      total_volume: {
        type: "number",
        description: "Total lifetime trading volume (in ETH).",
      },
      num_owners: {
        type: "number",
        description: "Current number of unique owners.",
      },
    },
  },
  tags: ["nft", "trading"],
  // Replace with the deploying wallet address before onchain registration.
  creatorAddress: "0x0000000000000000000000000000000000000000",
});
