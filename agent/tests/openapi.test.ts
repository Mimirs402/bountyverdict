import test from "node:test";
import assert from "node:assert/strict";
import { createLlmsText, createOpenApi } from "../src/openapi.ts";

test("free self-evaluation surfaces advertise the paid contract", () => {
  const spec = createOpenApi("https://agent.example", "eip155:8453", {
    single: "$0.05",
    portfolio: "$0.40",
    harness: "$0.03",
    skill: "$0.06",
    run: "$0.04",
    flake: "$0.07",
    mcpdrift: "$0.02",
  });
  assert.match(spec.info.title, /Agent Decision APIs/);
  assert.equal(spec.info.version, "1.0.1");
  assert.match(spec.info.description, /Seven bounded/);
  assert.match(spec.info["x-guidance"], /service_reuse/);
  assert.equal(spec.tags.length, 7);
  assert.equal(new Set(spec.tags.map((tag) => tag.name)).size, 7);
  const operation = spec.paths["/api/verdict"].get;
  assert.equal(operation["x-x402"].price, "$0.05");
  assert.equal(operation["x-x402"].network, "eip155:8453");
  assert.ok(operation.parameters.some((parameter) => parameter.name === "issue_url"));
  const paidOperations = [
    spec.paths["/api/verdict"].get,
    spec.paths["/api/portfolio"].post,
    spec.paths["/api/harness"].get,
    spec.paths["/api/skill"].get,
    spec.paths["/api/run"].get,
    spec.paths["/api/flake"].get,
    spec.paths["/api/mcp-drift"].post,
  ];
  for (const paid of paidOperations) {
    assert.ok(paid.responses["200"].content["application/json"].schema.required.includes("service_reuse"));
    assert.deepEqual(paid["x-payment-info"].protocols, [{ x402: {} }]);
    assert.equal(paid["x-payment-info"].price.mode, "fixed");
    assert.equal(paid["x-payment-info"].price.currency, "USD");
    assert.match(paid["x-payment-info"].price.amount, /^\d+\.\d{6}$/);
    assert.ok(paid.responses["402"]);
    assert.equal(paid.tags.length, 1);
    assert.match(paid["x-agent-skill"], /^https:\/\/cristianmoroaica\.github\.io\/bountyverdict\/skills\/[a-z0-9-]+\/SKILL\.md$/);
    assert.match(paid["x-use-when"], /\.$/);
    assert.ok(paid["x-service-reuse"]);
    assert.match(paid["x-free-sample"], /^https:\/\/agent\.example\/api\/(?:.+\/)?sample$/);
  }
  assert.equal(operation["x-payment-info"].price.amount, "0.050000");
  assert.equal(spec.paths["/api/portfolio"].post["x-x402"].price, "$0.40");
  assert.equal(spec.paths["/api/portfolio"].post.requestBody.content["application/json"].schema.properties.issue_urls.maxItems, 10);
  assert.equal(spec.paths["/api/harness"].get["x-x402"].price, "$0.03");
  assert.ok(spec.paths["/api/harness"].get.parameters.some((parameter) => parameter.name === "repo_url"));
  assert.equal(spec.paths["/api/skill"].get["x-x402"].price, "$0.06");
  assert.deepEqual(spec.paths["/api/skill"].get.parameters.map((parameter) => parameter.name), ["repo_url", "skill_path"]);
  assert.equal(spec.paths["/api/run"].get["x-x402"].price, "$0.04");
  assert.deepEqual(spec.paths["/api/run"].get.parameters.map((parameter) => parameter.name), ["run_url"]);
  assert.equal(spec.paths["/api/flake"].get["x-x402"].price, "$0.07");
  assert.deepEqual(spec.paths["/api/flake"].get.parameters.map((parameter) => parameter.name), ["run_url", "attempt"]);
  assert.equal(spec.paths["/api/flake"].get.responses["429"].description.includes("not settled"), true);
  assert.equal(spec.paths["/api/mcp-drift"].post["x-x402"].price, "$0.02");
  assert.equal(spec.paths["/api/mcp-drift"].post.requestBody.content["application/json"].schema.additionalProperties, false);
  assert.equal(spec.paths["/api/mcp-drift"].post.responses["422"].description.includes("no payment challenge"), true);
  assert.match(spec.externalDocs.url, /agent-manifest\.json$/);

  const llms = createLlmsText("https://agent.example");
  assert.match(llms, /\/api\/sample/);
  assert.match(llms, /\$0\.05 USDC/);
  assert.match(llms, /\$0\.40 USDC/);
  assert.match(llms, /\$0\.03 USDC/);
  assert.match(llms, /HarnessVerdict/);
  assert.match(llms, /\$0\.06 USDC/);
  assert.match(llms, /SkillVerdict/);
  assert.match(llms, /\$0\.04 USDC/);
  assert.match(llms, /RunVerdict/);
  assert.match(llms, /\$0\.07 USDC/);
  assert.match(llms, /FlakeVerdict/);
  assert.match(llms, /\$0\.02 USDC/);
  assert.match(llms, /MCPDriftVerdict/);
  assert.match(llms, /RECURRING_FAILURE/);
  assert.match(llms, /service_reuse guidance/);
  assert.match(llms, /route-github-agent-checks\/SKILL\.md/);
  assert.match(llms, /Install all operating skills/);
  assert.match(llms, /AI-work bans/);
  assert.match(llms, /Escrow marketplace/);
  assert.match(llms, /services\/svc_5e36dabc8b434e95\/purchase/);
  assert.match(llms, /SkillVerdict is intentionally excluded/);
  assert.match(llms, /plans\/plan_ec6c49878dc34636\/subscribe/);
  assert.match(llms, /up to 20 combined requests/);
  assert.match(llms, /NEAR Agent Market/);
  assert.match(llms, /market\.near\.ai\/hire\?service_id=88c3e8f6-07f4-414e-bc43-c5ad61cf21fd/);
  assert.match(llms, /market\.near\.ai\/v1\/services\/0a0b0909-2829-4437-b23e-4376a61041ba\/invoke/);
});
