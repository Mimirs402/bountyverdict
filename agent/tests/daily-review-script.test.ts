import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

test("daily review bounds a failed Codex pass, does not retry, and preserves the prior baseline", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "bountyverdict-daily-codex-bound-"));
  const binRoot = join(stateRoot, "bin");
  const counterFile = join(stateRoot, "codex-invocations");
  const fakeCodex = join(binRoot, "codex");
  await mkdir(binRoot, { recursive: true, mode: 0o700 });
  await writeFile(fakeCodex, `#!/usr/bin/env node\nconst fs = require("node:fs");\nfs.appendFileSync(${JSON.stringify(counterFile)}, process.env.UNRECOGNIZED_SECRET_TOKEN ? "secret-leaked" : "x");\nprocess.on("SIGTERM", () => {});\nsetTimeout(() => {}, 10_000);\n`, { mode: 0o700 });
  await chmod(fakeCodex, 0o700);

  const startedAt = Date.now();
  const result = await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    script.pathname,
  ], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binRoot}:${process.env.PATH}`,
      UNRECOGNIZED_SECRET_TOKEN: "must-not-reach-codex",
      BOUNTYVERDICT_STATE_ROOT: stateRoot,
      BOUNTYVERDICT_CADENCE_ROOT: join(stateRoot, "cadence"),
      BOUNTYVERDICT_REPOSITORY: repository,
      BOUNTYVERDICT_MODEL_REVIEW_ENABLED: "YES",
      BOUNTYVERDICT_CODEX_TIMEOUT_MS: "100",
    },
  });
  assert.ok(Date.now() - startedAt >= 2_000);
  assert.ok(Date.now() - startedAt < 5_000);
  assert.match(result.stdout, /"model_review_status": "failed_retry_next_day"/);
  assert.equal(await readFile(counterFile, "utf8"), "x");
  await assert.rejects(
    readFile(join(stateRoot, "cadence", "daily-review-scorecard-baseline.json"), "utf8"),
    (error: NodeJS.ErrnoException) => error.code === "ENOENT",
  );
});

test("daily review rejects an invalid timeout before spawning Codex", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "bountyverdict-daily-invalid-timeout-"));
  const binRoot = join(stateRoot, "bin");
  const counterFile = join(stateRoot, "codex-invocations");
  const fakeCodex = join(binRoot, "codex");
  await mkdir(binRoot, { recursive: true, mode: 0o700 });
  await writeFile(fakeCodex, `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(${JSON.stringify(counterFile)}, "x");\n`, { mode: 0o700 });
  await chmod(fakeCodex, 0o700);

  const result = await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    script.pathname,
  ], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binRoot}:${process.env.PATH}`,
      BOUNTYVERDICT_STATE_ROOT: stateRoot,
      BOUNTYVERDICT_CADENCE_ROOT: join(stateRoot, "cadence"),
      BOUNTYVERDICT_REPOSITORY: repository,
      BOUNTYVERDICT_MODEL_REVIEW_ENABLED: "YES",
      BOUNTYVERDICT_CODEX_TIMEOUT_MS: "invalid",
    },
  });
  assert.match(result.stdout, /"model_review_status": "failed_retry_next_day"/);
  await assert.rejects(
    readFile(counterFile, "utf8"),
    (error: NodeJS.ErrnoException) => error.code === "ENOENT",
  );
});

test("daily review cleans same-group descendants after a successful Codex exit", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "bountyverdict-daily-descendant-cleanup-"));
  const binRoot = join(stateRoot, "bin");
  const descendantPidFile = join(stateRoot, "descendant-pid");
  const fakeCodex = join(binRoot, "codex");
  await mkdir(binRoot, { recursive: true, mode: 0o700 });
  await writeFile(fakeCodex, `#!/usr/bin/env node\nconst fs = require("node:fs");\nconst { spawn } = require("node:child_process");\nconst descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setTimeout(() => {}, 10000)"], { stdio: "ignore" });\ndescendant.unref();\nfs.writeFileSync(${JSON.stringify(descendantPidFile)}, String(descendant.pid));\nconst outputIndex = process.argv.indexOf("--output-last-message");\nfs.writeFileSync(process.argv[outputIndex + 1], JSON.stringify({ review_date: new Date().toISOString().slice(0, 10), actionable: false, evidence: [], do_not_do: [] }));\n`, { mode: 0o700 });
  await chmod(fakeCodex, 0o700);

  const result = await execFileAsync(process.execPath, [
    "--experimental-strip-types",
    script.pathname,
  ], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binRoot}:${process.env.PATH}`,
      BOUNTYVERDICT_STATE_ROOT: stateRoot,
      BOUNTYVERDICT_CADENCE_ROOT: join(stateRoot, "cadence"),
      BOUNTYVERDICT_REPOSITORY: repository,
      BOUNTYVERDICT_MODEL_REVIEW_ENABLED: "YES",
      BOUNTYVERDICT_CODEX_TIMEOUT_MS: "5000",
    },
  });
  assert.match(result.stdout, /"model_review_status": "completed"/);
  const descendantPid = Number(await readFile(descendantPidFile, "utf8"));
  assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 1);
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  assert.throws(
    () => process.kill(descendantPid, 0),
    (error: NodeJS.ErrnoException) => error.code === "ESRCH",
  );
});
