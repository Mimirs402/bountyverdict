import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  AGENTMRR_PRODUCT,
  AGENTMRR_REQUIRED_RELEASE_COMMIT,
  AGENTMRR_ROTATION_REASON,
  isAgentMrrUuid,
  parseAgentMrrCatalog,
  parseAgentMrrChallenge,
  parseAgentMrrPublishedProduct,
  parseAgentMrrRegistration,
  parseAgentMrrSecret,
  readAgentMrrJsonResponse,
  solveAgentMrrChallenge,
  validateAgentMrrPublicationGate,
} from "../src/agentmrr.ts";

const id = "11111111-1111-4111-8111-111111111111";
const ownerId = "33333333-3333-4333-8333-333333333333";

function product(overrides: Record<string, unknown> = {}) {
  return { id, submitted_by: ownerId, ...AGENTMRR_PRODUCT, ...overrides };
}

function funnelBaseline(epochId: number, capture = "capture-a") {
  return {
    schema_version: 1,
    epoch_id: epochId,
    initialized_at: "2026-07-22T07:00:00.000Z",
    reason: "test baseline",
    funnel_capture_started_at: capture,
    funnel_schema_version: 2,
    funnel_observed_through: "2026-07-22T07:00:00.000Z",
    funnel_collector_heartbeat_at: "2026-07-22T07:00:00.000Z",
    cohort_capture_started_at: "cohort-a",
    counters: {},
    external_by_product: {},
    by_channel: {},
    by_client_class: {},
    external_discovery_by_surface: {},
  };
}

test("AgentMRR proof-of-work is bounded and satisfies the advertised challenge", () => {
  const challenge = parseAgentMrrChallenge({
    nonce: "ebc834f4f333c5627579edc054066e60",
    difficulty: 2,
  });
  const solution = solveAgentMrrChallenge(challenge, 10_000);
  const digest = createHash("sha256").update(challenge.nonce + solution).digest("hex");
  assert.ok(digest.startsWith("00"));
  assert.throws(() => parseAgentMrrChallenge({ nonce: "unsafe", difficulty: 2 }), /nonce/);
  assert.throws(() => parseAgentMrrChallenge({ nonce: "a".repeat(32), difficulty: 9 }), /difficulty/);
  assert.throws(() => solveAgentMrrChallenge(challenge, 0), /iteration bound/);
});

test("AgentMRR registration accepts only a bounded agent identity and secret", () => {
  assert.deepEqual(parseAgentMrrRegistration({
    agent_id: id,
    api_key: "ah_1234567890abcdef",
  }), { agentId: id, apiKey: "ah_1234567890abcdef" });
  assert.throws(() => parseAgentMrrRegistration({ agent_id: id, api_key: "wrong" }), /API key/);
  assert.throws(() => parseAgentMrrRegistration({ agent_id: "wrong", api_key: "ah_1234567890abcdef" }), /identity/);
  assert.throws(() => parseAgentMrrRegistration({ agent_id: "-".repeat(36), api_key: "ah_1234567890abcdef" }), /identity/);
  assert.equal(isAgentMrrUuid("-".repeat(36)), false);
  assert.deepEqual(parseAgentMrrSecret(
    `AGENTMRR_AGENT_ID=${id}\nAGENTMRR_API_KEY=ah_1234567890abcdef\n`,
  ), { agentId: id, apiKey: "ah_1234567890abcdef" });
  assert.throws(() => parseAgentMrrSecret(`AGENTMRR_AGENT_ID=${id}\nAGENTMRR_API_KEY=ah_${"a".repeat(129)}\n`), /invalid/);
});

test("AgentMRR product contract exposes the existing RunVerdict task without inventing a product", () => {
  assert.equal(AGENTMRR_PRODUCT.name, "RunVerdict");
  assert.equal(AGENTMRR_PRODUCT.type, "api");
  assert.equal(AGENTMRR_PRODUCT.pricing_model, "paid");
  assert.equal(AGENTMRR_PRODUCT.github_url, "https://github.com/Mimirs402/bountyverdict");
  assert.match(AGENTMRR_PRODUCT.description, /\{"run_url":"https:\/\/github\.com\/OWNER\/REPO\/actions\/runs\/ID"\}/);
  assert.match(AGENTMRR_PRODUCT.description, /\/api\/github-actions-run-diagnosis/);
  assert.match(AGENTMRR_PRODUCT.description, /\$0\.04 Base USDC/);
  assert.match(AGENTMRR_PRODUCT.description, /diagnose_github_actions_run/);
  assert.match(AGENTMRR_PRODUCT.description, /secret-like excerpts/);
  assert.doesNotMatch(`${AGENTMRR_PRODUCT.tagline} ${AGENTMRR_PRODUCT.description}`, /safe|recommends one retry/);
  assert.deepEqual(AGENTMRR_PRODUCT.tags, ["github-actions", "ci-cd", "debugging", "coding-agents", "x402", "mcp"]);
});

test("AgentMRR catalog parsing prevents duplicates, drift, and incomplete scans", () => {
  assert.equal(parseAgentMrrCatalog({ products: [], total: 0, sort: "newest" }), null);
  assert.deepEqual(parseAgentMrrCatalog({ products: [product()], total: 1, sort: "newest" }), {
    id,
    name: AGENTMRR_PRODUCT.name,
    exact: true,
    submittedBy: ownerId,
  });
  assert.equal(parseAgentMrrCatalog({
    products: [product({ tagline: "drifted" })],
    total: 1,
    sort: "newest",
  })?.exact, false);
  assert.throws(() => parseAgentMrrCatalog({
    products: [product(), product({ id: "22222222-2222-4222-8222-222222222222" })],
    total: 2,
    sort: "newest",
  }), /duplicate/);
  assert.throws(() => parseAgentMrrCatalog({ products: [], total: 1_000, sort: "newest", has_more: true }), /invalid or unbounded/);
  assert.throws(() => parseAgentMrrCatalog({ products: [], total: 0, sort: "newest", next_cursor: "next" }), /invalid or unbounded/);
  assert.throws(() => parseAgentMrrCatalog({
    products: Array.from({ length: 10 }, (_, index) => ({ id: index })),
    total: 10,
    sort: "newest",
  }, 10), /incomplete/);
  assert.throws(() => parseAgentMrrCatalog({ products: "wrong" }), /invalid or unbounded/);
});

test("AgentMRR publication response must echo the exact reviewed product", () => {
  assert.deepEqual(parseAgentMrrPublishedProduct({ product: product() }, ownerId), {
    id,
    name: AGENTMRR_PRODUCT.name,
    exact: true,
    submittedBy: ownerId,
  });
  assert.throws(() => parseAgentMrrPublishedProduct(
    { product: product({ docs_url: "https://wrong.example" }) },
    ownerId,
  ), /drifted/);
  assert.throws(() => parseAgentMrrPublishedProduct(
    { product: product({ submitted_by: "44444444-4444-4444-8444-444444444444" }) },
    ownerId,
  ), /drifted/);
});

test("AgentMRR publication waits for the reviewed release and a draining funnel epoch", () => {
  const now = new Date("2026-07-22T07:00:30.000Z");
  const rotationId = "agentmrr-publish-mdfh1234-0123456789abcdef";
  const valid = {
    releaseState: { schema_version: 1, status: "complete", release_commit: AGENTMRR_REQUIRED_RELEASE_COMMIT },
    releaseMode: 0o600,
    releaseOwnerUid: 1000,
    baselineMode: 0o600,
    baselineOwnerUid: 1000,
    historyMode: 0o600,
    historyOwnerUid: 1000,
    expectedUid: 1000,
    trustedBaseline: funnelBaseline(40),
    baselineEpochId: 40,
    expectedRotationId: rotationId,
    now,
    funnelLedger: {
      schema_version: 2,
      active_epoch_id: 40,
      epochs: [{
        id: 40,
        status: "draining",
        conversion_eligible: false,
        baseline: funnelBaseline(40),
      }],
      rotation: {
        id: rotationId,
        status: "draining",
        requested_at: "2026-07-22T07:00:00.000Z",
        last_observed_at: "2026-07-22T07:00:00.000Z",
        observations: 1,
        target_epoch_id: 41,
        reason: AGENTMRR_ROTATION_REASON,
        candidate: funnelBaseline(41),
      },
    },
  };
  assert.doesNotThrow(() => validateAgentMrrPublicationGate(valid));
  assert.throws(() => validateAgentMrrPublicationGate({ ...valid, releaseMode: 0o644 }), /reviewed release/);
  assert.throws(() => validateAgentMrrPublicationGate({
    ...valid,
    releaseState: { ...valid.releaseState, release_commit: "wrong" },
  }), /reviewed release/);
  assert.throws(() => validateAgentMrrPublicationGate({
    ...valid,
    funnelLedger: { ...valid.funnelLedger, rotation: { ...valid.funnelLedger.rotation, status: "activated" } },
  }), /draining rotation/);
  assert.throws(() => validateAgentMrrPublicationGate({
    ...valid,
    funnelLedger: { ...valid.funnelLedger, active_epoch_id: 39 },
  }), /draining rotation/);
  assert.throws(() => validateAgentMrrPublicationGate({
    ...valid,
    funnelLedger: { ...valid.funnelLedger, epochs: [] },
  }), /draining rotation/);
  assert.throws(() => validateAgentMrrPublicationGate({
    ...valid,
    funnelLedger: {
      ...valid.funnelLedger,
      epochs: [{ ...valid.funnelLedger.epochs[0], baseline: { schema_version: 1, epoch_id: 40 } }],
    },
  }), /draining rotation/);
  assert.throws(() => validateAgentMrrPublicationGate({
    ...valid,
    funnelLedger: {
      ...valid.funnelLedger,
      epochs: [{ ...valid.funnelLedger.epochs[0], baseline: funnelBaseline(40, "capture-drift") }],
    },
  }), /draining rotation/);
  assert.throws(() => validateAgentMrrPublicationGate({
    ...valid,
    funnelLedger: {
      ...valid.funnelLedger,
      epochs: [{ ...valid.funnelLedger.epochs[0], conversion_eligible: true }],
    },
  }), /draining rotation/);
  assert.throws(() => validateAgentMrrPublicationGate({
    ...valid,
    funnelLedger: {
      ...valid.funnelLedger,
      rotation: { ...valid.funnelLedger.rotation, reason: "unrelated drain" },
    },
  }), /draining rotation/);
  assert.throws(() => validateAgentMrrPublicationGate({
    ...valid,
    now: new Date("2026-07-22T07:06:00.000Z"),
  }), /draining rotation/);
  assert.throws(() => validateAgentMrrPublicationGate({ ...valid, historyMode: 0o644 }), /reviewed release/);
});

test("AgentMRR response parsing rejects oversized and malformed JSON bodies", async () => {
  assert.deepEqual(await readAgentMrrJsonResponse(new Response('{"ok":true}', {
    headers: { "content-type": "application/json" },
  }), "fixture", 32), { ok: true });
  await assert.rejects(readAgentMrrJsonResponse(new Response(`{"value":"${"x".repeat(64)}"}`, {
    headers: { "content-type": "application/json" },
  }), "fixture", 32), /byte limit/);
  await assert.rejects(readAgentMrrJsonResponse(new Response("not-json", {
    headers: { "content-type": "application/json" },
  }), "fixture", 32), /invalid JSON/);
});

test("AgentMRR scripts keep credentials private and expose no self-promotion action", async () => {
  const [registerScript, publishScript] = await Promise.all([
    readFile(new URL("../scripts/agentmrr-register.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/agentmrr-publish.ts", import.meta.url), "utf8"),
  ]);
  assert.match(registerScript, /open\(secretFile, constants\.O_RDONLY \| constants\.O_NOFOLLOW\)/);
  assert.match(registerScript, /open\(registrationLockFile, "wx", 0o600\)/);
  assert.match(registerScript, /open\(secretFile, "wx", 0o600\)/);
  assert.match(registerScript, /Buffer\.alloc\(512\)/);
  assert.ok(registerScript.indexOf("Buffer.alloc(512)") < registerScript.indexOf('method: "POST"'));
  assert.doesNotMatch(registerScript, /AGENTMRR_SECRET_FILE|chmod\(/);
  assert.match(publishScript, /open\(path, constants\.O_RDONLY \| constants\.O_NOFOLLOW\)/);
  assert.match(publishScript, /open\(publicationLockFile, "wx", 0o600\)/);
  assert.match(publishScript, /open\(funnelLockFile, "wx", 0o600\)/);
  assert.match(publishScript, /validateAgentMrrPublicationGate/);
  assert.doesNotMatch(`${registerScript}\n${publishScript}`, /\/vote|\/try|upvote|downvote/);
});
