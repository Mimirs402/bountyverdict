import assert from "node:assert/strict";
import test from "node:test";
import {
  activateFunnelCollectorCapabilities,
  classifyFunnelTailEvent,
  classifyDiscoveryTailEvent,
  classifyMcpTailEvents,
  createFunnelSnapshot,
  discoveryBuyerCandidateTotals,
  FUNNEL_COLLECTOR_CAPABILITIES,
  isFunnelSnapshot,
  isBuyerCandidateDiscoveryCohort,
  loadFunnelSnapshot,
  mcpBuyerCandidateTotals,
  MCP_VALIDATION_KINDS,
  recordDiscoveryObservation,
  recordFunnelObservation,
  recordMcpObservation,
  renewFunnelCollectorCapabilityLeases,
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

test("canonical POST and legacy GET aggregate as one BountyVerdict product", () => {
  const canonical = classifyFunnelTailEvent(event(
    "/api/bounty-preflight",
    402,
    { "user-agent": "undici" },
    "POST",
  ));
  const legacy = classifyFunnelTailEvent(event(
    "/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Facme%2Frepo%2Fissues%2F1",
    402,
    { "user-agent": "undici" },
  ));
  assert.equal(canonical?.product, "single");
  assert.equal(canonical?.input_profile, "body_unobservable");
  assert.equal(legacy?.product, "single");
  assert.equal(legacy?.input_profile, "complete_expected");
  const snapshot = createFunnelSnapshot("2026-07-20T19:00:00.000Z");
  recordFunnelObservation(snapshot, canonical!);
  recordFunnelObservation(snapshot, legacy!);
  assert.equal(snapshot.by_product.single.requests, 2);
  assert.equal(snapshot.totals.requests, 2);

  const owner = classifyFunnelTailEvent(event(
    "/api/bounty-preflight",
    402,
    { "user-agent": "bountyverdict-owner-audit/1.0" },
    "POST",
  ));
  assert.equal(owner?.source, "owner_automation");
});

test("migrated canonical POST and legacy GET transports share product accounting", () => {
  const transports = [
    {
      product: "harness",
      canonical: "/api/repository-agent-instructions-audit",
      legacy: "/api/harness?repo_url=https%3A%2F%2Fgithub.com%2Fopenai%2Fcodex",
    },
    {
      product: "run",
      canonical: "/api/github-actions-run-diagnosis",
      legacy: "/api/run?run_url=https%3A%2F%2Fgithub.com%2Fopenai%2Fcodex%2Factions%2Fruns%2F29728148711",
    },
    {
      product: "flake",
      canonical: "/api/github-actions-flake-retry-gate",
      legacy: "/api/flake?run_url=https%3A%2F%2Fgithub.com%2Factions%2Frunner%2Factions%2Fruns%2F29423388605&attempt=1",
    },
  ] as const;
  const snapshot = createFunnelSnapshot("2026-07-20T19:00:00.000Z");
  for (const transport of transports) {
    const canonical = classifyFunnelTailEvent(event(
      transport.canonical,
      402,
      { "user-agent": "bountyverdict-payment-smoke/1.0" },
      "POST",
    ));
    const legacy = classifyFunnelTailEvent(event(
      transport.legacy,
      402,
      { "user-agent": "undici" },
    ));
    assert.equal(canonical?.product, transport.product);
    assert.equal(canonical?.input_profile, "body_unobservable");
    assert.equal(canonical?.source, "owner_automation");
    assert.equal(legacy?.product, transport.product);
    assert.equal(legacy?.input_profile, "complete_expected");
    recordFunnelObservation(snapshot, canonical!);
    recordFunnelObservation(snapshot, legacy!);
  }
  assert.equal(snapshot.by_product.harness.requests, 2);
  assert.equal(snapshot.by_product.run.requests, 2);
  assert.equal(snapshot.by_product.flake.requests, 2);
  assert.equal(snapshot.totals.requests, 6);
  assert.equal(snapshot.by_source.owner_automation.requests, 3);
});

test("learns MCP conversion stages without retaining tool arguments or request identity", () => {
  const value = event("/mcp?private=discard", 200, {
    "user-agent": "Codex/99 private-build",
    referer: "https://github.com/private/repository?token=secret",
  }, "POST");
  Object.assign(value, {
    logs: [
      { message: [JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 2, stage: "payment_required", product: "single", source: "external", client_family: "not_applicable" })] },
      { message: JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 3, stage: "validation_error", product: "mcpdrift", source: "external", client_family: "not_applicable", validation_kind: "invalid_mcp_snapshot" }) },
      { message: JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 3, stage: "capacity_rejected", product: "flake", source: "external", client_family: "not_applicable", validation_kind: "not_applicable" }) },
      { message: ["private raw console output", { secret: true }] },
    ],
  });
  const observations = classifyMcpTailEvents(value);
  assert.deepEqual(observations.map(({ stage, product, source, client_class, channel }) => ({ stage, product, source, client_class, channel })), [
    { stage: "payment_required", product: "single", source: "automated_client", client_class: "agent_runtime", channel: "github" },
    { stage: "validation_error", product: "mcpdrift", source: "automated_client", client_class: "agent_runtime", channel: "github" },
    { stage: "capacity_rejected", product: "flake", source: "automated_client", client_class: "agent_runtime", channel: "github" },
  ]);
  const snapshot = createFunnelSnapshot("2026-07-20T19:00:00.000Z");
  for (const observation of observations) recordMcpObservation(snapshot, observation);
  assert.equal(snapshot.mcp_totals.events, 3);
  assert.equal(snapshot.mcp_totals.payment_required, 1);
  assert.equal(snapshot.mcp_totals.validation_error, 1);
  assert.equal(snapshot.mcp_totals.capacity_rejected, 1);
  assert.equal(observations[1].validation_kind, "invalid_mcp_snapshot");
  assert.equal(snapshot.mcp_validation_kinds.invalid_mcp_snapshot, 1);
  assert.equal(snapshot.mcp_validation_kinds.legacy_unclassified, 0);
  assert.equal(snapshot.mcp_by_product.single.payment_required, 1);
  assert.equal(snapshot.mcp_by_product.mcpdrift.validation_error, 1);
  assert.equal(snapshot.mcp_by_product_source.single.automated_client.payment_required, 1);
  assert.equal(snapshot.mcp_by_source.automated_client.events, 3);
  assert.equal(snapshot.mcp_by_client_class.agent_runtime.events, 3);
  assert.equal(snapshot.mcp_by_client_family.not_applicable.events, 3);
  assert.equal(snapshot.mcp_by_channel.github.events, 3);
  assert.equal(snapshot.mcp_by_day["2026-07-20"].events, 3);
  assert.equal(snapshot.mcp_by_hour["2026-07-20T20"].events, 3);
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /must-never-persist|github\.com\/private|token=secret|Codex\/99|private-build/);
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

test("records protocol negotiation failures without retaining the requested version", () => {
  const value = event("/mcp", 400, { "user-agent": "Codex/private", "mcp-protocol-version": "secret-version" }, "POST");
  Object.assign(value, { logs: [{ message: [JSON.stringify({
    type: "bountyverdict_mcp_funnel",
    schema_version: 2,
    stage: "protocol_error",
    product: null,
    source: "external",
    client_family: "not_applicable",
  })] }] });
  const observations = classifyMcpTailEvents(value);
  assert.equal(observations.length, 1);
  const snapshot = recordMcpObservation(createFunnelSnapshot("2026-07-20T19:00:00.000Z"), observations[0]);
  assert.equal(snapshot.mcp_totals.protocol_error, 1);
  assert.equal(snapshot.mcp_by_client_class.agent_runtime.protocol_error, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret-version|Codex\/private/);
  assert.equal(isFunnelSnapshot(snapshot), true);
});

test("rejects malformed, forged, and identity-inconsistent MCP log events", () => {
  const value = event("/mcp", 200, { "user-agent": "bountyverdict-owner-audit/1" }, "POST");
  Object.assign(value, { logs: [
    { message: [JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 1, stage: "paid_success", product: "single", source: "external" })] },
    { message: [JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 1, stage: "initialize", product: "single", source: "owner_automation" })] },
    { message: [JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 1, stage: "paid_success", product: "skill", source: "owner_automation" })] },
    { message: [JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 1, stage: "tools_list", product: null, source: "owner_automation", raw: "forbidden" })] },
    { message: [JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 3, stage: "validation_error", product: "single", source: "owner_automation", client_family: "not_applicable", validation_kind: "not_applicable" })] },
    { message: [JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 3, stage: "validation_error", product: "mcpdrift", source: "owner_automation", client_family: "not_applicable", validation_kind: "invalid_issue_url" })] },
    { message: [JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 3, stage: "validation_error", product: "single", source: "owner_automation", client_family: "not_applicable", validation_kind: "legacy_unclassified" })] },
    { message: [JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 3, stage: "capacity_rejected", product: "flake", source: "owner_automation", client_family: "not_applicable", validation_kind: "invalid_run_or_attempt" })] },
    { message: [JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 3, stage: "capacity_rejected", product: "single", source: "owner_automation", client_family: "not_applicable", validation_kind: "not_applicable" })] },
    { message: [JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 1, stage: "capacity_rejected", product: "flake", source: "owner_automation" })] },
  ] });
  assert.deepEqual(classifyMcpTailEvents(value), []);
});

test("drops non-allowlisted validation keys during snapshot migration", () => {
  const snapshot = createFunnelSnapshot("2026-07-20T19:00:00.000Z");
  const observation = classifyMcpTailEvents(Object.assign(event("/mcp", 200, {}, "POST"), { logs: [{ message: JSON.stringify({
    type: "bountyverdict_mcp_funnel",
    schema_version: 3,
    stage: "validation_error",
    product: "single",
    source: "external",
    client_family: "not_applicable",
    validation_kind: "invalid_issue_url",
  }) }] }))[0];
  assert.ok(observation);
  recordMcpObservation(snapshot, observation);
  (snapshot.mcp_validation_kinds as Record<string, number>)["https://private.example/?token=secret"] = 99;
  assert.equal(isFunnelSnapshot(snapshot), false);
  const loaded = loadFunnelSnapshot(snapshot);
  assert.ok(loaded);
  assert.equal(loaded.mcp_validation_kinds.legacy_unclassified, 1);
  assert.equal(loaded.mcp_validation_kinds.invalid_issue_url, 0);
  assert.doesNotMatch(JSON.stringify(loaded), /private\.example|token=secret/);
  assert.deepEqual(Object.keys(loaded.mcp_validation_kinds).sort(), [...MCP_VALIDATION_KINDS].sort());
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
  const readiness = classifyDiscoveryTailEvent(event(
    "/api/sample",
    200,
    { "user-agent": "bountyverdict-funnel-smoke/1.0" },
  ));
  assert.ok(readiness);
  assert.equal(readiness.surface, "sample_single");
  assert.equal(readiness.source, "owner_automation");
  assert.equal(classifyFunnelTailEvent(event("/_internal/canary/single", 200)), null);
  assert.equal(classifyFunnelTailEvent(event("/api/portfolio", 402, {}, "GET")), null);
  assert.equal(classifyFunnelTailEvent(event("/api/bounty-preflight", 402, {}, "GET")), null);
  assert.equal(classifyFunnelTailEvent(event("/api/verdict", 402, {}, "POST")), null);
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

test("attributes MCP directory discovery and enumeration to registry crawlers", () => {
  for (const userAgent of ["mcp-spider/0.2", "SmitheryBot/1.0 (+https://smithery.ai)"]) {
    const discovery = classifyDiscoveryTailEvent(event(
      "/.well-known/mcp.json",
      200,
      { "user-agent": userAgent },
    ));
    assert.ok(discovery);
    assert.equal(discovery.surface, "well_known_mcp_probe");
    assert.equal(discovery.client_class, "registry_crawler");
    assert.equal(discovery.source, "known_directory");
    assert.equal(discovery.channel, "registry_or_directory");

    const enumeration = event("/mcp", 200, { "user-agent": userAgent }, "POST");
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
  }
});

test("attributes only exact allowlisted MCP source markers without retaining query data", () => {
  const kiro = event("/mcp?source=kiro-power", 200, { "user-agent": "Kiro IDE/1.0" }, "POST");
  Object.assign(kiro, { logs: [{ message: [JSON.stringify({
    type: "bountyverdict_mcp_funnel",
    schema_version: 2,
    stage: "tools_list",
    product: null,
    source: "external",
    client_family: "not_applicable",
  })] }] });
  const exact = classifyMcpTailEvents(kiro);
  assert.equal(exact.length, 1);
  assert.equal(exact[0].channel, "kiro_power");

  const agentSkills = event("/mcp?source=agent-skills-marketplace", 200, { "user-agent": "Codex/1.0" }, "POST");
  Object.assign(agentSkills, { logs: kiro.logs });
  const marketplace = classifyMcpTailEvents(agentSkills);
  assert.equal(marketplace.length, 1);
  assert.equal(marketplace[0].channel, "agent_skills_marketplace");

  const cline = event("/mcp?source=cline-marketplace", 200, { "user-agent": "Cline/1.0" }, "POST");
  Object.assign(cline, { logs: kiro.logs });
  const clineMarketplace = classifyMcpTailEvents(cline);
  assert.equal(clineMarketplace.length, 1);
  assert.equal(clineMarketplace[0].channel, "cline_marketplace");

  const kilo = event("/mcp?source=kilo-marketplace", 200, { "user-agent": "Kilo Code/1.0" }, "POST");
  Object.assign(kilo, { logs: kiro.logs });
  const kiloMarketplace = classifyMcpTailEvents(kilo);
  assert.equal(kiloMarketplace.length, 1);
  assert.equal(kiloMarketplace[0].channel, "kilo_marketplace");

  const cursorLink = event("/mcp?source=cursor-deeplink", 200, { "user-agent": "Cursor/1.0" }, "POST");
  Object.assign(cursorLink, { logs: kiro.logs });
  const cursorDeeplink = classifyMcpTailEvents(cursorLink);
  assert.equal(cursorDeeplink.length, 1);
  assert.equal(cursorDeeplink[0].channel, "cursor_deeplink");

  const vscodeLink = event("/mcp?source=vscode-deeplink", 200, { "user-agent": "Visual Studio Code/1.0" }, "POST");
  Object.assign(vscodeLink, { logs: kiro.logs });
  const vscodeDeeplink = classifyMcpTailEvents(vscodeLink);
  assert.equal(vscodeDeeplink.length, 1);
  assert.equal(vscodeDeeplink[0].channel, "vscode_deeplink");

  const openhands = event("/mcp?source=openhands-integrations", 200, { "user-agent": "OpenHands/1.0" }, "POST");
  Object.assign(openhands, { logs: kiro.logs });
  const openhandsIntegrations = classifyMcpTailEvents(openhands);
  assert.equal(openhandsIntegrations.length, 1);
  assert.equal(openhandsIntegrations[0].channel, "openhands_integrations");

  const goose = event("/mcp?source=goose-extensions", 200, { "user-agent": "Goose/1.0" }, "POST");
  Object.assign(goose, { logs: kiro.logs });
  const gooseExtensions = classifyMcpTailEvents(goose);
  assert.equal(gooseExtensions.length, 1);
  assert.equal(gooseExtensions[0].channel, "goose_extensions");

  const smithery = event("/mcp?source=smithery", 200, { "user-agent": "Codex/1.0" }, "POST");
  Object.assign(smithery, { logs: kiro.logs });
  const smitheryObservations = classifyMcpTailEvents(smithery);
  assert.equal(smitheryObservations.length, 1);
  assert.equal(smitheryObservations[0].channel, "smithery");

  const smitheryScan = event("/mcp?source=smithery", 200, { "user-agent": "SmitheryBot/1.0 (+https://smithery.ai)" }, "POST");
  Object.assign(smitheryScan, { logs: kiro.logs });
  const smitheryScanObservations = classifyMcpTailEvents(smitheryScan);
  assert.equal(smitheryScanObservations.length, 1);
  assert.equal(smitheryScanObservations[0].channel, "registry_or_directory");

  const agentMrr = event("/mcp?source=agentmrr", 200, { "user-agent": "Codex/1.0" }, "POST");
  Object.assign(agentMrr, { logs: kiro.logs });
  const agentMrrObservations = classifyMcpTailEvents(agentMrr);
  assert.equal(agentMrrObservations.length, 1);
  assert.equal(agentMrrObservations[0].channel, "agentmrr");

  const glama = event("/mcp?source=glama-release", 200, { "user-agent": "Glama/1.0" }, "POST");
  Object.assign(glama, { logs: kiro.logs });
  const glamaObservations = classifyMcpTailEvents(glama);
  assert.equal(glamaObservations.length, 1);
  assert.equal(glamaObservations[0].channel, "glama");

  const registry = event("/mcp?source=mcp-registry", 200, { "user-agent": "MCP Registry/1.0" }, "POST");
  Object.assign(registry, { logs: kiro.logs });
  const registryObservations = classifyMcpTailEvents(registry);
  assert.equal(registryObservations.length, 1);
  assert.equal(registryObservations[0].channel, "registry_or_directory");

  const owner = event("/mcp?source=agentmrr", 200, { "user-agent": "bountyverdict-owner-audit/1.0" }, "POST");
  Object.assign(owner, { logs: [{ message: [JSON.stringify({
    type: "bountyverdict_mcp_funnel",
    schema_version: 2,
    stage: "tools_list",
    product: null,
    source: "owner_automation",
    client_family: "not_applicable",
  })] }] });
  const ownerMarker = classifyMcpTailEvents(owner);
  assert.equal(ownerMarker.length, 1);
  assert.equal(ownerMarker[0].channel, "owner_automation");

  const spoofed = event("/mcp?source=kiro-power&private=discard", 200, { "user-agent": "Kiro IDE/1.0" }, "POST");
  Object.assign(spoofed, { logs: kiro.logs });
  const rejected = classifyMcpTailEvents(spoofed);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].channel, "direct_or_hidden");

  for (const path of [
    "/mcp?source=cline-marketplace&private=discard",
    "/mcp?source=cline-marketplace&source=cline-marketplace",
    "/mcp?source=kilo-marketplace&private=discard",
    "/mcp?source=kilo-marketplace&source=kilo-marketplace",
    "/mcp?source=cursor-deeplink&private=discard",
    "/mcp?source=cursor-deeplink&source=cursor-deeplink",
    "/mcp?source=vscode-deeplink&private=discard",
    "/mcp?source=vscode-deeplink&source=vscode-deeplink",
    "/mcp?source=openhands-integrations&private=discard",
    "/mcp?source=openhands-integrations&source=openhands-integrations",
    "/mcp?source=goose-extensions&private=discard",
    "/mcp?source=goose-extensions&source=goose-extensions",
    "/mcp?source=smithery&private=discard",
    "/mcp?source=smithery&source=smithery",
    "/mcp?source=agentmrr&private=discard",
    "/mcp?source=agentmrr&source=agentmrr",
  ]) {
    const ambiguous = event(path, 200, { "user-agent": "Codex/1.0" }, "POST");
    Object.assign(ambiguous, { logs: kiro.logs });
    const observations = classifyMcpTailEvents(ambiguous);
    assert.equal(observations.length, 1);
    assert.equal(observations[0].channel, "direct_or_hidden");
  }

  const unknown = event("/mcp?source=private-campaign", 200, { "user-agent": "Codex/1.0" }, "POST");
  Object.assign(unknown, { logs: kiro.logs });
  const unknownMarker = classifyMcpTailEvents(unknown);
  assert.equal(unknownMarker.length, 1);
  assert.equal(unknownMarker[0].channel, "direct_or_hidden");
  assert.doesNotMatch(
    JSON.stringify([
      ...exact,
      ...marketplace,
      ...clineMarketplace,
      ...kiloMarketplace,
      ...cursorDeeplink,
      ...vscodeDeeplink,
      ...openhandsIntegrations,
      ...gooseExtensions,
      ...smitheryObservations,
      ...smitheryScanObservations,
      ...agentMrrObservations,
      ...registryObservations,
      ...ownerMarker,
      ...rejected,
      ...unknownMarker,
    ]),
    /private|discard|kiro-power|cline-marketplace|kilo-marketplace|cursor-deeplink|vscode-deeplink|openhands-integrations|goose-extensions|campaign/i,
  );
});

test("attributes only the exact AgentMRR marker on paid REST calls", () => {
  const exact = classifyFunnelTailEvent(event(
    "/api/github-actions-run-diagnosis?source=agentmrr",
    402,
    { "user-agent": "Codex/1.0", accept: "application/json" },
    "POST",
  ));
  assert.ok(exact);
  assert.equal(exact.product, "run");
  assert.equal(exact.channel, "agentmrr");
  assert.equal(exact.input_profile, "body_unobservable");
  assert.equal(exact.outcome, "challenge_402");

  for (const path of [
    "/api/github-actions-run-diagnosis?source=agentmrr&private=discard",
    "/api/github-actions-run-diagnosis?source=agentmrr&source=agentmrr",
    "/api/github-actions-run-diagnosis?source=unknown",
  ]) {
    const ambiguous = classifyFunnelTailEvent(event(
      path,
      402,
      { "user-agent": "Codex/1.0" },
      "POST",
    ));
    assert.ok(ambiguous);
    assert.equal(ambiguous.channel, "direct_or_hidden");
  }

  const owner = classifyFunnelTailEvent(event(
    "/api/github-actions-run-diagnosis?source=agentmrr",
    402,
    { "user-agent": "bountyverdict-owner-audit/1.0" },
    "POST",
  ));
  assert.ok(owner);
  assert.equal(owner.channel, "owner_automation");
});

test("Glama release probes remain distribution evidence and never enter the buyer-candidate funnel", () => {
  const snapshot = createFunnelSnapshot();
  const glama = event("/mcp?source=glama-release", 200, { "user-agent": "Glama/1.0" }, "POST");
  Object.assign(glama, { logs: [{ message: [JSON.stringify({
    type: "bountyverdict_mcp_funnel",
    schema_version: 3,
    stage: "tools_list",
    product: null,
    source: "external",
    client_family: "not_applicable",
    validation_kind: "not_applicable",
  })] }] });
  const direct = event("/mcp", 200, { "user-agent": "Codex/1.0" }, "POST");
  Object.assign(direct, { logs: glama.logs });
  for (const observation of [...classifyMcpTailEvents(glama), ...classifyMcpTailEvents(direct)]) {
    recordMcpObservation(snapshot, observation);
  }

  assert.equal(snapshot.mcp_by_channel.glama.tools_list, 1);
  assert.equal(snapshot.mcp_totals.tools_list, 2);
  assert.equal(mcpBuyerCandidateTotals(snapshot).tools_list, 1);
});

test("direct editor runtimes count while passive Smithery catalog inspection does not", () => {
  const snapshot = createFunnelSnapshot();
  for (const path of [
    "/mcp?source=cursor-deeplink",
    "/mcp?source=vscode-deeplink",
    "/mcp?source=openhands-integrations",
    "/mcp?source=goose-extensions",
    "/mcp?source=smithery",
  ]) {
    const request = event(path, 200, { "user-agent": "OpenHands/1.0" }, "POST");
    Object.assign(request, { logs: [{ message: [JSON.stringify({
      type: "bountyverdict_mcp_funnel",
      schema_version: 3,
      stage: "tools_list",
      product: null,
      source: "external",
      client_family: "not_applicable",
      validation_kind: "not_applicable",
    })] }] });
    for (const observation of classifyMcpTailEvents(request)) recordMcpObservation(snapshot, observation);
  }

  assert.equal(snapshot.mcp_by_channel.cursor_deeplink.tools_list, 1);
  assert.equal(snapshot.mcp_by_channel.vscode_deeplink.tools_list, 1);
  assert.equal(snapshot.mcp_by_channel.openhands_integrations.tools_list, 1);
  assert.equal(snapshot.mcp_by_channel.goose_extensions.tools_list, 1);
  assert.equal(snapshot.mcp_by_channel.smithery.tools_list, 1);
  assert.equal(mcpBuyerCandidateTotals(snapshot).tools_list, 4);
  assert.equal(mcpBuyerCandidateTotals(snapshot).events, 4);
});

test("Smithery tool-selection stages remain buyer-candidate evidence", () => {
  const snapshot = createFunnelSnapshot();
  for (const stage of [
    "initialize",
    "tools_list",
    "protocol_error",
    "tool_not_found",
    "validation_error",
    "payment_required",
  ] as const) {
    recordMcpObservation(snapshot, {
      observed_at: "2026-07-22T15:30:00.000Z",
      stage,
      product: stage === "validation_error" || stage === "payment_required" ? "single" : null,
      source: "automated_client",
      client_class: "agent_runtime",
      client_family: "not_applicable",
      validation_kind: stage === "validation_error" ? "missing_required" : "not_applicable",
      channel: "smithery",
    });
  }

  const buyerCandidate = mcpBuyerCandidateTotals(snapshot);
  assert.equal(snapshot.mcp_by_channel.smithery.events, 6);
  assert.equal(buyerCandidate.events, 3);
  assert.equal(buyerCandidate.initialize, 0);
  assert.equal(buyerCandidate.tools_list, 0);
  assert.equal(buyerCandidate.protocol_error, 0);
  assert.equal(buyerCandidate.tool_not_found, 1);
  assert.equal(buyerCandidate.validation_error, 1);
  assert.equal(buyerCandidate.payment_required, 1);
});

test("buyer-candidate discovery excludes directory health without hiding real acquisition channels", () => {
  const snapshot = createFunnelSnapshot();
  const observations = [
    event("/openapi.json", 200, { "user-agent": "Agent402/1.0" }),
    event("/.well-known/x402", 200, { "user-agent": "Agent402/1.0" }),
    event("/openapi.json", 200, { "user-agent": "x402-observer/1.0" }),
    event("/agent-manifest.json", 200, { "user-agent": "OpenDexter/1.0" }),
    event("/llms.txt", 200, { "user-agent": "bountyverdict-owner-audit/1.0" }),
    // Preserve an Agent402 visit outside its known OpenAPI/manifest health loop.
    event("/api/sample", 200, { "user-agent": "Agent402/1.0" }),
    event("/llms.txt", 200, { "user-agent": "curl/8.14.1" }),
    event("/openapi.json", 200, { referer: "https://github.com/acme/repo" }),
    event("/.well-known/x402", 200, { referer: "https://x402scan.com/resource/example" }),
  ].map(classifyDiscoveryTailEvent);
  assert.ok(observations.every(Boolean));
  for (const observation of observations) recordDiscoveryObservation(snapshot, observation!);

  const buyerCandidate = discoveryBuyerCandidateTotals(snapshot);
  assert.equal(snapshot.discovery_totals.requests, 9);
  assert.equal(buyerCandidate.requests, 4);
  assert.equal(buyerCandidate.unsigned_successes, 4);
  assert.equal(isBuyerCandidateDiscoveryCohort("openapi|agent402|agent402|unspecified_or_other"), false);
  assert.equal(isBuyerCandidateDiscoveryCohort("well_known_x402_probe|agent402|agent402|unspecified_or_other"), false);
  assert.equal(isBuyerCandidateDiscoveryCohort("sample_single|agent402|agent402|unspecified_or_other"), true);
  assert.equal(isBuyerCandidateDiscoveryCohort("openapi|smithery|agent_runtime|unspecified_or_other"), false);
  assert.equal(isBuyerCandidateDiscoveryCohort("openapi|github|unknown|unspecified_or_other"), true);
  assert.equal(isBuyerCandidateDiscoveryCohort("invalid|direct_or_hidden|unknown|json"), false);
});

test("ignores irrelevant discovery paths and non-GET probes", () => {
  assert.equal(classifyDiscoveryTailEvent(event("/favicon.ico", 302)), null);
  assert.equal(classifyDiscoveryTailEvent(event("/openapi.json", 405, {}, "POST")), null);
});

test("classifies ARD well-known catalog fetches as a distinct discovery surface", () => {
  const observation = classifyDiscoveryTailEvent(event(
    "/.well-known/ai-catalog.json",
    200,
    { "user-agent": "ard-registry-crawler/1.0", accept: "application/json" },
  ));
  assert.ok(observation);
  assert.equal(observation.surface, "well_known_ai_catalog_probe");
  assert.equal(observation.response_preference, "json");
});

test("separates standard integration discovery documents and RFC HEAD probes", () => {
  const paths = [
    ["/.well-known/api-catalog", "well_known_api_catalog_probe", "HEAD"],
    ["/.well-known/mcp/server-card.json", "well_known_mcp_server_card_probe", "GET"],
    ["/.well-known/integrations.json", "well_known_integrations_probe", "GET"],
  ] as const;
  const snapshot = createFunnelSnapshot("2026-07-20T19:00:00.000Z");
  for (const [path, surface, method] of paths) {
    const observation = classifyDiscoveryTailEvent(event(
      path,
      200,
      { "user-agent": "registry-crawler/1.0", accept: "application/json" },
      method,
    ));
    assert.ok(observation);
    assert.equal(observation.surface, surface);
    recordDiscoveryObservation(snapshot, observation);
  }
  assert.equal(snapshot.by_discovery_surface.well_known_api_catalog_probe.requests, 1);
  assert.equal(snapshot.by_discovery_surface.well_known_mcp_server_card_probe.requests, 1);
  assert.equal(snapshot.by_discovery_surface.well_known_integrations_probe.requests, 1);
  assert.equal(snapshot.discovery_totals.requests, 3);
});

test("schema enrichment preserves previously learned discovery aggregates", () => {
  const snapshot = createFunnelSnapshot("2026-07-20T19:00:00.000Z") as unknown as Record<string, unknown>;
  const observation = classifyDiscoveryTailEvent(event("/llms.txt", 200, { "user-agent": "Agent402/1.0" }));
  assert.ok(observation);
  recordDiscoveryObservation(snapshot as never, observation);
  delete snapshot.by_hour;
  delete snapshot.discovery_by_hour;
  delete snapshot.cohort_capture_started_at;
  delete snapshot.collector_heartbeat_at;
  delete snapshot.collector_capabilities;
  delete snapshot.collector_capability_heartbeats;
  delete snapshot.by_cohort;
  delete snapshot.by_discovery_cohort;
  delete (snapshot.by_channel as Record<string, unknown>).agentmrr;
  delete (snapshot.by_discovery_channel as Record<string, unknown>).agentmrr;
  delete (snapshot.mcp_by_channel as Record<string, unknown>).agentmrr;
  delete snapshot.mcp_validation_kinds;
  (snapshot.mcp_totals as Record<string, unknown>).events = 2;
  (snapshot.mcp_totals as Record<string, unknown>).validation_error = 2;
  const mcpContainers: Array<Record<string, unknown>> = [
    snapshot.mcp_totals as unknown as Record<string, unknown>,
    ...Object.values(snapshot.mcp_by_product as Record<string, Record<string, unknown>>),
    ...Object.values(snapshot.mcp_by_source as Record<string, Record<string, unknown>>),
    ...Object.values(snapshot.mcp_by_client_class as Record<string, Record<string, unknown>>),
    ...Object.values(snapshot.mcp_by_client_family as Record<string, Record<string, unknown>>),
    ...Object.values(snapshot.mcp_by_channel as Record<string, Record<string, unknown>>),
  ];
  for (const sources of Object.values(snapshot.mcp_by_product_source as Record<string, Record<string, Record<string, unknown>>>)) {
    mcpContainers.push(...Object.values(sources));
  }
  for (const counters of mcpContainers) {
    delete counters.protocol_error;
    delete counters.capacity_rejected;
  }
  snapshot.privacy = "legacy privacy wording";
  const loaded = loadFunnelSnapshot(snapshot, "2026-07-21T00:00:00.000Z");
  assert.ok(loaded);
  assert.equal(loaded.discovery_totals.requests, 1);
  assert.equal(loaded.by_discovery_surface.llms.requests, 1);
  assert.deepEqual(loaded.by_hour, {});
  assert.deepEqual(loaded.discovery_by_hour, {});
  assert.equal(loaded.cohort_capture_started_at, "2026-07-21T00:00:00.000Z");
  assert.equal(loaded.collector_heartbeat_at, snapshot.updated_at);
  assert.deepEqual(loaded.collector_capabilities, []);
  assert.deepEqual(loaded.collector_capability_heartbeats, {});
  assert.equal(loaded.by_channel.agentmrr.requests, 0);
  assert.equal(loaded.by_discovery_channel.agentmrr.requests, 0);
  assert.equal(loaded.mcp_by_channel.agentmrr.events, 0);
  activateFunnelCollectorCapabilities(loaded);
  assert.deepEqual(loaded.collector_capabilities, [...FUNNEL_COLLECTOR_CAPABILITIES]);
  assert.deepEqual(loaded.collector_capability_heartbeats, {
    agentmrr_source_attribution_v1: "1970-01-01T00:00:00.000Z",
  });
  renewFunnelCollectorCapabilityLeases(loaded, "2026-07-21T00:00:01.000Z");
  assert.deepEqual(loaded.collector_capability_heartbeats, {
    agentmrr_source_attribution_v1: "2026-07-21T00:00:01.000Z",
  });
  assert.deepEqual(loaded.by_cohort, {});
  assert.deepEqual(loaded.by_discovery_cohort, {});
  assert.equal(loaded.mcp_totals.protocol_error, 0);
  assert.equal(loaded.mcp_totals.capacity_rejected, 0);
  assert.equal(loaded.mcp_validation_kinds.legacy_unclassified, 2);
  assert.equal(loaded.mcp_by_product.single.protocol_error, 0);
  assert.equal(loaded.mcp_by_source.automated_client.protocol_error, 0);
  assert.match(loaded.privacy, /tool arguments/);
  assert.match(loaded.privacy, /payer addresses/);
});
