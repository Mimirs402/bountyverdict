import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentToolsCloudContractDrift,
  parseAgentToolsCloudMcpBuyerQuery,
  parseAgentToolsCloudListing,
  parseAgentToolsCloudMcpListing,
} from "../src/agent-tools-cloud.ts";
import { PRODUCT_CATALOG, PRODUCT_KEYS } from "../src/product-catalog.ts";

const productionOrigin = "https://bountyverdict-agent-production.mimirslab.workers.dev";
const slug = "bountyverdict-agent-production-mimirslab-workers-dev-bazaar";
const revenueWallet = "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614";
const expectedResources = PRODUCT_KEYS.map((product) => ({
  product,
  url: `${productionOrigin}${PRODUCT_CATALOG[product].path}`,
}));
const listedResources = expectedResources.filter(({ product }) => product !== "mcpdrift");

function payload(overrides: Record<string, unknown> = {}) {
  const prices = listedResources.map(({ product }) => Number(PRODUCT_CATALOG[product].priceUsd.slice(1)));
  return {
    slug,
    url: productionOrigin,
    name: new URL(productionOrigin).host,
    well_known_url: `${productionOrigin}/.well-known/x402`,
    description: "FlakeVerdict retry decision",
    resource_count: listedResources.length,
    resource_samples: listedResources.map(({ url }) => ({ url, kind: "http" })),
    payment: {
      currency: "USDC",
      chains: ["eip155:8453"],
      pay_to: revenueWallet,
      price_min_usd: Math.min(...prices),
      price_max_usd: Math.max(...prices),
    },
    health: "ok",
    http_status: 200,
    latency_ms: 96,
    x402_ok: 0,
    health_checked: 1_784_592_290,
    last_seen: 1_784_582_728,
    ...overrides,
  };
}

const search = { count: 1, services: [{ slug }] };
const options = { productionOrigin, slug, revenueWallet, expectedResources };

test("Agent Tools Cloud keeps a failed payment probe visible on a partial organic listing", () => {
  const parsed = parseAgentToolsCloudListing(search, payload(), options);
  assert.equal(parsed.status, "listed_partial_probe_failed");
  assert.equal(parsed.x402_probe_ok, false);
  assert.equal(parsed.x402_probe_status, "failed");
  assert.deepEqual(parsed.missing_products, ["mcpdrift"]);
  assert.equal(parsed.description_coverage, "narrow_or_incomplete");
});

test("Agent Tools Cloud recognizes a complete suite-wide payable listing", () => {
  const prices = expectedResources.map(({ product }) => Number(PRODUCT_CATALOG[product].priceUsd.slice(1)));
  const parsed = parseAgentToolsCloudListing(search, payload({
    description: "Bounty, repository instruction, GitHub Actions CI workflow, and MCP checks",
    resource_count: expectedResources.length,
    resource_samples: expectedResources.map(({ url }) => ({ url, kind: "http" })),
    payment: {
      currency: "USDC",
      chains: ["eip155:8453"],
      pay_to: revenueWallet,
      price_min_usd: Math.min(...prices),
      price_max_usd: Math.max(...prices),
    },
    x402_ok: 1,
  }), options);
  assert.equal(parsed.status, "listed");
  assert.equal(parsed.x402_probe_ok, true);
  assert.equal(parsed.description_coverage, "suite_wide");
});

test("Agent Tools Cloud rejects wrong-wallet, unknown-route, and invalid probe telemetry as contract drift", () => {
  assert.throws(() => parseAgentToolsCloudListing(search, payload({
    payment: { ...payload().payment, pay_to: "0x1111111111111111111111111111111111111111" },
  }), options), AgentToolsCloudContractDrift);
  assert.throws(() => parseAgentToolsCloudListing(search, payload({
    resource_samples: [{ url: "https://attacker.example/api", kind: "http" }],
    resource_count: 1,
  }), options), AgentToolsCloudContractDrift);
  assert.throws(() => parseAgentToolsCloudListing(search, payload({ x402_ok: 2 }), options), AgentToolsCloudContractDrift);
  assert.throws(() => parseAgentToolsCloudListing(search, payload({
    payment: { ...payload().payment, pay_to: 42 },
  }), options), AgentToolsCloudContractDrift);
  assert.throws(() => parseAgentToolsCloudListing(search, payload({
    resource_samples: [null],
    resource_count: 1,
  }), options), AgentToolsCloudContractDrift);
});

const expectedMcpTools = [
  "check_github_bounty",
  "rank_github_bounties",
  "audit_agent_harness",
  "diagnose_github_actions_run",
  "classify_github_actions_flake",
  "check_mcp_tool_drift",
];
const mcpSlug = "bountyverdict-agent-decision-tools-bountyverdict-agent-production-mimirslab-work";
const mcpEndpoint = `${productionOrigin}/mcp?source=mcp-registry`;
// Agent Tools Cloud derives homepage_url from the submitted MCP URL because
// its submission contract does not expose a separate homepage field.
const mcpHomepage = mcpEndpoint;
const mcpName = "BountyVerdict Agent Decision Tools";
const expectedMcpDescriptionPrefixes = Object.fromEntries(
  expectedMcpTools.map((name) => [name, `${name} task description`]),
);
const mcpSearch = { count: 1, total_matched: 1, servers: [{ slug: mcpSlug }] };
function mcpPayload(overrides: Record<string, unknown> = {}) {
  return {
    slug: mcpSlug,
    name: mcpName,
    homepage_url: mcpHomepage,
    endpoint_url: mcpEndpoint,
    transport: "streamable-http",
    x402_supported: 1,
    health: "ok",
    http_status: 200,
    kind: "callable",
    conformance: "pass",
    safety_verdict: "clean",
    quality_score: 82.25,
    latency_ms: 388,
    tool_count: expectedMcpTools.length,
    tools: expectedMcpTools.map((name) => ({ name, description: `${name} task description` })),
    health_checked: 1_784_651_291,
    last_seen: 1_784_651_291,
    ...overrides,
  };
}
const mcpOptions = {
  endpointUrl: mcpEndpoint,
  homepageUrl: mcpHomepage,
  name: mcpName,
  slug: mcpSlug,
  expectedTools: expectedMcpTools,
  expectedDescriptionPrefixes: expectedMcpDescriptionPrefixes,
};

test("Agent Tools Cloud verifies the refreshed six-tool x402 MCP listing", () => {
  const parsed = parseAgentToolsCloudMcpListing(mcpSearch, mcpPayload(), mcpOptions);
  assert.equal(parsed.status, "listed");
  assert.equal(parsed.x402_supported, true);
  assert.equal(parsed.listed_tools, 6);
  assert.equal(parsed.safety_verdict, "clean");
  assert.deepEqual(parsed.tool_names, expectedMcpTools);
  assert.equal(parsed.current_tool_descriptions, 6);
  assert.equal(parsed.tool_description_revision, "agent_question_v3");
});

test("Agent Tools Cloud reports stale cached tool descriptions after a card-only refresh", () => {
  const parsed = parseAgentToolsCloudMcpListing(mcpSearch, mcpPayload({
    tools: expectedMcpTools.map((name) => ({ name, description: `Old ${name} selection copy` })),
  }), mcpOptions);
  assert.equal(parsed.current_tool_descriptions, 0);
  assert.equal(parsed.tool_description_revision, "stale_pre_agent_question_v3");
});

test("Agent Tools Cloud MCP parser rejects identity, tool, and payment-support drift", () => {
  assert.throws(() => parseAgentToolsCloudMcpListing(mcpSearch, mcpPayload({ endpoint_url: "https://attacker.example/mcp" }), mcpOptions), AgentToolsCloudContractDrift);
  assert.throws(() => parseAgentToolsCloudMcpListing(mcpSearch, mcpPayload({ homepage_url: "https://attacker.example/" }), mcpOptions), AgentToolsCloudContractDrift);
  assert.throws(() => parseAgentToolsCloudMcpListing(mcpSearch, mcpPayload({ name: "BountyVerdict Agent Decision APIs" }), mcpOptions), AgentToolsCloudContractDrift);
  assert.throws(() => parseAgentToolsCloudMcpListing(mcpSearch, mcpPayload({ tools: [], tool_count: 0 }), mcpOptions), AgentToolsCloudContractDrift);
  assert.throws(() => parseAgentToolsCloudMcpListing(mcpSearch, mcpPayload({ x402_supported: 0 }), mcpOptions), AgentToolsCloudContractDrift);
});

test("Agent Tools Cloud retains only bounded owner-run MCP retrieval ranks", () => {
  const payload = {
    count: 3,
    total_matched: 7,
    servers: [{ slug: "other" }, { slug: "bountyverdict-agent-decision-apis-x402" }, { slug: mcpSlug }],
  };
  assert.deepEqual(parseAgentToolsCloudMcpBuyerQuery(payload, [mcpSlug, "bountyverdict-agent-decision-apis-x402", "bountyverdict-agent-decision-tools-x402"]), {
    found: true,
    rank: 2,
    returned_results: 3,
  });
  assert.deepEqual(parseAgentToolsCloudMcpBuyerQuery({ count: 1, total_matched: 1, servers: [{ slug: "other" }] }, [mcpSlug]), {
    found: false,
    rank: null,
    returned_results: 1,
  });
});

test("Agent Tools Cloud buyer-query parser rejects malformed and duplicate results", () => {
  assert.throws(() => parseAgentToolsCloudMcpBuyerQuery({ count: 2, total_matched: 2, servers: [{ slug: "same" }, { slug: "same" }] }, [mcpSlug]), AgentToolsCloudContractDrift);
  assert.throws(() => parseAgentToolsCloudMcpBuyerQuery({ count: 101, total_matched: 101, servers: [] }, [mcpSlug]), AgentToolsCloudContractDrift);
  assert.throws(() => parseAgentToolsCloudMcpBuyerQuery({ count: 1, total_matched: 0, servers: [{ slug: mcpSlug }] }, [mcpSlug]), AgentToolsCloudContractDrift);
});
