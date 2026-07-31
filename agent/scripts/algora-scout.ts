import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  ALGORA_SCOUT_COMMENTERS,
  ALGORA_SCOUT_LOOKBACK_MS,
  algoraOpportunityCandidate,
  mergeAlgoraSearches,
  parseAlgoraSearch,
  selectAlgoraScoutIssues,
} from "../src/algora-scout.ts";
import { CheckError, checkGithubIssue } from "../src/check.ts";
import { acquireExclusiveRun } from "../src/exclusive-run.ts";
import { GITHUB_DIGEST_ACCOUNT } from "../src/github-digest.ts";
import {
  OPPORTUNITY_MARKER_VERSION,
  parseOpportunityTrigger,
  parseRememberedOpportunityFingerprints,
} from "../src/opportunity-agent-workflow.ts";
import { coordinateOpportunityTrigger } from "../src/opportunity-trigger-coordination.ts";

const execFileAsync = promisify(execFile);
const stateRoot = resolve(process.env.BOUNTYVERDICT_STATE_ROOT || `${homedir()}/.local/state/bountyverdict`);
const statePath = `${stateRoot}/algora-scout.json`;
const triggerPath = `${stateRoot}/opportunity-trigger.json`;
const producerLockPath = `${stateRoot}/opportunity-trigger-producer.lock`;

async function ghJson(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync("gh", args, {
    timeout: 60_000,
    maxBuffer: 4_000_000,
    encoding: "utf8",
  });
  return JSON.parse(stdout);
}

async function githubToken(): Promise<string> {
  const { stdout } = await execFileAsync("gh", ["auth", "token"], {
    timeout: 10_000,
    maxBuffer: 16_384,
    encoding: "utf8",
  });
  const token = stdout.trim();
  if (!token) throw new Error("GitHub business token is unavailable.");
  return token;
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

async function previousState(): Promise<Record<string, unknown> | null> {
  try {
    const metadata = await lstat(statePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 512_000) {
      throw new Error("Algora scout state is not a bounded regular file.");
    }
    const value = JSON.parse(await readFile(statePath, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      (value as Record<string, unknown>).schema_version !== 1) {
      throw new Error("Algora scout state is incompatible.");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function pendingTriggerId(): Promise<string | null> {
  try {
    const metadata = await lstat(triggerPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 256_000) {
      throw new Error("Pending opportunity trigger is not a bounded regular file.");
    }
    return parseOpportunityTrigger(JSON.parse(await readFile(triggerPath, "utf8")) as unknown).trigger_id;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

const identity = await ghJson(["api", "user"]);
if ((identity as Record<string, unknown>).login !== GITHUB_DIGEST_ACCOUNT) {
  throw new Error("Algora scout requires the active Mimir's Lab GitHub account.");
}
const checkedAt = new Date().toISOString();
const previous = await previousState();
const previousCheckedAt = typeof previous?.checked_at === "string" && Number.isFinite(Date.parse(previous.checked_at))
  ? previous.checked_at
  : null;
const since = new Date(Math.max(
  previousCheckedAt ? Date.parse(previousCheckedAt) : 0,
  Date.now() - ALGORA_SCOUT_LOOKBACK_MS,
)).toISOString();
const updatedQualifier = since.slice(0, 10);
const searches = await Promise.all(ALGORA_SCOUT_COMMENTERS.map(async (commenter) => parseAlgoraSearch(await ghJson([
  "api", "--method", "GET", "search/issues",
  "-f", `q=is:issue is:open commenter:${commenter} updated:>=${updatedQualifier} sort:updated-desc`,
  "-f", "per_page=100",
]))));
const inventory = mergeAlgoraSearches(searches);
const selected = selectAlgoraScoutIssues(inventory, since);
const token = selected.length ? await githubToken() : "";
const evaluations: Array<Record<string, unknown>> = [];
const candidates = [];
for (let index = 0; index < selected.length; index += 3) {
  const batch = selected.slice(index, index + 3);
  const results = await Promise.all(batch.map(async (issue) => {
    try {
      const verdict = await checkGithubIssue(issue.html_url, { GITHUB_TOKEN: token });
      const candidate = algoraOpportunityCandidate(issue, verdict);
      return {
        candidate,
        evaluation: {
          issue_url: issue.html_url,
          title: issue.title,
          verdict: verdict.verdict,
          score: verdict.score,
          reward_state: verdict.reward.state,
          reward_platform: verdict.reward.platform,
          reward_amount: verdict.reward.amount,
          hard_stops: verdict.signals.filter(({ hard_stop }) => hard_stop).map(({ label }) => label),
          admitted: candidate !== null,
          error_code: null,
        },
      };
    } catch (error) {
      return {
        candidate: null,
        evaluation: {
          issue_url: issue.html_url,
          title: issue.title,
          verdict: null,
          score: null,
          reward_state: null,
          reward_platform: null,
          reward_amount: null,
          hard_stops: [],
          admitted: false,
          error_code: error instanceof CheckError ? error.code : "CHECK_FAILED",
        },
      };
    }
  }));
  for (const result of results) {
    evaluations.push(result.evaluation);
    if (result.candidate) candidates.push(result.candidate);
  }
}

const previousRemembered = parseRememberedOpportunityFingerprints(
  previous?.triggered_opportunity_fingerprints,
);
const releaseProducerLock = await acquireExclusiveRun(producerLockPath, { staleAfterMs: 10 * 60 * 1_000 });
let opportunityEvent: Awaited<ReturnType<typeof coordinateOpportunityTrigger>>;
let pendingId: string | null = null;
try {
  pendingId = await pendingTriggerId();
  opportunityEvent = await coordinateOpportunityTrigger({
    candidates,
    rememberedOpportunityFingerprints: previousRemembered,
    checkedAt,
    pendingTriggerId: pendingId,
    writeTrigger: async (trigger) => atomicWrite(triggerPath, trigger),
  });
} finally {
  await releaseProducerLock();
}

const state = {
  schema_version: 1,
  checked_at: checkedAt,
  since,
  account: GITHUB_DIGEST_ACCOUNT,
  read_only: true,
  external_actions_enabled: false,
  commenter_queries: [...ALGORA_SCOUT_COMMENTERS],
  inventory_count: inventory.length,
  evaluated_count: evaluations.length,
  admitted_candidate_count: candidates.length,
  evaluations,
  marker_version: OPPORTUNITY_MARKER_VERSION,
  emitted_new_trigger: opportunityEvent.trigger !== null,
  trigger_id: opportunityEvent.trigger?.trigger_id || null,
  pending_trigger_id: pendingId,
  triggered_opportunity_fingerprints: opportunityEvent.remembered_opportunity_fingerprints,
};
await atomicWrite(statePath, state);
console.log(JSON.stringify({
  checked_at: checkedAt,
  inventory_count: inventory.length,
  evaluated_count: evaluations.length,
  admitted_candidate_count: candidates.length,
  emitted_new_trigger: opportunityEvent.trigger !== null,
  trigger_id: opportunityEvent.trigger?.trigger_id || null,
}, null, 2));
