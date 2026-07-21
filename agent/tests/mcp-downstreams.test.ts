import assert from "node:assert/strict";
import test from "node:test";
import { canReuseMcpDownstreamStatus, glamaConnectorStatus, parseMcpubGetResponse, parseOneMcpRegistryShow, parseQtMcpRegistry } from "../src/mcp-downstreams.ts";

const name = "io.github.cristianmoroaica/bountyverdict";
const version = "1.1.0";
const endpoint = "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp";

test("reuses downstream checks only for the exact registry release coordinates", () => {
  const now = Date.parse("2026-07-21T03:05:00Z");
  const previous = {
    checked_at: "2026-07-21T03:00:00Z",
    registry_name: name,
    registry_version: version,
    registry_endpoint: endpoint,
    mcpub: { listed: true },
  };
  assert.equal(canReuseMcpDownstreamStatus(previous, name, version, endpoint, now, 6 * 60 * 60 * 1000), true);
  assert.equal(canReuseMcpDownstreamStatus({ ...previous, registry_version: "1.0.1" }, name, version, endpoint, now, 6 * 60 * 60 * 1000), false);
  assert.equal(canReuseMcpDownstreamStatus({ ...previous, registry_endpoint: "https://wrong.example/mcp" }, name, version, endpoint, now, 6 * 60 * 60 * 1000), false);
  assert.equal(canReuseMcpDownstreamStatus({ ...previous, mcpub: { listed: false } }, name, version, endpoint, now, 6 * 60 * 60 * 1000), false);
  assert.equal(canReuseMcpDownstreamStatus(previous, name, version, endpoint, Date.parse("2026-07-21T10:00:00Z"), 6 * 60 * 60 * 1000), false);
  assert.equal(canReuseMcpDownstreamStatus({ checked_at: "bad" }, name, version, endpoint, now, 6 * 60 * 60 * 1000), false);
});

test("parses only exact bounded mcpub registrations", () => {
  const response = (payload: unknown) => ({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
  });
  assert.deepEqual(parseMcpubGetResponse(response({ status: "not_found", url: endpoint }), endpoint), {
    listed: false,
    status: "not_found",
    endpoint,
  });
  assert.deepEqual(parseMcpubGetResponse(response({
    url: endpoint,
    description: "GitHub agent decisions",
    submitted_at: 1784604000,
    source: "archive",
  }), endpoint), {
    listed: true,
    status: "registered",
    endpoint,
    description: "GitHub agent decisions",
    submitted_at_unix: 1784604000,
    source: "archive",
  });
  assert.throws(() => parseMcpubGetResponse(response({ status: "not_found", url: "https://wrong.example/mcp" }), endpoint));
  assert.throws(() => parseMcpubGetResponse({ jsonrpc: "2.0", result: { content: [] } }, endpoint));
});

test("parses 1MCP JSON output even when its CLI emits a leading info line", () => {
  assert.deepEqual(parseOneMcpRegistryShow('2026-07-21T03:02:59Z [INFO] fetching\n{"name":"example","version":"1.0.0"}\n'), {
    name: "example",
    version: "1.0.0",
  });
  assert.throws(() => parseOneMcpRegistryShow("no json"));
  assert.throws(() => parseOneMcpRegistryShow("[]"));
});

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
  assert.deepEqual(result.observed_versions, ["1.0.0", "1.1.0"]);
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
  assert.deepEqual(result.observed_versions, ["1.0.0", "1.1.0"]);
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
