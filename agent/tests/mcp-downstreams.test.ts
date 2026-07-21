import assert from "node:assert/strict";
import test from "node:test";
import {
  canReuseMcpDownstreamStatus,
  glamaConnectorStatus,
  parseAwesomeMcpServersReadme,
  parseMcpObservatoryDetail,
  parseMcpubGetResponse,
  parseMcpubSearchLiveResponse,
  parseOneMcpRegistryShow,
  parseQtMcpRegistry,
} from "../src/mcp-downstreams.ts";

const name = "io.github.cristianmoroaica/bountyverdict";
const version = "1.1.0";
const endpoint = "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp";
const repository = "https://github.com/cristianmoroaica/bountyverdict";

test("recognizes only the exact bounded Awesome MCP Servers contract", () => {
  const entry = `- [cristianmoroaica/bountyverdict](${repository}) 📇 ☁️ - Six read-only tools. Remote [endpoint](${endpoint}) over x402.`;
  assert.deepEqual(parseAwesomeMcpServersReadme(`# Developer Tools\n${entry}\n`, repository, endpoint), {
    listed: true,
    contract_verified: true,
    skillverdict_contamination_risk: false,
    repository,
    endpoint,
  });

  const wrongEndpoint = parseAwesomeMcpServersReadme(
    `${entry.replace(endpoint, "https://wrong.example/mcp")}\n`,
    repository,
    endpoint,
  );
  assert.equal(wrongEndpoint.listed, true);
  assert.equal(wrongEndpoint.contract_verified, false);

  const contaminated = parseAwesomeMcpServersReadme(`${entry} Includes SkillVerdict and /api/skill.\n`, repository, endpoint);
  assert.equal(contaminated.skillverdict_contamination_risk, true);
  assert.equal(contaminated.contract_verified, false);

  assert.throws(() => parseAwesomeMcpServersReadme(`${entry}\n${entry}\n`, repository, endpoint), /duplicated/);
  assert.throws(() => parseAwesomeMcpServersReadme("x".repeat(2_000_001), repository, endpoint), /unbounded/);
});

test("classifies exact MCP Observatory repository metadata without inventing agent readiness", () => {
  const payload = {
    server: {
      id: "github:cristianmoroaica/bountyverdict",
      name: "cristianmoroaica/bountyverdict",
      kind: "github-only",
      repoUrl: repository,
      firstSeen: "2026-07-20T15:21:42.873Z",
      lastSeen: "2026-07-21T04:03:14.313Z",
      currentVersion: null,
      tags: ["github-actions", "x402"],
      language: "TypeScript",
      license: "MIT",
    },
    releases: [
      { version: "v1.0.0", publishedAt: "2026-07-20T20:00:00Z", source: "github" },
      { version: "v1.0.3", publishedAt: "2026-07-21T01:00:00Z", source: "github" },
    ],
    deps: { out: [], in: [] },
    related: [],
  };
  assert.deepEqual(parseMcpObservatoryDetail(payload, payload.server.id, repository), {
    listed: true,
    status: "repository_metadata_only",
    server_id: payload.server.id,
    repository,
    first_seen: payload.server.firstSeen,
    last_seen: payload.server.lastSeen,
    current_version: null,
    release_versions: ["v1.0.0", "v1.0.3"],
    tags: ["github-actions", "x402"],
    language: "TypeScript",
    license: "MIT",
    endpoint_exposed: false,
    tool_schemas_exposed: false,
  });
  assert.throws(() => parseMcpObservatoryDetail({ ...payload, server: { ...payload.server, id: "github:other/repo" } }, payload.server.id, repository));
  assert.throws(() => parseMcpObservatoryDetail({ ...payload, releases: new Array(101).fill(payload.releases[0]) }, payload.server.id, repository));
});

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

test("distinguishes MCPub archive registration from exact live verification", () => {
  const response = (results: Array<Record<string, unknown>>, total = results.length) => ({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify({
      total,
      offset: 0,
      limit: 50,
      results,
      source: "live (scan_cache.csv - verified alive)",
    }) }] },
  });
  assert.deepEqual(parseMcpubSearchLiveResponse(response([]), endpoint), {
    listed: false,
    status: "not_live_verified",
    endpoint,
    matching_live_results: 0,
    returned_results: 0,
    description: null,
  });
  assert.deepEqual(parseMcpubSearchLiveResponse(response([{ url: endpoint, description: "GitHub Actions failure diagnosis" }], 12), endpoint), {
    listed: true,
    status: "verified_alive",
    endpoint,
    matching_live_results: 12,
    returned_results: 1,
    description: "GitHub Actions failure diagnosis",
  });
  assert.throws(() => parseMcpubSearchLiveResponse(response([
    { url: endpoint, description: "one" },
    { url: endpoint, description: "two" },
  ]), endpoint));
  assert.throws(() => parseMcpubSearchLiveResponse({ jsonrpc: "2.0", result: { content: [] } }, endpoint));
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
