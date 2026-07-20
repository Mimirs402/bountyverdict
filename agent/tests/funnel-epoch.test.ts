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
} from "../src/funnel-telemetry.ts";
import { captureTrustedFunnelBaseline, trustedBoundaryFingerprint, trustedFunnelBaseline } from "../src/funnel-epoch.ts";

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
  assert.equal(baseline.external_by_product.single.challenges_402, 1);
  assert.equal(baseline.by_channel.owner_automation.challenges_402, 1);
  assert.deepEqual(trustedFunnelBaseline(baseline), baseline);
});

test("loads legacy epoch-one baselines and rejects malformed records", () => {
  const baseline = captureTrustedFunnelBaseline(
    createFunnelSnapshot(),
    "2026-07-20T21:05:00Z",
    "A sufficiently descriptive clean measurement boundary reason.",
    1,
  ) as any;
  delete baseline.epoch_id;
  assert.equal(trustedFunnelBaseline(baseline)?.epoch_id, 1);
  assert.equal(trustedFunnelBaseline({ ...baseline, schema_version: 2 }), null);
});

test("epoch stability ignores owner automation but changes on external counters", () => {
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

test("epoch rotation closes and opens at one boundary and repairs a partial baseline commit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bountyverdict-epoch-"));
  const stateFile = join(directory, "funnel.json");
  const baselineFile = join(directory, "baseline.json");
  const historyFile = join(directory, "epochs.json");
  const state = createFunnelSnapshot("2026-07-20T20:00:00Z");
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
  const second = await execFileAsync(process.execPath, ["--experimental-strip-types", script.pathname], { env });
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
});
