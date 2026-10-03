# NFT Data

An OpenSea Agent Tool that provides structured NFT collection and market data to AI agents via the [ERC-8257 Tool Registry](https://eips.ethereum.org/EIPS/eip-8257).

**Live:** https://www.nftdata.app/

**OpenSea Tool:** #778 on Base

## What it does

NFT Data is a read-only tool for AI agents. It accepts an OpenSea collection slug and returns structured NFT collection and market data sourced directly from the OpenSea API v2.

The tool is registered on Base through the OpenSea ERC-8257 Tool Registry, while the underlying data layer can serve collections across OpenSea-supported chains.

**Tool action:** `get_collection_data`

**Endpoint:** `POST https://www.nftdata.app/api/get-collection-data`

### Request

```json
{
  "collection": "doodles-official"
}
```

### Returns

* collection name
* collection slug
* NFT contract information
* floor price and currency
* 24-hour sales and volume
* 7-day sales and volume
* 30-day sales and volume
* total lifetime sales and volume
* owner count
* total supply when available
* collection creation date when available

### Example response

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
  "seven_day_sales": 42,
  "seven_day_volume": 78.4,
  "thirty_day_sales": 156,
  "thirty_day_volume": 284.7,
  "total_sales": 84210,
  "total_volume": 98432.7,
  "num_owners": 5021
}
```

## Error responses

| HTTP Status | Meaning                            |
| ----------- | ---------------------------------- |
| `400`       | Missing or invalid collection slug |
| `404`       | Collection not found on OpenSea    |
| `429`       | OpenSea API rate limit exceeded    |
| `500`       | Server configuration error         |
| `502`       | Upstream OpenSea API error         |

## ERC-8257 Tool Registry

**Tool ID:** 778
**Network:** Base
**Chain ID:** 8453
**Access:** Open / Free

Registry:

`0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1`

The ERC-8257 manifest is available at:

https://www.nftdata.app/.well-known/ai-tool/nft-data.json

The manifest defines the tool name, description, production endpoint, input and output schemas, discovery tags, and creator address.

## API

NFT Data uses the OpenSea API v2 as its data source.

The server-side API key is stored as the `OPENSEA_API_KEY` environment variable and is never exposed to clients.

No end-user wallet connection, authentication, signing, trading, or write operation is required.

## Architecture

```text
AI Agent
   │
   ▼
OpenSea Tool Registry
   │
   ▼
Tool #778
   │
   ▼
ERC-8257 Manifest
   │
   ▼
NFT Data API
   │
   ▼
OpenSea API v2
```

## Local development

**Prerequisites:** Node.js 18+ and npm.

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Test the API:

```bash
curl -X POST http://localhost:3000/api/get-collection-data \
  -H "Content-Type: application/json" \
  -d '{"collection":"doodles-official"}'
```

Test the manifest:

```bash
curl http://localhost:3000/.well-known/ai-tool/nft-data.json
```

Run the TypeScript check:

```bash
npm run build
```

## Environment variables

Create a local `.env` file:

```env
OPENSEA_API_KEY=your_opensea_api_key
```

The OpenSea API key is required by the server and must never be exposed in client-side code.

## Deployment

The production application is deployed on Vercel.

**Website:** https://www.nftdata.app/

**API:** https://www.nftdata.app/api/get-collection-data

**Manifest:** https://www.nftdata.app/.well-known/ai-tool/nft-data.json

## Project structure

```text
nft-data/
├── api/
│   ├── get-collection-data.ts
│   └── well-known/
│       └── [slug].ts
├── src/
│   ├── manifest.ts
│   ├── handler.ts
│   └── opensea.ts
├── public/
│   ├── nft-data-icon.svg
│   ├── nft-data-banner.svg
│   └── favicon.svg
├── env.example
├── vercel.json
├── tsconfig.json
└── package.json
```

## Links

* Website: https://www.nftdata.app/
* GitHub: https://github.com/Nomad07/nft-data
* OpenSea Tool #778: https://opensea.io/tools/erc8257/base/778
* ERC-8257: https://eips.ethereum.org/EIPS/eip-8257
* OpenSea API: https://docs.opensea.io/

## License

MIT
