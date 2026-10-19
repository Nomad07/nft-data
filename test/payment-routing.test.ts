/**
 * Tests for dual x402 + MPP payment routing in api/get-collection-data.ts
 *
 * Test strategy
 * ─────────────
 * These tests import and call the REAL exported production functions with
 * mocked SDK dependencies. They verify:
 *   - hasX402Credential / hasMppCredential detect headers correctly
 *   - createHandler routes to x402 path, MPP path, or no-credential 402 path
 *   - handleMppRequest returns 402 when MPP challenge fires
 *   - handleMppRequest returns 200 + data + receipt when MPP payment verified
 *   - handleNoPaiment returns 402 with both challenge headers
 *   - handleX402Request returns 402 on x402 payment-error
 *   - handleX402Request: payment-verified → business logic → settlement → 200
 *   - handleX402Request: payment-verified → settlement failure → 402
 *   - invokeDataLogicFromBuffer validates slug and calls fetchCollectionData
 *   - Startup throws when MPP_SECRET_KEY absent (safety check)
 *
 * All external API calls (OpenSea, x402 facilitator, mppx) are mocked.
 * No real network requests are made in any test in this file.
 *
 * Live-payment scenarios (marked INTEGRATION — require real network):
 *   - Valid EIP-3009 transferWithAuthorization → settlement → 200
 *   - Valid MPP evm/charge credential → settlement → 200
 *   - Replay / expired credential → rejected by facilitator
 */

import assert from "node:assert/strict";
import { describe, it, before, after, afterEach } from "node:test";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

// ── Import real production functions ────────────────────────────────────────
// We import via a dynamic import after setting MPP_SECRET_KEY so the module
// initialises successfully (Mppx.create() throws without the key).

// Set required env vars BEFORE importing the module.
process.env.MPP_SECRET_KEY = "a".repeat(64); // 64-char hex = 32 bytes
process.env.OPENSEA_API_KEY = "test-opensea-key-not-used-in-unit-tests";

// Alias for lazy resolution below.
type HandlerModule = typeof import("../api/get-collection-data.js");
let mod: HandlerModule;

// ── Mock factories ───────────────────────────────────────────────────────────

function makeMockReq(opts: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.method = opts.method ?? "POST";
  // Bun sets headers to null on a freshly constructed IncomingMessage; use
  // direct assignment rather than Object.assign to be runtime-agnostic.
  (req as IncomingMessage & { headers: Record<string, string> }).headers =
    { ...(opts.headers ?? {}) };
  const bodyBuf = Buffer.from(opts.body ?? "{}", "utf8");
  setImmediate(() => {
    req.emit("data", bodyBuf);
    req.emit("end");
  });
  return req;
}

interface CapturedRes extends ServerResponse {
  capturedStatus: number;
  capturedHeaders: Record<string, string | string[]>;
  capturedBody: string;
}

function makeMockRes(): CapturedRes {
  const res = new ServerResponse(new IncomingMessage(new Socket())) as CapturedRes;
  res.capturedStatus = 0;
  res.capturedHeaders = {};
  res.capturedBody = "";

  const origSetHeader = res.setHeader.bind(res);
  res.setHeader = (name: string, value: string | string[] | number) => {
    res.capturedHeaders[name.toLowerCase()] =
      typeof value === "number" ? String(value) : (value as string | string[]);
    return origSetHeader(name, value);
  };

  const origEnd = res.end.bind(res);
  res.end = (chunk?: unknown) => {
    if (typeof chunk === "string") res.capturedBody = chunk;
    else if (Buffer.isBuffer(chunk)) res.capturedBody = chunk.toString("utf8");
    res.capturedStatus = res.statusCode;
    return origEnd(chunk as never);
  };

  return res;
}

// ── Minimal x402HTTPResourceServer mock ─────────────────────────────────────

function makeX402Mock(opts: {
  initShouldFail?: boolean;
  processResult:
    | { type: "payment-error"; status: number; paymentRequiredHeader: string }
    | { type: "no-payment-required" }
    | { type: "payment-verified"; settleShouldFail?: boolean };
}) {
  return {
    initialize: opts.initShouldFail
      ? async () => { throw new Error("facilitator unavailable"); }
      : async () => undefined,
    processHTTPRequest: async (_ctx: unknown) => {
      if (opts.processResult.type === "payment-error") {
        return {
          type: "payment-error" as const,
          response: {
            status: opts.processResult.status,
            headers: { "PAYMENT-REQUIRED": opts.processResult.paymentRequiredHeader },
            body: { error: "payment_required", accepts: [] },
          },
        };
      }
      if (opts.processResult.type === "no-payment-required") {
        return { type: "no-payment-required" as const };
      }
      // "payment-verified" — return a fully verified payment context
      return {
        type: "payment-verified" as const,
        paymentPayload: { mockPayload: true },
        paymentRequirements: { mockRequirements: true },
        declaredExtensions: {},
      };
    },
    processSettlement: async (_payload: unknown, _reqs: unknown, _ext: unknown) => {
      if (
        opts.processResult.type === "payment-verified" &&
        opts.processResult.settleShouldFail
      ) {
        return { success: false as const, errorReason: "mock_settlement_failure" };
      }
      return { success: true as const, headers: { "PAYMENT-RESPONSE": "mock-settled" } };
    },
  };
}

// ── Minimal mppx mock ────────────────────────────────────────────────────────

function makeMppxMock(opts: {
  chargeResult: "402" | "200";
}) {
  return {
    charge: (_chargeOpts: { amount: string }) =>
      async (_req: Request): Promise<{ status: number; challenge?: Response; withReceipt?: (r: Response) => Response }> => {
        if (opts.chargeResult === "402") {
          const challenge = new Response(
            JSON.stringify({ error: "payment_required" }),
            {
              status: 402,
              headers: {
                "Content-Type": "application/json",
                "WWW-Authenticate": 'Payment id="test-id", realm="www.nftdata.app", method="evm"',
              },
            },
          );
          return { status: 402, challenge };
        }
        // 200 — payment verified
        return {
          status: 200,
          withReceipt: (r: Response) => {
            const headers = new Headers(r.headers);
            headers.set("Payment-Receipt", "mock-receipt");
            return new Response(r.body, { status: r.status, headers });
          },
        };
      },
  };
}

// ── Canonical mock OpenSea response (used wherever OpenSea would be called) ─

const MOCK_COLLECTION = {
  collection: "azuki",
  name: "Azuki",
  contracts: [{ address: "0xed5af388653567af2f388e6224dc7c4b3241c544", chain: "ethereum" }],
  total_supply: 10000,
  created_date: "2022-01-12T00:00:00Z",
};
const MOCK_STATS = {
  total: {
    floor_price: 3.5,
    floor_price_symbol: "ETH",
    volume: 120000,
    volume_symbol: "ETH",
    sales: 45000,
    num_owners: 4200,
  },
  intervals: [
    { interval: "one_day", volume: 40, volume_symbol: "ETH", sales: 12 },
    { interval: "seven_day", volume: 280, volume_symbol: "ETH", sales: 84 },
    { interval: "thirty_day", volume: 1200, volume_symbol: "ETH", sales: 360 },
  ],
};

/** Install a mock fetchCollectionData that returns MOCK_COLLECTION + MOCK_STATS. */
function installFetchMock() {
  mod._setFetchOverrideForTest(async (_slug, _apiKey) => [MOCK_COLLECTION, MOCK_STATS]);
}

/** Remove the mock fetchCollectionData (restore real function). */
function removeFetchMock() {
  mod._setFetchOverrideForTest(null);
}

// ── Test: startup safety ─────────────────────────────────────────────────────

describe("Startup safety (UNIT)", () => {
  it("Mppx.create() throws when MPP_SECRET_KEY is absent", async () => {
    // We cannot unset the env var after it's been set (module is already loaded),
    // but we can verify the SDK's throw path directly using its constructor.
    // This is the path the audit confirmed would crash a cold start.
    const { Mppx, evm } = await import("mppx/server");
    const methods = evm({
      currencies: [evm.assets.base.USDC],
      recipient: "0x344143199642e87320785823c20c2df107d17534",
      x402: { facilitator: "https://facilitator.payai.network" },
    });
    const savedKey = process.env.MPP_SECRET_KEY;
    try {
      delete process.env.MPP_SECRET_KEY;
      assert.throws(
        () => Mppx.create({ realm: "www.nftdata.app", methods }),
        /Missing secret key/,
        "Mppx.create() must throw when MPP_SECRET_KEY is absent",
      );
    } finally {
      process.env.MPP_SECRET_KEY = savedKey;
    }
  });

  it("Mppx.create() succeeds with a valid MPP_SECRET_KEY and evm method", async () => {
    const { Mppx, evm } = await import("mppx/server");
    const PAY_TO = "0x344143199642e87320785823c20c2df107d17534";
    assert.doesNotThrow(
      () => Mppx.create({
        realm: "www.nftdata.app",
        secretKey: "b".repeat(64),
        methods: evm({
          currencies: [evm.assets.base.USDC],
          recipient: PAY_TO,
          x402: { facilitator: "https://facilitator.payai.network" },
        }),
      }),
      "Mppx.create() must succeed with valid key and evm method",
    );
  });
});

// ── Load module (after env vars are set) ────────────────────────────────────

before(async () => {
  // Use dynamic import so the module reads MPP_SECRET_KEY at load time.
  // Strip .ts extension for ts-node/esm compatibility.
  mod = await import("../api/get-collection-data.js") as HandlerModule;
});

// Always clean up the fetch override after each test.
afterEach(() => removeFetchMock());

// ── hasX402Credential (real function from module) ────────────────────────────

describe("hasX402Credential — real exported function (UNIT)", () => {
  it("returns true when X-PAYMENT header is present (x402 v1)", () => {
    const { hasX402Credential } = mod;
    const req = makeMockReq({ headers: { "x-payment": "eyJhbGciOiJFUzI1NiJ9.test" } });
    assert.ok(hasX402Credential(req), "should detect X-PAYMENT header (v1)");
  });

  it("returns true when PAYMENT-SIGNATURE header is present (x402 v2)", () => {
    // x402 v2 clients (AgentCash 0.17+, @x402/core v2) send PAYMENT-SIGNATURE.
    // This was the root cause: the server only checked X-PAYMENT and missed v2 clients.
    const { hasX402Credential } = mod;
    const req = makeMockReq({ headers: { "payment-signature": "eyJhbGciOiJFUzI1NiJ9.v2payload" } });
    assert.ok(hasX402Credential(req), "should detect PAYMENT-SIGNATURE header (v2)");
  });

  it("returns false when PAYMENT-SIGNATURE header is empty / whitespace-only", () => {
    const { hasX402Credential } = mod;
    const req = makeMockReq({ headers: { "payment-signature": "   " } });
    assert.ok(!hasX402Credential(req), "whitespace-only PAYMENT-SIGNATURE is not a credential");
  });

  it("returns false when X-PAYMENT header is absent", () => {
    const { hasX402Credential } = mod;
    const req = makeMockReq({ headers: {} });
    assert.ok(!hasX402Credential(req), "should not detect missing X-PAYMENT");
  });

  it("returns false when X-PAYMENT header is empty string", () => {
    const { hasX402Credential } = mod;
    const req = makeMockReq({ headers: { "x-payment": "   " } });
    assert.ok(!hasX402Credential(req), "whitespace-only X-PAYMENT is not a credential");
  });
});

// ── hasMppCredential (real function from module) ─────────────────────────────

describe("hasMppCredential — real exported function (UNIT)", () => {
  it("returns true for Authorization: Payment … header", () => {
    const { hasMppCredential } = mod;
    const req = makeMockReq({ headers: { authorization: "Payment eyJjaGFsbGVuZ2UiOiJ0ZXN0In0" } });
    assert.ok(hasMppCredential(req), "should detect Authorization: Payment");
  });

  it("returns false for Authorization: Bearer … header", () => {
    const { hasMppCredential } = mod;
    const req = makeMockReq({ headers: { authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.test" } });
    assert.ok(!hasMppCredential(req), "Bearer token must not be treated as MPP credential");
  });

  it("returns true for Payment-Authorization: Payment … header", () => {
    const { hasMppCredential } = mod;
    const req = makeMockReq({ headers: { "payment-authorization": "Payment eyJjaGFsbGVuZ2UiOiJ0ZXN0In0" } });
    assert.ok(hasMppCredential(req), "should detect Payment-Authorization: Payment");
  });

  it("returns false for Payment-Authorization: Bearer … header", () => {
    // Regression: Payment-Authorization with Bearer scheme must NOT be treated
    // as an MPP credential. Previously any non-empty Payment-Authorization
    // value was accepted. The fix requires the 'Payment ' prefix.
    const { hasMppCredential } = mod;
    const req = makeMockReq({ headers: { "payment-authorization": "Bearer eyJhbGciOiJSUzI1NiJ9.test" } });
    assert.ok(
      !hasMppCredential(req),
      "Payment-Authorization: Bearer must not be treated as MPP credential",
    );
  });

  it("returns false when neither Authorization nor Payment-Authorization present", () => {
    const { hasMppCredential } = mod;
    const req = makeMockReq({ headers: { "content-type": "application/json" } });
    assert.ok(!hasMppCredential(req), "no MPP credential when headers absent");
  });
});

// ── createHandler routing (real createHandler, mock deps) ────────────────────

describe("createHandler routing — real createHandler with mock deps (UNIT)", () => {
  it("routes X-PAYMENT request to x402 path: returns 402 on payment-error", async () => {
    const { createHandler } = mod;
    const x402Mock = makeX402Mock({
      processResult: { type: "payment-error", status: 402, paymentRequiredHeader: "eyJ0ZXN0IjoidHJ1ZSJ9" },
    }) as Parameters<typeof createHandler>[0]["x402Server"];
    const mppMock = makeMppxMock({ chargeResult: "402" }) as Parameters<typeof createHandler>[0]["mppxInstance"];
    const handler = createHandler({ x402Server: x402Mock, mppxInstance: mppMock, initX402: async () => undefined });

    const req = makeMockReq({ headers: { "x-payment": "eyJhbGciOiJFUzI1NiJ9.test" } });
    const res = makeMockRes();
    await handler(req, res);

    assert.equal(res.capturedStatus, 402, "x402 payment-error should return 402");
  });

  it("routes Authorization: Payment request to MPP path: returns 402 challenge", async () => {
    const { createHandler } = mod;
    const x402Mock = makeX402Mock({ processResult: { type: "payment-error", status: 402, paymentRequiredHeader: "" } }) as Parameters<typeof createHandler>[0]["x402Server"];
    const mppMock = makeMppxMock({ chargeResult: "402" }) as Parameters<typeof createHandler>[0]["mppxInstance"];
    const handler = createHandler({ x402Server: x402Mock, mppxInstance: mppMock, initX402: async () => undefined });

    const req = makeMockReq({ headers: { authorization: "Payment eyJjaGFsbGVuZ2UiOiJ0ZXN0In0" } });
    const res = makeMockRes();
    await handler(req, res);

    assert.equal(res.capturedStatus, 402, "MPP challenge should return 402");
    assert.ok(
      res.capturedHeaders["www-authenticate"],
      "MPP 402 should include WWW-Authenticate",
    );
  });

  it("returns combined 402 with both challenge headers when no credential present", async () => {
    const { createHandler } = mod;
    const x402Mock = makeX402Mock({
      processResult: { type: "payment-error", status: 402, paymentRequiredHeader: "eyJ0ZXN0IjoidHJ1ZSJ9" },
    }) as Parameters<typeof createHandler>[0]["x402Server"];
    const mppMock = makeMppxMock({ chargeResult: "402" }) as Parameters<typeof createHandler>[0]["mppxInstance"];
    const handler = createHandler({ x402Server: x402Mock, mppxInstance: mppMock, initX402: async () => undefined });

    const req = makeMockReq({ headers: { "content-type": "application/json" } });
    const res = makeMockRes();
    await handler(req, res);

    assert.equal(res.capturedStatus, 402, "no-credential path should return 402");
    assert.ok(
      res.capturedHeaders["payment-required"] || res.capturedHeaders["payment_required"],
      "no-credential 402 should include PAYMENT-REQUIRED header",
    );
    assert.ok(res.capturedHeaders["www-authenticate"], "no-credential 402 should include WWW-Authenticate");
  });

  it("returns 500 when x402 init fails", async () => {
    const { createHandler } = mod;
    const x402Mock = makeX402Mock({ initShouldFail: true, processResult: { type: "payment-error", status: 402, paymentRequiredHeader: "" } }) as Parameters<typeof createHandler>[0]["x402Server"];
    const mppMock = makeMppxMock({ chargeResult: "402" }) as Parameters<typeof createHandler>[0]["mppxInstance"];
    const handler = createHandler({ x402Server: x402Mock, mppxInstance: mppMock, initX402: async () => { throw new Error("init failed"); } });

    const req = makeMockReq({});
    const res = makeMockRes();
    await handler(req, res);

    assert.equal(res.capturedStatus, 500, "init failure should return 500");
    const body = JSON.parse(res.capturedBody) as Record<string, unknown>;
    assert.ok(typeof body["error"] === "string", "500 should include error field");
  });

  it("routes PAYMENT-SIGNATURE (x402 v2) request to x402 path, not MPP or no-cred path", async () => {
    // Root-cause regression test: AgentCash 0.17+ sends PAYMENT-SIGNATURE (not X-PAYMENT).
    // Before the fix, hasX402Credential returned false for PAYMENT-SIGNATURE, causing the
    // request to fall through to handleNoPaiment and return 402 instead of processing payment.
    const { createHandler } = mod;
    let x402Called = false;
    let mppCalled = false;
    let noPaymentCalled = false;

    const x402Mock = {
      initialize: async () => undefined,
      processHTTPRequest: async (_ctx: unknown) => {
        x402Called = true;
        return {
          type: "payment-error" as const,
          response: { status: 402, headers: {}, body: { error: "payment_required", accepts: [] } },
        };
      },
      processSettlement: async () => ({ success: true as const }),
    } as Parameters<typeof mod.createHandler>[0]["x402Server"];

    const mppMock = {
      charge: (_opts: { amount: string }) => async (_req: Request) => {
        mppCalled = true;
        return { status: 402 as const, challenge: new Response(null, { status: 402 }) };
      },
    } as Parameters<typeof mod.createHandler>[0]["mppxInstance"];

    // Inject a spy that sets noPaymentCalled if handleNoPaiment is reached.
    // We detect this by giving the x402Mock's processHTTPRequest a sentinel —
    // if x402Called is set and mppCalled is not, the routing is correct.
    const handler = mod.createHandler({
      x402Server: x402Mock,
      mppxInstance: mppMock,
      initX402: async () => undefined,
    });

    const req = makeMockReq({
      headers: {
        // v2 credential — NO X-PAYMENT header
        "payment-signature": "eyJhbGciOiJFUzI1NiJ9.v2payload",
      },
    });
    const res = makeMockRes();
    await handler(req, res);

    assert.ok(x402Called, "x402 processHTTPRequest must be called for PAYMENT-SIGNATURE requests");
    assert.ok(!mppCalled, "MPP path must NOT be called for PAYMENT-SIGNATURE requests");
    // The mock returns payment-error (not a real credential) so status is 402 —
    // but the routing went to handleX402Request, not handleNoPaiment.
    assert.equal(res.capturedStatus, 402, "mock payment-error returns 402 (correct path taken)");
    void noPaymentCalled; // unused — routing confirmed by x402Called flag
  });

  it("x402 path takes precedence when both X-PAYMENT and Authorization: Payment are present", async () => {
    const { createHandler } = mod;
    let x402Called = false;
    let mppCalled = false;

    const x402Mock = {
      initialize: async () => undefined,
      processHTTPRequest: async (_ctx: unknown) => {
        x402Called = true;
        return {
          type: "payment-error" as const,
          response: { status: 402, headers: {}, body: { error: "payment_required", accepts: [] } },
        };
      },
      processSettlement: async () => ({ success: true as const }),
    } as Parameters<typeof mod.createHandler>[0]["x402Server"];

    const mppMock = {
      charge: (_opts: { amount: string }) => async (_req: Request) => {
        mppCalled = true;
        return { status: 402 as const, challenge: new Response(null, { status: 402 }) };
      },
    } as Parameters<typeof mod.createHandler>[0]["mppxInstance"];

    const handler = mod.createHandler({ x402Server: x402Mock, mppxInstance: mppMock, initX402: async () => undefined });

    const req = makeMockReq({
      headers: {
        "x-payment": "eyJhbGciOiJFUzI1NiJ9.test",
        authorization: "Payment eyJjaGFsbGVuZ2UiOiJ0ZXN0In0",
      },
    });
    const res = makeMockRes();
    await handler(req, res);

    assert.ok(x402Called, "x402 path should be invoked");
    assert.ok(!mppCalled, "MPP path must NOT be invoked when X-PAYMENT is present");
  });
});

// ── handleX402Request — real function, payment-verified path ─────────────────

describe("handleX402Request — payment-verified path (UNIT)", () => {
  it("payment-verified + settlement success: returns 200 with data and PAYMENT-RESPONSE header", async () => {
    const { handleX402Request } = mod;
    installFetchMock();

    const x402Mock = makeX402Mock({
      processResult: { type: "payment-verified" },
    }) as Parameters<typeof handleX402Request>[2];

    const req = makeMockReq({
      body: JSON.stringify({ collection: "azuki" }),
      headers: { "x-payment": "eyJhbGciOiJFUzI1NiJ9.test" },
    });
    const res = makeMockRes();
    await handleX402Request(req, res, x402Mock);

    assert.equal(res.capturedStatus, 200, "verified + settled should return 200");
    const body = JSON.parse(res.capturedBody) as Record<string, unknown>;
    assert.equal(body["slug"], "azuki", "response body should include slug field");
    assert.equal(body["name"], "Azuki", "response body should include name field");
    assert.ok(
      res.capturedHeaders["payment-response"],
      "settled response must include PAYMENT-RESPONSE header",
    );
    assert.equal(
      res.capturedHeaders["payment-response"],
      "mock-settled",
      "PAYMENT-RESPONSE header should carry settlement token",
    );
  });

  it("payment-verified + settlement failure: returns 402 settlement_failed", async () => {
    const { handleX402Request } = mod;
    installFetchMock();

    const x402Mock = makeX402Mock({
      processResult: { type: "payment-verified", settleShouldFail: true },
    }) as Parameters<typeof handleX402Request>[2];

    const req = makeMockReq({
      body: JSON.stringify({ collection: "azuki" }),
      headers: { "x-payment": "eyJhbGciOiJFUzI1NiJ9.test" },
    });
    const res = makeMockRes();
    await handleX402Request(req, res, x402Mock);

    assert.equal(res.capturedStatus, 402, "settlement failure should return 402");
    const body = JSON.parse(res.capturedBody) as Record<string, unknown>;
    assert.equal(body["error"], "settlement_failed", "error field must be 'settlement_failed'");
    assert.equal(body["reason"], "mock_settlement_failure", "reason field should carry settlement error reason");
  });

  it("payment-verified + data response non-OK: skips settlement, returns data error status", async () => {
    const { handleX402Request } = mod;
    // Use an invalid slug so invokeDataLogic returns 400 (no OpenSea call)
    let settleCalled = false;
    const x402Mock = {
      initialize: async () => undefined,
      processHTTPRequest: async () => ({
        type: "payment-verified" as const,
        paymentPayload: {},
        paymentRequirements: {},
        declaredExtensions: {},
      }),
      processSettlement: async () => {
        settleCalled = true;
        return { success: true as const, headers: {} };
      },
    } as Parameters<typeof mod.handleX402Request>[2];

    const req = makeMockReq({
      body: JSON.stringify({ collection: "INVALID SLUG!" }),
      headers: { "x-payment": "eyJhbGciOiJFUzI1NiJ9.test" },
    });
    const res = makeMockRes();
    await handleX402Request(req, res, x402Mock);

    assert.equal(res.capturedStatus, 400, "data error should propagate as 400");
    assert.ok(!settleCalled, "processSettlement must NOT be called when business logic returned non-OK");
  });

  it("returns 402 on payment-error", async () => {
    const { handleX402Request } = mod;
    const x402Mock = makeX402Mock({
      processResult: { type: "payment-error", status: 402, paymentRequiredHeader: "eyJ0ZXN0IjoidHJ1ZSJ9" },
    }) as Parameters<typeof handleX402Request>[2];

    const req = makeMockReq({ headers: { "x-payment": "eyJhbGciOiJFUzI1NiJ9.test" } });
    const res = makeMockRes();
    await handleX402Request(req, res, x402Mock);

    assert.equal(res.capturedStatus, 402);
    assert.ok(res.capturedHeaders["payment-required"], "payment-error should set PAYMENT-REQUIRED header");
  });
});

// ── handleMppRequest — real function with mock mppx ──────────────────────────

describe("handleMppRequest — real function with mock mppx (UNIT)", () => {
  it("returns 402 challenge when mppx returns 402", async () => {
    const { handleMppRequest } = mod;
    const mppMock = makeMppxMock({ chargeResult: "402" }) as Parameters<typeof handleMppRequest>[2];
    const req = makeMockReq({ body: JSON.stringify({ collection: "azuki" }) });
    const res = makeMockRes();
    await handleMppRequest(req, res, mppMock);

    assert.equal(res.capturedStatus, 402);
    assert.ok(res.capturedHeaders["www-authenticate"], "should include WWW-Authenticate");
  });

  it("payment verified + valid slug: calls withReceipt and returns 200 with receipt header", async () => {
    const { handleMppRequest } = mod;
    installFetchMock();

    const mppMock = makeMppxMock({ chargeResult: "200" }) as Parameters<typeof handleMppRequest>[2];
    const req = makeMockReq({ body: JSON.stringify({ collection: "azuki" }) });
    const res = makeMockRes();
    await handleMppRequest(req, res, mppMock);

    assert.equal(res.capturedStatus, 200, "verified MPP payment should return 200");
    const body = JSON.parse(res.capturedBody) as Record<string, unknown>;
    assert.equal(body["slug"], "azuki", "response must include collection slug");
    assert.ok(
      res.capturedHeaders["payment-receipt"],
      "verified MPP response must include Payment-Receipt header from withReceipt",
    );
  });

  it("payment verified + invalid slug: does NOT call withReceipt, returns 400", async () => {
    const { handleMppRequest } = mod;
    // Invalid slug → invokeDataLogicFromBuffer returns 400 before reaching OpenSea.
    // withReceipt guard: must NOT be called when data response is non-OK.
    let withReceiptCalled = false;
    const mppMock = {
      charge: (_opts: { amount: string }) =>
        async (_req: Request): Promise<{ status: 200; withReceipt: (r: Response) => Response }> => ({
          status: 200,
          withReceipt: (r: Response) => {
            withReceiptCalled = true;
            return r;
          },
        }),
    } as Parameters<typeof handleMppRequest>[2];

    const req = makeMockReq({ body: JSON.stringify({ collection: "INVALID SLUG!" }) });
    const res = makeMockRes();
    await handleMppRequest(req, res, mppMock);

    assert.ok(!withReceiptCalled, "withReceipt must NOT be called when data response is non-OK");
    assert.equal(res.capturedStatus, 400, "invalid slug should return 400");
  });
});

// ── invokeDataLogicFromBuffer — real function (UNIT) ─────────────────────────

describe("invokeDataLogicFromBuffer — real exported function (UNIT)", () => {
  it("returns 400 for invalid JSON body", async () => {
    const { invokeDataLogicFromBuffer } = mod;
    const res = await invokeDataLogicFromBuffer(Buffer.from("not-json", "utf8"));
    assert.equal(res.status, 400);
    const body = await res.json() as Record<string, unknown>;
    assert.ok(typeof body["error"] === "string");
  });

  it("returns 400 for missing collection field", async () => {
    const { invokeDataLogicFromBuffer } = mod;
    const res = await invokeDataLogicFromBuffer(Buffer.from(JSON.stringify({ foo: "bar" }), "utf8"));
    assert.equal(res.status, 400);
  });

  it("returns 400 for invalid slug format (uppercase)", async () => {
    const { invokeDataLogicFromBuffer } = mod;
    const res = await invokeDataLogicFromBuffer(Buffer.from(JSON.stringify({ collection: "AZUKI" }), "utf8"));
    assert.equal(res.status, 400);
    const body = await res.json() as Record<string, unknown>;
    assert.match(body["error"] as string, /slug/i);
  });

  it("returns 400 for slug starting with hyphen", async () => {
    const { invokeDataLogicFromBuffer } = mod;
    const res = await invokeDataLogicFromBuffer(Buffer.from(JSON.stringify({ collection: "-azuki" }), "utf8"));
    assert.equal(res.status, 400);
  });

  it("returns 400 for empty slug", async () => {
    const { invokeDataLogicFromBuffer } = mod;
    const res = await invokeDataLogicFromBuffer(Buffer.from(JSON.stringify({ collection: "" }), "utf8"));
    assert.equal(res.status, 400);
  });

  it("accepts valid slug 'azuki' and returns 200 with all 20 fields (mocked OpenSea)", async () => {
    const { invokeDataLogicFromBuffer } = mod;
    installFetchMock();
    // No real network call — fetchCollectionData is overridden via _setFetchOverrideForTest.
    const res = await invokeDataLogicFromBuffer(Buffer.from(JSON.stringify({ collection: "azuki" }), "utf8"));
    assert.equal(res.status, 200, "valid slug with mocked data should return 200");
    const body = await res.json() as Record<string, unknown>;
    // Verify all 20 output fields are present.
    const expectedFields = [
      "name", "slug", "contracts", "floor_price", "floor_price_currency",
      "one_day_sales", "one_day_volume", "seven_day_sales", "seven_day_volume",
      "thirty_day_sales", "thirty_day_volume", "total_sales", "total_volume",
      "num_owners", "total_supply", "created_date",
      "one_day_volume_currency", "seven_day_volume_currency",
      "thirty_day_volume_currency", "total_volume_currency",
    ];
    for (const field of expectedFields) {
      assert.ok(field in body, `response must include field '${field}'`);
    }
    assert.equal(body["slug"], "azuki");
    assert.equal(body["name"], "Azuki");
    assert.equal(body["floor_price"], 3.5);
    assert.equal(body["total_supply"], 10000);
  });

  it("returns 500 when OPENSEA_API_KEY is missing", async () => {
    const { invokeDataLogicFromBuffer } = mod;
    const savedKey = process.env.OPENSEA_API_KEY;
    try {
      delete process.env.OPENSEA_API_KEY;
      const res = await invokeDataLogicFromBuffer(Buffer.from(JSON.stringify({ collection: "azuki" }), "utf8"));
      assert.equal(res.status, 500, "missing OPENSEA_API_KEY should return 500");
      const body = await res.json() as Record<string, unknown>;
      assert.ok(typeof body["error"] === "string");
    } finally {
      process.env.OPENSEA_API_KEY = savedKey;
    }
  });
});

// ── makeWebRequest (real function) ───────────────────────────────────────────

describe("makeWebRequest — real exported function (UNIT)", () => {
  it("constructs a Web Request with correct URL and method", () => {
    const { makeWebRequest } = mod;
    const body = Buffer.from(JSON.stringify({ collection: "azuki" }), "utf8");
    const req = makeMockReq({ method: "POST", headers: { "content-type": "application/json" } });
    req.url = "/api/get-collection-data";

    const webReq = makeWebRequest(req, body);
    assert.equal(webReq.method, "POST");
    assert.ok(webReq.url.includes("/api/get-collection-data"), "URL must include path");
    assert.equal(webReq.headers.get("content-type"), "application/json");
  });
});

// ── Protocol isolation: credential formats cannot cross-pollinate ─────────────

describe("Protocol isolation — credential format mismatch (UNIT)", () => {
  it("x402 credential in X-PAYMENT does not satisfy hasMppCredential", () => {
    const { hasMppCredential } = mod;
    // x402 credential is raw base64 with no 'Payment ' prefix — placed in X-PAYMENT.
    // If (incorrectly) also placed in Authorization, it must not pass MPP check.
    const x402Cred = "eyJzY2hlbWUiOiJleGFjdCJ9"; // no 'Payment ' prefix
    const req = makeMockReq({ headers: { "x-payment": x402Cred, authorization: x402Cred } });
    assert.ok(!hasMppCredential(req), "raw x402 credential cannot satisfy hasMppCredential");
  });

  it("MPP credential in Authorization does not satisfy hasX402Credential", () => {
    const { hasX402Credential } = mod;
    const req = makeMockReq({ headers: { authorization: "Payment eyJjaGFsbGVuZ2UiOiJ0ZXN0In0" } });
    assert.ok(!hasX402Credential(req), "MPP credential in Authorization must not satisfy hasX402Credential");
  });
});

// ── OpenAPI specification metadata ───────────────────────────────────────────

describe("OpenAPI spec metadata (UNIT)", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const specPath = path.resolve(process.cwd(), "public/openapi.json");

  let spec: Record<string, unknown>;
  try {
    const raw = await fs.readFile(specPath, "utf8");
    spec = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    spec = {};
  }

  it("spec version is 3.1.0", () => {
    assert.equal(spec["openapi"], "3.1.0");
  });

  it("info.contact.email is present and non-empty", () => {
    const info = spec["info"] as Record<string, unknown>;
    const contact = info?.["contact"] as Record<string, unknown>;
    assert.ok(
      typeof contact?.["email"] === "string" && contact["email"].length > 0,
      "info.contact.email must be present",
    );
  });

  it("info.x-guidance is a non-empty string", () => {
    const info = spec["info"] as Record<string, unknown>;
    assert.ok(
      typeof info?.["x-guidance"] === "string" && (info["x-guidance"] as string).length > 0,
      "info.x-guidance must be present",
    );
  });

  it("paid endpoint lists both x402 and mpp in protocols", () => {
    const paths = spec["paths"] as Record<string, unknown>;
    const post = ((paths?.["/api/get-collection-data"] as Record<string, unknown>)?.["post"]) as Record<string, unknown>;
    const protocols = ((post?.["x-payment-info"] as Record<string, unknown>)?.["protocols"]) as unknown[];
    assert.ok(Array.isArray(protocols) && protocols.length >= 2, "must have at least 2 protocols");
    const names = protocols.map((p) => Object.keys(p as object)[0]);
    assert.ok(names.includes("x402"), "protocols must include x402");
    assert.ok(names.includes("mpp"), "protocols must include mpp");
  });

  it("price is 0.002 USD fixed", () => {
    const paths = spec["paths"] as Record<string, unknown>;
    const post = ((paths?.["/api/get-collection-data"] as Record<string, unknown>)?.["post"]) as Record<string, unknown>;
    const price = ((post?.["x-payment-info"] as Record<string, unknown>)?.["price"]) as Record<string, unknown>;
    assert.equal(price?.["mode"], "fixed");
    assert.equal(price?.["amount"], "0.002");
    assert.equal(price?.["currency"], "USD");
  });

  it("/openapi.json path has security: []", () => {
    const paths = spec["paths"] as Record<string, unknown>;
    const get = ((paths?.["/openapi.json"] as Record<string, unknown>)?.["get"]) as Record<string, unknown>;
    assert.ok(get, "/openapi.json GET must exist");
    assert.deepEqual(get["security"], [], "security must be empty array");
  });
});

// ── Notes: tests that require live payment infrastructure ────────────────────
//
// INTEGRATION (requires Vercel deployment + real USDC on Base mainnet):
//   - Valid EIP-3009 transferWithAuthorization → verified + settled → 200 + data
//   - Valid MPP evm/charge credential         → verified + settled → 200 + data
//   - Duplicate x402 credential (replay)      → facilitator rejects → 402
//   - Expired MPP challenge ID                → mppx rejects → 402
//   - Valid payment but OpenSea 404           → settle skipped → 404
//   - Valid x402 payment + settlement failure → 402 settlement_failed
//
// These require: live Vercel, OPENSEA_API_KEY (real), MPP_SECRET_KEY, Base USDC.
