import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  classifyDiscoveryTailEvent,
  classifyFunnelTailEvent,
  createFunnelSnapshot,
  recordDiscoveryObservation,
  recordFunnelObservation,
  recordMcpObservation,
} from "../src/funnel-telemetry.ts";
import {
  assertFreshFunnelCollector,
  captureTrustedFunnelBaseline,
  captureTrustedMcpBaseline,
  trustedBuyerCandidateDiscoveryDelta,
  trustedMcpDelta,
  trustedBoundaryFingerprint,
  trustedFunnelBaseline,
} from "../src/funnel-epoch.ts";

const execFileAsync = promisify(execFile);

function event(path: string, status: number, userAgent: string) {
  return {
    scriptName: "bountyverdict-agent-production",
    eventTimestamp: Date.parse("2026-07-20T21:00:00Z"),
    event: {
      request: {
        url: `https://bountyverdict-agent-production.mimirslab.workers.dev${path}`,
        method: "GET",
        headers: { "user-agent": userAgent },
      },
      response: { status },
    },
  };
}

test("captures an immutable epoch baseline while excluding owner automation", () => {
  const state = createFunnelSnapshot("2026-07-20T20:00:00Z");
  const owner = classifyFunnelTailEvent(event(
    "/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Facme%2Frepo%2Fissues%2F1",
    402,
    "bountyverdict-payment-smoke/1.0",
  ));
  const external = classifyFunnelTailEvent(event(
    "/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Facme%2Frepo%2Fissues%2F1",
    402,
    "agent-runtime/1.0",
  ));
  const discovery = classifyDiscoveryTailEvent(event("/openapi.json", 200, "Agent402/1.0"));
  assert.ok(owner && external && discovery);
  recordFunnelObservation(state, owner);
  recordFunnelObservation(state, external);
  recordDiscoveryObservation(state, discovery);
  const baseline = captureTrustedFunnelBaseline(
    state,
    "2026-07-20T21:05:00Z",
    "A sufficiently descriptive clean measurement boundary reason.",
    2,
  );
  assert.equal(baseline.epoch_id, 2);
  assert.equal(baseline.counters.external_402_challenges, 1);
  assert.equal(baseline.counters.external_discovery_requests, 1);
  assert.equal(baseline.buyer_candidate_discovery_totals.requests, 0);
  assert.equal(baseline.external_by_product.single.challenges_402, 1);
  assert.equal(baseline.funnel_collector_heartbeat_at, state.collector_heartbeat_at);
  assert.equal(baseline.by_channel.owner_automation.challenges_402, 1);
  assert.deepEqual(trustedFunnelBaseline(baseline), baseline);
});

test("loads a pre-channel-addition baseline by adding only zero counters", () => {
  const state = createFunnelSnapshot("2026-07-22T01:40:00Z");
  const baseline = captureTrustedFunnelBaseline(
    state,
    "2026-07-22T01:42:23Z",
    "A sufficiently descriptive baseline before new runtime channels existed.",
    36,
  );
  const legacy = structuredClone(baseline);
  delete (legacy.by_channel as Partial<typeof legacy.by_channel>).cursor_deeplink;
  delete (legacy.by_channel as Partial<typeof legacy.by_channel>).openhands_integrations;
  delete (legacy.by_discovery_channel as Partial<typeof legacy.by_discovery_channel>).cursor_deeplink;
  delete (legacy.by_discovery_channel as Partial<typeof legacy.by_discovery_channel>).openhands_integrations;
  delete (legacy.mcp!.by_channel as Partial<typeof legacy.mcp.by_channel>).cursor_deeplink;
  delete (legacy.mcp!.by_channel as Partial<typeof legacy.mcp.by_channel>).openhands_integrations;

  const migrated = trustedFunnelBaseline(legacy);
  assert.ok(migrated);
  assert.equal(migrated.epoch_id, 36);
  assert.equal(migrated.initialized_at, baseline.initialized_at);
  assert.deepEqual(migrated.by_channel.cursor_deeplink, baseline.by_channel.cursor_deeplink);
  assert.deepEqual(migrated.by_channel.openhands_integrations, baseline.by_channel.openhands_integrations);
  assert.deepEqual(migrated.mcp!.by_channel.cursor_deeplink, baseline.mcp!.by_channel.cursor_deeplink);
  assert.deepEqual(migrated.mcp!.by_channel.openhands_integrations, baseline.mcp!.by_channel.openhands_integrations);

  const unknown = structuredClone(legacy) as Record<string, any>;
  unknown.mcp.by_channel.untrusted_campaign = baseline.mcp!.by_channel.github;
  assert.equal(trustedFunnelBaseline(unknown), null);
});

test("trusted buyer-candidate discovery deltas preserve acquisition while excluding health refreshes", () => {
  const state = createFunnelSnapshot("2026-07-21T17:00:00Z");
  const baseline = captureTrustedFunnelBaseline(
    state,
    "2026-07-21T17:00:00Z",
    "A sufficiently descriptive buyer discovery boundary reason.",
    2,
  );
  const values = [
    event("/openapi.json", 200, "Agent402/1.0"),
    event("/.well-known/x402", 200, "Agent402/1.0"),
    event("/openapi.json", 200, "x402-observer/1.0"),
    event("/agent-manifest.json", 200, "OpenDexter/1.0"),
    event("/llms.txt", 200, "curl/8.14.1"),
  ].map(classifyDiscoveryTailEvent);
  assert.ok(values.every(Boolean));
  for (const value of values) recordDiscoveryObservation(state, value!);

  const delta = trustedBuyerCandidateDiscoveryDelta(state, baseline);
  assert.equal(state.discovery_totals.requests, 5);
  assert.equal(delta.requests, 1);
  assert.equal(delta.unsigned_successes, 1);
  const future = structuredClone(baseline);
  future.buyer_candidate_discovery_totals.requests = 2;
  future.buyer_candidate_discovery_totals.unsigned_successes = 2;
  assert.throws(() => trustedBuyerCandidateDiscoveryDelta(state, future), /internally inconsistent/);
});

test("captures exact bounded MCP epoch dimensions and computes monotonic deltas", () => {
  const state = createFunnelSnapshot("2026-07-21T17:00:00Z");
  recordMcpObservation(state, {
    observed_at: "2026-07-21T17:00:01Z",
    stage: "payment_required",
    product: "single",
    source: "owner_automation",
    client_class: "owner_automation",
    client_family: "owner_automation",
    validation_kind: "not_applicable",
    channel: "owner_automation",
  });
  recordMcpObservation(state, {
    observed_at: "2026-07-21T17:00:02Z",
    stage: "initialize",
    product: null,
    source: "known_directory",
    client_class: "registry_crawler",
    client_family: "missing",
    validation_kind: "not_applicable",
    channel: "registry_or_directory",
  });
  for (const stage of ["initialize", "tools_list", "payment_required"] as const) {
    recordMcpObservation(state, {
      observed_at: "2026-07-21T17:00:03Z",
      stage,
      product: stage === "payment_required" ? "run" : null,
      source: "automated_client",
      client_class: "agent_runtime",
      client_family: stage === "initialize" ? "codex" : "not_applicable",
      validation_kind: "not_applicable",
      channel: "direct_or_hidden",
    });
  }
  const baseline = captureTrustedMcpBaseline(state);
  assert.equal(baseline.external_totals.events, 4);
  assert.equal(baseline.external_totals.initialize, 2);
  assert.equal(baseline.buyer_candidate_totals.events, 3);
  assert.equal(baseline.buyer_candidate_totals.initialize, 1);
  assert.equal(baseline.external_by_product.run.payment_required, 1);
  assert.equal(baseline.external_by_product.single.payment_required, 0);
  assert.equal(baseline.by_channel.registry_or_directory.initialize, 1);
  assert.equal(baseline.by_client_family.codex.initialize, 1);

  recordMcpObservation(state, {
    observed_at: "2026-07-21T17:00:04Z",
    stage: "validation_error",
    product: "run",
    source: "automated_client",
    client_class: "agent_runtime",
    client_family: "not_applicable",
    validation_kind: "invalid_run_or_attempt",
    channel: "direct_or_hidden",
  });
  const delta = trustedMcpDelta(state, baseline);
  assert.equal(delta.external_totals.events, 1);
  assert.equal(delta.buyer_candidate_totals.validation_error, 1);
  assert.equal(delta.external_by_product.run.validation_error, 1);
  assert.equal(delta.by_channel.direct_or_hidden.validation_error, 1);
  assert.equal(delta.by_client_class.agent_runtime.validation_error, 1);
  assert.equal(delta.validation_kinds.invalid_run_or_attempt, 1);
  assert.equal(baseline.validation_kinds.invalid_run_or_attempt, 0);
  const futureBaseline = structuredClone(baseline);
  futureBaseline.external_totals.events += 2;
  futureBaseline.external_totals.validation_error += 2;
  assert.throws(() => trustedMcpDelta(state, futureBaseline), /internally inconsistent/);
});

test("epoch rotation requires a live collector heartbeat", () => {
  const state = createFunnelSnapshot("2026-07-21T17:00:00Z");
  assert.doesNotThrow(() => assertFreshFunnelCollector(state, "2026-07-21T17:00:45Z"));
  assert.throws(
    () => assertFreshFunnelCollector(state, "2026-07-21T17:01:01Z"),
    /heartbeat is stale/,
  );
  state.collector_heartbeat_at = "2026-07-21T17:00:10Z";
  assert.throws(
    () => assertFreshFunnelCollector(state, "2026-07-21T17:00:00Z"),
    /ahead of the rotation boundary/,
  );
});

test("loads legacy epoch-one baselines and rejects malformed records", () => {
  const baseline = captureTrustedFunnelBaseline(
    createFunnelSnapshot(),
    "2026-07-20T21:05:00Z",
    "A sufficiently descriptive clean measurement boundary reason.",
    1,
  ) as any;
  delete baseline.epoch_id;
  delete baseline.mcp;
  delete baseline.buyer_candidate_discovery_totals;
  assert.equal(trustedFunnelBaseline(baseline)?.epoch_id, 1);
  assert.equal(trustedFunnelBaseline(baseline)?.mcp, undefined);
  assert.equal(trustedFunnelBaseline(baseline)?.buyer_candidate_discovery_totals.requests, 0);
  assert.equal(trustedFunnelBaseline({ ...baseline, schema_version: 2 }), null);
  assert.equal(
    trustedFunnelBaseline({ ...baseline, funnel_collector_heartbeat_at: "not-a-date" })?.funnel_collector_heartbeat_at,
    baseline.funnel_observed_through,
  );
  const current = captureTrustedFunnelBaseline(
    createFunnelSnapshot(),
    "2026-07-20T21:05:00Z",
    "A sufficiently descriptive clean measurement boundary reason.",
    2,
  ) as any;
  current.mcp.by_channel.direct_or_hidden.unbounded_secret_dimension = 1;
  assert.equal(trustedFunnelBaseline(current), null);
});

test("epoch stability ignores owner and unsigned preflight noise but changes on conversion-capable events", () => {
  const original = createFunnelSnapshot("2026-07-20T20:00:00Z");
  const first = captureTrustedFunnelBaseline(original, "2026-07-20T21:00:00Z", "A sufficiently descriptive boundary reason for testing.", 2);
  const owner = classifyFunnelTailEvent(event(
    "/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Facme%2Frepo%2Fissues%2F1",
    402,
    "bountyverdict-payment-smoke/1.0",
  ));
  assert.ok(owner);
  recordFunnelObservation(original, owner);
  const afterOwner = captureTrustedFunnelBaseline(original, "2026-07-20T21:01:00Z", "A sufficiently descriptive boundary reason for testing.", 2);
  assert.equal(trustedBoundaryFingerprint(afterOwner), trustedBoundaryFingerprint(first));
  const knownDirectoryDiscovery = classifyDiscoveryTailEvent(event("/openapi.json", 200, "Agent402/1.0"));
  const knownDirectoryProbe = classifyFunnelTailEvent(event(
    "/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Facme%2Frepo%2Fissues%2F1",
    402,
    "x402-observer/1.0",
  ));
  assert.ok(knownDirectoryDiscovery && knownDirectoryProbe);
  recordDiscoveryObservation(original, knownDirectoryDiscovery);
  recordFunnelObservation(original, knownDirectoryProbe);
  const afterHealthPolls = captureTrustedFunnelBaseline(original, "2026-07-20T21:01:30Z", "A sufficiently descriptive boundary reason for testing.", 2);
  assert.equal(trustedBoundaryFingerprint(afterHealthPolls), trustedBoundaryFingerprint(first));
  // Marginal client totals cannot safely identify a health event when a crawler
  // supplies a generic user agent. The joint cohort's channel remains authoritative.
  afterHealthPolls.by_client_class.unknown.requests += 1;
  assert.equal(trustedBoundaryFingerprint(afterHealthPolls), trustedBoundaryFingerprint(first));
  const anonymousPreflight = classifyFunnelTailEvent(event(
    "/api/verdict",
    400,
    "Mozilla/5.0 Firefox/128.0",
  ));
  const anonymousDiscovery = classifyDiscoveryTailEvent(event(
    "/llms.txt",
    200,
    "curl/8.14.1",
  ));
  assert.ok(anonymousPreflight && anonymousDiscovery);
  recordFunnelObservation(original, anonymousPreflight);
  recordDiscoveryObservation(original, anonymousDiscovery);
  const afterUnsignedNoise = captureTrustedFunnelBaseline(original, "2026-07-20T21:01:45Z", "A sufficiently descriptive boundary reason for testing.", 2);
  assert.equal(afterUnsignedNoise.counters.external_discovery_requests, 2);
  assert.equal(afterUnsignedNoise.external_by_product.single.preflight_rejections, 1);
  assert.equal(trustedBoundaryFingerprint(afterUnsignedNoise), trustedBoundaryFingerprint(first));
  const external = classifyFunnelTailEvent(event(
    "/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Facme%2Frepo%2Fissues%2F1",
    402,
    "agent-runtime/1.0",
  ));
  assert.ok(external);
  recordFunnelObservation(original, external);
  const afterExternal = captureTrustedFunnelBaseline(original, "2026-07-20T21:02:00Z", "A sufficiently descriptive boundary reason for testing.", 2);
  assert.notEqual(trustedBoundaryFingerprint(afterExternal), trustedBoundaryFingerprint(first));
});

test("MCP baseline changes do not alter the REST drain fingerprint", () => {
  const state = createFunnelSnapshot("2026-07-21T17:00:00Z");
  const first = captureTrustedFunnelBaseline(state, "2026-07-21T17:00:00Z", "A sufficiently descriptive MCP fingerprint reason.", 2);
  recordMcpObservation(state, {
    observed_at: "2026-07-21T17:00:01Z",
    stage: "payment_required",
    product: "run",
    source: "automated_client",
    client_class: "agent_runtime",
    client_family: "not_applicable",
    validation_kind: "not_applicable",
    channel: "direct_or_hidden",
  });
  const second = captureTrustedFunnelBaseline(state, "2026-07-21T17:00:02Z", "A sufficiently descriptive MCP fingerprint reason.", 2);
  assert.equal(trustedBoundaryFingerprint(second), trustedBoundaryFingerprint(first));
});

test("epoch stability resets on every non-challenge paid-route anomaly", () => {
  const baseline = captureTrustedFunnelBaseline(
    createFunnelSnapshot("2026-07-20T20:00:00Z"),
    "2026-07-20T21:00:00Z",
    "A sufficiently descriptive boundary reason for anomaly testing.",
    2,
  );
  for (const counter of ["signed_requests", "signed_successes", "unsigned_successes", "rate_limited", "server_errors", "other"] as const) {
    const changed = structuredClone(baseline);
    changed.by_cohort[`single|direct_or_hidden|unknown|complete_expected|none|json`] = {
      requests: 1,
      challenges_402: 0,
      signed_requests: 0,
      signed_successes: 0,
      unsigned_successes: 0,
      preflight_rejections: 0,
      rate_limited: 0,
      server_errors: 0,
      other: 0,
      [counter]: 1,
    };
    assert.notEqual(trustedBoundaryFingerprint(changed), trustedBoundaryFingerprint(baseline), counter);
  }
});

test("epoch rotation closes and opens at one boundary and repairs a partial baseline commit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bountyverdict-epoch-"));
  const stateFile = join(directory, "funnel.json");
  const baselineFile = join(directory, "baseline.json");
  const historyFile = join(directory, "epochs.json");
  const state = createFunnelSnapshot();
  const initial = captureTrustedFunnelBaseline(
    state,
    "2026-07-20T20:01:00Z",
    "Initial trusted conversion epoch used by the rotation test.",
    1,
  );
  await writeFile(stateFile, `${JSON.stringify(state)}\n`);
  await writeFile(baselineFile, `${JSON.stringify(initial)}\n`);
  const env = {
    ...process.env,
    START_FUNNEL_EPOCH: "YES",
    FUNNEL_ROTATION_ID: "rotation-test-001",
    FUNNEL_EPOCH_REASON: "Exclude an owner-triggered downstream directory crawl from conversion measurement.",
    QUIET_PERIOD_SECONDS: "60",
    FUNNEL_STATE_FILE: stateFile,
    TRUSTED_FUNNEL_BASELINE_FILE: baselineFile,
    TRUSTED_FUNNEL_HISTORY_FILE: historyFile,
  };
  const script = new URL("../scripts/start-funnel-epoch.ts", import.meta.url);
  const first = await execFileAsync(process.execPath, ["--experimental-strip-types", script.pathname], { env });
  assert.match(first.stdout, /draining_started/);
  const draining = JSON.parse(await readFile(historyFile, "utf8"));
  draining.rotation.stable_since = new Date(Date.now() - 120_000).toISOString();
  await writeFile(historyFile, `${JSON.stringify(draining)}\n`);
  const automaticEnv = { ...env, FUNNEL_ROTATION_ID: "AUTO", FUNNEL_EPOCH_REASON: "" };
  const second = await execFileAsync(process.execPath, ["--experimental-strip-types", script.pathname], { env: automaticEnv });
  assert.match(second.stdout, /"status": "activated"/);
  const activated = JSON.parse(await readFile(historyFile, "utf8"));
  const closed = activated.epochs.find((epoch: any) => epoch.id === 1);
  const active = activated.epochs.find((epoch: any) => epoch.id === 2);
  assert.equal(closed.status, "closed");
  assert.equal(closed.conversion_eligible, false);
  assert.equal(active.status, "active");
  assert.equal(active.conversion_eligible, true);
  assert.equal(
    trustedBoundaryFingerprint(trustedFunnelBaseline(closed.final)!),
    trustedBoundaryFingerprint(trustedFunnelBaseline(active.baseline)!),
  );
  assert.deepEqual(trustedFunnelBaseline(JSON.parse(await readFile(baselineFile, "utf8"))), active.baseline);

  await writeFile(baselineFile, `${JSON.stringify(initial)}\n`);
  const repaired = await execFileAsync(process.execPath, ["--experimental-strip-types", script.pathname], { env });
  assert.match(repaired.stdout, /activated_baseline_repaired/);
  assert.deepEqual(trustedFunnelBaseline(JSON.parse(await readFile(baselineFile, "utf8"))), active.baseline);

  const idle = await execFileAsync(process.execPath, ["--experimental-strip-types", script.pathname], { env: automaticEnv });
  assert.match(idle.stdout, /idle_no_pending_rotation/);
  const nextEnv = {
    ...env,
    FUNNEL_ROTATION_ID: "rotation-test-002",
    FUNNEL_EPOCH_REASON: "A second autonomous marketplace audit needs its own excluded drain window.",
  };
  const next = await execFileAsync(process.execPath, ["--experimental-strip-types", script.pathname], { env: nextEnv });
  assert.match(next.stdout, /draining_started/);
  const recurrent = JSON.parse(await readFile(historyFile, "utf8"));
  assert.equal(recurrent.rotation.target_epoch_id, 3);
  assert.equal(recurrent.epochs.find((epoch: any) => epoch.id === 2).conversion_eligible, false);
  assert.equal(recurrent.completed_rotations.length, 1);
});
