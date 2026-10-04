# NFT Data

A read-only OpenSea Agent Tool that provides structured NFT collection and market data for AI agents. Registered as [Tool #778](https://opensea.io/tools/erc8257/base/778) on Base via the [ERC-8257 Tool Registry](https://eips.ethereum.org/EIPS/eip-8257).

**Website:** https://nftdata.app/

---

## What it does

NFT Data exposes a single tool action, `get_collection_data`, that accepts an OpenSea collection slug and returns structured, factual data sourced directly from the OpenSea API v2. It is designed to be called by AI agents that need reliable NFT collection metadata without having to implement OpenSea API access themselves.

No end-user wallet connection is required. NFT Data performs no purchases, sales, transfers, or other write operations.

---

## Multi-chain support

NFT Data is not hardcoded to a single blockchain. The `contracts` field in every response includes the blockchain identifier for each collection contract, enabling agents to identify and reason about collections on any supported network.

NFT Data uses the OpenSea API v2, which provides NFT and marketplace data across 30 chains.

NFT Data has been verified with real production collections on multiple networks. Currently confirmed in production:

| Network | Slug | Contract |
|---------|------|----------|
| Base | `basedpunks` | `0xcb28749c24af4797808364d71d71539bc01e76d4` |
| Base | `gribbits` | `0x38b7446dd746a98a101ec0bf1a0717784c4dc69f` |
| Ink | `rekt-ink` | `0x25aa78ab6785a4b0aeff5c170998992fd958d43d` |
| Ink | `prtscn-ink` | `0x3ea71c6abde8a1b3cf6e5683761a7378b4e9e448` |

All four were tested against the production endpoint. Base and Ink are not the only supported networks.

---

## How it works

```
AI agent
  → NFT Data Agent Tool (POST /api/get-collection-data)
  → OpenSea API v2
  → structured NFT collection data
```

NFT Data handles the OpenSea API request server-side, normalises the response into a consistent schema, and returns it to the calling agent. OpenSea API credentials are handled entirely server-side and are never exposed to clients.

---

## Tool action

**Tool action:** `get_collection_data`

**Endpoint:** `POST https://www.nftdata.app/api/get-collection-data`

### Request

```json
{
  "collection": "basedpunks"
}
```

`collection` is the OpenSea collection slug — the unique identifier visible in the collection's OpenSea URL.

### PowerShell example

```powershell
$body = @{ collection = "basedpunks" } | ConvertTo-Json

Invoke-RestMethod `
  -Uri "https://www.nftdata.app/api/get-collection-data" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body | ConvertTo-Json -Depth 10
```

---

## Returned data

The tool returns:

- collection metadata (name, slug)
- NFT contract information (address and chain for each contract)
- floor price and floor currency
- 24-hour sales and volume
- 7-day sales and volume
- 30-day sales and volume
- total sales and lifetime volume
- owner count
- total supply
- collection creation date

All data is sourced from the OpenSea API v2. `floor_price_currency` identifies the currency of the floor price (for example `ETH`). Volume fields represent trading volume as reported by OpenSea and are not guaranteed to be in any specific currency.

---

## Example response

Real production response for `basedpunks` (Base):

```json
{
  "name": "based punks",
  "slug": "basedpunks",
  "contracts": [
    {
      "address": "0xcb28749c24af4797808364d71d71539bc01e76d4",
      "chain": "base"
    }
  ],
  "floor_price": 0.02391776,
  "floor_price_currency": "ETH",
  "one_day_sales": 1,
  "one_day_volume": 0.0185,
  "seven_day_sales": 16,
  "seven_day_volume": 0.34213836,
  "thirty_day_sales": 217,
  "thirty_day_volume": 1.50135021,
  "total_sales": 18027,
  "total_volume": 4728.074488347124,
  "num_owners": 2408,
  "total_supply": 5000,
  "created_date": "2024-04-05"
}
```

---

## Output schema

All 16 fields:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Collection display name. |
| `slug` | `string` | Collection slug. |
| `contracts` | `array` | NFT contract addresses and their chains. |
| `floor_price` | `number` | Current floor price of the collection. |
| `floor_price_currency` | `string` | Currency symbol for the floor price. |
| `one_day_sales` | `number` | Number of sales in the last 24 hours. |
| `one_day_volume` | `number` | Trading volume in the last 24 hours. |
| `seven_day_sales` | `number \| null` | Number of sales in the last 7 days. Null if not reported. |
| `seven_day_volume` | `number \| null` | Trading volume in the last 7 days. Null if not reported. |
| `thirty_day_sales` | `number \| null` | Number of sales in the last 30 days. Null if not reported. |
| `thirty_day_volume` | `number \| null` | Trading volume in the last 30 days. Null if not reported. |
| `total_sales` | `number` | Total lifetime sales count. |
| `total_volume` | `number` | Total lifetime trading volume. |
| `num_owners` | `number` | Current number of unique owners. |
| `total_supply` | `number \| null` | Total number of NFTs in the collection. Null if not reported. |
| `created_date` | `string \| null` | ISO 8601 date when the collection was created. Null if not reported. |

---

## API behavior

| HTTP Status | Meaning |
|-------------|---------|
| `200` | Success — structured collection data returned. |
| `400` | Missing or invalid collection slug. |
| `404` | Collection not found on OpenSea. |
| `429` | OpenSea rate limit exceeded. The `Retry-After` header is forwarded when OpenSea provides it. |
| `500` | Unexpected server error. |
| `502` | Upstream OpenSea API error. |

---

## Caching

Successful collection and statistics responses are cached server-side for 60 seconds on the active Vercel worker instance. Repeated requests for the same slug within that window return the cached result without hitting the OpenSea API. This is a best-effort in-memory cache and is not shared across worker instances or deployments.

---

## Security and access model

- NFT Data is read-only.
- No end-user wallet connection is required.
- No private keys are required from users.
- No NFT trading or transfer operations are performed.
- OpenSea API credentials are handled server-side and are never exposed to clients or returned in responses.

---

## Manifest and registry

| Resource | URL |
|----------|-----|
| Website | https://nftdata.app/ |
| API | https://www.nftdata.app/api/get-collection-data |
| Manifest | https://www.nftdata.app/.well-known/ai-tool/nft-data.json |
| OpenSea Tool #778 | https://opensea.io/tools/erc8257/base/778 |

NFT Data is registered as Tool #778 on Base.

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENSEA_API_KEY` | Yes | OpenSea API key. |
| `TOOL_ENDPOINT` | No | Overrides the manifest endpoint URL. Defaults to the production URL. |

---

## Project structure

```
nft-data/
  api/
    get-collection-data.ts      # Tool invocation endpoint
    well-known/[slug].ts        # Manifest discovery endpoint
  src/
    manifest.ts                 # ERC-8257 Tool Manifest
    handler.ts                  # Tool handler and schema validation
    opensea.ts                  # OpenSea API v2 client with 60s cache
  public/                       # Web interface and public assets
  vercel.json                   # Vercel routing configuration
  package.json
  tsconfig.json
```

---

## License

MIT
