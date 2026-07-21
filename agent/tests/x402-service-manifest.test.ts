import test from "node:test";
import assert from "node:assert/strict";
import { createX402ServiceManifest } from "../src/x402-service-manifest.ts";

test("x402 seller manifest exposes exactly the seven paid resources", () => {
  const manifest = createX402ServiceManifest(
    "https://agent.example/path-is-ignored",
    "eip155:8453",
    "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614",
  );
  assert.equal(manifest.spec, "agent402-service-manifest/1");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.name, "BountyVerdict Agent Decision APIs");
  assert.equal(manifest.resources.length, 7);
  assert.equal(new Set(manifest.resources).size, 7);
  assert.ok(manifest.resources.every((resource) => resource.startsWith("https://agent.example/api/")));
  assert.ok(manifest.resources.includes("https://agent.example/api/skill"));
  assert.ok(manifest.resources.includes("https://agent.example/api/mcp-drift"));
  assert.ok(manifest.resources.every((resource) => !resource.endsWith("/sample")));
  assert.equal(manifest.payment.x402.primaryNetwork, "eip155:8453");
  assert.equal(manifest.payment.x402.payTo, "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614");
  assert.deepEqual(manifest.payment.x402.priceRange, { minimumUsd: 0.02, maximumUsd: 0.4 });
  assert.equal(manifest.discovery.agentManifest, "https://mimirs402.github.io/bountyverdict/agent-manifest.json");
  assert.equal(manifest.discovery.agentSkill, "https://mimirs402.github.io/bountyverdict/skills/route-github-agent-checks/SKILL.md");
  assert.equal(manifest.discovery.mcp, "https://agent.example/mcp");
  assert.equal(manifest.discovery.mcpMetadata, "https://agent.example/.well-known/mcp.json");
  assert.equal(manifest.discovery.aiCatalog, "https://agent.example/.well-known/ai-catalog.json");
  assert.equal(manifest.discovery.mcpRegistryLatest, "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.Mimirs402%2Fbountyverdict/versions/latest");
  assert.equal(manifest.capabilities.freeSamples.length, 7);
  assert.equal(manifest.capabilities.mutatesExternalSystems, false);
});

test("x402 seller manifest does not invent a payee in local development", () => {
  const manifest = createX402ServiceManifest("https://agent.example", "eip155:84532");
  assert.equal(manifest.payment.x402.payTo, null);
});
