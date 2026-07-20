import assert from "node:assert/strict";
import test from "node:test";
import {
  parseThe402JobDispatch,
  parseThe402ServiceMap,
  reportThe402Result,
  verifyThe402Webhook,
} from "../src/the402.ts";
import {
  THE402_LISTINGS,
  THE402_PROVIDER_CATALOG_URL,
  THE402_SUBSCRIPTION_PLAN,
} from "../src/the402-catalog.ts";
import { outputSchema, portfolioOutputSchema } from "../src/discovery.ts";
import { harnessOutputSchema } from "../src/harness-discovery.ts";
import { runOutputSchema } from "../src/run-discovery.ts";
import { flakeOutputSchema } from "../src/flake-discovery.ts";
import { mcpDriftOutputSchema } from "../src/mcp-drift-discovery.ts";

const apiKey = "sk_test_bountyverdict_provider";
const webhookSecret = "whsec_test_bountyverdict_webhook";
const serviceMap = parseThe402ServiceMap(JSON.stringify({ svc_bounty_123: "single" }));
const body = JSON.stringify({
  type: "job_dispatch",
  job_id: "job_123",
  service_id: "svc_bounty_123",
  brief: { issue_url: "https://github.com/typeorm/typeorm/issues/3357" },
  callback_url: "https://api.the402.ai/v1/threads/thread_123/update",
});

test("the402 monthly bundle contains only the six existing non-SkillVerdict services", () => {
  assert.equal(THE402_SUBSCRIPTION_PLAN.interval, "monthly");
  assert.equal(THE402_SUBSCRIPTION_PLAN.plan_id, "plan_ec6c49878dc34636");
  assert.equal(THE402_SUBSCRIPTION_PLAN.provider_price_usd, 1);
  assert.equal(THE402_SUBSCRIPTION_PLAN.agent_price_usd, 1.05);
  assert.equal(THE402_SUBSCRIPTION_PLAN.max_requests, 20);
  assert.deepEqual(
    [...THE402_SUBSCRIPTION_PLAN.service_ids].sort(),
    THE402_LISTINGS.map(({ service_id }) => service_id).sort(),
  );
  assert.equal(THE402_SUBSCRIPTION_PLAN.service_ids.length, 6);
  assert.match(THE402_SUBSCRIPTION_PLAN.description, /SkillVerdict is not included/);
});

async function signature(timestamp: string, rawBody = body): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  ));
  return `sha256=${[...signed].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

test("the402 service map permits only independently distributed existing products", () => {
  assert.equal(serviceMap.get("svc_bounty_123"), "single");
  assert.throws(() => parseThe402ServiceMap("{}"), /at least one/);
  assert.throws(() => parseThe402ServiceMap(JSON.stringify({ bad: "single" })), /service ID/);
  assert.throws(() => parseThe402ServiceMap(JSON.stringify({ svc_skill_123: "skill" })), /unsupported product/);
  assert.throws(() => parseThe402ServiceMap(JSON.stringify({ svc_one: "run", svc_two: "run" })), /duplicate product/);
});

test("the402 publishes six exact existing-product contracts and excludes SkillVerdict", () => {
  assert.equal(THE402_LISTINGS.length, 6);
  assert.equal(new Set(THE402_LISTINGS.map(({ service_id }) => service_id)).size, 6);
  assert.deepEqual(THE402_LISTINGS.map(({ product }) => product).sort(), [
    "flake", "harness", "mcpdrift", "portfolio", "run", "single",
  ]);
  assert.equal(THE402_LISTINGS.some(({ name }) => name === "SkillVerdict"), false);
  assert.match(THE402_PROVIDER_CATALOG_URL, /provider=p_d4b4ece39162409b/);
  const schemas = new Map(THE402_LISTINGS.map(({ product, deliverable_schema }) => [product, deliverable_schema]));
  assert.deepEqual(schemas.get("single"), { type: "object", ...outputSchema });
  assert.deepEqual(schemas.get("portfolio"), { type: "object", ...portfolioOutputSchema });
  assert.deepEqual(schemas.get("harness"), { type: "object", ...harnessOutputSchema });
  assert.deepEqual(schemas.get("run"), { type: "object", ...runOutputSchema });
  assert.deepEqual(schemas.get("flake"), { type: "object", ...flakeOutputSchema });
  assert.deepEqual(schemas.get("mcpdrift"), { type: "object", ...mcpDriftOutputSchema });
  for (const listing of THE402_LISTINGS) {
    assert.notDeepEqual(listing.deliverable_schema, { type: "object", additionalProperties: true });
    assert.ok(Array.isArray(listing.deliverable_schema.required));
  }
});

test("the402 webhook verification pins API key, HMAC body, and five-minute replay window", async () => {
  const nowMs = Date.parse("2026-07-20T17:00:00.000Z");
  const timestamp = String(Math.floor(nowMs / 1000));
  const signatureHeader = await signature(timestamp);
  const common = {
    raw_body: body,
    api_key_header: apiKey,
    signature_header: signatureHeader,
    timestamp_header: timestamp,
    api_key: apiKey,
    webhook_secret: webhookSecret,
    now_ms: nowMs,
  };
  assert.equal(await verifyThe402Webhook(common), true);
  assert.equal(await verifyThe402Webhook({ ...common, api_key_header: `${apiKey}x` }), false);
  assert.equal(await verifyThe402Webhook({ ...common, raw_body: `${body} ` }), false);
  assert.equal(await verifyThe402Webhook({ ...common, now_ms: nowMs + 301_000 }), false);
});

test("the402 dispatch parser binds a known service and exact callback origin", () => {
  const job = parseThe402JobDispatch(body, serviceMap);
  assert.equal(job?.product, "single");
  assert.equal(job?.job_id, "job_123");
  assert.equal(parseThe402JobDispatch(JSON.stringify({ type: "thread_inquiry" }), serviceMap), null);
  assert.throws(() => parseThe402JobDispatch(body.replace("api.the402.ai", "evil.example"), serviceMap), /callback_url/);
  assert.throws(() => parseThe402JobDispatch(body.replace("svc_bounty_123", "svc_unknown_123"), serviceMap), /unknown service/);
});

test("the402 result callback cannot redirect or leave the platform API", async () => {
  let captured: Request | null = null;
  await reportThe402Result({
    callback_url: "https://api.the402.ai/v1/jobs/job_123/update",
    api_key: apiKey,
    status: "completed",
    deliverables: { verdict: "VIABLE" },
    notes: "fulfilled",
    fetch_impl: async (input, init) => {
      captured = new Request(input, init);
      return new Response(null, { status: 200 });
    },
  });
  assert.ok(captured);
  assert.equal(captured.headers.get("X-API-Key"), apiKey);
  assert.equal((await captured.json()).status, "completed");
  assert.equal(captured.redirect, "error");
  await assert.rejects(() => reportThe402Result({
    callback_url: "https://example.com/v1/jobs/job_123/update",
    api_key: apiKey,
    status: "failed",
    notes: "failed",
  }), /callback_url/);
});
