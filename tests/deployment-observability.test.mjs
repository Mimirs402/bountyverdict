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
