import assert from "node:assert/strict";
import test from "node:test";
import { parseMcpMarketplaceListing, parseMcpMarketplaceSearchResponse } from "../src/mcp-marketplace.ts";

const name = "io.github.Mimirs402/bountyverdict";
const slug = "io-github-mimirs402-bountyverdict";
const version = "1.1.10";
const repository = "https://github.com/Mimirs402/bountyverdict";
const endpoint = "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp?source=mcp-registry";
const tools = [
  "check_github_bounty",
  "rank_github_bounties",
  "audit_agent_harness",
  "diagnose_github_actions_run",
  "classify_github_actions_flake",
  "check_mcp_tool_drift",
] as const;

const listing = (overrides: Record<string, unknown> = {}) => ({
  id: "0cad778b-08c4-4d11-9e29-74484a8e75e5",
  name,
  slug,
  tagline: "Read-only GitHub engineering decisions.",
  description: `Remote endpoints:\nstreamable-http: ${endpoint}`,
  price_cents: 0,
  pricing_type: "free",
  security_score: 10,
  install_count: 0,
  status: "approved",
  created_at: "2026-07-21T23:30:05.27806+00:00",
  github_url: repository,
  version,
  import_source: "registry",
  claimed_at: null,
  remote_url: endpoint,
  install_config: { mcpServers: { [slug]: { url: endpoint } } },
  security_report: {
    overall_score: 10,
    risk_level: "low",
    summary: "Valid MCP server (1 strong, 1 medium validity signals). No known CVEs in dependencies. Imported from the Official MCP Registry.",
    remote_probe: {
      probe_succeeded: true,
      protocol_version: "2025-11-25",
      tool_count: tools.length,
      tool_names: tools,
      response_time_ms: 64,
      server_name: "BountyVerdict",
      endpoint_url: endpoint,
    },
  },
  ...overrides,
});

const page = (server = listing()) => {
  const payload = `25:["$","$L27",null,{"server":${JSON.stringify(server)},"reviews":[]}]`;
  return `<html><script>self.__next_f.push(${JSON.stringify([1, payload])})</script></html>`;
};

const parse = (html: string) => parseMcpMarketplaceListing(html, name, slug, version, repository, endpoint, tools);

test("verifies the exact Registry-imported marketplace listing without calling installs purchases", () => {
  const result = parse(page());
  assert.equal(result.listed, true);
  assert.equal(result.contract_verified, true);
  assert.equal(result.install_count, 0);
  assert.equal(result.security_score, 10);
  assert.equal(result.remote_probe_tool_count, 6);
  assert.equal(result.pricing_disclosure_state, "misclassified_free");
  assert.equal(result.claimed, false);
});

test("retains bounded anonymous install telemetry", () => {
  const result = parse(page(listing({ install_count: 17 })));
  assert.equal(result.install_count, 17);
});

test("surfaces endpoint and probe drift without accepting the technical contract", () => {
  const otherEndpoint = "https://example.com/mcp";
  const result = parse(page(listing({
    remote_url: otherEndpoint,
    install_config: { mcpServers: { [slug]: { url: otherEndpoint } } },
  })));
  assert.equal(result.contract_verified, false);
});

test("rejects duplicate, malformed, and unbounded listing telemetry", () => {
  const valid = page();
  assert.throws(() => parse(valid + valid), /duplicate exact listing/);
  assert.throws(() => parse(page(listing({ install_count: -1 }))), /malformed or unbounded/);
  assert.throws(() => parse("x".repeat(2_000_001)), /invalid or unbounded/);
});

const searchResult = (resultSlug: string) => ({
  name: "Result",
  slug: resultSlug,
  url: `https://mcp-marketplace.io/server/${resultSlug}`,
  tagline: "A bounded result",
  pricing: "Free",
  security_score: 10,
  critical_findings: 0,
  has_critical_findings: false,
});

test("retains exact rank from an agent-facing marketplace search", () => {
  const result = parseMcpMarketplaceSearchResponse({
    total_matches: 2,
    page: 1,
    limit: 25,
    returned: 2,
    ranking_mode: "semantic",
    has_more: false,
    results: [searchResult("another-server"), searchResult(slug)],
  }, slug, 25);
  assert.deepEqual(result, { ranking_mode: "semantic", total_matches: 2, returned: 2, rank: 2 });
});

test("retains an empty substring fallback without inventing a marketplace miss", () => {
  const result = parseMcpMarketplaceSearchResponse({
    total_matches: 0,
    page: 1,
    limit: 25,
    returned: 0,
    ranking_mode: "substring",
    has_more: false,
    results: [],
  }, slug, 25);
  assert.deepEqual(result, { ranking_mode: "substring", total_matches: 0, returned: 0, rank: null });
});

test("rejects malformed and duplicate marketplace search results", () => {
  assert.throws(() => parseMcpMarketplaceSearchResponse({
    total_matches: 2,
    page: 1,
    limit: 25,
    returned: 2,
    ranking_mode: "semantic",
    has_more: false,
    results: [searchResult(slug), searchResult(slug)],
  }, slug, 25), /duplicated a server/);
  assert.throws(() => parseMcpMarketplaceSearchResponse({
    total_matches: 0,
    page: 1,
    limit: 25,
    returned: 1,
    ranking_mode: "substring",
    has_more: false,
    results: [],
  }, slug, 25), /malformed or unbounded/);
});
