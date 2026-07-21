import assert from "node:assert/strict";
import test from "node:test";
import app from "../src/index.ts";
import { createMcpWellKnown, createOriginAgentManifest, createOriginSkillMarkdown } from "../src/origin-discovery.ts";
import { PRODUCT_CATALOG } from "../src/product-catalog.ts";

const origin = "https://bountyverdict-agent-production.mimirslab.workers.dev";

test("origin manifest publishes six exact products without changing SkillVerdict exposure", async () => {
  const manifest = createOriginAgentManifest(origin, "eip155:8453", "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614");
  const openApiResponse = await app.request(`${origin}/openapi.json`, {}, { X402_NETWORK: "eip155:8453" });
  const openApi = await openApiResponse.json() as Record<string, any>;
  assert.equal(manifest.spec, "bountyverdict-agent-manifest/1");
  assert.equal(manifest.products.length, 6);
  assert.equal(manifest.products.some(({ id }) => id === "skill"), false);
  assert.deepEqual(manifest.products.map(({ id }) => id), ["single", "portfolio", "harness", "run", "flake", "mcpdrift"]);
  for (const product of manifest.products) {
    const expected = PRODUCT_CATALOG[product.id];
    assert.equal(product.name, expected.service);
    assert.equal(product.method, expected.method);
    assert.equal(product.url, `${origin}${expected.path}`);
    assert.equal(product.price_usdc, expected.priceUsd.slice(1));
    assert.equal(product.amount_atomic_usdc, String(expected.amountAtomic));
    assert.equal(product.free_sample, `${origin}${expected.samplePath}`);
    const fragment = new URL(product.openapi_operation).hash;
    const tokens = fragment.slice(2).split("/").map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
    assert.deepEqual(tokens, ["paths", expected.path, expected.method.toLowerCase()]);
    const resolved = tokens.reduce((value: any, token) => value?.[token], openApi);
    assert.ok(resolved, `${product.name} OpenAPI operation pointer must resolve`);
    assert.match(product.task_skill, /^https:\/\/cristianmoroaica\.github\.io\/bountyverdict\/skills\//);
  }
  assert.equal(manifest.payment.pay_to, "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614");
  assert.equal(manifest.reliability.mutates_external_systems, false);
  assert.equal(manifest.mcp.url, `${origin}/mcp`);
  assert.equal(manifest.mcp.transport, "streamable-http");
  assert.deepEqual(manifest.mcp.tools.map(({ name }) => name), [
    "check_github_bounty",
    "rank_github_bounties",
    "audit_agent_harness",
    "diagnose_github_actions_run",
    "classify_github_actions_flake",
    "check_mcp_tool_drift",
  ]);
});

test("origin skill is a truthful six-product payment-safe routing surface", () => {
  const markdown = createOriginSkillMarkdown(origin, "eip155:8453", "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614");
  assert.match(markdown, /^---\nname: bountyverdict-agent-decisions\n/);
  assert.match(markdown, /BountyVerdict Portfolio/);
  assert.match(markdown, /HarnessVerdict/);
  assert.match(markdown, /MCPDriftVerdict/);
  assert.doesNotMatch(markdown, /### SkillVerdict/);
  assert.match(markdown, /never signs, pays, executes repository code, mutates GitHub/);
  assert.match(markdown, /Never join it into a shell string or raise the cap silently/);
  assert.match(markdown, /network `eip155:8453` \(Base mainnet\)/);
  assert.match(markdown, /0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614/);
  assert.match(markdown, /Remote MCP server: https:\/\/bountyverdict-agent-production\.mimirslab\.workers\.dev\/mcp/);
});

test("origin skill uses the runtime testnet instead of inventing mainnet", () => {
  const markdown = createOriginSkillMarkdown(origin, "eip155:84532");
  assert.match(markdown, /network `eip155:84532` \(Base Sepolia\)/);
  assert.doesNotMatch(markdown, /Base mainnet/);
  assert.throws(() => createOriginSkillMarkdown(origin, "eip155:1"), /supported Base network/);
});

test("well-known MCP metadata resolves the exact paid remote without secrets", async () => {
  const metadata = createMcpWellKnown(origin, "eip155:8453");
  assert.equal(metadata.name, "io.github.cristianmoroaica/bountyverdict");
  assert.equal(metadata.url, `${origin}/mcp`);
  assert.equal(metadata.transport, "streamable-http");
  assert.equal(metadata.protocol_version, "2025-11-25");
  assert.deepEqual(metadata.payment.price_range_usdc, { minimum: "0.02", maximum: "0.40" });
  assert.doesNotMatch(JSON.stringify(metadata), /secret|private.?key|api.?key/i);

  const response = await app.request(`${origin}/.well-known/mcp.json`, {}, { X402_NETWORK: "eip155:8453" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^application\/json/);
  assert.deepEqual(await response.json(), metadata);
});

test("Worker serves origin-native manifest and skill with exact content types", async () => {
  const env = {
    X402_NETWORK: "eip155:8453",
    PAY_TO_ADDRESS: "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614",
  };
  const manifestResponse = await app.request(`${origin}/agent-manifest.json`, {}, env);
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get("content-type") || "", /^application\/json/);
  const manifest = await manifestResponse.json() as ReturnType<typeof createOriginAgentManifest>;
  assert.equal(manifest.products.length, 6);
  const skillResponse = await app.request(`${origin}/SKILL.md`, {}, env);
  assert.equal(skillResponse.status, 200);
  assert.match(skillResponse.headers.get("content-type") || "", /^text\/markdown/);
  assert.match(await skillResponse.text(), /Manifest: https:\/\/bountyverdict-agent-production\.mimirslab\.workers\.dev\/agent-manifest\.json/);

  const rootResponse = await app.request(`${origin}/`, {}, env);
  const root = await rootResponse.json() as Record<string, any>;
  assert.equal(root.agent_manifest, "https://cristianmoroaica.github.io/bountyverdict/agent-manifest.json");
  assert.equal(root.agent_skill, "https://cristianmoroaica.github.io/bountyverdict/skills/route-github-agent-checks/SKILL.md");
  assert.equal(root.distributed_agent_manifest, "/agent-manifest.json");
  assert.equal(root.distributed_agent_skill, "/SKILL.md");
  assert.equal(root.mcp.endpoint, "/mcp");
});

test("origin discovery rejects non-origin or non-HTTPS identities", () => {
  for (const value of ["http://example.com", "https://example.com/path", "https://user:pass@example.com"]) {
    assert.throws(() => createOriginAgentManifest(value, "eip155:8453"), /exact HTTPS origin/);
    assert.throws(() => createMcpWellKnown(value, "eip155:8453"), /exact HTTPS origin/);
  }
  assert.throws(() => createMcpWellKnown("https://example.com", "eip155:1"), /supported Base network/);
});
