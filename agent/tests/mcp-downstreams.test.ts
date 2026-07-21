import assert from "node:assert/strict";
import test from "node:test";
import { glamaConnectorStatus, parseQtMcpRegistry } from "../src/mcp-downstreams.ts";

const name = "io.github.cristianmoroaica/bountyverdict";
const version = "1.0.1";
const endpoint = "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp";

test("recognizes exact active remote propagation into the Qt Creator mirror", () => {
  const result = parseQtMcpRegistry({
    count: 2,
    generated_at: "2026-07-21T03:00:00.000Z",
    servers: [
      { name, version: "1.0.0", status: "active", remotes: [{ type: "streamable-http", url: endpoint }] },
      { name, version, status: "active", remotes: [{ type: "streamable-http", url: endpoint }] },
    ],
  }, name, version, endpoint);
  assert.equal(result.listed, true);
  assert.deepEqual(result.observed_versions, ["1.0.0", "1.0.1"]);
  assert.equal(result.server_count, 2);
});

test("keeps pending and drifted Qt entries distinct from exact propagation", () => {
  const result = parseQtMcpRegistry({
    count: 2,
    generated_at: "2026-07-21T03:00:00.000Z",
    servers: [
      { name, version: "1.0.0", status: "active", remotes: [{ type: "streamable-http", url: endpoint }] },
      { name, version, status: "active", remotes: [{ type: "streamable-http", url: "https://wrong.example/mcp" }] },
    ],
  }, name, version, endpoint);
  assert.equal(result.listed, false);
  assert.deepEqual(result.observed_versions, ["1.0.0", "1.0.1"]);
});

test("rejects malformed or unbounded Qt mirrors", () => {
  assert.throws(() => parseQtMcpRegistry({ count: 1, generated_at: "bad", servers: [] }, name, version, endpoint));
  assert.throws(() => parseQtMcpRegistry({ count: 50_001, generated_at: "2026-07-21T03:00:00Z", servers: [] }, name, version, endpoint));
  assert.throws(() => parseQtMcpRegistry({ count: 2, generated_at: "2026-07-21T03:00:00Z", servers: [] }, name, version, endpoint));
});

test("classifies only exact Glama listing and pending statuses", () => {
  assert.deepEqual(glamaConnectorStatus(200, "https://glama.example/connector"), {
    listed: true,
    status: "listed",
    connector_url: "https://glama.example/connector",
    http_status: 200,
    accounting_note: "This bounded owner-run propagation check is not an impression, purchase, or revenue event.",
  });
  assert.equal(glamaConnectorStatus(404, "https://glama.example/connector").status, "pending_registry_ingestion");
  assert.throws(() => glamaConnectorStatus(403, "https://glama.example/connector"));
});
