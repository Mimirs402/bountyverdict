import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/deploy-worker.yml", import.meta.url);
const canaryUrl = new URL("../agent/scripts/functional-canary.ts", import.meta.url);
const glamaVerifierUrl = new URL("../agent/scripts/verify-glama-release.ts", import.meta.url);

test("every production deployment probe identifies as owner automation", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const canary = await readFile(canaryUrl, "utf8");
  const glamaVerifier = await readFile(glamaVerifierUrl, "utf8");
  assert.match(workflow, /owner_curl\(\)/);
  assert.match(workflow, /--user-agent "bountyverdict-owner-audit\/1\.0"/);
  assert.match(workflow, /CLOUDFLARE_WORKER_VERSION_OVERRIDE=\$deployed_version/);
  assert.match(workflow, /Cloudflare-Workers-Version-Overrides: bountyverdict-agent-production=/);
  assert.match(workflow, /bountyverdict-release-override-check/);
  for (const stage of ["exact-version-override", "root", "samples", "x402-manifest", "discovery-documents", "ai-catalog", "agent-manifest", "agent-skill", "mcp", "openapi", "payment-challenges", "external-glama-bridge"]) {
    assert.match(workflow, new RegExp(`verify_stage ${stage}`));
  }
  assert.equal((workflow.match(/\bowner_curl --/g) || []).length, 18);
  assert.doesNotMatch(workflow, /\n\s+curl --(?:fail|silent|show-error)/);
  assert.match(workflow, /io\.github\.Mimirs402\/bountyverdict\/http-payment-handoff/);
  assert.match(workflow, /automatic_payment_requires !== "@x402\/mcp"/);
  assert.match(workflow, /handoff\?\.version !== "2"/);
  assert.match(workflow, /walletMcp\?\.tool_name !== "make_http_request_with_x402"/);
  assert.match(workflow, /walletMcp\?\.execution_kind !== "equivalent_rest_request"/);
  assert.match(workflow, /JSON\.stringify\(walletMcp\) !== JSON\.stringify\(payment\?\.coinbase_wallet_mcp\)/);
  assert.match(workflow, /walletMcp\?\.arguments\?\.preferredNetwork !== "base"/);
  assert.match(workflow, /payment\.exact_request\.normalized_body_sha256/);
  assert.match(workflow, /payment\?\.agentic_wallet\?\.execute_as_argument_vector !== true/);
  assert.match(workflow, /freeRoute\?\.next_call\?\.tool_name !== "diagnose_github_actions_run"/);
  assert.match(workflow, /freeRoute\?\.total_price_usdc !== "0\.04"/);
  assert.match(workflow, /freeRoute\?\.selector_call_payment_required !== false/);
  assert.match(workflow, /freeRoute\?\.next_call\?\.payment_required !== true/);
  assert.match(workflow, /freeRoute\?\.next_call\?\.authorization_required_before_settlement !== true/);
  assert.match(workflow, /freeRoute\?\.next_call\?\.unsigned_call_action !== "inspect_quote_then_authorize_or_stop"/);
  assert.match(workflow, /freeRoute\?\.next_call\?\.preserve_arguments_on_retry !== true/);
  assert.match(workflow, /outputSchemaSizes\.reduce\(\(total, bytes\) => total \+ bytes, 0\) > 12500/);
  assert.match(workflow, /called\.result\?\.content\?\.length !== 2/);
  assert.match(workflow, /\/\^PAYMENT REQUIRED:\//);
  assert.match(workflow, /economicalRoute\?\.next_call\?\.call_strategy !== "repeat_for_each_issue".*economicalRoute\?\.total_price_usdc !== "0\.35"/);
  assert.match(workflow, /rankedRoute\?\.next_call\?\.call_strategy !== "single_call".*rankedRoute\?\.total_price_usdc !== "0\.40"/);
  assert.match(glamaVerifier, /choose_github_agent_decision: \/\^\(\?:Call with no arguments for a free six-tool catalog\|Choose the economical next call\)\//);
  assert.match(canary, /"User-Agent": "bountyverdict-owner-audit\/1\.0"/);
});

test("production deployment is version-pinned, rollback-capable, and activation is race-safe", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(workflow, /registry_version=\$\(jq -er '\.version' \.\.\/server\.json\)/);
  assert.match(workflow, /worker_version=\$\(jq -er '\.version' package\.json\)/);
  assert.match(workflow, /manifest_status=\$\(jq -er '\.status' \.\.\/agent-manifest\.json\)/);
  assert.match(workflow, /\[\[ "\$manifest_status" == "awaiting_production" \]\]/);
  assert.match(workflow, /jq -e '\.production_api == null' \.\.\/agent-manifest\.json/);
  assert.match(workflow, /value\.surfaces\?\.length !== 8/);
  assert.match(workflow, /type === "http"\)\.length !== 7/);
  assert.match(workflow, /repository-agent-instructions-audit", "\/api\/skill", "\/api\/github-actions-run-diagnosis/);
  assert.match(workflow, /const expected = \["single", "portfolio", "harness", "skill", "run", "flake", "mcpdrift"\]/);
  assert.match(workflow, /body\.includes\("### SkillVerdict"\)/);
  assert.match(workflow, /serverInfo\?\.version !== process\.env\.WORKER_RELEASE_VERSION/);
  assert.match(workflow, /ai_catalog_ready=false/);
  assert.match(workflow, /if \[\[ "\$ai_catalog_ready" != "true" \]\]/);
  assert.match(workflow, /Production AI catalog did not converge to the deployed contract/);
  assert.match(workflow, /mcp_release_ready=false/);
  assert.match(workflow, /if \[\[ "\$mcp_release_ready" != "true" \]\]/);
  assert.match(workflow, /Production MCP contracts did not converge to the deployed release/);
  assert.equal((workflow.match(/for attempt in \{1\.\.30\}; do/g) || []).length, 7);
  assert.match(workflow, /agent_manifest_ready=false/);
  assert.match(workflow, /Production agent manifest did not converge to the deployed contract/);
  assert.match(workflow, /npx wrangler deployments list --env production --json/);
  assert.match(workflow, /current production deployment is not one version at 100 percent/);
  assert.match(workflow, /semantic_version=\$previous_semantic_version/);
  assert.match(workflow, /bountyverdict-release-rollback-capture/);
  assert.match(workflow, /npx wrangler rollback "\$PREVIOUS_WORKER_VERSION"/);
  assert.match(workflow, /PREVIOUS_SEMANTIC_VERSION: \$\{\{ steps\.previous\.outputs\.semantic_version \}\}/);
  assert.match(workflow, /bountyverdict-release-rollback-check/);
  assert.match(workflow, /"\$current_version" == "\$PREVIOUS_WORKER_VERSION" && "\$current_semantic_version" == "\$PREVIOUS_SEMANTIC_VERSION"/);
  assert.match(workflow, /failure\(\) && steps\.deploy\.outcome != 'skipped'.*steps\.previous\.outputs\.semantic_version != ''/);
  assert.match(workflow, /EXPECTED_MAIN_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /\[\[ "\$EXPECTED_RELEASE_REF" == "refs\/heads\/main" \]\]/);
  assert.equal(
    (workflow.match(/git fetch --no-tags origin refs\/heads\/main:refs\/remotes\/origin\/main/g) || []).length,
    3,
  );
  assert.match(workflow, /git rev-parse refs\/remotes\/origin\/main\)" == "\$EXPECTED_MAIN_SHA"/);
  assert.doesNotMatch(workflow, /push .*--force/);
});
