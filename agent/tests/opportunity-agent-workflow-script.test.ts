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
  market: "taskmarket",
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
  task_snapshot_sha256: "c".repeat(64),
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
import { join } from "node:path";
const outputIndex = process.argv.indexOf("--output-last-message");
if (process.argv[2] !== "exec" || outputIndex < 0 || !process.argv[outputIndex + 1]) process.exit(2);
const sandbox = process.argv[process.argv.indexOf("--sandbox") + 1];
const assessment = process.argv[outputIndex + 1].includes(".assessment.json");
await appendFile(${JSON.stringify(invocationFile)}, JSON.stringify({
  assessment,
  sandbox,
  args: process.argv.slice(2),
  env_keys: Object.keys(process.env).sort(),
}) + "\\n");
const output = assessment
  ? {
      schema_version: 1,
      trigger_id: ${JSON.stringify(trigger.trigger_id)},
      decision: "READY_FOR_LOCAL_PREPARATION",
      candidates: [{
        task_id: ${JSON.stringify(candidate.task_id)},
        decision: "READY_FOR_LOCAL_PREPARATION",
        reason: "Canonical public evidence is complete and no blocker remains.",
        evidence_urls: ["https://api.taskmarket.dev/api/tasks/${candidate.task_id}"],
        capability_requirements: [],
      }],
      product_learning: [],
    }
  : {
      schema_version: 1,
      trigger_id: ${JSON.stringify(trigger.trigger_id)},
      task_id: ${JSON.stringify(candidate.task_id)},
      status: "PREPARED",
      summary: "Prepared and tested locally.",
      artifact_paths: [join(process.cwd(), "solution.txt")],
      tests: [{ command: "test", passed: true, result: "passed" }],
      remaining_blockers: ["External submission remains disabled."],
      product_learning: [],
    };
if (!assessment) await writeFile(output.artifact_paths[0], "solution\\n", { mode: 0o600 });
await writeFile(process.argv[outputIndex + 1], JSON.stringify(output), { mode: 0o600 });
process.stdout.write("fake workflow complete\\n");
`, { mode: 0o700 });
  await chmod(fakeCodex, 0o700);
  const env = {
    ...process.env,
    PATH: `${root}:${process.env.PATH || ""}`,
    SHOULD_NOT_LEAK_TO_CODEX: "secret",
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
  await assert.rejects(readFile(triggerFile, "utf8"), { code: "ENOENT" });
  const state = JSON.parse(await readFile(stateFile, "utf8")) as Record<string, any>;
  assert.equal(state.completed.length, 1);
  assert.equal(state.completed[0].trigger_id, trigger.trigger_id);
  const result = JSON.parse(await readFile(state.completed[0].result_file, "utf8")) as Record<string, unknown>;
  assert.equal(result.outcome, "PREPARED");
  assert.equal((result.assessment as Record<string, unknown>).decision, "READY_FOR_LOCAL_PREPARATION");
  assert.equal((result.preparation as Record<string, unknown>).status, "PREPARED");
  const invocations = (await readFile(invocationFile, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, any>);
  assert.deepEqual(invocations.map(({ assessment }) => assessment), [true, false]);
  assert.deepEqual(invocations.map(({ sandbox }) => sandbox), ["workspace-write", "workspace-write"]);
  for (const invocation of invocations) {
    assert.ok(invocation.args.includes("--ignore-user-config"));
    assert.ok(invocation.args.some((argument: string) => /shell_environment_policy=.*inherit="none"/.test(argument)));
    assert.ok(invocation.args.includes("sandbox_workspace_write.network_access=true"));
    assert.ok(invocation.args.includes("features.network_proxy.enabled=true"));
    assert.ok(invocation.args.some((argument: string) =>
      argument.startsWith("features.network_proxy.domains=") &&
      argument.includes('"api.taskmarket.dev"="allow"') &&
      argument.includes('"api.moltjobs.io"="allow"') &&
      argument.includes('"github.com"="allow"')
    ));
    assert.ok(!invocation.env_keys.includes("SHOULD_NOT_LEAK_TO_CODEX"));
  }

  await writeFile(triggerFile, `${JSON.stringify(trigger)}\n`, { mode: 0o600 });
  const second = await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    workflowScript.pathname,
  ], { env, encoding: "utf8" });
  assert.match(second.stdout, /"reason":"trigger_already_completed"/);
  await assert.rejects(readFile(triggerFile, "utf8"), { code: "ENOENT" });
  assert.equal((await readFile(invocationFile, "utf8")).trim().split("\n").length, 2);
});

test("opportunity workflow leaves a failed trigger durable for retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "bountyverdict-opportunity-retry-"));
  const triggerFile = join(root, "opportunity-trigger.json");
  const fakeCodex = join(root, "codex");
  const { trigger } = buildOpportunityTrigger([candidate], [], "2026-07-21T12:00:00.000Z");
  assert.ok(trigger);
  await writeFile(triggerFile, `${JSON.stringify(trigger)}\n`, { mode: 0o600 });
  await writeFile(fakeCodex, "#!/bin/sh\nexit 17\n", { mode: 0o700 });
  await chmod(fakeCodex, 0o700);
  const env = {
    ...process.env,
    PATH: `${root}:${process.env.PATH || ""}`,
    BOUNTY_OPPORTUNITY_STATE_ROOT: root,
    BOUNTY_OPPORTUNITY_TRIGGER_FILE: triggerFile,
    BOUNTY_OPPORTUNITY_WORKFLOW_STATE_FILE: join(root, "opportunity-workflow.json"),
    BOUNTY_OPPORTUNITY_LOCK_FILE: join(root, "workflow.lock"),
    BOUNTY_OPPORTUNITY_WORKSPACE_ROOT: root,
    BOUNTY_OPPORTUNITY_OUTPUT_ROOT: join(root, "outputs"),
  };

  await assert.rejects(
    execFileAsync(process.execPath, ["--experimental-strip-types", workflowScript.pathname], {
      env,
      encoding: "utf8",
    }),
  );
  assert.deepEqual(
    JSON.parse(await readFile(triggerFile, "utf8")),
    trigger,
  );
  await assert.rejects(readFile(join(root, "opportunity-workflow.json"), "utf8"), { code: "ENOENT" });
});
