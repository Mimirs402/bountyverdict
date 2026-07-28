import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  DAILY_REVIEW_SCORECARD_SCHEMA_VERSION,
  applyDailyReviewModelBudget,
  buildDailyReviewGate,
  buildDailyReviewScorecard,
  type DailyReviewScorecard,
} from "../src/daily-review-scorecard.ts";
import { runBoundedAttempts } from "../src/bounded-retry.ts";

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

function validPrevious(value: unknown): value is DailyReviewScorecard {
  const candidate = value as Partial<DailyReviewScorecard> | null;
  return candidate?.schema_version === DAILY_REVIEW_SCORECARD_SCHEMA_VERSION &&
    typeof candidate.material_fingerprint === "string" &&
    typeof candidate.healthy === "boolean";
}

async function runCodex(prompt: string, expectedDate: string): Promise<void> {
  const temporary = `${reviewFile}.${process.pid}.tmp`;
  const strippedEnvironment = { ...process.env };
  for (const key of [
    "ANTHROPIC_API_KEY", "CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET",
    "CLOUDFLARE_API_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "HL_INITIAL_WORKSPACE_TOKEN",
    "OPENAI_API_KEY", "PAYPAL_CLIENT_SECRET", "STRIPE_SECRET_KEY", "WHOOP_CLIENT_SECRET",
    "WITHINGS_CLIENT_SECRET",
  ]) delete strippedEnvironment[key];
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--color", "never",
    "--sandbox", "read-only",
    "--cd", repository,
    "--output-schema", schemaFile,
    "--output-last-message", temporary,
    prompt,
  ];
  const maximumAttempts = 2;
  const exitCode = await runBoundedAttempts(maximumAttempts, async () => {
    await unlink(temporary).catch(() => undefined);
    return await new Promise<number>((resolveExit, reject) => {
      const child = spawn("codex", args, {
        env: strippedEnvironment,
        stdio: ["ignore", "inherit", "inherit"],
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (signal) reject(new Error(`codex review terminated by ${signal}.`));
        else resolveExit(code ?? 1);
      });
    });
  }, (code) => code === 0, (attempt, code) => {
    console.warn(`Codex daily review attempt ${attempt} failed with status ${code}; retrying once.`);
  });
  if (exitCode !== 0) throw new Error(`codex review exited with status ${exitCode}.`);
  try {
    const result = JSON.parse(await readFile(temporary, "utf8")) as Record<string, unknown>;
    if (result.review_date !== expectedDate || typeof result.actionable !== "boolean" ||
      !Array.isArray(result.evidence) || !Array.isArray(result.do_not_do)) {
      throw new Error("Codex daily review output failed the local contract check.");
    }
    await atomicWrite(reviewFile, result);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

const [
  distribution,
  funnel,
  functional,
  demand,
  acquisitionExperiment,
  taskmarket,
  payan,
  clawlancer,
  previousValue,
] = await Promise.all([
  readJson("distribution-status.json"),
  readJson("funnel-telemetry.json"),
  readJson("functional-canary.json"),
  readJson("demand-watch.json"),
  readJson("acquisition-experiment.json"),
  readJson("taskmarket-agentwork-pitch.json"),
  readJson("payan-demand.json"),
  readJson("clawlancer-work.json"),
  readJson("cadence/daily-review-scorecard-baseline.json"),
]);
const previous = validPrevious(previousValue) ? previousValue : null;
const scorecard = buildDailyReviewScorecard({
  distribution,
  funnel,
  functional,
  demand,
  acquisitionExperiment,
  taskmarket,
  payan,
  clawlancer,
});
const gate = buildDailyReviewGate(scorecard, previous);
const executionGate = applyDailyReviewModelBudget(gate, modelReviewEnabled);
await atomicWrite(scorecardFile, scorecard);

if (executionGate.action === "invoke_codex") {
  await runCodex(gate.prompt as string, scorecard.generated_at.slice(0, 10));
}
// Preserve the first observation timestamp for an unchanged alert so the
// local gate can issue one bounded weekly reminder without invoking Codex daily.
// When the model budget gate suppresses a review, retain the prior baseline so
// an explicit future opt-in reviews the still-material delta immediately.
if (!executionGate.codex_suppressed && gate.reason !== "unhealthy_materially_unchanged") {
  await atomicWrite(baselineFile, scorecard);
}
console.log(JSON.stringify({
  product: "BountyVerdict daily review gate",
  checked_at: scorecard.generated_at,
  healthy: scorecard.healthy,
  scorecard_bytes: Buffer.byteLength(JSON.stringify(scorecard)),
  ...executionGate,
  prompt: executionGate.prompt === null ? null : "[compact scorecard prompt supplied to Codex]",
}, null, 2));
