import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSmitheryServer,
  smitherySearchObservation,
  SMITHERY_DESCRIPTION,
  SMITHERY_DISPLAY_NAME,
  SMITHERY_QUALIFIED_NAME,
  SMITHERY_TOOL_NAMES,
} from "../src/smithery.ts";

const server = {
  qualifiedName: SMITHERY_QUALIFIED_NAME,
  displayName: SMITHERY_DISPLAY_NAME,
  description: SMITHERY_DESCRIPTION,
  remote: true,
  tools: SMITHERY_TOOL_NAMES.map((name) => ({ name, description: `Use ${name}.` })),
  connections: [{ type: "http", deploymentUrl: "https://bountyverdict--owner.run.tools", configSchema: {} }],
};

test("normalizes only the exact live Smithery metadata and seven-tool catalog", () => {
  const normalized = normalizeSmitheryServer(server);
  assert.equal(normalized.listed, true);
  assert.equal(normalized.tool_count, 7);
  assert.deepEqual(normalized.tool_names, [...SMITHERY_TOOL_NAMES]);
  assert.equal(normalized.deployment_url, "https://bountyverdict--owner.run.tools/");
  assert.throws(() => normalizeSmitheryServer({ ...server, remote: false }), /identity/);
  assert.throws(() => normalizeSmitheryServer({ ...server, description: "Generic developer tools." }), /identity/);
  assert.throws(() => normalizeSmitheryServer({ ...server, tools: server.tools.slice(1) }), /catalog drifted/);
});

test("retains bounded Smithery rank and use telemetry without inventing misses", () => {
  const response = {
    servers: [
      { qualifiedName: "other/server", score: 1, useCount: 10 },
      { qualifiedName: SMITHERY_QUALIFIED_NAME, score: 0.5, useCount: 0 },
    ],
  };
  assert.deepEqual(smitherySearchObservation(response, "diagnose CI"), {
    query: "diagnose CI",
    found: true,
    rank: 2,
    score: 0.5,
    use_count: 0,
  });
  assert.deepEqual(smitherySearchObservation({ servers: [] }, "missing task"), {
    query: "missing task",
    found: false,
    rank: null,
    score: null,
    use_count: null,
  });
  assert.throws(() => smitherySearchObservation({ servers: [
    { qualifiedName: SMITHERY_QUALIFIED_NAME, score: 0.5, useCount: 0 },
    { qualifiedName: SMITHERY_QUALIFIED_NAME, score: 0.4, useCount: 0 },
  ] }, "duplicate"), /duplicated/);
});
