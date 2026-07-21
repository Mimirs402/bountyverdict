import assert from "node:assert/strict";
import test from "node:test";
import {
  canReuseMcpDownstreamStatus,
  parseClineMarketplaceCatalog,
  glamaConnectorStatus,
  parseAgentageGetResponse,
  parseAgentageSearchResponse,
  parseAwesomeMcpServersReadme,
  parseDockerMcpHubPage,
  parseDockerMcpRegistryDefinition,
  parseKiloMarketplaceCatalog,
  parseKiloMarketplaceDefinition,
  parseMcpObservatoryDetail,
  parseMcpDirectoryPage,
  parseMcpServersOrgPage,
  parseMcpubGetResponse,
  parseMcpubSearchLiveResponse,
  parseOneMcpRegistryShow,
  parseQtMcpRegistry,
  parseTensorBlockProfile,
  parseTensorBlockSearch,
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

test("recognizes only the exact TensorBlock search entry and remote profile", () => {
  const id = "github-cristianmoroaica-bountyverdict-038d60c1";
  const search = parseTensorBlockSearch({
    count: 1,
    limit: 20,
    query: "bountyverdict",
    filters: { category: null, transport: null, auth: null },
    servers: [{
      id,
      name: "BountyVerdict Agent Decision Tools",
      primaryUrl: repository,
      profilePath: `/v1/servers/${id}`,
      webProfilePath: `https://tensorblock.co/mcp/servers/${id}`,
      sourcePullRequest: 1312,
    }],
  }, id, repository, 1312);
  assert.equal(search.listed, true);
  assert.equal(search.source_pull_request, 1312);

  const profile = parseTensorBlockProfile({
    id,
    name: "BountyVerdict Agent Decision Tools",
    category: "Developer Productivity & Utilities",
    links: { primary: repository, repo: repository, endpoint },
    transport: ["streamable-http"],
    auth: { type: "none", notes: [] },
    license: "MIT",
  }, id, repository, endpoint);
  assert.equal(profile.contract_verified, true);
  assert.equal(parseTensorBlockProfile({
    id,
    name: "BountyVerdict Agent Decision Tools",
    category: "Developer Productivity & Utilities",
    links: { primary: repository, repo: repository, endpoint: "https://wrong.example/mcp" },
    transport: ["streamable-http"],
    auth: { type: "none", notes: [] },
    license: "MIT",
  }, id, repository, endpoint).contract_verified, false);
  assert.equal(parseTensorBlockSearch({ count: 0, limit: 20, query: "bountyverdict", servers: [] }, id, repository, 1312).listed, false);
  assert.throws(() => parseTensorBlockSearch({ count: 51, limit: 20, query: "bountyverdict", servers: [] }, id, repository, 1312), /malformed/);
  assert.throws(() => parseTensorBlockSearch({
    count: 1,
    limit: 20,
    query: "bountyverdict",
    servers: [{
      id,
      primaryUrl: repository,
      profilePath: `/v1/servers/${id}`,
      webProfilePath: `https://tensorblock.co/mcp/servers/${id}`,
      sourcePullRequest: 999,
    }],
  }, id, repository, 1312), /drifted/);
});

test("recognizes only the exact Docker remote registry and catalog contracts", () => {
  const definition = `name: bountyverdict\ntype: remote\nabout:\n  title: BountyVerdict Agent Decision Tools\n  description: Six read-only tools settle through x402.\nremote:\n  transport_type: streamable-http\n  url: ${endpoint}\n`;
  assert.equal(parseDockerMcpRegistryDefinition(definition, endpoint).contract_verified, true);
  assert.equal(parseDockerMcpRegistryDefinition(definition.replace(endpoint, "https://wrong.example/mcp"), endpoint).contract_verified, false);
  assert.equal(parseDockerMcpRegistryDefinition(`${definition}  SkillVerdict\n`, endpoint).skillverdict_contamination_risk, true);
  assert.throws(() => parseDockerMcpRegistryDefinition(`${definition}name: bountyverdict\n`, endpoint), /duplicated/);

  const page = `<html><h1>BountyVerdict Agent Decision Tools</h1><span>streamable-http</span><span>${endpoint}</span></html>`;
  assert.equal(parseDockerMcpHubPage(page, endpoint).contract_verified, true);
  assert.equal(parseDockerMcpHubPage(page.replace(endpoint, "https://wrong.example/mcp"), endpoint).contract_verified, false);
});

test("distinguishes MCPServers.org repository placement from a verified remote contract", () => {
  const repositoryOnly = parseMcpServersOrgPage(
    `<main><h1>BountyVerdict Agent Decision Tools</h1><a href="${repository}">GitHub</a></main>`,
    repository,
    endpoint,
  );
  assert.equal(repositoryOnly.listed, true);
  assert.equal(repositoryOnly.repository_metadata_verified, true);
  assert.equal(repositoryOnly.contract_verified, false);

  const remote = parseMcpServersOrgPage(
    `<main><h1>BountyVerdict Agent Decision Tools</h1><a href="${repository}">GitHub</a><code>${endpoint}</code><p>Streamable HTTP over x402</p></main>`,
    repository,
    endpoint,
  );
  assert.equal(remote.contract_verified, true);

  const contaminated = parseMcpServersOrgPage(
    `<h1>BountyVerdict Agent Decision Tools</h1><a href="${repository}">GitHub</a><code>${endpoint}</code><p>Streamable HTTP x402 SkillVerdict</p>`,
    repository,
    endpoint,
  );
  assert.equal(contaminated.skillverdict_contamination_risk, true);
  assert.equal(contaminated.contract_verified, false);

  assert.equal(parseMcpServersOrgPage("not found", repository, endpoint).listed, false);
  assert.throws(() => parseMcpServersOrgPage("x".repeat(2_000_001), repository, endpoint), /unbounded/);
});

test("distinguishes MCP.Directory repository placement from remote x402 metadata", () => {
  const repositoryOnly = parseMcpDirectoryPage(
    `<main><h1>BountyVerdict Agent Decision Tools</h1><a href="${repository}">GitHub</a></main>`,
    repository,
    endpoint,
  );
  assert.equal(repositoryOnly.listed, true);
  assert.equal(repositoryOnly.repository_metadata_verified, true);
  assert.equal(repositoryOnly.remote_metadata_verified, false);

  const remote = parseMcpDirectoryPage(
    `<main><h1>BountyVerdict Agent Decision Tools</h1><a href="${repository}">GitHub</a><code>${endpoint}</code><span>Remote streamable-http x402</span></main>`,
    repository,
    endpoint,
  );
  assert.equal(remote.remote_metadata_verified, true);

  const contaminated = parseMcpDirectoryPage(
    `<h1>BountyVerdict Agent Decision Tools</h1><a href="${repository}">GitHub</a><code>${endpoint}</code><p>streamable-http x402 /api/skill</p>`,
    repository,
    endpoint,
  );
  assert.equal(contaminated.skillverdict_contamination_risk, true);
  assert.equal(contaminated.remote_metadata_verified, false);

  assert.equal(parseMcpDirectoryPage("not found", repository, endpoint).listed, false);
  assert.throws(() => parseMcpDirectoryPage("x".repeat(2_000_001), repository, endpoint), /unbounded/);
});

test("recognizes only the exact Cline in-agent install contract", () => {
  const catalog = (entry: Record<string, unknown>) => ({
    version: 1,
    generatedAt: "2026-07-21T05:00:00.000Z",
    baseUrl: "https://cline.github.io/marketplace",
    counts: { total: 1, mcp: 1 },
    entries: [entry],
  });
  const entry = {
    id: "bountyverdict",
    type: "mcp",
    name: "BountyVerdict Agent Decision Tools",
    description: "Six read-only tools return evidence-linked verdicts and request x402 payment only after valid input.",
    repo: repository,
    install: {
      args: ["bountyverdict", "--transport", "http", endpoint],
      command: `cline mcp install bountyverdict --transport http ${endpoint}`,
    },
  };
  const exact = parseClineMarketplaceCatalog(catalog(entry), repository, endpoint);
  assert.equal(exact.listed, true);
  assert.equal(exact.contract_verified, true);

  const drifted = parseClineMarketplaceCatalog(catalog({
    ...entry,
    install: { ...entry.install, args: ["bountyverdict", "--transport", "sse", endpoint] },
  }), repository, endpoint);
  assert.equal(drifted.listed, true);
  assert.equal(drifted.contract_verified, false);

  const contaminated = parseClineMarketplaceCatalog(catalog({
    ...entry,
    description: `${entry.description} Includes SkillVerdict.`,
  }), repository, endpoint);
  assert.equal(contaminated.skillverdict_contamination_risk, true);
  assert.equal(contaminated.contract_verified, false);

  const requiresSecret = parseClineMarketplaceCatalog(catalog({
    ...entry,
    install: { ...entry.install, env: { API_KEY: "required" } },
  }), repository, endpoint);
  assert.equal(requiresSecret.listed, true);
  assert.equal(requiresSecret.contract_verified, false);

  assert.equal(parseClineMarketplaceCatalog({ ...catalog(entry), entries: [] }, repository, endpoint).listed, false);
  assert.throws(() => parseClineMarketplaceCatalog({ ...catalog(entry), entries: [entry, entry] }, repository, endpoint), /duplicated/);
});

test("recognizes only Kilo's exact secret-free remote marketplace contract", () => {
  const definition = `id: bountyverdict
name: BountyVerdict Agent Decision Tools
description: Six read-only x402 tools return evidence-linked decisions. Invalid input is rejected before payment.
author: Cristian Moroaica
url: ${repository}
category: development
prerequisites:
  - An x402-compatible wallet with Base USDC is required only for paid tool calls; the server requires no account or API key
content:
  - name: Remote Streamable HTTP
    content: |
      {
        "type": "streamable-http",
        "url": "${endpoint}"
      }
`;
  const exact = parseKiloMarketplaceDefinition(definition, repository, endpoint);
  assert.equal(exact.listed, true);
  assert.equal(exact.contract_verified, true);

  const secretRequired = parseKiloMarketplaceDefinition(
    `${definition}parameters:\n  - name: API key\n    key: API_KEY\n`,
    repository,
    endpoint,
  );
  assert.equal(secretRequired.contract_verified, false);
  assert.equal(parseKiloMarketplaceDefinition(definition.replace(endpoint, "https://wrong.example/mcp"), repository, endpoint).contract_verified, false);

  const generated = `items:\n  - id: another\n    name: Another\n${definition.split("\n").map((line, index) => index === 0 ? `  - ${line}` : `    ${line}`).join("\n")}  - id: later\n    name: Later\n`;
  assert.equal(parseKiloMarketplaceCatalog(generated, repository, endpoint).contract_verified, true);
  assert.equal(parseKiloMarketplaceCatalog("items:\n  - id: another\n", repository, endpoint).listed, false);
  assert.throws(() => parseKiloMarketplaceCatalog(`${generated}${generated}`, repository, endpoint), /duplicated/);
});

test("recognizes bounded Agentage official-registry search and detail contracts", () => {
  const slug = "io-github-cristianmoroaica-bountyverdict";
  const response = (text: string) => ({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text }] },
  });
  assert.equal(parseAgentageSearchResponse(response(`No MCP servers matched "bountyverdict".`), slug).listed, false);
  assert.equal(parseAgentageSearchResponse(response(
    `1. **BountyVerdict** \`${slug}\` - match 1 · remote\n   https://catalog.agentage.io/mcp/${slug}`,
  ), slug).listed, true);
  const detailResponse = (detail: Record<string, unknown>) => ({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: "Formatted detail output may change." }],
      structuredContent: detail,
    },
  });
  assert.equal(parseAgentageGetResponse(detailResponse({
    slug,
    is_official: true,
    details_url: `https://catalog.agentage.io/mcp/${slug}`,
    remotes: [{ type: "streamable-http", url: endpoint }],
  }), slug, endpoint).contract_verified, true);
  assert.equal(parseAgentageGetResponse(detailResponse({
    slug,
    is_official: false,
    details_url: `https://catalog.agentage.io/mcp/${slug}`,
    remotes: [{ type: "streamable-http", url: endpoint }],
  }), slug, endpoint).contract_verified, false);
  assert.equal(parseAgentageGetResponse({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: "Unknown slug. Use mcp_search to find the right slug." }],
      isError: true,
    },
  }, slug, endpoint).listed, false);
  assert.throws(() => parseAgentageSearchResponse(response(
    `\`${slug}\` https://catalog.agentage.io/mcp/${slug}\n\`${slug}\` https://catalog.agentage.io/mcp/${slug}`,
  ), slug), /duplicated/);
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
