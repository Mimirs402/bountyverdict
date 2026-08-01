import assert from "node:assert/strict";
import test from "node:test";
import {
  activeReleaseIdentity,
  validateFunctionalCanaryRelease,
} from "../src/functional-canary-release.ts";

const productionApi = "https://bountyverdict-agent-production.mimirslab.workers.dev";
const manifest = {
  status: "active",
  release_version: "1.1.25",
  worker_version_id: "12345678-1234-1234-1234-123456789abc",
  production_api: productionApi,
  updated_at: "2026-07-31T15:14:50.734Z",
};
const canary = {
  checked_at: "2026-07-31T15:20:00.000Z",
  release: {
    verified: true,
    release_version: "1.1.25",
    worker_version_id: "12345678-1234-1234-1234-123456789abc",
    mcp_server_version: "1.1.25",
    mcp_worker_version_id: "12345678-1234-1234-1234-123456789abc",
    manifest_updated_at: "2026-07-31T15:14:50.734Z",
  },
};

test("binds functional evidence to the active manifest and live MCP version", () => {
  assert.deepEqual(activeReleaseIdentity(manifest, productionApi), {
    release_version: "1.1.25",
    worker_version_id: "12345678-1234-1234-1234-123456789abc",
    updated_at: "2026-07-31T15:14:50.734Z",
    production_api: productionApi,
  });
  assert.deepEqual(validateFunctionalCanaryRelease(canary, manifest, productionApi), {
    release_version: "1.1.25",
    worker_version_id: "12345678-1234-1234-1234-123456789abc",
    updated_at: "2026-07-31T15:14:50.734Z",
    production_api: productionApi,
  });
});

test("rejects stale, mismatched, and inactive release evidence", () => {
  assert.throws(() => validateFunctionalCanaryRelease({
    ...canary,
    checked_at: "2026-07-31T15:00:00.000Z",
  }, manifest, productionApi), /predates/);
  assert.throws(() => validateFunctionalCanaryRelease({
    ...canary,
    release: { ...canary.release, mcp_server_version: "1.1.17" },
  }, manifest, productionApi), /does not match/);
  assert.throws(() => validateFunctionalCanaryRelease({
    ...canary,
    release: { ...canary.release, worker_version_id: "87654321-4321-4321-4321-cba987654321" },
  }, manifest, productionApi), /does not match/);
  assert.throws(() => validateFunctionalCanaryRelease(canary, {
    ...manifest,
    status: "awaiting_production",
  }, productionApi), /not active/);
  assert.throws(() => validateFunctionalCanaryRelease(canary, {
    ...manifest,
    production_api: "https://example.com",
  }, productionApi), /another production API/);
});
