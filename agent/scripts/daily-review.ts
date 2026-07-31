import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import {
  DAILY_REVIEW_SCORECARD_SCHEMA_VERSION,
  applyDailyReviewModelBudget,
  buildDailyReviewGate,
  buildDailyReviewScorecard,
  type DailyReviewScorecard,
} from "../src/daily-review-scorecard.ts";

const MAX_STATE_BYTES = 2 * 1024 * 1024;
const stateRoot = resolve(process.env.BOUNTYVERDICT_STATE_ROOT || `${homedir()}/.local/state/bountyverdict`);
const cadenceRoot = resolve(process.env.BOUNTYVERDICT_CADENCE_ROOT || `${stateRoot}/cadence`);
const repository = resolve(process.env.BOUNTYVERDICT_REPOSITORY || new URL("../..", import.meta.url).pathname);
const scorecardFile = `${cadenceRoot}/daily-review-scorecard.json`;
const baselineFile = `${cadenceRoot}/daily-review-scorecard-baseline.json`;
const reviewFile = `${cadenceRoot}/daily-review.json`;
const schemaFile = resolve(
  process.env.BOUNTYVERDICT_DAILY_REVIEW_SCHEMA ||
  new URL("../../ops/cadence/daily-review.schema.json", import.meta.url).pathname,
);
const modelReviewEnabled = process.env.BOUNTYVERDICT_MODEL_REVIEW_ENABLED === "YES";
const DEFAULT_CODEX_TIMEOUT_MS = 6 * 60 * 1_000;

function codexTimeoutMs(value: string | undefined): number {
  if (value === undefined) return DEFAULT_CODEX_TIMEOUT_MS;
  if (!/^\d+$/.test(value)) throw new Error("BOUNTYVERDICT_CODEX_TIMEOUT_MS must be an integer.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > DEFAULT_CODEX_TIMEOUT_MS) {
    throw new Error(`BOUNTYVERDICT_CODEX_TIMEOUT_MS must be between 100 and ${DEFAULT_CODEX_TIMEOUT_MS}.`);
  }
  return parsed;
}

async function readJson(name: string): Promise<unknown | undefined> {
  const path = `${stateRoot}/${name}`;
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${name} must be a regular non-symlink file.`);
    if (metadata.size > MAX_STATE_BYTES) throw new Error(`${name} exceeds the ${MAX_STATE_BYTES}-byte input limit.`);
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function readOpportunityResult(workflowValue: unknown): Promise<unknown | undefined> {
  if (!workflowValue || typeof workflowValue !== "object" || Array.isArray(workflowValue)) return undefined;
  const workflow = workflowValue as Record<string, unknown>;
  if (workflow.schema_version !== 1 || !Array.isArray(workflow.completed) ||
    workflow.completed.length === 0 || workflow.completed.length > 200) return undefined;
  const latest = workflow.completed.at(-1);
  if (!latest || typeof latest !== "object" || Array.isArray(latest)) return undefined;
  const completion = latest as Record<string, unknown>;
  if (typeof completion.trigger_id !== "string" || !/^[a-f0-9]{64}$/.test(completion.trigger_id) ||
    typeof completion.result_file !== "string") return undefined;
  const resultRoot = resolve(`${stateRoot}/opportunity-workflows`);
  const resultPath = resolve(completion.result_file);
  if (!resultPath.startsWith(`${resultRoot}${sep}`)) return undefined;
  try {
    const metadata = await lstat(resultPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 256 * 1024) return undefined;
    const contents = await readFile(resultPath, "utf8");
    const compact = contents.replace(/\s+/g, " ").trim();
    if (!compact) return undefined;
    const excerpt = compact.length <= 2_400
      ? compact
      : `${compact.slice(0, 1_190)} ... ${compact.slice(-1_190)}`;
    return {
      trigger_id: completion.trigger_id,
      result_sha256: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
      result_excerpt: excerpt,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function validPrevious(value: unknown): value is DailyReviewScorecard {
  const candidate = value as Partial<DailyReviewScorecard> | null;
  return candidate?.schema_version === DAILY_REVIEW_SCORECARD_SCHEMA_VERSION &&
    typeof candidate.material_fingerprint === "string" &&
    typeof candidate.healthy === "boolean";
}

function codexEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "HOME", "CODEX_HOME", "LANG", "LC_ALL", "TERM", "TMPDIR"];
  const environment: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  environment.GIT_CONFIG_GLOBAL = "/dev/null";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GCM_INTERACTIVE = "Never";
  return environment;
}

function signalProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function runCodex(prompt: string, expectedDate: string): Promise<boolean> {
  const temporary = `${reviewFile}.${process.pid}.tmp`;
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--disable", "plugins",
    "--disable", "remote_plugin",
    "--disable", "plugin_sharing",
    "--disable", "skill_mcp_dependency_install",
    "-c", 'shell_environment_policy={inherit="none",set={GIT_CONFIG_GLOBAL="/dev/null",GIT_TERMINAL_PROMPT="0",GCM_INTERACTIVE="Never"}}',
    "--color", "never",
    "--sandbox", "read-only",
    "--cd", repository,
    "--output-schema", schemaFile,
    "--output-last-message", temporary,
    prompt,
  ];
  try {
    await unlink(temporary).catch(() => undefined);
    const maximumRuntimeMs = codexTimeoutMs(process.env.BOUNTYVERDICT_CODEX_TIMEOUT_MS);
    const exitCode = await new Promise<number>((resolveExit, reject) => {
      let timedOut = false;
      const child = spawn("codex", args, {
        detached: true,
        env: codexEnvironment(),
        stdio: ["ignore", "inherit", "inherit"],
      });
      const timeout = setTimeout(() => {
        timedOut = true;
        try {
          signalProcessGroup(child.pid, "SIGTERM");
        } catch (error) {
          reject(error);
          return;
        }
        setTimeout(() => {
          try {
            signalProcessGroup(child.pid, "SIGKILL");
            reject(new Error("codex review exceeded its bounded runtime."));
          } catch (error) {
            reject(error);
          }
        }, 2_000);
      }, maximumRuntimeMs);
      child.once("error", (error) => {
        clearTimeout(timeout);
        try {
          signalProcessGroup(child.pid, "SIGTERM");
          signalProcessGroup(child.pid, "SIGKILL");
        } catch (cleanupError) {
          reject(cleanupError);
          return;
        }
        reject(error);
      });
      child.once("exit", (code, signal) => {
        if (timedOut) return;
        clearTimeout(timeout);
        try {
          signalProcessGroup(child.pid, "SIGTERM");
          signalProcessGroup(child.pid, "SIGKILL");
        } catch (error) {
          reject(error);
          return;
        }
        if (signal) reject(new Error(`codex review terminated by ${signal}.`));
        else resolveExit(code ?? 1);
      });
    });
    if (exitCode !== 0) {
      console.warn(`Codex daily review exited with status ${exitCode}; retaining the prior baseline for tomorrow.`);
      return false;
    }
    const result = JSON.parse(await readFile(temporary, "utf8")) as Record<string, unknown>;
    if (result.review_date !== expectedDate || typeof result.actionable !== "boolean" ||
      !Array.isArray(result.evidence) || !Array.isArray(result.do_not_do)) {
      throw new Error("Codex daily review output failed the local contract check.");
    }
    await atomicWrite(reviewFile, result);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Codex daily review unavailable; retaining the prior baseline for tomorrow: ${reason}`);
    return false;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

const [
  distribution,
  funnel,
  functional,
  demand,
  githubDigest,
  algoraScout,
  acquisitionExperiment,
  taskmarket,
  payan,
  clawlancer,
  catalogExperiment,
  opportunityWorkflow,
  previousValue,
] = await Promise.all([
  readJson("distribution-status.json"),
  readJson("funnel-telemetry.json"),
  readJson("functional-canary.json"),
  readJson("demand-watch.json"),
  readJson("github-digest.json"),
  readJson("algora-scout.json"),
  readJson("acquisition-experiment.json"),
  readJson("taskmarket-agentwork-pitch.json"),
  readJson("payan-demand.json"),
  readJson("clawlancer-work.json"),
  readJson("experiments/mcp-free-selection-catalog-v2.json"),
  readJson("opportunity-workflow.json"),
  readJson("cadence/daily-review-scorecard-baseline.json"),
]);
const opportunityResult = await readOpportunityResult(opportunityWorkflow);
const previous = validPrevious(previousValue) ? previousValue : null;
const scorecard = buildDailyReviewScorecard({
  distribution,
  funnel,
  functional,
  demand,
  githubDigest,
  algoraScout,
  acquisitionExperiment,
  taskmarket,
  payan,
  clawlancer,
  catalogExperiment,
  opportunityWorkflow,
  opportunityResult,
});
const gate = buildDailyReviewGate(scorecard, previous);
const executionGate = applyDailyReviewModelBudget(gate, modelReviewEnabled);
await atomicWrite(scorecardFile, scorecard);

const modelReviewCompleted = executionGate.action === "invoke_codex"
  ? await runCodex(gate.prompt as string, scorecard.generated_at.slice(0, 10))
  : null;
// Preserve the first observation timestamp for an unchanged alert so the
// local gate can issue one bounded weekly reminder without invoking Codex daily.
// When the model budget gate suppresses a review, retain the prior baseline so
// an explicit future opt-in reviews the still-material delta immediately.
if (modelReviewCompleted !== false && !executionGate.codex_suppressed && gate.reason !== "unhealthy_materially_unchanged") {
  await atomicWrite(baselineFile, scorecard);
}
console.log(JSON.stringify({
  product: "BountyVerdict daily review gate",
  checked_at: scorecard.generated_at,
  healthy: scorecard.healthy,
  scorecard_bytes: Buffer.byteLength(JSON.stringify(scorecard)),
  ...executionGate,
  model_review_status: modelReviewCompleted === true
    ? "completed"
    : modelReviewCompleted === false
      ? "failed_retry_next_day"
      : "not_requested",
  prompt: executionGate.prompt === null ? null : "[compact scorecard prompt supplied to Codex]",
}, null, 2));
