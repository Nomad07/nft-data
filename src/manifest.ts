import { defineManifest, x402UsdcPricing } from "@opensea/tool-sdk";

export const manifest = defineManifest({
  type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
  name: "NFT Data",
  description:
    "Provides structured NFT collection and market data for AI agents. " +
    "Given an OpenSea collection slug, returns collection metadata, contract " +
    "information, floor price, 24-hour sales and volume, total lifetime " +
    "statistics, and owner count sourced directly from the OpenSea API v2.",
  version: "1.0.0",
  endpoint: process.env.TOOL_ENDPOINT ?? "https://www.nftdata.app/api/get-collection-data",
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
        description: "Trading volume in the last 24 hours.",
      },
      seven_day_sales: {
        type: ["number", "null"],
        description: "Number of sales in the last 7 days. Null if not reported.",
      },
      seven_day_volume: {
        type: ["number", "null"],
        description: "Trading volume in the last 7 days. Null if not reported.",
      },
      thirty_day_sales: {
        type: ["number", "null"],
        description: "Number of sales in the last 30 days. Null if not reported.",
      },
      thirty_day_volume: {
        type: ["number", "null"],
        description: "Trading volume in the last 30 days. Null if not reported.",
      },
      total_sales: {
        type: "number",
        description: "Total lifetime sales count.",
      },
      total_volume: {
        type: "number",
        description: "Total lifetime trading volume.",
      },
      num_owners: {
        type: "number",
        description: "Current number of unique owners.",
      },
      total_supply: {
        type: ["number", "null"],
        description: "Total number of NFTs in the collection. Null if not reported.",
      },
      created_date: {
        type: ["string", "null"],
        description: "ISO 8601 date when the collection was created. Null if not reported.",
      },
      one_day_volume_currency: {
        type: ["string", "null"],
        description: "Currency symbol for the 24-hour volume. Null if not reported.",
      },
      seven_day_volume_currency: {
        type: ["string", "null"],
        description: "Currency symbol for the 7-day volume. Null if not reported.",
      },
      thirty_day_volume_currency: {
        type: ["string", "null"],
        description: "Currency symbol for the 30-day volume. Null if not reported.",
      },
      total_volume_currency: {
        type: ["string", "null"],
        description: "Currency symbol for the total lifetime volume. Null if not reported.",
      },
    },
  },
  pricing: x402UsdcPricing({
    recipient: "0x344143199642e87320785823c20c2df107d17534",
    amountUsdc: "0.01",
    network: "base",
  }),
  tags: ["nft", "trading"],
  image: "https://www.nftdata.app/nft-data-icon.svg",
  featuredImage: "https://www.nftdata.app/nft-data-banner.svg",
  creatorAddress: "0x344143199642e87320785823c20c2df107d17534",
});
