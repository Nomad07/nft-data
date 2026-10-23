/**
 * POST /api/get-collection-data
 *
 * Dual-protocol paid tool endpoint:
 *   - x402 v2  (ExactEvmScheme, PAYMENT-REQUIRED / X-PAYMENT or PAYMENT-SIGNATURE headers)
 *   - MPP      (evm/charge on Base mainnet,
 *               WWW-Authenticate: Payment / Authorization: Payment headers)
 *
 * All protocols:
 *   - Price:     $0.002 USDC per successful request
 *   - Recipient: PAY_TO address
 *
 * x402 / MPP evm:
 *   - Network:   Base mainnet (eip155:8453), USDC 0x833589...
 *   - Settler:   PayAI x402 facilitator
 *
 * Header routing (mutually exclusive — one protocol per request):
 *   - X-PAYMENT or PAYMENT-SIGNATURE present       → x402 path (v1 and v2)
 *   - Authorization/Payment-Authorization present  → MPP path
 *   - Neither present                              → 402 with both challenges
 *
 * The NFT/OpenSea data logic lives entirely in src/handler.ts and is unchanged.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

// ── x402 imports ─────────────────────────────────────────────────────────────
import {
  x402HTTPResourceServer,
  HTTPFacilitatorClient,
  x402ResourceServer,
} from "@x402/core/server";
import type { HTTPAdapter } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

// ── MPP imports ───────────────────────────────────────────────────────────────
import { Mppx, evm } from "mppx/server";

/** Minimal structural type for an mppx instance — avoids un-portable typeof references.
 *  The charge handler returns:
 *    { status: 402; challenge: Response }           on missing/invalid credential
 *    { status: 200; withReceipt: (r: Response) => Response }  on verified payment
 */
type MppxChargeResult =
  | { status: 402; challenge: Response; withReceipt?: never }
  | { status: 200; challenge?: never; withReceipt: (res: Response) => Response };
type MppxInstance = { charge: (opts: { amount: string }) => (req: Request) => Promise<MppxChargeResult> };

// ── Business logic ────────────────────────────────────────────────────────────
import { handleToolError } from "../src/handler.js";
import { fetchCollectionData as _realFetchCollectionData, OpenSeaApiError } from "../src/opensea.js";

// ---------------------------------------------------------------------------
// Test seam — allows unit tests to inject a mock for fetchCollectionData
// without a network call. Only exported for test use; must NOT be called in
// production code paths. Set back to null after each test.
// ---------------------------------------------------------------------------
type FetchCollectionDataFn = typeof _realFetchCollectionData;
let _fetchOverride: FetchCollectionDataFn | null = null;
/** @internal Unit test seam. Do not call from production code. */
export function _setFetchOverrideForTest(fn: FetchCollectionDataFn | null): void {
  _fetchOverride = fn;
}
function fetchCollectionData(...args: Parameters<FetchCollectionDataFn>): ReturnType<FetchCollectionDataFn> {
  return (_fetchOverride ?? _realFetchCollectionData)(...args);
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

// arc-studio-allow-onchain-literal
// payTo: declared creator wallet for this project (NFT Data Tool #778, Base).
const PAY_TO = "0x344143199642e87320785823c20c2df107d17534" as const; // arc-studio-allow-onchain-literal

// arc-studio-allow-onchain-literal
// Solana USDC payment recipient for x402 v2 exact/svm — public address only, no private key.
const SOLANA_PAY_TO = "8MdycJfWSD8KxL8n2kSzEU9Ryuo1EuJALkq8ezrK9i3m" as const; // arc-studio-allow-onchain-literal

const FACILITATOR_URL = "https://facilitator.payai.network";
const CANONICAL_ORIGIN = "https://www.nftdata.app";

// Display-unit amount for MPP handler options.
const MPP_AMOUNT = "0.002";

// ---------------------------------------------------------------------------
// x402 setup (unchanged from original implementation)
// ---------------------------------------------------------------------------

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register("eip155:*", new ExactEvmScheme())
  .register("solana:*", new ExactSvmScheme());

const bazaarExtension = declareDiscoveryExtension({
  bodyType: "json",
  input: { collection: "basedpunks" },
  inputSchema: {
    type: "object",
    properties: {
      collection: { type: "string", description: "OpenSea collection slug" },
    },
    required: ["collection"],
  },
  output: {
    example: {
      name: "Based Punks",
      slug: "basedpunks",
      contracts: [
        // arc-studio-allow-onchain-literal
        { address: "0xcb28749c24af4797808364d71d71539bc01e76d4", chain: "base" }, // arc-studio-allow-onchain-literal
      ],
      floor_price: 0.0045,
      floor_price_currency: "ETH",
      one_day_sales: 12,
      one_day_volume: 0.054,
      one_day_volume_currency: "ETH",
      seven_day_sales: 84,
      seven_day_volume: 0.38,
      seven_day_volume_currency: "ETH",
      thirty_day_sales: 310,
      thirty_day_volume: 1.39,
      thirty_day_volume_currency: "ETH",
      total_sales: 45200,
      total_volume: 203.4,
      total_volume_currency: "ETH",
      num_owners: 1842,
      total_supply: 10000,
      created_date: "2022-08-15T00:00:00Z",
    },
  },
});

const ROUTE_KEY = "POST /api/get-collection-data";

const httpServer = new x402HTTPResourceServer(resourceServer, {
  [ROUTE_KEY]: {
    accepts: [
      {
        scheme: "exact",
        price: "$0.002",
        network: "eip155:8453",
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
      },
      {
        scheme: "exact",
        price: "$0.002",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        payTo: SOLANA_PAY_TO,
        maxTimeoutSeconds: 60,
      },
    ],
    resource: "https://www.nftdata.app/api/get-collection-data",
    description:
      "NFT Data — get_collection_data (0.002 USDC). Returns structured NFT collection and market data for any OpenSea collection slug.",
    mimeType: "application/json",
    serviceName: "NFT Data",
    tags: ["nft", "opensea", "market-data", "collection"],
    iconUrl: "https://www.nftdata.app/nft-data-logo.png",
    extensions: { ...bazaarExtension },
  },
});

// Lazy x402 init (deferred to avoid Vercel cold-start network timeout).
let initPromise: Promise<void> | null = null;
function getInitPromise(): Promise<void> {
  if (!initPromise) initPromise = httpServer.initialize();
  return initPromise;
}

// ---------------------------------------------------------------------------
// MPP setup
// ---------------------------------------------------------------------------

// Read MPP_SECRET_KEY from environment. Must be set in Vercel project settings
// (Production, Preview, and Development environments). At least 32 bytes.
// Without it challenges use random IDs (insecure for stateless verification).
const MPP_SECRET_KEY = process.env.MPP_SECRET_KEY;

const mppx = Mppx.create({
  realm: "www.nftdata.app",
  secretKey: MPP_SECRET_KEY,
  methods: evm({
    currencies: [evm.assets.base.USDC],
    recipient: PAY_TO,
    x402: {
      facilitator: FACILITATOR_URL,
      maxTimeoutSeconds: 60,
      // 'resource' binding: accepts both mppx-bound and standard x402-compatible
      // credentials. This maximises compatibility with existing EVM wallet clients.
      routeBinding: "resource",
    },
  }),
});

// ---------------------------------------------------------------------------
// Credential-routing helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Returns true when the request carries an x402 payment credential.
 *
 * Header names by protocol version:
 *   x402 v1: X-PAYMENT          (legacy header, used by v1 clients)
 *   x402 v2: PAYMENT-SIGNATURE  (used by AgentCash 0.17+, @x402/core v2 clients)
 *
 * Both headers are checked so that either version routes to handleX402Request.
 * The underlying x402HTTPResourceServer.extractPayment() reads PAYMENT-SIGNATURE
 * natively and handles both versions internally — no change to verification or
 * settlement is required.
 */
export function hasX402Credential(req: IncomingMessage): boolean {
  const xPayment = req.headers["x-payment"];
  const paymentSig = req.headers["payment-signature"];
  return (typeof xPayment === "string" && xPayment.trim().length > 0) ||
         (typeof paymentSig === "string" && paymentSig.trim().length > 0);
}

/**
 * Returns true when the request carries an MPP payment credential.
 * MPP places the credential in either:
 *   Authorization: Payment <token>           (primary MPP header)
 *   Payment-Authorization: Payment <token>   (secondary / forwarding-proxy header)
 *
 * Both headers must carry the "Payment " scheme prefix. A bare Bearer token or
 * any other scheme in either header is NOT an MPP credential and will not be
 * routed to the MPP path.
 */
export function hasMppCredential(req: IncomingMessage): boolean {
  const auth = req.headers["authorization"];
  const payAuth = req.headers["payment-authorization"];
  const hasAuth =
    typeof auth === "string" &&
    auth.trimStart().toLowerCase().startsWith("payment ");
  const hasPayAuth =
    typeof payAuth === "string" &&
    payAuth.trimStart().toLowerCase().startsWith("payment ");
  return hasAuth || hasPayAuth;
}

// ---------------------------------------------------------------------------
// Build a Web Request from a Node IncomingMessage + pre-buffered body.
// Used by both the MPP handler and the no-credential challenge path.
// ---------------------------------------------------------------------------

export function makeWebRequest(req: IncomingMessage, bodyBuf: Buffer): Request {
  const rawUrl = req.url ?? "/api/get-collection-data";
  const url = new URL(rawUrl, CANONICAL_ORIGIN);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.set(key, value);
  }
  return new Request(url.toString(), {
    method: req.method ?? "POST",
    headers,
    body: bodyBuf.length > 0 ? bodyBuf.toString("utf8") : null,
  });
}

// ---------------------------------------------------------------------------
// Node IncomingMessage → x402 HTTPAdapter bridge (unchanged)
// ---------------------------------------------------------------------------

function makeNodeAdapter(req: IncomingMessage): HTTPAdapter {
  const rawUrl = req.url ?? "/api/get-collection-data";
  const url = new URL(rawUrl, CANONICAL_ORIGIN);
  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    queryParams[k] = v;
  });

  const getHeader = (name: string): string | undefined => {
    const val = req.headers[name.toLowerCase()];
    if (Array.isArray(val)) return val.join(", ");
    return val;
  };

  return {
    getHeader,
    getMethod: () => (req.method ?? "POST").toUpperCase(),
    getPath: () => url.pathname,
    getUrl: () => url.toString(),
    getAcceptHeader: () => getHeader("accept") ?? "",
    getUserAgent: () => getHeader("user-agent") ?? "",
    getQueryParams: () => queryParams,
    getQueryParam: (name: string) => queryParams[name],
  };
}

// ---------------------------------------------------------------------------
// Write a Web Response into a Node ServerResponse
// ---------------------------------------------------------------------------

async function sendWebResponse(
  webRes: Response,
  res: ServerResponse,
): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, name) => res.setHeader(name, value));
  const body = await webRes.text();
  res.end(body);
}

// ---------------------------------------------------------------------------
// Injectable dependencies interface — used by createHandler for testability.
// Minimal structural types so tests can inject lightweight mocks.
// ---------------------------------------------------------------------------

/** Minimal x402 server surface used by the handler (structural, accepts real and mock instances). */
export interface X402ServerInterface {
  initialize(): Promise<void>;
  processHTTPRequest(context: unknown): Promise<unknown>;
  processSettlement(payload: unknown, requirements: unknown, extensions: unknown): Promise<unknown>;
}

/** Internal discriminated union for the x402 processHTTPRequest result. */
type X402ProcessResult =
  | { type: "no-payment-required" }
  | { type: "payment-error"; response: { status: number; headers?: Record<string, string>; body: unknown } }
  | { type: "payment-verified"; paymentPayload: unknown; paymentRequirements: unknown; declaredExtensions?: unknown };

/** Internal discriminated union for the x402 processSettlement result. */
type X402SettleResult =
  | { success: false; errorReason: string }
  | { success: true; headers?: Record<string, string> };

export interface HandlerDeps {
  /** x402 HTTP resource server instance */
  x402Server: X402ServerInterface;
  /** mppx instance */
  mppxInstance: MppxInstance;
  /** lazy x402 init function */
  initX402: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// createHandler — injectable factory (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Returns the Vercel handler function with dependencies injected.
 * Production code calls createHandler({ x402Server: httpServer, mppxInstance: mppx, initX402: getInitPromise }).
 * Tests pass mock implementations to avoid network calls.
 */
export function createHandler(deps: HandlerDeps) {
  return async function handlerFn(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // ── Lazy x402 init ───────────────────────────────────────────────────────
    try {
      await deps.initX402();
    } catch {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Payment system unavailable. Please try again." }));
      return;
    }

    // ── Route to protocol based on which credential header is present ────────
    //
    // Decision order:
    //   1. X-PAYMENT present        → x402 verification path
    //   2. Authorization/Payment-Authorization: Payment … → MPP verification path
    //   3. Neither                  → 402 with BOTH challenge headers
    //
    // A request can never be charged twice: header names are mutually exclusive.

    if (hasX402Credential(req)) {
      await handleX402Request(req, res, deps.x402Server);
      return;
    }

    if (hasMppCredential(req)) {
      await handleMppRequest(req, res, deps.mppxInstance);
      return;
    }

    await handleNoPaiment(req, res, deps.x402Server, deps.mppxInstance);
  };
}

// ---------------------------------------------------------------------------
// Main handler (default export uses real SDK instances)
// ---------------------------------------------------------------------------

export default createHandler({
  x402Server: httpServer,
  mppxInstance: mppx,
  initX402: getInitPromise,
});

// ---------------------------------------------------------------------------
// x402 request handler (original implementation, structurally unchanged)
// ---------------------------------------------------------------------------

export async function handleX402Request(
  req: IncomingMessage,
  res: ServerResponse,
  x402Server: X402ServerInterface = httpServer,
): Promise<void> {
  const adapter = makeNodeAdapter(req);
  const context = { adapter, path: adapter.getPath(), method: adapter.getMethod() };

  let processResult: X402ProcessResult;
  try {
    processResult = (await x402Server.processHTTPRequest(context)) as X402ProcessResult;
  } catch (err) {
    const errRes = handleToolError(err);
    await sendWebResponse(errRes, res);
    return;
  }

  if (processResult.type === "no-payment-required") {
    const dataRes = await invokeDataLogic(req);
    await sendWebResponse(dataRes, res);
    return;
  }

  if (processResult.type === "payment-error") {
    const { status, headers, body } = processResult.response;
    res.statusCode = status;
    for (const [k, v] of Object.entries(headers ?? {})) {
      res.setHeader(k, v as string);
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
    return;
  }

  // Payment verified — run business logic then settle.
  const { paymentPayload, paymentRequirements, declaredExtensions } = processResult;

  let dataResponse: Response;
  try {
    dataResponse = await invokeDataLogic(req);
  } catch (err) {
    const errRes = handleToolError(err);
    await sendWebResponse(errRes, res);
    return;
  }

  if (!dataResponse.ok) {
    await sendWebResponse(dataResponse, res);
    return;
  }

  const settleResult = (await x402Server.processSettlement(
    paymentPayload,
    paymentRequirements,
    declaredExtensions ?? {},
  )) as X402SettleResult;

  if (!settleResult.success) {
    const failReason = (settleResult as { success: false; errorReason: string }).errorReason;
    res.statusCode = 402;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "settlement_failed", reason: failReason }));
    return;
  }

  res.statusCode = dataResponse.status;
  dataResponse.headers.forEach((value, name) => res.setHeader(name, value));
  if (settleResult.headers) {
    for (const [k, v] of Object.entries(settleResult.headers)) {
      res.setHeader(k, v as string);
    }
  }
  res.end(await dataResponse.text());
}

// ---------------------------------------------------------------------------
// MPP request handler
// ---------------------------------------------------------------------------

export async function handleMppRequest(
  req: IncomingMessage,
  res: ServerResponse,
  mppxInstance: MppxInstance = mppx,
): Promise<void> {
  // Buffer the body once — it will be consumed by nodeToWebRequest (for mppx)
  // and must also be available to invokeDataLogic.
  let rawBodyBuf: Buffer;
  try {
    rawBodyBuf = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Failed to read request body." }));
    return;
  }

  // Build a Web Request for mppx using the buffered body.
  const webReq = makeWebRequest(req, rawBodyBuf);

  // mppxInstance.charge() returns a handler function; call it with the Web Request.
  const mppHandler = mppxInstance.charge({ amount: MPP_AMOUNT });
  let result;
  try {
    result = await mppHandler(webReq);
  } catch (err) {
    const errRes = handleToolError(err);
    await sendWebResponse(errRes, res);
    return;
  }

  if (result.status === 402) {
    // Payment verification failed or credential was invalid.
    await sendWebResponse(result.challenge as Response, res);
    return;
  }

  // status === 200: payment verified. Run business logic with the buffered body.
  let dataResponse: Response;
  try {
    dataResponse = await invokeDataLogicFromBuffer(rawBodyBuf);
  } catch (err) {
    const errRes = handleToolError(err);
    await sendWebResponse(errRes, res);
    return;
  }

  if (!dataResponse.ok) {
    await sendWebResponse(dataResponse, res);
    return;
  }

  // Attach the MPP receipt header to the successful response (withReceipt is synchronous).
  const receiptResponse = result.withReceipt(dataResponse);
  await sendWebResponse(receiptResponse, res);
}

// ---------------------------------------------------------------------------
// No-credential path: generate and return both x402 and MPP 402 challenges.
// This lets clients of either protocol discover the payment requirements.
// ---------------------------------------------------------------------------

export async function handleNoPaiment(
  req: IncomingMessage,
  res: ServerResponse,
  x402Server: X402ServerInterface = httpServer,
  mppxInstance: MppxInstance = mppx,
): Promise<void> {
  // Buffer the body so it can be used for both the x402 and MPP challenge paths.
  let rawBodyBuf: Buffer;
  try {
    rawBodyBuf = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  } catch {
    rawBodyBuf = Buffer.from("{}");
  }

  // Get the x402 challenge by running the x402 processor without a credential.
  const adapter = makeNodeAdapter(req);
  const context = { adapter, path: adapter.getPath(), method: adapter.getMethod() };

  let processResult: X402ProcessResult;
  try {
    processResult = (await x402Server.processHTTPRequest(context)) as X402ProcessResult;
  } catch (err) {
    const errRes = handleToolError(err);
    await sendWebResponse(errRes, res);
    return;
  }

  // Collect x402 response headers and body.
  let x402Status = 402;
  let x402Headers: Record<string, string> = { "Content-Type": "application/json" };
  let x402Body: unknown = { error: "payment_required" };

  if (processResult.type === "payment-error") {
    x402Status = processResult.response.status;
    x402Headers = { ...x402Headers, ...(processResult.response.headers ?? {}) };
    x402Body = processResult.response.body;
  } else if (processResult.type === "no-payment-required") {
    // Route not gated — should not happen in practice, but handle gracefully.
    const dataRes = await invokeDataLogicFromBuffer(rawBodyBuf);
    await sendWebResponse(dataRes, res);
    return;
  } else if (processResult.type === "payment-verified") {
    // A payment credential was processed by the x402 SDK inside handleNoPaiment.
    //
    // This branch is unreachable in normal operation: hasX402Credential() now
    // intercepts both X-PAYMENT and PAYMENT-SIGNATURE before reaching here.
    //
    // Settlement note: ExactEvmScheme uses the "authorization" payment flow
    // (settleBeforeHandler: false, confirmed from SDK source). Under normal
    // operation processHTTPRequest does NOT settle before returning payment-verified.
    // However, if a client requests the "upfront" flow (settleBeforeHandler: true),
    // the SDK settles inside processHTTPRequest before returning this result, and
    // that settlement cannot be undone by this 500 response. Returning 500 here
    // is correct — it prevents duplicate settlement by not calling processSettlement
    // a second time — but it does not guarantee the upfront-flow settlement was not
    // already completed inside the SDK. This is documented, not hidden.
    //
    // The right fix is always to ensure routing never reaches this path with a
    // valid credential, which the hasX402Credential update achieves.
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Internal routing error." }));
    return;
  }

  // Generate the MPP WWW-Authenticate challenge header.
  let mppChallengeHeader: string | null = null;
  try {
    const webReq = makeWebRequest(req, rawBodyBuf);
    const mppHandler = mppxInstance.charge({ amount: MPP_AMOUNT });
    const mppResult = await mppHandler(webReq);
    if (mppResult.status === 402) {
      const challengeResponse = mppResult.challenge as Response;
      mppChallengeHeader = challengeResponse.headers.get("www-authenticate");
    }
  } catch {
    // MPP challenge generation failed — still return the x402 challenge alone.
  }

  res.statusCode = x402Status;
  for (const [k, v] of Object.entries(x402Headers)) {
    res.setHeader(k, v);
  }
  if (mppChallengeHeader) {
    res.setHeader("WWW-Authenticate", mppChallengeHeader);
  }
  res.end(JSON.stringify(x402Body));
}

// ---------------------------------------------------------------------------
// Business logic — same 20-field output as collectionDataHandler in src/handler.ts
// Two entry points:
//   invokeDataLogic(req)        — reads body from Node stream (x402 path)
//   invokeDataLogicFromBuffer() — uses pre-buffered body (MPP and no-cred paths)
// ---------------------------------------------------------------------------

async function invokeDataLogic(req: IncomingMessage): Promise<Response> {
  let rawBodyBuf: Buffer;
  try {
    rawBodyBuf = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  } catch {
    return new Response(JSON.stringify({ error: "Failed to read request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return invokeDataLogicFromBuffer(rawBodyBuf);
}

export async function invokeDataLogicFromBuffer(rawBodyBuf: Buffer): Promise<Response> {
  try {
    const apiKey = process.env.OPENSEA_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Server configuration error." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBodyBuf.toString("utf8"));
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>)["collection"] !== "string"
    ) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid 'collection' field." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const slug = (
      (body as Record<string, unknown>)["collection"] as string
    ).trim();
    if (!slug || !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
      return new Response(
        JSON.stringify({ error: "Invalid collection slug format." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const [collectionData, statsData] = await fetchCollectionData(slug, apiKey);

    const oneDayStat = statsData.intervals.find((i) => i.interval === "one_day");
    const sevenDayStat = statsData.intervals.find((i) => i.interval === "seven_day");
    const thirtyDayStat = statsData.intervals.find(
      (i) => i.interval === "thirty_day",
    );

    const result = {
      name: collectionData.name,
      slug: collectionData.collection,
      contracts: collectionData.contracts,
      floor_price: statsData.total.floor_price,
      floor_price_currency: statsData.total.floor_price_symbol,
      one_day_sales: oneDayStat?.sales ?? 0,
      one_day_volume: oneDayStat?.volume ?? 0,
      seven_day_sales: sevenDayStat ? sevenDayStat.sales : null,
      seven_day_volume: sevenDayStat ? sevenDayStat.volume : null,
      thirty_day_sales: thirtyDayStat ? thirtyDayStat.sales : null,
      thirty_day_volume: thirtyDayStat ? thirtyDayStat.volume : null,
      total_sales: statsData.total.sales,
      total_volume: statsData.total.volume,
      num_owners: statsData.total.num_owners,
      total_supply: collectionData.total_supply ?? null,
      created_date: collectionData.created_date ?? null,
      one_day_volume_currency: oneDayStat?.volume_symbol ?? null,
      seven_day_volume_currency: sevenDayStat?.volume_symbol ?? null,
      thirty_day_volume_currency: thirtyDayStat?.volume_symbol ?? null,
      total_volume_currency: statsData.total.volume_symbol ?? null,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof OpenSeaApiError) {
      const status =
        err.status === 404
          ? 404
          : err.status === 429
            ? 429
            : err.status === 401 || err.status === 403
              ? 502
              : err.status >= 500
                ? 502
                : 400;

      const message =
        err.status === 404
          ? "Collection not found."
          : err.status === 429
            ? "Rate limit exceeded."
            : err.status >= 500
              ? "The upstream OpenSea API returned an error. Please try again later."
              : "Invalid request to the OpenSea API.";

      const responseHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (err.status === 429 && err.retryAfter) {
        responseHeaders["Retry-After"] = err.retryAfter;
      }
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: responseHeaders,
      });
    }

    return new Response(JSON.stringify({ error: "An unexpected error occurred." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const config = {
  runtime: "nodejs",
};
