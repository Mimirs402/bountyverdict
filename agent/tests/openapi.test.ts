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
  });
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
  ];
  for (const paid of paidOperations) {
    assert.ok(paid.responses["200"].content["application/json"].schema.required.includes("service_reuse"));
  }
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
  assert.match(llms, /RECURRING_FAILURE/);
  assert.match(llms, /service_reuse guidance/);
  assert.match(llms, /preflight-github-bounties\/SKILL\.md/);
  assert.match(llms, /AI-work bans/);
});
