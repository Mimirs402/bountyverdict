import test from "node:test";
import assert from "node:assert/strict";
import { activateManifest } from "../src/manifest.ts";

const manifest = {
  schema_version: "1.0",
  product: "BountyVerdict",
  status: "awaiting_production" as const,
  production_api: null,
  updated_at: "2026-07-20T00:00:00.000Z",
};

test("manifest activation records a verified HTTPS production origin", () => {
  const result = activateManifest(
    manifest,
    "https://bountyverdict-agent.example.workers.dev",
    new Date("2026-07-20T12:00:00Z"),
  );
  assert.equal(result.status, "active");
  assert.equal(result.production_api, "https://bountyverdict-agent.example.workers.dev");
  assert.equal(result.updated_at, "2026-07-20T12:00:00.000Z");
  const marketplaces = result.marketplaces as Record<string, any>;
  assert.equal(marketplaces.the402.provider_id, "p_d4b4ece39162409b");
  assert.equal(marketplaces.the402.services.length, 6);
  assert.equal(marketplaces.the402.services.some((service: any) => service.name === "SkillVerdict"), false);
  assert.equal(marketplaces.the402.subscription_plan.plan_id, "plan_ec6c49878dc34636");
  assert.equal(marketplaces.the402.subscription_plan.maximum_requests_per_period, 20);
  assert.match(marketplaces.the402.services[0].purchase_endpoint, /^https:\/\/api\.the402\.ai\/v1\/services\/svc_/);
  assert.equal(marketplaces.near_agent_market.provider_id, "51ebba6e-65e9-49b2-b23b-6561b2375179");
  assert.equal(marketplaces.near_agent_market.services.length, 6);
  assert.equal(marketplaces.near_agent_market.services.some((service: any) => service.name === "SkillVerdict"), false);
  assert.match(marketplaces.near_agent_market.services[0].hire_url, /^https:\/\/market\.near\.ai\/hire\?service_id=/);
  assert.match(marketplaces.near_agent_market.services[0].invoke_endpoint, /^https:\/\/market\.near\.ai\/v1\/services\//);
});

test("manifest activation rejects non-origin and non-HTTPS URLs", () => {
  assert.throws(() => activateManifest(manifest, "http://example.com"), /HTTPS origin/);
  assert.throws(() => activateManifest(manifest, "https://example.com/api"), /HTTPS origin/);
  assert.throws(() => activateManifest(manifest, "https://user:pass@example.com"), /HTTPS origin/);
});
