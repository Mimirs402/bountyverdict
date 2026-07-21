import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDiscoveryExtension, validateDiscoveryExtensionSpec } from "@x402/extensions/bazaar";
import {
  discoveryExtension,
  exampleVerdict,
  portfolioDiscoveryExtension,
  portfolioExample,
} from "../src/discovery.ts";
import { harnessDiscoveryExtension } from "../src/harness-discovery.ts";
import { skillDiscoveryExtension } from "../src/skill-discovery.ts";
import { runDiscoveryExtension } from "../src/run-discovery.ts";
import { flakeDiscoveryExtension } from "../src/flake-discovery.ts";
import {
  CDP_RESOURCE_DESCRIPTION_MAX_LENGTH,
  requireCdpResourceDescription,
} from "../src/x402-resource-server.ts";
import app from "../src/index.ts";

const crawlerEnv = {
  PAY_TO_ADDRESS: "0x1111111111111111111111111111111111111111",
  X402_NETWORK: "eip155:84532",
  X402_FACILITATOR_URL: "https://facilitator.invalid",
  FLAKE_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

test("CDP facilitator resource descriptions enforce the live 500-character boundary", () => {
  assert.equal(
    requireCdpResourceDescription("a".repeat(CDP_RESOURCE_DESCRIPTION_MAX_LENGTH)).length,
    CDP_RESOURCE_DESCRIPTION_MAX_LENGTH,
  );
  assert.throws(
    () => requireCdpResourceDescription("a".repeat(CDP_RESOURCE_DESCRIPTION_MAX_LENGTH + 1)),
    /1-500 characters/,
  );
  assert.throws(() => requireCdpResourceDescription(""), /1-500 characters/);
});

test("BountyVerdict canonical POST declaration passes Bazaar schema and protocol validation", () => {
  const extension = discoveryExtension.bazaar;

  assert.equal(extension.info.input.method, "POST");
  assert.equal(extension.info.input.bodyType, "json");
  assert.deepEqual(extension.info.input.body, {
    issue_url: "https://github.com/typeorm/typeorm/issues/3357",
  });
  assert.deepEqual(validateDiscoveryExtensionSpec(extension), { valid: true });
  assert.deepEqual(validateDiscoveryExtension(extension), { valid: true });
});

test("canonical BountyVerdict POST example survives preflight and returns a payable challenge", async () => {
  const input = discoveryExtension.bazaar.info.input;
  const response = await app.request("/api/bounty-preflight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.body),
  }, crawlerEnv);
  assert.equal(response.status, 402);
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded);
  const challenge = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  assert.equal(challenge.resource.url, "http://localhost/api/bounty-preflight");
  assert.ok(challenge.resource.description.length <= CDP_RESOURCE_DESCRIPTION_MAX_LENGTH);
  assert.equal(challenge.extensions.bazaar.info.input.method, "POST");
  assert.equal(challenge.extensions.bazaar.info.input.bodyType, "json");
});

test("portfolio POST declaration passes Bazaar schema and protocol validation", () => {
  const extension = portfolioDiscoveryExtension.bazaar;
  assert.equal(extension.info.input.method, "POST");
  assert.equal(extension.info.input.bodyType, "json");
  assert.deepEqual(validateDiscoveryExtensionSpec(extension), { valid: true });
  assert.deepEqual(validateDiscoveryExtension(extension), { valid: true });
});

test("public bounty samples exactly match the real evidence snapshots advertised to agents", async () => {
  const [single, portfolio] = await Promise.all([
    readFile(new URL("../../samples/verdict.json", import.meta.url), "utf8"),
    readFile(new URL("../../samples/portfolio.json", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(JSON.parse(single), exampleVerdict);
  assert.deepEqual(JSON.parse(portfolio), portfolioExample);
  assert.match(exampleVerdict.issue.title, /Migration generation drops and creates columns/);
  assert.equal(portfolioExample.best_candidate, null);
  assert.deepEqual(portfolioExample.counts, {
    submitted: 2,
    checked: 2,
    viable: 0,
    caution: 0,
    avoid: 2,
    failed: 0,
  });
});

test("HarnessVerdict canonical POST declaration is a strict JSON body", () => {
  const extension = harnessDiscoveryExtension.bazaar;
  const bodySchema = extension.schema.properties.input.properties.body;
  assert.equal(extension.info.input.method, "POST");
  assert.equal(extension.info.input.bodyType, "json");
  assert.deepEqual(extension.info.input.body, { repo_url: "https://github.com/openai/codex" });
  assert.deepEqual(bodySchema.required, ["repo_url"]);
  assert.deepEqual(Object.keys(bodySchema.properties), ["repo_url"]);
  assert.equal(bodySchema.additionalProperties, false);
  assert.deepEqual(validateDiscoveryExtensionSpec(extension), { valid: true });
  assert.deepEqual(validateDiscoveryExtension(extension), { valid: true });
});

test("SkillVerdict GET declaration passes Bazaar schema and protocol validation", () => {
  const extension = skillDiscoveryExtension.bazaar;
  assert.equal(extension.info.input.method, "GET");
  assert.deepEqual(validateDiscoveryExtensionSpec(extension), { valid: true });
  assert.deepEqual(validateDiscoveryExtension(extension), { valid: true });
});

test("RunVerdict canonical POST declaration is a strict JSON body", () => {
  const extension = runDiscoveryExtension.bazaar;
  const bodySchema = extension.schema.properties.input.properties.body;
  assert.equal(extension.info.input.method, "POST");
  assert.equal(extension.info.input.bodyType, "json");
  assert.deepEqual(extension.info.input.body, {
    run_url: "https://github.com/openai/codex/actions/runs/29728148711",
  });
  assert.deepEqual(bodySchema.required, ["run_url"]);
  assert.deepEqual(Object.keys(bodySchema.properties), ["run_url"]);
  assert.equal(bodySchema.additionalProperties, false);
  assert.deepEqual(validateDiscoveryExtensionSpec(extension), { valid: true });
  assert.deepEqual(validateDiscoveryExtension(extension), { valid: true });
});

test("FlakeVerdict canonical POST declaration is a strict JSON body", () => {
  const extension = flakeDiscoveryExtension.bazaar;
  const bodySchema = extension.schema.properties.input.properties.body;
  assert.equal(extension.info.input.method, "POST");
  assert.equal(extension.info.input.bodyType, "json");
  assert.deepEqual(extension.info.input.body, {
    run_url: "https://github.com/acme/widget/actions/runs/123456789",
    attempt: 2,
  });
  assert.deepEqual(bodySchema.required, ["run_url"]);
  assert.deepEqual(Object.keys(bodySchema.properties), ["run_url", "attempt"]);
  assert.equal(bodySchema.additionalProperties, false);
  assert.deepEqual(validateDiscoveryExtensionSpec(extension), { valid: true });
  assert.deepEqual(validateDiscoveryExtension(extension), { valid: true });
});

test("the remaining advertised GET example survives preflight and returns a payable crawler challenge", async () => {
  const routes = [
    ["/api/skill", skillDiscoveryExtension],
  ] as const;
  for (const [path, declaration] of routes) {
    const input = declaration.bazaar.info.input;
    assert.equal(input.method, "GET");
    assert.ok(input.queryParams && Object.keys(input.queryParams).length > 0);
    const query = new URLSearchParams(Object.entries(input.queryParams).map(([key, value]) => [key, String(value)]));
    const response = await app.request(`${path}?${query}`, {}, crawlerEnv);
    assert.equal(response.status, 402, `${path} must challenge the exact advertised Bazaar input`);
    assert.ok(response.headers.get("payment-required"));
  }
});

test("legacy BountyVerdict GET remains payable without advertising a second Bazaar contract", async () => {
  const response = await app.request(
    "/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Ftypeorm%2Ftypeorm%2Fissues%2F3357",
    {},
    crawlerEnv,
  );
  assert.equal(response.status, 402);
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded);
  const challenge = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  assert.equal(challenge.resource.url.includes("/api/verdict?issue_url="), true);
  assert.equal(challenge.extensions?.bazaar, undefined);
});
