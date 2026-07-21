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
  assert.equal((workflow.match(/\n\s+owner_curl --/g) || []).length, 13);
  assert.doesNotMatch(workflow, /\n\s+curl --(?:fail|silent|show-error)/);
  assert.match(canary, /"User-Agent": "bountyverdict-owner-audit\/1\.0"/);
});
