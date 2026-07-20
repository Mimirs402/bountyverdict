import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFunnelTailEvent,
  createFunnelSnapshot,
  isFunnelSnapshot,
  recordFunnelObservation,
} from "../src/funnel-telemetry.ts";

function event(path: string, status: number, headers: Record<string, string> = {}, method = "GET") {
  return {
    scriptName: "bountyverdict-agent-production",
    eventTimestamp: Date.parse("2026-07-20T20:00:00.000Z"),
    event: {
      request: {
        url: `https://bountyverdict-agent-production.mimirslab.workers.dev${path}`,
        method,
        headers: {
          ...headers,
          "cf-connecting-ip": "192.0.2.10",
          "x-private-example": "must-never-persist",
        },
      },
      response: { status },
    },
  };
}

test("classifies an external directory challenge without retaining raw request data", () => {
  const observation = classifyFunnelTailEvent(event(
    "/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Facme%2Frepo%2Fissues%2F1",
    402,
    { "user-agent": "Mozilla/5.0 (compatible; Agent402/1.0)" },
  ));
  assert.deepEqual(observation, {
    observed_at: "2026-07-20T20:00:00.000Z",
    product: "single",
    source: "known_directory",
    outcome: "challenge_402",
    signed_request: false,
  });
  const serialized = JSON.stringify(observation);
  assert.doesNotMatch(serialized, /192\.0\.2\.10|must-never-persist|github\.com|Agent402/);
});

test("records signed successes as funnel evidence rather than purchase proof", () => {
  const observation = classifyFunnelTailEvent(event(
    "/api/portfolio",
    200,
    { "payment-signature": "sensitive", "user-agent": "undici" },
    "POST",
  ));
  assert.ok(observation);
  const snapshot = recordFunnelObservation(createFunnelSnapshot("2026-07-20T19:00:00.000Z"), observation);
  assert.equal(snapshot.totals.requests, 1);
  assert.equal(snapshot.totals.signed_requests, 1);
  assert.equal(snapshot.totals.signed_successes, 1);
  assert.equal(snapshot.by_product.portfolio.signed_successes, 1);
  assert.equal(snapshot.by_source.automated_client.requests, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /sensitive|payment-signature/);
  assert.equal(isFunnelSnapshot(snapshot), true);
});

test("ignores samples, internal routes, wrong methods, hosts, and scripts", () => {
  assert.equal(classifyFunnelTailEvent(event("/api/sample", 200)), null);
  assert.equal(classifyFunnelTailEvent(event("/_internal/canary/single", 200)), null);
  assert.equal(classifyFunnelTailEvent(event("/api/portfolio", 402, {}, "GET")), null);
  assert.equal(classifyFunnelTailEvent({ ...event("/api/verdict", 402), scriptName: "other" }), null);
  const otherHost = event("/api/verdict", 402);
  otherHost.event.request.url = "https://example.com/api/verdict";
  assert.equal(classifyFunnelTailEvent(otherHost), null);
});

test("separates owner automation from external challenge counts", () => {
  const observation = classifyFunnelTailEvent(event(
    "/api/harness?repo_url=https%3A%2F%2Fgithub.com%2Fopenai%2Fcodex",
    402,
    { "user-agent": "bountyverdict-funnel-smoke/1.0" },
  ));
  assert.ok(observation);
  const snapshot = recordFunnelObservation(createFunnelSnapshot(), observation);
  assert.equal(snapshot.by_source.owner_automation.challenges_402, 1);
  assert.equal(snapshot.by_source.known_directory.challenges_402, 0);
});
