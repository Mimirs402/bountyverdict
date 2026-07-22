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
  assert.equal(spec.info.version, "1.1.9");
  assert.match(spec.info.description, /Seven bounded/);
  assert.match(spec.info["x-guidance"], /service_reuse/);
  assert.equal(spec.tags.length, 7);
  assert.equal(new Set(spec.tags.map((tag) => tag.name)).size, 7);
  const operation = spec.paths["/api/bounty-preflight"].post;
  assert.match(operation.summary, /GitHub bounty eligibility and claimability/i);
  assert.match(operation.description, /^Should I work on this GitHub issue\?/i);
  assert.match(operation.description, /already assigned or claimed/i);
  assert.equal(operation["x-x402"].price, "$0.05");
  assert.equal(operation["x-x402"].network, "eip155:8453");
  assert.equal(operation.requestBody.content["application/json"].schema.additionalProperties, false);
  assert.deepEqual(operation.requestBody.content["application/json"].schema.required, ["issue_url"]);
  assert.equal(
    operation.requestBody.content["application/json"].schema.properties.issue_url.example,
    "https://github.com/typeorm/typeorm/issues/3357",
  );
  assert.equal(spec.paths["/api/verdict"].get.deprecated, true);
  assert.equal(spec.paths["/api/verdict"].get.operationId, "checkBountyVerdictLegacyGet");
  assert.ok(spec.paths["/api/verdict"].get.parameters.some((parameter) => parameter.name === "issue_url"));
  const paidOperations = [
    spec.paths["/api/bounty-preflight"].post,
    spec.paths["/api/portfolio"].post,
    spec.paths["/api/repository-agent-instructions-audit"].post,
    spec.paths["/api/skill"].get,
    spec.paths["/api/github-actions-run-diagnosis"].post,
    spec.paths["/api/github-actions-flake-retry-gate"].post,
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
    assert.match(paid["x-agent-skill"], /^https:\/\/mimirs402\.github\.io\/bountyverdict\/skills\/[a-z0-9-]+\/SKILL\.md$/);
    assert.match(paid["x-use-when"], /\.$/);
    assert.ok(paid["x-service-reuse"]);
    assert.match(paid["x-free-sample"], /^https:\/\/agent\.example\/api\/(?:.+\/)?sample$/);
  }
  assert.equal(operation["x-payment-info"].price.amount, "0.050000");
  assert.equal(spec.paths["/api/portfolio"].post["x-x402"].price, "$0.40");
  assert.equal(spec.paths["/api/portfolio"].post.requestBody.content["application/json"].schema.properties.issue_urls.maxItems, 10);
  assert.deepEqual(
    spec.paths["/api/portfolio"].post.requestBody.content["application/json"].schema.properties.issue_urls.example,
    ["https://github.com/tenstorrent/tt-metal/issues/50522", "https://github.com/typeorm/typeorm/issues/3357"],
  );
  assert.deepEqual(
    spec.paths["/api/portfolio"].post.requestBody.content["application/json"].schema.properties.issue_urls.default,
    ["https://github.com/tenstorrent/tt-metal/issues/50522", "https://github.com/typeorm/typeorm/issues/3357"],
  );
  const harness = spec.paths["/api/repository-agent-instructions-audit"].post;
  assert.equal(harness["x-x402"].price, "$0.03");
  assert.deepEqual(harness.requestBody.content["application/json"].schema.required, ["repo_url"]);
  assert.equal(harness.requestBody.content["application/json"].schema.additionalProperties, false);
  assert.equal(
    harness.requestBody.content["application/json"].schema.properties.repo_url.example,
    "https://github.com/openai/codex",
  );
  assert.equal(spec.paths["/api/harness"].get.deprecated, true);
  assert.equal(spec.paths["/api/skill"].get["x-x402"].price, "$0.06");
  assert.match(spec.paths["/api/skill"].get.description, /^Is this agent skill safe to install\?/i);
  assert.deepEqual(spec.paths["/api/skill"].get.parameters.map((parameter) => parameter.name), ["repo_url", "skill_path"]);
  assert.deepEqual(
    spec.paths["/api/skill"].get.parameters.map((parameter) => parameter.schema.example),
    ["https://github.com/coinbase/agentic-wallet-skills", "skills/agentic-wallet"],
  );
  assert.deepEqual(
    spec.paths["/api/skill"].get.parameters.map((parameter) => parameter.schema.default),
    ["https://github.com/coinbase/agentic-wallet-skills", "skills/agentic-wallet"],
  );
  const run = spec.paths["/api/github-actions-run-diagnosis"].post;
  assert.equal(run["x-x402"].price, "$0.04");
  assert.deepEqual(run.requestBody.content["application/json"].schema.required, ["run_url"]);
  assert.equal(
    run.requestBody.content["application/json"].schema.properties.run_url.example,
    "https://github.com/openai/codex/actions/runs/29728148711",
  );
  assert.equal(spec.paths["/api/run"].get.deprecated, true);
  const flake = spec.paths["/api/github-actions-flake-retry-gate"].post;
  assert.equal(flake["x-x402"].price, "$0.07");
  assert.deepEqual(Object.keys(flake.requestBody.content["application/json"].schema.properties), ["run_url", "attempt"]);
  assert.equal(
    flake.requestBody.content["application/json"].schema.properties.run_url.example,
    "https://github.com/actions/runner/actions/runs/29423388605",
  );
  assert.equal(flake.responses["429"].description.includes("not settled"), true);
  assert.equal(spec.paths["/api/flake"].get.deprecated, true);
  assert.equal(spec.paths["/api/mcp-drift"].post["x-x402"].price, "$0.02");
  assert.match(spec.paths["/api/mcp-drift"].post.summary, /MCP schema drift/i);
  assert.match(spec.paths["/api/mcp-drift"].post.description, /MCP tools\/list compatibility/i);
  assert.equal(spec.paths["/api/mcp-drift"].post.requestBody.content["application/json"].schema.additionalProperties, false);
  assert.deepEqual(
    spec.paths["/api/mcp-drift"].post.requestBody.content["application/json"].schema.properties.subject.example,
    { server_id: "acme/tasks@production" },
  );
  assert.equal(
    spec.paths["/api/mcp-drift"].post.requestBody.content["application/json"].schema.properties.baseline.example.protocol_version,
    "2025-11-25",
  );
  assert.equal(
    spec.paths["/api/mcp-drift"].post.requestBody.content["application/json"].schema.properties.current.example.protocol_version,
    "2025-11-25",
  );
  assert.equal(spec.paths["/api/mcp-drift"].post.responses["422"].description.includes("no payment challenge"), true);
  assert.match(spec.externalDocs.url, /agent-manifest\.json$/);

  const llms = createLlmsText("https://agent.example");
  assert.match(llms, /\.well-known\/x402/);
  assert.match(llms, /\.well-known\/ai-catalog\.json/);
  assert.match(llms, /\.well-known\/mcp\/server-card\.json/);
  assert.match(llms, /\.well-known\/api-catalog/);
  assert.match(llms, /\.well-known\/integrations\.json/);
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
  assert.match(llms, /Remote MCP server: https:\/\/agent\.example\/mcp/);
  assert.match(llms, /io\.github\.Mimirs402\/bountyverdict/);
  assert.match(llms, /plans\/plan_ec6c49878dc34636\/subscribe/);
  assert.match(llms, /up to 20 combined requests/);
  assert.match(llms, /NEAR Agent Market/);
  assert.match(llms, /market\.near\.ai\/hire\?service_id=88c3e8f6-07f4-414e-bc43-c5ad61cf21fd/);
  assert.match(llms, /market\.near\.ai\/v1\/services\/0a0b0909-2829-4437-b23e-4376a61041ba\/invoke/);
});
