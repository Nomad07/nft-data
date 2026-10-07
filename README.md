# NFT Data

Structured NFT collection and market data for AI agents, delivered as an [ERC-8257 OpenSea Agent Tool](https://opensea.io/tools/erc8257/base/778).

---

## What it does

Given an OpenSea collection slug, NFT Data returns collection metadata, contract addresses, floor price, 24-hour / 7-day / 30-day / lifetime sales and volume, and owner statistics — sourced directly from OpenSea API v2.

**Human users** can check any collection for free at [nftdata.app](https://nftdata.app/).

**AI agents** call the paid x402 endpoint programmatically:

```
POST https://www.nftdata.app/api/get-collection-data
```

---

## OpenSea Agent Tool

| Field              | Value                                          |
|--------------------|------------------------------------------------|
| Tool ID            | 778                                            |
| Network            | Base (chain ID 8453)                           |
| Registry contract  | `0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1`   |
| Registry page      | https://opensea.io/tools/erc8257/base/778      |
| Action             | `get_collection_data`                          |
| Payment            | 0.01 USDC per call via x402 on Base            |
| Manifest           | https://www.nftdata.app/.well-known/ai-tool/nft-data.json |

---

## Public Paid API

```
POST https://www.nftdata.app/api/get-collection-data
Content-Type: application/json
```

The endpoint is protected by x402. Requests without a valid payment header receive `HTTP 402`. See [x402 payment](#x402-payment) below.

---

## x402 Payment

The endpoint requires **0.01 USDC on Base** per successful call, paid via [x402](https://x402.org/) using EIP-3009.

Payment is routed to:

```
0x344143199642e87320785823c20c2df107d17534
```

To call this tool from an OpenSea-compatible agent, reference it by its on-chain coordinates:

```
8453,0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1,778
```

---

## Input

```json
{
  "collection": "<opensea-collection-slug>"
}
```

`collection` is the unique identifier visible in the collection's OpenSea URL, for example `basedpunks` from `opensea.io/collection/basedpunks`.

**Validation:** the slug must be lowercase alphanumeric and may contain hyphens or underscores. Uppercase letters, spaces, and special characters are rejected with `HTTP 400`.

---

## Response Schema

A successful `HTTP 200` response contains the following 20 fields:

| Field                      | Type              | Description                                              |
|----------------------------|-------------------|----------------------------------------------------------|
| `name`                     | `string`          | Collection display name                                  |
| `slug`                     | `string`          | Collection slug                                          |
| `contracts`                | `array`           | NFT contract addresses and their chains                  |
| `floor_price`              | `number`          | Current floor price                                      |
| `floor_price_currency`     | `string`          | Currency symbol for the floor price                      |
| `one_day_sales`            | `number`          | Sales count in the last 24 hours                         |
| `one_day_volume`           | `number`          | Trading volume in the last 24 hours                      |
| `one_day_volume_currency`  | `string \| null`  | Currency symbol for 24-hour volume; null if not reported |
| `seven_day_sales`          | `number \| null`  | Sales count in the last 7 days; null if not reported     |
| `seven_day_volume`         | `number \| null`  | Trading volume in the last 7 days; null if not reported  |
| `seven_day_volume_currency`| `string \| null`  | Currency symbol for 7-day volume; null if not reported   |
| `thirty_day_sales`         | `number \| null`  | Sales count in the last 30 days; null if not reported    |
| `thirty_day_volume`        | `number \| null`  | Trading volume in the last 30 days; null if not reported |
| `thirty_day_volume_currency`| `string \| null` | Currency symbol for 30-day volume; null if not reported  |
| `total_sales`              | `number`          | Lifetime sales count                                     |
| `total_volume`             | `number`          | Lifetime trading volume                                  |
| `total_volume_currency`    | `string \| null`  | Currency symbol for lifetime volume; null if not reported|
| `num_owners`               | `number`          | Current unique owner count                               |
| `total_supply`             | `number \| null`  | Total NFTs in the collection; null if not reported       |
| `created_date`             | `string \| null`  | ISO 8601 creation date; null if not reported             |

Currency values (`floor_price_currency`, `*_volume_currency`) are returned directly from OpenSea and vary by collection and network. Examples include `ETH`, `WETH`, `USDC`, `APE`, `RON`, `HYPE`, and others. Do not assume all volume is ETH.

---

## Verified Production Collections

The OpenSea API supports **30 networks**. The table below lists 15 production-tested examples across a subset of those networks.

| Network        | Slug                   | Contract                                       |
|----------------|------------------------|------------------------------------------------|
| Base           | `basedpunks`           | `0xcb28749c24af4797808364d71d71539bc01e76d4`   |
| Base           | `gribbits`             | `0x38b7446dd746a98a101ec0bf1a0717784c4dc69f`   |
| Ink            | `rekt-ink`             | `0x25aa78ab6785a4b0aeff5c170998992fd958d43d`   |
| Ink            | `prtscn-ink`           | `0x3ea71c6abde8a1b3cf6e5683761a7378b4e9e448`   |
| Robinhood Chain| `quotrons404`          | `0x027aca2794e44f24950d81227dcd516ffbb49d6e`   |
| Robinhood Chain| `rare-friends-genesis` | `0x116eaa62241751e0c98da43d458600c6c17cd361`   |
| HyperEVM       | `hypurr-hyperevm`      | `0x9125e2d6827a00b0f8330d6ef7bef07730bac685`   |
| HyperEVM       | `hypio`                | `0x63eb9d77d083ca10c304e28d5191321977fd0bfb`   |
| Arc            | `akarii`               | `0xbea22653119f73716905919708a612332bf98e3f`   |
| Ronin          | `axie-land`            | `0x8c811e3c958e190f5ec15fb376533a3398620500`   |
| Ronin          | `moki-collection`      | `0xabbf01d95346368d2d85995b28880f9c4557d7b0`   |
| ApeChain       | `gimboznft`            | `0x81c9ce55e8214fd0f5181fd3d38f52fd8c33ec38`   |
| ApeChain       | `gobs-on-ape`          | `0x8f8bff91ec8dc5bf340b23c91046e7ad550582bf`   |
| Ethereum       | `azuki`                | `0xed5af388653567af2f388e6224dc7c4b3241c544`   |
| Ethereum       | `pudgypenguins`        | `0xbd3531da5cf5857e7cfaa92426877b022e612cf8`   |

These examples have been tested in production and are not representative of all 30 supported networks.

---

## Security and Read-Only Scope

NFT Data is strictly **read-only**. It does not:

- require a user wallet or private key
- sign transactions
- purchase, sell, list, offer on, or transfer NFTs
- perform any on-chain write operations

The OpenSea API key is held server-side and is never exposed to callers or included in any response.

---

## Cache

Responses are cached **in-memory for 60 seconds** per worker instance. Because the API runs on Vercel Edge, multiple isolated worker instances may be active simultaneously — cache hits are best-effort within a single warm instance, not globally shared. Cold workers always fetch from the OpenSea API.

---

## HTTP Status Codes

| Status | Meaning                                                                                 |
|--------|-----------------------------------------------------------------------------------------|
| `200`  | Success — response body contains collection data                                        |
| `400`  | Invalid request — malformed slug, missing field, or OpenSea rejected the input          |
| `402`  | Payment required — valid x402 payment header missing or invalid                        |
| `404`  | Collection not found — slug does not match any OpenSea collection                       |
| `429`  | Rate limited — OpenSea upstream rate limit hit; `Retry-After` header forwarded if present |
| `500`  | Unexpected server error                                                                 |
| `502`  | Upstream error — OpenSea API returned a 5xx or unexpected response                     |

---

## Environment Variables

| Variable          | Required | Description                                                                                    |
|-------------------|----------|------------------------------------------------------------------------------------------------|
| `OPENSEA_API_KEY` | Yes      | OpenSea API v2 key. Used server-side only; never exposed to callers.                           |
| `TOOL_ENDPOINT`   | No       | Override the manifest endpoint URL. Defaults to `https://www.nftdata.app/api/get-collection-data`. |

---

## Manifest

The ERC-8257 AI tool manifest is served at:

```
https://www.nftdata.app/.well-known/ai-tool/nft-data.json
```

It describes the tool action, input/output schema, pricing, and creator address for agent and registry discovery. The manifest is generated from `src/manifest.ts` using `@opensea/tool-sdk`.

---

## OpenSea Tool Registry

- **Tool ID:** 778
- **Network:** Base
- **Registry page:** https://opensea.io/tools/erc8257/base/778
- **Registry contract:** `0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1`

---

## Project Structure

```
api/
  get-collection-data.ts   # Paid Vercel Edge function (x402-gated)
  well-known/
    [slug].ts              # Serves the ERC-8257 manifest
src/
  handler.ts               # Tool handler, input/output schemas, error mapping
  manifest.ts              # ERC-8257 manifest definition
  opensea.ts               # OpenSea API v2 client and in-memory cache
public/
  index.html               # Static website frontend
  openapi.json             # OpenAPI 3.1 discovery document for x402scan
  .well-known/x402         # x402 compatibility discovery document
  nft-data-icon.svg        # Tool icon (256×256)
  nft-data-banner.svg      # Featured banner (1200×400)
  favicon.svg              # Favicon (32×32)
vercel.json                # Build config and /.well-known/ai-tool/* rewrite
tsconfig.json              # TypeScript config (NodeNext, strict)
package.json               # Dependencies and scripts
```

---

## Setup / Development

**Requirements:** Node.js ≥ 18, Vercel CLI

```bash
# Install dependencies
npm install

# Set environment variables
cp env.example .env
# Edit .env and add your OPENSEA_API_KEY

# Run locally
npm run dev          # vercel dev — serves API routes and static files

# Type-check
npm run build

# Validate the ERC-8257 manifest
npm run validate-manifest
```

---

## License

MIT
