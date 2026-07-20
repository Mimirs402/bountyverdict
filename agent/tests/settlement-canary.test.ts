import test from "node:test";
import assert from "node:assert/strict";
import {
  SETTLEMENT_CANARY_ASSET,
  SETTLEMENT_CANARY_NETWORK,
  SETTLEMENT_CANARY_ORIGIN,
  SETTLEMENT_CANARY_PAYEE,
  SETTLEMENT_CANARY_PRODUCTS,
  assertSettlementCanarySpacing,
  decodeAndValidatePaymentRequired,
  decodeAndValidateSettlement,
  getSettlementCanaryFixture,
  runSettlementCanary,
  selectSettlementCanaryProduct,
  validatePaidProductContract,
  type SettlementCanaryProduct,
} from "../src/settlement-canary.ts";
import { FLAKE_SERVICE_REUSE } from "../src/flake.ts";

function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function paymentRequired(product: SettlementCanaryProduct): Record<string, unknown> {
  const fixture = getSettlementCanaryFixture(product);
  return {
    x402Version: 2,
    resource: { url: fixture.url, serviceName: fixture.service },
    accepts: [{
      scheme: "exact",
      network: SETTLEMENT_CANARY_NETWORK,
      asset: SETTLEMENT_CANARY_ASSET,
      amount: fixture.amountAtomic,
      payTo: SETTLEMENT_CANARY_PAYEE,
    }],
    extensions: { bazaar: { info: { input: { method: fixture.method } } } },
  };
}

function settlementHeader(overrides: Record<string, unknown> = {}): string {
  return encodeHeader({
    success: true,
    network: SETTLEMENT_CANARY_NETWORK,
    transaction: `0x${"ab".repeat(32)}`,
    ...overrides,
  });
}

function singleBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product: "BountyVerdict",
    version: "1.0",
    verdict: "CAUTION",
    score: 47,
    issue: { url: "https://github.com/typeorm/typeorm/issues/3357" },
    service_reuse: {
      reusable: true,
      fresh_result_per_successful_call: true,
      reliability: "bounded_live_check",
      guidance: "Call BountyVerdict for every new public bounty candidate and again after issue activity changes; each successful call re-reads bounded live GitHub evidence.",
    },
    checked_at: "2026-07-20T12:00:00.000Z",
    ...overrides,
  };
}

function flakeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product: "FlakeVerdict",
    version: "1.0",
    verdict: "CONFIRMED_FLAKE",
    service_reuse: FLAKE_SERVICE_REUSE,
    checked_at: "2026-07-20T12:00:00.000Z",
    target: {
      id: "29423388605",
      attempt: 1,
      current_attempt: 2,
      status: "completed",
      conclusion: "failure",
    },
    coverage: {
      same_run_attempts_checked: 1,
      target_jobs_reported: 9,
      target_jobs_total: 9,
      target_jobs_truncated: false,
      target_failed_jobs: 1,
    },
    decision: { retry: "NO" },
    ...overrides,
  };
}

test("settlement fixtures are exact production-only resources", () => {
  for (const product of SETTLEMENT_CANARY_PRODUCTS) {
    const fixture = getSettlementCanaryFixture(product);
    const url = new URL(fixture.url);
    assert.equal(url.origin, SETTLEMENT_CANARY_ORIGIN);
    assert.equal(url.username, "");
    assert.equal(url.password, "");
    assert.equal(url.hash, "");
    assert.match(url.pathname, /^\/api\/(?:verdict|portfolio|harness|skill|run|flake)$/);
  }
  assert.throws(
    () => selectSettlementCanaryProduct("https://attacker.invalid", new Date()),
    /INVALID_PRODUCT_SELECTION/,
  );
});

test("default selection rotates deterministically once per UTC week", () => {
  const epoch = new Date(0);
  assert.equal(selectSettlementCanaryProduct(undefined, epoch), "single");
  assert.equal(
    selectSettlementCanaryProduct(undefined, new Date(7 * 24 * 60 * 60 * 1000)),
    "portfolio",
  );
  assert.equal(
    selectSettlementCanaryProduct(undefined, new Date(6 * 7 * 24 * 60 * 60 * 1000)),
    "single",
  );
  assert.equal(selectSettlementCanaryProduct("run", epoch), "run");
});

test("durable spacing requires a full rolling seven days and rejects future state", () => {
  const previous = "2026-07-16T23:59:59.000Z";
  assert.throws(
    () => assertSettlementCanarySpacing(previous, new Date("2026-07-17T00:00:01.000Z")),
    /CANARY_INTERVAL_NOT_ELAPSED/,
  );
  assert.throws(
    () => assertSettlementCanarySpacing("2026-07-21T00:00:00.000Z", new Date("2026-07-20T00:00:00.000Z")),
    /FUTURE_CANARY_TIMESTAMP/,
  );
  assert.doesNotThrow(() =>
    assertSettlementCanarySpacing(previous, new Date("2026-07-23T23:59:59.000Z"))
  );
});

test("challenge validation pins every economic and resource field", () => {
  const fixture = getSettlementCanaryFixture("single");
  assert.doesNotThrow(() => decodeAndValidatePaymentRequired(
    encodeHeader(paymentRequired("single")),
    "single",
  ));

  const mutations: Array<[string, (challenge: any) => void]> = [
    ["RESOURCE_URL_CHANGED", value => { value.resource.url = `${SETTLEMENT_CANARY_ORIGIN}/api/run`; }],
    ["SERVICE_CHANGED", value => { value.resource.serviceName = "Other"; }],
    ["AMOUNT_CHANGED", value => { value.accepts[0].amount = String(Number(fixture.amountAtomic) + 1); }],
    ["NETWORK_CHANGED", value => { value.accepts[0].network = "eip155:84532"; }],
    ["ASSET_CHANGED", value => { value.accepts[0].asset = "0x0000000000000000000000000000000000000001"; }],
    ["PAYEE_CHANGED", value => { value.accepts[0].payTo = "0x0000000000000000000000000000000000000001"; }],
    ["METHOD_CHANGED", value => { value.extensions.bazaar.info.input.method = "POST"; }],
  ];
  for (const [code, mutate] of mutations) {
    const challenge = paymentRequired("single");
    mutate(challenge);
    assert.throws(
      () => decodeAndValidatePaymentRequired(encodeHeader(challenge), "single"),
      new RegExp(code),
    );
  }
});

test("settlement validation requires explicit success, Base, and a 32-byte hash", () => {
  assert.deepEqual(decodeAndValidateSettlement(settlementHeader()), {
    transaction: `0x${"ab".repeat(32)}`,
    network: SETTLEMENT_CANARY_NETWORK,
  });
  assert.throws(
    () => decodeAndValidateSettlement(settlementHeader({ success: false })),
    /SETTLEMENT_NOT_SUCCESSFUL/,
  );
  assert.throws(
    () => decodeAndValidateSettlement(settlementHeader({ network: "eip155:84532" })),
    /SETTLEMENT_NETWORK_CHANGED/,
  );
  assert.throws(
    () => decodeAndValidateSettlement(settlementHeader({ transaction: "0x1234" })),
    /TRANSACTION_HASH_INVALID/,
  );
});

test("paid contract validation requires reusable bounded-live guidance", () => {
  const summary = validatePaidProductContract("single", singleBody());
  assert.deepEqual(summary, { verdict: "CAUTION", score: 47 });
  assert.throws(
    () => validatePaidProductContract("single", singleBody({ service_reuse: {
      reusable: false,
      fresh_result_per_successful_call: true,
      reliability: "bounded_live_check",
      guidance: "Call BountyVerdict but this deliberately does not meet the contract.",
    } })),
    /SERVICE_REUSE_INVALID/,
  );
});

test("flake settlement contract rejects obsolete retry advice and incomplete targets", () => {
  assert.deepEqual(validatePaidProductContract("flake", flakeBody()), {
    verdict: "CONFIRMED_FLAKE",
    retry: "NO",
    same_run_attempts_checked: 1,
  });
  assert.throws(
    () => validatePaidProductContract("flake", flakeBody({ decision: { retry: "ONCE" } })),
    /FLAKE_RETRY_INVALID/,
  );
  assert.throws(
    () => validatePaidProductContract("flake", flakeBody({ coverage: {
      same_run_attempts_checked: 1,
      target_jobs_reported: 1,
      target_jobs_total: 101,
      target_jobs_truncated: true,
      target_failed_jobs: 1,
    } })),
    /FLAKE_COVERAGE_INCOMPLETE/,
  );
  assert.throws(
    () => validatePaidProductContract("flake", flakeBody({ coverage: {
      same_run_attempts_checked: 1,
      target_jobs_reported: 9,
      target_jobs_total: 9,
      target_jobs_truncated: false,
      target_failed_jobs: 0,
    } })),
    /FLAKE_COVERAGE_INCOMPLETE/,
  );
});

test("orchestration authorizes once, sends once, forbids redirects, and validates 200", async () => {
  const calls: Array<{ input: string; init: RequestInit }> = [];
  let authorizationCalls = 0;
  let encodingCalls = 0;
  const checkpoints: string[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init });
    if (calls.length === 1) {
      return new Response("", {
        status: 402,
        headers: { "payment-required": encodeHeader(paymentRequired("single")) },
      });
    }
    return new Response(JSON.stringify(singleBody()), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "payment-response": settlementHeader(),
      },
    });
  };
  const result = await runSettlementCanary({
    product: "single",
    fetchImpl,
    payment: {
      createPaymentPayload: async () => {
        authorizationCalls += 1;
        return { x402Version: 2, payload: "not-persisted" };
      },
      encodePaymentHeaders: () => {
        encodingCalls += 1;
        return { "PAYMENT-SIGNATURE": "not-persisted" };
      },
    },
    onPaymentAuthorized: async pending => {
      checkpoints.push(pending.error_code || "");
      assert.equal(calls.length, 1);
      assert.equal(pending.requires_reconciliation, true);
    },
    now: () => new Date("2026-07-20T12:00:00.000Z"),
  });

  assert.equal(result.status, "SETTLED");
  assert.equal(result.healthy, true);
  assert.equal(result.transaction_hash, `0x${"ab".repeat(32)}`);
  assert.equal(result.contract_summary?.verdict, "CAUTION");
  assert.equal(authorizationCalls, 1);
  assert.equal(encodingCalls, 1);
  assert.deepEqual(checkpoints, ["PAYMENT_AUTHORIZED_AWAITING_RESULT"]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.input === getSettlementCanaryFixture("single").url));
  assert.ok(calls.every(call => call.init.redirect === "error"));
  assert.equal(new Headers(calls[0].init.headers).has("payment-signature"), false);
  assert.equal(new Headers(calls[1].init.headers).get("payment-signature"), "not-persisted");
  assert.equal(JSON.stringify(result).includes("not-persisted"), false);
});

test("post-authorization transport ambiguity is never retried", async () => {
  let calls = 0;
  let authorizations = 0;
  const result = await runSettlementCanary({
    product: "run",
    fetchImpl: (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("", {
          status: 402,
          headers: { "payment-required": encodeHeader(paymentRequired("run")) },
        });
      }
      throw new TypeError("simulated connection reset containing sensitive transport detail");
    }) as typeof fetch,
    payment: {
      createPaymentPayload: async () => {
        authorizations += 1;
        return { signed: "secret-payload" };
      },
      encodePaymentHeaders: () => ({ "PAYMENT-SIGNATURE": "secret-header" }),
    },
  });
  assert.equal(calls, 2);
  assert.equal(authorizations, 1);
  assert.equal(result.status, "AMBIGUOUS");
  assert.equal(result.requires_reconciliation, true);
  assert.equal(result.error_code, "AMBIGUOUS_AFTER_AUTHORIZATION");
  assert.equal(JSON.stringify(result).includes("sensitive"), false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("a failed authorization checkpoint prevents signed transport", async () => {
  let calls = 0;
  const result = await runSettlementCanary({
    product: "single",
    fetchImpl: (async () => {
      calls += 1;
      return new Response("", {
        status: 402,
        headers: { "payment-required": encodeHeader(paymentRequired("single")) },
      });
    }) as typeof fetch,
    payment: {
      createPaymentPayload: async () => ({ signed: "secret-payload" }),
      encodePaymentHeaders: () => ({ "PAYMENT-SIGNATURE": "secret-header" }),
    },
    onPaymentAuthorized: async () => {
      throw new Error("disk unavailable");
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "AMBIGUOUS");
  assert.equal(result.error_code, "AMBIGUOUS_AUTHORIZATION_CHECKPOINT_FAILED");
  assert.equal(result.requires_reconciliation, true);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("a settled payment with a broken product contract retains its public proof", async () => {
  let calls = 0;
  const result = await runSettlementCanary({
    product: "single",
    fetchImpl: (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("", {
          status: 402,
          headers: { "payment-required": encodeHeader(paymentRequired("single")) },
        });
      }
      return new Response(JSON.stringify(singleBody({ service_reuse: null })), {
        status: 200,
        headers: { "payment-response": settlementHeader() },
      });
    }) as typeof fetch,
    payment: {
      createPaymentPayload: async () => ({}),
      encodePaymentHeaders: () => ({ "PAYMENT-SIGNATURE": "redacted" }),
    },
  });
  assert.equal(result.status, "CONTRACT_FAILED");
  assert.equal(result.error_code, "SERVICE_REUSE_MISSING");
  assert.equal(result.transaction_hash, `0x${"ab".repeat(32)}`);
  assert.equal(result.requires_reconciliation, false);
});
