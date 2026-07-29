import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  buildOpportunityTrigger,
  type OpportunityCandidate,
} from "../src/opportunity-agent-workflow.ts";

const execFileAsync = promisify(execFile);
const workflowScript = new URL("../scripts/opportunity-agent-workflow.ts", import.meta.url);

const candidate: OpportunityCandidate = {
  task_id: `0x${"a".repeat(64)}`,
  title: "Implement a bounded parser.",
  mode: "bounty",
  gross_reward_usdc: "6",
  net_reward_usdc: "5.55",
  submission_count: 1,
  created_at: "2026-07-21T11:30:00.000Z",
  deadline_at: "2026-07-21T18:00:00.000Z",
  hours_remaining: 6,
  escrow_tx_hash: `0x${"b".repeat(64)}`,
  requester: "0x1111111111111111111111111111111111111111",
  opportunity_score_usdc_per_current_entry: "2.775",
  requires_agent_fit_review: true,
  selection_basis:
    "official escrow-backed open bounty; non-owner requester; <=3 submissions; >=5 USDC net; <=12h old; >=2h remaining",
};

test("opportunity workflow launches Codex once and persists a private completion receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "bountyverdict-opportunity-workflow-"));
  const triggerFile = join(root, "opportunity-trigger.json");
  const stateFile = join(root, "opportunity-workflow.json");
  const outputRoot = join(root, "outputs");
  const invocationFile = join(root, "fake-codex-invocations.txt");
  const fakeCodex = join(root, "codex");
  const { trigger } = buildOpportunityTrigger([candidate], [], "2026-07-21T12:00:00.000Z");
  assert.ok(trigger);
  await writeFile(triggerFile, `${JSON.stringify(trigger)}\n`, { mode: 0o600 });
  await writeFile(fakeCodex, `#!/usr/bin/env node
import { appendFile, writeFile } from "node:fs/promises";
const outputIndex = process.argv.indexOf("--output-last-message");
if (process.argv[2] !== "exec" || outputIndex < 0 || !process.argv[outputIndex + 1]) process.exit(2);
await appendFile(process.env.FAKE_CODEX_INVOCATIONS, "called\\n");
await writeFile(process.argv[outputIndex + 1], "FAKE_GO\\n", { mode: 0o600 });
process.stdout.write("fake workflow complete\\n");
`, { mode: 0o700 });
  await chmod(fakeCodex, 0o700);
  const env = {
    ...process.env,
    PATH: `${root}:${process.env.PATH || ""}`,
    FAKE_CODEX_INVOCATIONS: invocationFile,
    BOUNTY_OPPORTUNITY_STATE_ROOT: root,
    BOUNTY_OPPORTUNITY_TRIGGER_FILE: triggerFile,
    BOUNTY_OPPORTUNITY_WORKFLOW_STATE_FILE: stateFile,
    BOUNTY_OPPORTUNITY_LOCK_FILE: join(root, "workflow.lock"),
    BOUNTY_OPPORTUNITY_WORKSPACE_ROOT: root,
    BOUNTY_OPPORTUNITY_OUTPUT_ROOT: outputRoot,
  };

  const first = await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    workflowScript.pathname,
  ], { env, encoding: "utf8" });
  assert.match(first.stdout, /"status":"completed"/);
  const state = JSON.parse(await readFile(stateFile, "utf8")) as Record<string, any>;
  assert.equal(state.completed.length, 1);
  assert.equal(state.completed[0].trigger_id, trigger.trigger_id);
  assert.equal(await readFile(state.completed[0].result_file, "utf8"), "FAKE_GO\n");

  const second = await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    workflowScript.pathname,
  ], { env, encoding: "utf8" });
  assert.match(second.stdout, /"reason":"trigger_already_completed"/);
  assert.equal(await readFile(invocationFile, "utf8"), "called\n");
});
