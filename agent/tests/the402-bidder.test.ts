import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAndBidThe402Request,
  parseThe402RequestCreated,
  selectThe402Bid,
} from "../src/the402-bidder.ts";

const event = {
  type: "request.created",
  posting_id: "post_run_123",
  title: "Diagnose why this GitHub Actions workflow failed",
  category: "developer-tools",
  budget_min_usd: 0.04,
  budget_max_usd: 1,
  required_tier: "unverified",
  deadline: null,
  created_at: "2026-07-20T17:00:00Z",
  expires_at: "2099-07-27T17:00:00Z",
  posting_url: "/v1/postings/post_run_123",
  bids_url: "/v1/postings/post_run_123/bids",
};

const posting = {
  posting_id: "post_run_123",
  is_subcontract: false,
  title: event.title,
  brief: { run_url: "https://github.com/openai/codex/actions/runs/29728148711" },
  category: event.category,
  budget_min_usd: event.budget_min_usd,
  budget_max_usd: event.budget_max_usd,
  deadline: null,
  status: "open",
  created_at: event.created_at,
  expires_at: event.expires_at,
  bid_count: 0,
};

test("the402 request parser pins the posting identity and platform-relative URLs", () => {
  assert.deepEqual(parseThe402RequestCreated(JSON.stringify(event)), {
    type: "request.created",
    posting_id: "post_run_123",
  });
  assert.equal(parseThe402RequestCreated(JSON.stringify({ type: "job_dispatch" })), null);
  assert.throws(() => parseThe402RequestCreated(JSON.stringify({ ...event, posting_id: "bad" })), /posting_id/);
  assert.throws(() => parseThe402RequestCreated(JSON.stringify({ ...event, bids_url: "https://evil.example/bids" })), /URLs/);
});

test("the402 bidder selects only exact existing-product briefs with explicit intent", () => {
  const decision = selectThe402Bid(posting, new Date("2026-07-20T18:00:00Z"));
  assert.equal(decision?.product, "run");
  assert.equal(decision?.service_id, "svc_cdd16073d02c4429");
  assert.equal(decision?.price_usd, 0.04);
  assert.equal(selectThe402Bid({ ...posting, title: "Write a CI article" }), null);
  assert.equal(selectThe402Bid({ ...posting, brief: { run_url: posting.brief.run_url, output: "markdown" } }), null);
  assert.equal(selectThe402Bid({ ...posting, status: "awarded" }), null);
  assert.equal(selectThe402Bid({ ...posting, budget_max_usd: 26 }), null);
  assert.equal(selectThe402Bid({ ...posting, expires_at: "2026-07-20T17:30:00Z" }, new Date("2026-07-20T18:00:00Z")), null);
});

test("the402 bidder disambiguates RunVerdict from FlakeVerdict and excludes SkillVerdict", () => {
  const flake = selectThe402Bid({
    ...posting,
    title: "Is this failed GitHub Actions run flaky and safe to retry?",
    brief: { run_url: posting.brief.run_url, attempt: 1 },
    budget_min_usd: 0.07,
  });
  assert.equal(flake?.product, "flake");
  assert.equal(flake?.service_id, "svc_565a2a5c8e154b6e");
  assert.equal(selectThe402Bid({
    ...posting,
    title: "Audit this agent skill before installation",
    brief: { repo_url: "https://github.com/openai/codex", skill_path: "skills/example" },
  }), null);
});

test("the402 request evaluation fetches one official posting and places one authenticated exact bid", async () => {
  const requests: Request[] = [];
  const result = await evaluateAndBidThe402Request({
    request: { type: "request.created", posting_id: "post_run_123" },
    api_key: "sk_test_provider_key_123",
    fetch_impl: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.method === "GET") return Response.json(posting);
      return Response.json({ bid_id: "bid_123" }, { status: 201 });
    },
  });
  assert.deepEqual(result, { action: "bid", posting_id: "post_run_123", product: "run" });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://api.the402.ai/v1/postings/post_run_123");
  assert.equal(requests[0].redirect, "error");
  assert.equal(requests[1].url, "https://api.the402.ai/v1/postings/post_run_123/bids");
  assert.equal(requests[1].headers.get("X-API-Key"), "sk_test_provider_key_123");
  assert.deepEqual(await requests[1].json(), {
    price_usd: 0.04,
    eta_hours: 1,
    service_id: "svc_cdd16073d02c4429",
    pitch: "GitHub Actions CI Failure Diagnosis — RunVerdict is an existing automated, evidence-linked service with a published exact input and deliverable contract. Delivery is within one hour and normally completes in seconds.",
  });
});

test("the402 request evaluation never bids on an unrelated posting", async () => {
  let calls = 0;
  const result = await evaluateAndBidThe402Request({
    request: { type: "request.created", posting_id: "post_run_123" },
    api_key: "sk_test_provider_key_123",
    fetch_impl: async () => {
      calls += 1;
      return Response.json({ ...posting, title: "Write a general HTTP explainer", brief: { objective: "Write 900 words" } });
    },
  });
  assert.deepEqual(result, { action: "ignored", posting_id: "post_run_123" });
  assert.equal(calls, 1);
});
