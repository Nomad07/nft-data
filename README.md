# NFT Data

An OpenSea Agent Tool that provides structured NFT collection and market data to AI agents via the [ERC-8257 Tool Registry](https://eips.ethereum.org/EIPS/eip-8257).

## What it does

NFT Data exposes a single tool action, `get_collection_data`, that accepts an OpenSea collection slug and returns structured, factual data sourced directly from the OpenSea API v2. It is designed to be called by AI agents that need reliable NFT collection metadata without having to implement OpenSea API access themselves.

## Tool action: `get_collection_data`

**Endpoint:** `POST /api/get-collection-data`

Accepts a JSON body with the collection slug and returns collection metadata, contract information, floor price, 24-hour trading statistics, total lifetime statistics, and owner count.

### Request

```json
{
  "collection": "doodles-official"
}
```

### Response

```json
{
  "name": "Doodles",
  "slug": "doodles-official",
  "contracts": [
    {
      "address": "0x8a90cab2b38dba80c64b7734e58ee1db38b8992e",
      "chain": "ethereum"
    }
  ],
  "floor_price": 1.85,
  "floor_price_currency": "ETH",
  "one_day_sales": 12,
  "one_day_volume": 22.5,
  "total_sales": 84210,
  "total_volume": 98432.7,
  "num_owners": 5021
}
```

### Error responses

| HTTP Status | Meaning |
|-------------|---------|
| `400` | Missing or invalid collection slug |
| `404` | Collection not found on OpenSea |
| `429` | Rate limit exceeded — retry after a short delay |
| `500` | Server configuration error (missing API key) |
| `502` | Upstream OpenSea API error |

## Tool manifest

The ERC-8257 Tool Manifest is served at:

```
GET /.well-known/ai-tool/nft-data.json
```

The manifest describes the tool's name, description, endpoint, JSON Schema for inputs and outputs, and discovery tags. It is used by the OpenSea ToolRegistry for onchain registration and by agents for capability discovery.

Before registering onchain, update two fields in `src/manifest.ts`:

- `endpoint` — set to the actual deployed URL of your Vercel project
- `creatorAddress` — set to the lowercase EVM wallet address that will call `registerTool`

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENSEA_API_KEY` | Yes | OpenSea API key. Obtain one at [docs.opensea.io/reference/api-keys](https://docs.opensea.io/reference/api-keys). |
| `TOOL_ENDPOINT` | No | Public URL of the deployed tool. Used to populate the `endpoint` field in the manifest. Defaults to a placeholder. |

Copy `env.example` to `.env` and fill in the values:

```bash
cp env.example .env
```

## Local development

**Prerequisites:** Node.js 18+, npm or pnpm.

```bash
npm install
npm run dev        # starts Vercel dev server on http://localhost:3000
```

Test the tool endpoint locally:

```bash
curl -X POST http://localhost:3000/api/get-collection-data \
  -H "Content-Type: application/json" \
  -d '{"collection":"doodles-official"}'
```

Test the manifest endpoint:

```bash
curl http://localhost:3000/.well-known/ai-tool/nft-data.json
```

Type-check the project:

```bash
npm run build
```

## Deployment

Deploy to Vercel:

```bash
npx vercel
```

After deploying:

1. Set the `OPENSEA_API_KEY` environment variable in your Vercel project settings.
2. Update `TOOL_ENDPOINT` in `src/manifest.ts` (or via the env var) to your deployment URL.
3. Register the tool onchain using the `@opensea/tool-sdk` CLI:

```bash
npx @opensea/tool-sdk register \
  --metadata https://your-deployment.vercel.app/.well-known/ai-tool/nft-data.json \
  --network base
```

## Project structure

```
nft-data/
  api/
    get-collection-data.ts      # Tool invocation endpoint
    well-known/[slug].ts        # Manifest discovery endpoint
  src/
    manifest.ts                 # ERC-8257 Tool Manifest definition
    handler.ts                  # Tool handler with input/output schemas
    opensea.ts                  # OpenSea API v2 client
  env.example                   # Environment variable template
  vercel.json                   # Vercel routing config
  tsconfig.json
  package.json
```

## License

MIT
