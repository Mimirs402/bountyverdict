import assert from "node:assert/strict";
import test from "node:test";
import app from "../src/index.ts";
import { BOUNTY_DISCOVERY_DESCRIPTION } from "../src/discovery.ts";
import { mcpDriftExampleInput } from "../src/mcp-drift-discovery.ts";

const env = {
  PAY_TO_ADDRESS: "0x1111111111111111111111111111111111111111",
  X402_NETWORK: "eip155:84532",
  X402_FACILITATOR_URL: "https://facilitator.invalid",
  FLAKE_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

const cases = [
  {
    product: "BountyVerdict",
    url: "/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fissues%2F1",
    method: "GET",
    decisions: ["AVOID", "CAUTION", "VIABLE"],
    skill: "preflight-github-bounties",
  },
  {
    product: "BountyVerdict Portfolio",
    url: "/api/portfolio",
    method: "POST",
    body: { issue_urls: ["https://github.com/owner/repo/issues/1", "https://github.com/owner/repo/issues/2"] },
    decisions: ["ranked_verdicts", "best_candidate", "counts", "partial_failures"],
    skill: "preflight-github-bounties",
  },
  {
    product: "HarnessVerdict",
    url: "/api/harness?repo_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo",
    method: "GET",
    decisions: ["READY", "REVIEW", "REPAIR"],
    skill: "audit-agent-harness",
  },
  {
    product: "SkillVerdict",
    url: "/api/skill?repo_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo&skill_path=skills%2Fexample",
    method: "GET",
    decisions: ["LOW_RISK", "REVIEW", "BLOCK"],
    skill: "preflight-agent-skills",
  },
  {
    product: "RunVerdict",
    url: "/api/run?run_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Factions%2Fruns%2F1",
    method: "GET",
    decisions: ["PASS", "WAIT", "RETRY", "FIX", "INVESTIGATE"],
    skill: "diagnose-github-actions",
  },
  {
    product: "FlakeVerdict",
    url: "/api/flake?run_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Factions%2Fruns%2F1&attempt=1",
    method: "GET",
    decisions: ["CONFIRMED_FLAKE", "LIKELY_FLAKE", "RECURRING_FAILURE", "NEW_FAILURE", "INCONCLUSIVE", "NOT_FAILED"],
    skill: "classify-github-flakes",
  },
] as const;

for (const preview of cases) {
  test(`${preview.product} unpaid response routes an agent before payment`, async () => {
    const response = await app.request(preview.url, {
      method: preview.method,
      headers: preview.method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: preview.method === "POST" ? JSON.stringify(preview.body) : undefined,
    }, env);
    assert.equal(response.status, 402);
    const body = await response.json() as any;
    assert.equal(body.error, "PAYMENT_REQUIRED");
    assert.equal(body.product, preview.product);
    assert.ok(body.use_when);
    assert.ok(body.not_for);
    assert.deepEqual(body.decision_returned, preview.decisions);
    assert.ok(body.why_pay);
    assert.match(body.free_sample, /^\/api\//);
    assert.equal(body.skill, `https://cristianmoroaica.github.io/bountyverdict/skills/${preview.skill}/SKILL.md`);
    assert.equal(body.documentation, "https://cristianmoroaica.github.io/bountyverdict/agents.html");
    assert.equal(body.payment.protocol, "x402 v2");
    assert.equal(body.payment.network, "Base");
    assert.equal(body.payment.asset, "USDC");
    assert.equal(body.payment.inspect_challenge_before_signing, true);
    assert.match(body.payment.max_amount_atomic, /^\d+$/);
    assert.equal(body.payment.exact_request.method, preview.method);
    assert.match(body.payment.exact_request.url, new RegExp(preview.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    if (preview.method === "POST") assert.deepEqual(body.payment.exact_request.body, preview.body);
    if (preview.method === "POST") assert.match(body.payment.exact_request.normalized_body_sha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(body.payment.authorization_scope, preview.method === "POST" ? "resource_url_not_post_body" : "resource_url");
    assert.equal(body.payment.agentic_wallet.executable, "npx");
    assert.deepEqual(body.payment.agentic_wallet.argv.slice(0, 4), [
      "awal@2.12.0",
      "x402",
      "pay",
      body.payment.exact_request.url,
    ]);
    assert.deepEqual(body.payment.agentic_wallet.argv.slice(-3), [
      "--max-amount",
      body.payment.max_amount_atomic,
      "--json",
    ]);
    assert.equal(body.payment.agentic_wallet.execute_as_argument_vector, true);
    assert.equal(body.payment.agentic_wallet.do_not_join_into_shell_string, true);
    assert.equal(body.payment.retry_semantics.payment_header, "Payment-Signature");
    assert.equal(body.payment.retry_semantics.never_raise_max_amount_without_new_authorization, true);
    assert.match(body.payment.execution_risk, /does not guarantee upstream success/);
  });
}

test("BountyVerdict challenge leads with exact eligibility and claimability intent", async () => {
  const response = await app.request(
    "/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fissues%2F1",
    {},
    env,
  );
  assert.equal(response.status, 402);
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded);
  const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  assert.equal(decoded.resource.description, BOUNTY_DISCOVERY_DESCRIPTION);
  assert.deepEqual(decoded.resource.tags, [
    "github",
    "bounty",
    "eligibility",
    "claimability",
    "already-claimed",
    "assignment-status",
    "due-diligence",
  ]);
});

test("invalid GET inputs are rejected before any payable challenge", async () => {
  const invalidCases = [
    ["/api/verdict", "BountyVerdict", ["issue_url"]],
    ["/api/harness?repo_url=https%3A%2F%2Fevil.example%2Frepo", "HarnessVerdict", ["repo_url"]],
    ["/api/skill?repo_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo", "SkillVerdict", ["repo_url", "skill_path"]],
    ["/api/run", "RunVerdict", ["run_url"]],
    ["/api/flake?run_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Factions%2Fruns%2F1&attempt=0", "FlakeVerdict", ["run_url"]],
  ] as const;
  for (const [url, product, required] of invalidCases) {
    const response = await app.request(url, {}, env);
    assert.equal(response.status, 400, `${product} must reject invalid input before x402`);
    assert.equal(response.headers.has("payment-required"), false);
    const body = await response.json() as any;
    assert.equal(body.product, product);
    assert.equal(body.payment_signature_present, false);
    assert.equal(body.payment_verified, false);
    assert.equal(body.payment_settled, false);
    assert.equal(body.payment_challenge_issued, false);
    assert.deepEqual(body.required_input.required, required);
    assert.match(body.free_sample, /^http:\/\/localhost\/api\//);
    assert.equal(body.openapi, "http://localhost/openapi.json");
    assert.match(body.retry, /without a payment signature/);
  }
});

test("Portfolio rejects malformed and bodyless calls before payment", async () => {
  const invalid = await app.request("/api/portfolio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ issue_urls: ["https://github.com/owner/repo/issues/1"] }),
  }, env);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.has("payment-required"), false);
  const invalidBody = await invalid.json() as any;
  assert.equal(invalidBody.error, "INVALID_PORTFOLIO_SIZE");
  assert.equal(invalidBody.payment_challenge_issued, false);

  const signedBodyless = await app.request("/api/portfolio", {
    method: "POST",
    headers: { "Payment-Signature": "owner-invalid-probe" },
  }, env);
  assert.equal(signedBodyless.status, 400);
  assert.equal(signedBodyless.headers.has("payment-required"), false);

  const discovery = await app.request("/api/portfolio", { method: "POST" }, env);
  assert.equal(discovery.status, 400);
  assert.equal(discovery.headers.has("payment-required"), false);
  const discoveryBody = await discovery.json() as any;
  assert.equal(discoveryBody.error, "INVALID_CONTENT_TYPE");
  assert.equal(discoveryBody.payment_challenge_issued, false);
});

test("invalid signed input and exhausted Flake capacity cannot reach payment verification", async () => {
  const invalidSigned = await app.request("/api/verdict", {
    headers: { "Payment-Signature": "invalid-but-present" },
  }, env);
  assert.equal(invalidSigned.status, 400);
  assert.equal(invalidSigned.headers.has("payment-required"), false);
  const invalidSignedBody = await invalidSigned.json() as any;
  assert.equal(invalidSignedBody.payment_signature_present, true);
  assert.equal(invalidSignedBody.payment_verified, false);
  assert.equal(invalidSignedBody.payment_settled, false);

  let capacityChecks = 0;
  const rateLimited = await app.request(
    "/api/flake?run_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Factions%2Fruns%2F1",
    { headers: { "Payment-Signature": "invalid-but-present" } },
    {
      ...env,
      FLAKE_RATE_LIMITER: {
        limit: async () => {
          capacityChecks += 1;
          return { success: false };
        },
      },
    },
  );
  assert.equal(capacityChecks, 1);
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.headers.get("retry-after"), "60");
  assert.equal(rateLimited.headers.has("payment-required"), false);
  const rateLimitedBody = await rateLimited.json() as any;
  assert.equal(rateLimitedBody.payment_signature_present, true);
  assert.equal(rateLimitedBody.payment_verified, false);
  assert.equal(rateLimitedBody.payment_settled, false);
});

test("MCPDriftVerdict unpaid response identifies the compatibility boundary", async () => {
  const response = await app.request("/api/mcp-drift", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mcpDriftExampleInput),
  }, env);
  assert.equal(response.status, 402);
  const body = await response.json() as any;
  assert.equal(body.product, "MCPDriftVerdict");
  assert.deepEqual(body.decision_returned, ["UNCHANGED", "SAFE_ADDITIVE", "REVIEW", "INCONCLUSIVE", "BREAKING", "SECURITY_REGRESSION"]);
  assert.match(body.not_for, /Malware or prompt-injection scanning/);
  assert.match(body.payment.request_binding, /authorizes the resource URL, not the POST body/);
  assert.match(body.payment.exact_request.normalized_body_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(body.payment.exact_request.body, mcpDriftExampleInput);
  assert.ok(body.payment.agentic_wallet.argv.includes(JSON.stringify(mcpDriftExampleInput)));
  assert.equal(body.payment.max_amount_atomic, "20000");
  assert.equal(body.skill, "https://cristianmoroaica.github.io/bountyverdict/skills/check-mcp-tool-drift/SKILL.md");
});
