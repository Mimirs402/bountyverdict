import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFunnelTailEvent,
  classifyDiscoveryTailEvent,
  classifyMcpTailEvents,
  createFunnelSnapshot,
  isFunnelSnapshot,
  loadFunnelSnapshot,
  recordDiscoveryObservation,
  recordFunnelObservation,
  recordMcpObservation,
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
    client_class: "agent402",
    channel: "agent402",
    input_profile: "complete_expected",
    payment_carrier: "none",
    response_preference: "unspecified_or_other",
    outcome: "challenge_402",
    signed_request: false,
  });
  const serialized = JSON.stringify(observation);
  assert.doesNotMatch(serialized, /192\.0\.2\.10|must-never-persist|github\.com|Agent402/);
});

test("learns MCP conversion stages without retaining tool arguments or request identity", () => {
  const value = event("/mcp?private=discard", 200, {
    "user-agent": "Codex/99 private-build",
    referer: "https://github.com/private/repository?token=secret",
  }, "POST");
  Object.assign(value, {
    logs: [
      { message: [JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 2, stage: "payment_required", product: "single", source: "external", client_family: "not_applicable" })] },
      { message: JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 2, stage: "validation_error", product: "mcpdrift", source: "external", client_family: "not_applicable" }) },
      { message: ["private raw console output", { secret: true }] },
    ],
  });
  const observations = classifyMcpTailEvents(value);
  assert.deepEqual(observations.map(({ stage, product, source, client_class, channel }) => ({ stage, product, source, client_class, channel })), [
    { stage: "payment_required", product: "single", source: "automated_client", client_class: "agent_runtime", channel: "github" },
    { stage: "validation_error", product: "mcpdrift", source: "automated_client", client_class: "agent_runtime", channel: "github" },
  ]);
  const snapshot = createFunnelSnapshot("2026-07-20T19:00:00.000Z");
  for (const observation of observations) recordMcpObservation(snapshot, observation);
  assert.equal(snapshot.mcp_totals.events, 2);
  assert.equal(snapshot.mcp_totals.payment_required, 1);
  assert.equal(snapshot.mcp_totals.validation_error, 1);
  assert.equal(snapshot.mcp_by_product.single.payment_required, 1);
  assert.equal(snapshot.mcp_by_product.mcpdrift.validation_error, 1);
  assert.equal(snapshot.mcp_by_product_source.single.automated_client.payment_required, 1);
  assert.equal(snapshot.mcp_by_source.automated_client.events, 2);
  assert.equal(snapshot.mcp_by_client_class.agent_runtime.events, 2);
  assert.equal(snapshot.mcp_by_client_family.not_applicable.events, 2);
  assert.equal(snapshot.mcp_by_channel.github.events, 2);
  assert.equal(snapshot.mcp_by_day["2026-07-20"].events, 2);
  assert.equal(snapshot.mcp_by_hour["2026-07-20T20"].events, 2);
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /private|repository|token|secret|Codex|private-build/);
  assert.equal(isFunnelSnapshot(snapshot), true);
});

test("retains only an allowlisted MCP initialize client family", () => {
  const value = event("/mcp", 200, { "user-agent": "private-client/123" }, "POST");
  Object.assign(value, { logs: [{ message: [JSON.stringify({
    type: "bountyverdict_mcp_funnel",
    schema_version: 2,
    stage: "initialize",
    product: null,
    source: "external",
    client_family: "codex",
  })] }] });
  const observations = classifyMcpTailEvents(value);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].client_family, "codex");
  const snapshot = recordMcpObservation(createFunnelSnapshot("2026-07-20T19:00:00.000Z"), observations[0]);
  assert.equal(snapshot.mcp_by_client_family.codex.initialize, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /private-client|123/);
  assert.equal(isFunnelSnapshot(snapshot), true);
});

test("rejects malformed, forged, and identity-inconsistent MCP log events", () => {
  const value = event("/mcp", 200, { "user-agent": "bountyverdict-owner-audit/1" }, "POST");
  Object.assign(value, { logs: [
    { message: [JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 1, stage: "paid_success", product: "single", source: "external" })] },
    { message: [JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 1, stage: "initialize", product: "single", source: "owner_automation" })] },
    { message: [JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 1, stage: "paid_success", product: "skill", source: "owner_automation" })] },
    { message: [JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 1, stage: "tools_list", product: null, source: "owner_automation", raw: "forbidden" })] },
  ] });
  assert.deepEqual(classifyMcpTailEvents(value), []);
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
  assert.equal(snapshot.by_client_class.agent_runtime.requests, 1);
  assert.equal(snapshot.by_channel.direct_or_hidden.requests, 1);
  assert.equal(snapshot.by_input_profile.body_unobservable.requests, 1);
  assert.equal(snapshot.by_payment_carrier.payment_signature_v2.requests, 1);
  assert.equal(snapshot.by_response_preference.unspecified_or_other.requests, 1);
  assert.equal(snapshot.by_product_source.portfolio.automated_client.signed_successes, 1);
  assert.equal(snapshot.by_cohort["portfolio|direct_or_hidden|agent_runtime|body_unobservable|payment_signature_v2|unspecified_or_other"].signed_successes, 1);
  assert.equal(snapshot.by_day["2026-07-20"].signed_successes, 1);
  assert.equal(snapshot.by_hour["2026-07-20T20"].signed_successes, 1);
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
  const paymentProbe = classifyFunnelTailEvent(event(
    "/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Facme%2Frepo%2Fissues%2F1",
    402,
    { "user-agent": "bountyverdict-payment-smoke/1.0" },
  ));
  assert.equal(paymentProbe?.source, "owner_automation");
  const ownerAudit = classifyFunnelTailEvent(event(
    "/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Facme%2Frepo%2Fissues%2F1",
    402,
    { "user-agent": "bountyverdict-owner-audit/1.0" },
  ));
  assert.equal(ownerAudit?.source, "owner_automation");
});

test("learns only coarse channel, client, input, payment, and response dimensions", () => {
  const observation = classifyFunnelTailEvent(event(
    "/api/skill?repo_url=https%3A%2F%2Fgithub.com%2Facme%2Fsecret-repo&skill_path=skills%2Freviewer",
    402,
    {
      "user-agent": "Codex/9.9 private-build",
      referer: "https://402index.io/service/private-id?token=secret",
      accept: "application/json",
      "x-sensitive": "do-not-store",
    },
  ));
  assert.ok(observation);
  assert.equal(observation.client_class, "agent_runtime");
  assert.equal(observation.channel, "index_402");
  assert.equal(observation.input_profile, "complete_expected");
  assert.equal(observation.payment_carrier, "none");
  assert.equal(observation.response_preference, "json");
  const serialized = JSON.stringify(observation);
  assert.doesNotMatch(serialized, /acme|secret-repo|reviewer|private-id|token|private-build|do-not-store/);
});

test("attributes Agent Plugins catalog referrals without retaining the page", () => {
  const observation = classifyFunnelTailEvent(event(
    "/api/run?run_url=https%3A%2F%2Fgithub.com%2Facme%2Frepo%2Factions%2Fruns%2F123",
    402,
    { referer: "https://dmgrok.github.io/agent-plugins/?q=private-search" },
  ));
  assert.equal(observation?.channel, "agent_plugins");
  assert.doesNotMatch(JSON.stringify(observation), /private-search|dmgrok/);
});

test("distinguishes missing and malformed GET inputs without retaining values", () => {
  const missing = classifyFunnelTailEvent(event("/api/run", 402, { "user-agent": "curl/8" }));
  const malformed = classifyFunnelTailEvent(event(
    "/api/flake?run_url=https%3A%2F%2Fevil.example%2Factions%2Fruns%2F1",
    402,
  ));
  assert.equal(missing?.input_profile, "missing_required");
  assert.equal(malformed?.input_profile, "malformed_expected");
  assert.equal(missing?.client_class, "generic_automation");
});

test("detects legacy and ambiguous payment carriers without retaining payloads", () => {
  const legacy = classifyFunnelTailEvent(event(
    "/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Facme%2Frepo%2Fissues%2F1",
    200,
    { "x-payment": "legacy-secret" },
  ));
  const ambiguous = classifyFunnelTailEvent(event(
    "/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Facme%2Frepo%2Fissues%2F1",
    400,
    { "x-payment": "legacy-secret", "payment-signature": "v2-secret" },
  ));
  assert.equal(legacy?.payment_carrier, "x_payment_legacy");
  assert.equal(legacy?.outcome, "signed_success");
  assert.equal(ambiguous?.payment_carrier, "ambiguous_multiple");
  assert.equal(ambiguous?.outcome, "preflight_rejection");
  assert.doesNotMatch(JSON.stringify([legacy, ambiguous]), /legacy-secret|v2-secret/);
});

test("migrates v1 aggregate telemetry without fabricating enhanced dimensions", () => {
  const v1 = {
    schema_version: 1,
    capture_started_at: "2026-07-20T19:00:00.000Z",
    updated_at: "2026-07-20T20:00:00.000Z",
    totals: { requests: 2, challenges_402: 2, signed_requests: 0, signed_successes: 0, preflight_rejections: 0, rate_limited: 0, server_errors: 0, other: 0 },
    by_product: Object.fromEntries(["single", "portfolio", "harness", "skill", "run", "flake", "mcpdrift"].map((product) =>
      [product, { requests: product === "single" ? 2 : 0, challenges_402: product === "single" ? 2 : 0, signed_requests: 0, signed_successes: 0, preflight_rejections: 0, rate_limited: 0, server_errors: 0, other: 0 }]
    )),
    by_source: Object.fromEntries(["owner_automation", "known_directory", "automated_client", "interactive_client", "unknown"].map((source) =>
      [source, { requests: source === "owner_automation" ? 2 : 0, challenges_402: source === "owner_automation" ? 2 : 0, signed_requests: 0, signed_successes: 0, preflight_rejections: 0, rate_limited: 0, server_errors: 0, other: 0 }]
    )),
  };
  const migrated = loadFunnelSnapshot(v1, "2026-07-21T00:00:00.000Z");
  assert.ok(migrated);
  assert.equal(migrated.schema_version, 2);
  assert.equal(migrated.capture_started_at, v1.capture_started_at);
  assert.equal(migrated.enhanced_capture_started_at, "2026-07-21T00:00:00.000Z");
  assert.equal(migrated.by_client_class.legacy_unclassified.requests, 2);
  assert.equal(migrated.by_channel.legacy_unclassified.requests, 2);
  assert.equal(isFunnelSnapshot(migrated), true);
});

test("learns agent discovery surfaces including useful missing-convention probes", () => {
  const openapi = classifyDiscoveryTailEvent(event(
    "/openapi.json?ignored=private",
    200,
    { "user-agent": "x402-observer/1.0", accept: "application/json" },
  ));
  const conventionProbe = classifyDiscoveryTailEvent(event(
    "/.well-known/x402",
    404,
    { "user-agent": "Agent402/1.0", referer: "https://example.net/private/path" },
  ));
  assert.ok(openapi);
  assert.ok(conventionProbe);
  assert.equal(openapi.surface, "openapi");
  assert.equal(openapi.client_class, "x402_observer");
  assert.equal(openapi.response_preference, "json");
  assert.equal(conventionProbe.surface, "well_known_x402_probe");
  assert.equal(conventionProbe.outcome, "preflight_rejection");
  assert.equal(conventionProbe.channel, "other_referrer");
  const snapshot = createFunnelSnapshot("2026-07-20T19:00:00.000Z");
  recordDiscoveryObservation(snapshot, openapi);
  recordDiscoveryObservation(snapshot, conventionProbe);
  assert.equal(snapshot.discovery_totals.requests, 2);
  assert.equal(snapshot.by_discovery_surface.openapi.requests, 1);
  assert.equal(snapshot.by_discovery_surface.well_known_x402_probe.preflight_rejections, 1);
  assert.equal(snapshot.by_discovery_client_class.agent402.requests, 1);
  assert.equal(snapshot.by_discovery_surface_source.well_known_x402_probe.known_directory.requests, 1);
  assert.equal(snapshot.by_discovery_cohort["openapi|x402_observer|x402_observer|json"].requests, 1);
  assert.equal(snapshot.by_discovery_cohort["well_known_x402_probe|other_referrer|agent402|unspecified_or_other"].preflight_rejections, 1);
  assert.equal(snapshot.discovery_by_day["2026-07-20"].requests, 2);
  assert.equal(snapshot.discovery_by_hour["2026-07-20T20"].requests, 2);
  assert.doesNotMatch(JSON.stringify(snapshot), /private|example\.net/);
  assert.equal(isFunnelSnapshot(snapshot), true);
});

test("attributes mcpub discovery and MCP enumeration to a registry crawler", () => {
  const discovery = classifyDiscoveryTailEvent(event(
    "/.well-known/mcp.json",
    200,
    { "user-agent": "mcp-spider/0.2" },
  ));
  assert.ok(discovery);
  assert.equal(discovery.surface, "well_known_mcp_probe");
  assert.equal(discovery.client_class, "registry_crawler");
  assert.equal(discovery.source, "known_directory");
  assert.equal(discovery.channel, "registry_or_directory");

  const enumeration = event("/mcp", 200, { "user-agent": "mcp-spider/0.2" }, "POST");
  Object.assign(enumeration, { logs: [{ message: [JSON.stringify({
    type: "bountyverdict_mcp_funnel",
    schema_version: 2,
    stage: "tools_list",
    product: null,
    source: "external",
    client_family: "not_applicable",
  })] }] });
  const observations = classifyMcpTailEvents(enumeration);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].client_class, "registry_crawler");
  assert.equal(observations[0].source, "known_directory");
  assert.equal(observations[0].channel, "registry_or_directory");
});

test("ignores irrelevant discovery paths and non-GET probes", () => {
  assert.equal(classifyDiscoveryTailEvent(event("/favicon.ico", 302)), null);
  assert.equal(classifyDiscoveryTailEvent(event("/openapi.json", 405, {}, "POST")), null);
});

test("schema enrichment preserves previously learned discovery aggregates", () => {
  const snapshot = createFunnelSnapshot("2026-07-20T19:00:00.000Z") as unknown as Record<string, unknown>;
  const observation = classifyDiscoveryTailEvent(event("/llms.txt", 200, { "user-agent": "Agent402/1.0" }));
  assert.ok(observation);
  recordDiscoveryObservation(snapshot as never, observation);
  delete snapshot.by_hour;
  delete snapshot.discovery_by_hour;
  delete snapshot.cohort_capture_started_at;
  delete snapshot.by_cohort;
  delete snapshot.by_discovery_cohort;
  snapshot.privacy = "legacy privacy wording";
  const loaded = loadFunnelSnapshot(snapshot, "2026-07-21T00:00:00.000Z");
  assert.ok(loaded);
  assert.equal(loaded.discovery_totals.requests, 1);
  assert.equal(loaded.by_discovery_surface.llms.requests, 1);
  assert.deepEqual(loaded.by_hour, {});
  assert.deepEqual(loaded.discovery_by_hour, {});
  assert.equal(loaded.cohort_capture_started_at, "2026-07-21T00:00:00.000Z");
  assert.deepEqual(loaded.by_cohort, {});
  assert.deepEqual(loaded.by_discovery_cohort, {});
  assert.match(loaded.privacy, /tool arguments/);
  assert.match(loaded.privacy, /payer addresses/);
});
