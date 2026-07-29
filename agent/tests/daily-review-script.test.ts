import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const script = new URL("../scripts/daily-review.ts", import.meta.url);
const repository = new URL("../..", import.meta.url).pathname;

test("daily review ingests only the exact bounded opportunity result under its private state root", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "bountyverdict-daily-opportunity-"));
  const triggerId = "a".repeat(64);
  const resultRoot = join(stateRoot, "opportunity-workflows");
  const resultFile = join(resultRoot, `${triggerId}.md`);
  await mkdir(resultRoot, { recursive: true, mode: 0o700 });
  await writeFile(resultFile, "NO_GO. Product learning: recheck live competition before local implementation.\n", { mode: 0o600 });
  await writeFile(join(stateRoot, "opportunity-workflow.json"), `${JSON.stringify({
    schema_version: 1,
    completed: [{
      trigger_id: triggerId,
      completed_at: new Date(Date.now() - 60_000).toISOString(),
      task_ids: [`0x${"b".repeat(64)}`],
      result_file: resultFile,
    }],
  })}\n`, { mode: 0o600 });
  await writeFile(join(stateRoot, "distribution-status.json"), `${JSON.stringify({
    healthy: true,
    errors: [],
    commerce: {
      genuine_purchases: 0,
      customer_revenue_usdc: "0",
      tracked_costs_usdc: "1.012",
    },
    functional: {
      healthy: true,
      checks: [],
      mcp_contract: {
        healthy: true,
        payment_or_signing_attempted: false,
        checks: [],
      },
    },
  })}\n`, { mode: 0o600 });

  const result = await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    script.pathname,
  ], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      BOUNTYVERDICT_STATE_ROOT: stateRoot,
      BOUNTYVERDICT_CADENCE_ROOT: join(stateRoot, "cadence"),
      BOUNTYVERDICT_REPOSITORY: repository,
      BOUNTYVERDICT_MODEL_REVIEW_ENABLED: "NO",
    },
  });
  assert.match(result.stdout, /"codex_suppressed": true/);
  const scorecard = JSON.parse(
    await readFile(join(stateRoot, "cadence", "daily-review-scorecard.json"), "utf8"),
  ) as Record<string, any>;
  assert.equal(scorecard.schema_version, 2);
  assert.equal(scorecard.autonomous_work.opportunity.latest_trigger_id, triggerId);
  assert.match(scorecard.autonomous_work.opportunity.result_excerpt, /recheck live competition/);
  assert.doesNotMatch(JSON.stringify(scorecard), /opportunity-workflows/);
});
