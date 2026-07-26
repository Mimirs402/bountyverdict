import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/deploy-worker.yml", import.meta.url);
const canaryUrl = new URL("../agent/scripts/functional-canary.ts", import.meta.url);

test("every production deployment probe identifies as owner automation", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const canary = await readFile(canaryUrl, "utf8");
  assert.match(workflow, /owner_curl\(\)/);
  assert.match(workflow, /curl --user-agent "bountyverdict-owner-audit\/1\.0"/);
  assert.equal((workflow.match(/\bowner_curl --/g) || []).length, 18);
  assert.doesNotMatch(workflow, /\n\s+curl --(?:fail|silent|show-error)/);
  assert.match(workflow, /io\.github\.Mimirs402\/bountyverdict\/http-payment-handoff/);
  assert.match(workflow, /automatic_payment_requires !== "@x402\/mcp"/);
  assert.match(workflow, /payment\.exact_request\.normalized_body_sha256/);
  assert.match(workflow, /payment\?\.agentic_wallet\?\.execute_as_argument_vector !== true/);
  assert.match(canary, /"User-Agent": "bountyverdict-owner-audit\/1\.0"/);
});

test("production deployment is version-pinned, rollback-capable, and activation is race-safe", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(workflow, /registry_version=\$\(jq -er '\.version' \.\.\/server\.json\)/);
  assert.match(workflow, /worker_version=\$\(jq -er '\.version' package\.json\)/);
  assert.match(workflow, /manifest_status=\$\(jq -er '\.status' \.\.\/agent-manifest\.json\)/);
  assert.match(workflow, /\[\[ "\$manifest_status" == "awaiting_production" \]\]/);
  assert.match(workflow, /jq -e '\.production_api == null' \.\.\/agent-manifest\.json/);
  assert.match(workflow, /serverInfo\?\.version !== process\.env\.WORKER_RELEASE_VERSION/);
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
