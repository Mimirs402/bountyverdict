import { HarnessError } from "./harness.ts";
import { parseRunUrl, redactLogLine, type RunJob, type RunStep } from "./run.ts";
import type { ServiceReuseGuidance } from "./reuse.ts";

export interface FlakeEnvironment {
  GITHUB_TOKEN?: string;
}

export type FlakeVerdict =
  | "CONFIRMED_FLAKE"
  | "LIKELY_FLAKE"
  | "RECURRING_FAILURE"
  | "NEW_FAILURE"
  | "INCONCLUSIVE"
  | "NOT_FAILED";

export type FlakeReasonCode =
  | "TARGET_SUCCEEDED"
  | "TARGET_NOT_COMPLETE"
  | "TARGET_JOBS_INCOMPLETE"
  | "TARGET_UNSUPPORTED_CONCLUSION"
  | "CURRENT_RUN_CHANGED_DURING_CHECK"
  | "CURRENT_RUN_NOT_REVALIDATED"
  | "SAME_RUN_JOB_SUCCEEDED"
  | "SAME_SHA_JOB_SUCCEEDED"
  | "HISTORICAL_FAILURE_RECURRED"
  | "FAILURE_SIGNATURE_UNSEEN"
  | "INSUFFICIENT_COMPARABLE_RUNS"
  | "PARTIAL_HISTORY"
  | "MIXED_EVIDENCE";

export type PartialFailure = {
  scope: "target_log" | "current_run" | "same_run_attempt" | "same_sha_run" | "historical_run";
  identifier: string;
  code: "UPSTREAM_ERROR" | "NOT_FOUND" | "LOG_UNAVAILABLE" | "DEADLINE_EXCEEDED" | "TRUNCATED";
};

export interface FlakeJob extends RunJob {
  steps?: RunStep[];
}

export interface FlakeSnapshot {
  run_id: string;
  attempt: number;
  head_sha: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
  jobs: FlakeJob[];
  jobs_total?: number;
  source: "same_run" | "same_sha" | "historical";
}

export interface FlakeAnalysisInput {
  runUrl: string;
  repository: string;
  run: any;
  currentAttempt: number;
  targetAttempt: number;
  jobs: FlakeJob[];
  jobsTotal?: number;
  logStatus?: Map<string, "scanned" | "unavailable">;
  logsScanned?: number;
  logsUnavailable?: number;
  logBytesRead?: number;
  logsTruncated?: number;
  sameRun: FlakeSnapshot[];
  sameSha: FlakeSnapshot[];
  historical: FlakeSnapshot[];
  sameRunAttemptsAvailable?: number;
  sameShaRunsListed?: number;
  earlierComparableRunsAvailable?: number;
  partialFailures?: PartialFailure[];
  rateRemaining?: number | null;
  deadlineMs?: number;
}

export interface FlakeResult {
  product: "FlakeVerdict";
  version: "1.0";
  verdict: FlakeVerdict;
  summary: string;
  service_reuse: ServiceReuseGuidance;
  decision: {
    confidence: "high" | "medium" | "low";
    retry: "ONCE" | "NO" | "NOT_NEEDED";
    reason_codes: FlakeReasonCode[];
  };
  target: {
    url: string;
    repository: string;
    id: string;
    attempt: number;
    current_attempt: number;
    workflow_id: number;
    workflow: string;
    workflow_path: string;
    event: string;
    head_branch: string;
    head_sha: string;
    status: string;
    conclusion: string | null;
    created_at: string;
    updated_at: string;
  };
  failure_signatures: Array<{
    fingerprint: string;
    job_name: string;
    conclusion: string | null;
    failed_steps: string[];
    evidence_url: string;
    log_status: "scanned" | "unavailable" | "not_selected";
  }>;
  same_run_attempts: Array<{
    attempt: number;
    conclusion: string | null;
    matching_jobs_succeeded: string[];
    matching_jobs_failed: string[];
  }>;
  same_sha_runs: Array<{
    run_id: string;
    attempt: number;
    conclusion: string | null;
    matching_jobs_succeeded: string[];
    matching_fingerprints: string[];
    html_url: string;
  }>;
  historical_matches: Array<{
    run_id: string;
    attempt: number;
    head_sha: string;
    created_at: string;
    matching_fingerprints: string[];
    recovered_by_later_success: boolean;
    html_url: string;
  }>;
  coverage: {
    target_jobs_reported: number;
    target_jobs_total: number;
    target_jobs_truncated: boolean;
    target_failed_jobs: number;
    target_logs_selected: number;
    target_logs_scanned: number;
    target_logs_unavailable: number;
    target_log_bytes_read: number;
    target_logs_truncated: number;
    same_run_attempts_available: number;
    same_run_attempts_checked: number;
    same_run_attempts_truncated: boolean;
    same_sha_runs_listed: number;
    same_sha_runs_checked: number;
    same_sha_runs_truncated: boolean;
    earlier_comparable_runs_available: number;
    earlier_comparable_runs_checked: number;
    earlier_comparable_runs_truncated: boolean;
    historical_job_pages: number;
    github_rate_limit_remaining: number | null;
    partial_failures: PartialFailure[];
    deadline_ms: number;
  };
  checked_at: string;
  limitations: string[];
}

export class FlakeError extends HarnessError {}

export const FLAKE_SERVICE_REUSE: ServiceReuseGuidance = {
  reusable: true,
  fresh_result_per_successful_call: true,
  reliability: "bounded_live_check",
  guidance: "Call FlakeVerdict for every completed public GitHub Actions failure before spending a retry; each successful call re-reads the selected attempt, other attempts of the same run, same-SHA outcomes, and up to 12 earlier comparable runs. Reuse a result only for its exact run ID and attempt, and call again after a new attempt appears.",
};

const FAILURE_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure"]);
const SUCCESS_CONCLUSION = "success";
const MAX_TARGET_LOGS = 8;
const MAX_LOG_BYTES = 4 * 1024 * 1024;
const MAX_RUN_ATTEMPTS = 8;
const MAX_SAME_SHA_LIST = 20;
const MAX_EARLIER_RUNS = 12;
const MAX_HISTORICAL_JOB_PAGES = 12;
const MAX_CONCURRENCY = 4;
const DEFAULT_DEADLINE_MS = 25_000;

function failedSteps(job: FlakeJob): string[] {
  return (job.steps || [])
    .filter((step) => FAILURE_CONCLUSIONS.has(String(step.conclusion || "")))
    .map((step) => String(step.name || ""));
}

function failedJobs(jobs: FlakeJob[]): FlakeJob[] {
  return jobs.filter((job) => FAILURE_CONCLUSIONS.has(String(job.conclusion || "")));
}

function successfulJobNames(jobs: FlakeJob[]): Set<string> {
  return new Set(jobs.filter((job) => job.conclusion === SUCCESS_CONCLUSION).map((job) => job.name));
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/** The fingerprint is deliberately exact: no case folding, whitespace folding, or step sorting. */
export async function flakeFingerprint(jobName: string, steps: string[]): Promise<string> {
  const canonical = JSON.stringify({ job_name: jobName, failed_steps: steps });
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
}

export function parseFlakeAttempt(value: string | number | null | undefined): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value);
  if (!/^[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new FlakeError("attempt must be a positive safe integer.", 400, "INVALID_ATTEMPT");
  }
  return Number(text);
}

type SignatureInternal = FlakeResult["failure_signatures"][number] & { job: FlakeJob };

async function signaturesFor(jobs: FlakeJob[], logStatus = new Map<string, "scanned" | "unavailable">()): Promise<SignatureInternal[]> {
  return Promise.all(failedJobs(jobs).map(async (job) => {
    const steps = failedSteps(job);
    return {
      fingerprint: await flakeFingerprint(job.name, steps),
      job_name: job.name,
      conclusion: job.conclusion,
      failed_steps: steps,
      evidence_url: job.html_url,
      log_status: logStatus.get(String(job.id)) || "not_selected",
      job,
    };
  }));
}

async function snapshotFingerprints(snapshot: FlakeSnapshot): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (const job of failedJobs(snapshot.jobs)) {
    const fingerprint = await flakeFingerprint(job.name, failedSteps(job));
    const names = result.get(fingerprint) || [];
    names.push(job.name);
    result.set(fingerprint, names);
  }
  return result;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export async function analyzeFlakeSnapshots(input: FlakeAnalysisInput, now = new Date()): Promise<FlakeResult> {
  const partialFailures = input.partialFailures || [];
  const signatures = await signaturesFor(input.jobs, input.logStatus);
  const signatureSet = new Set(signatures.map(({ fingerprint }) => fingerprint));
  const targetNames = new Set(signatures.map(({ job_name }) => job_name));

  const snapshotMaps = new Map<FlakeSnapshot, Map<string, string[]>>();
  for (const snapshot of [...input.sameRun, ...input.sameSha, ...input.historical]) {
    snapshotMaps.set(snapshot, await snapshotFingerprints(snapshot));
  }

  const sameRunAttempts = input.sameRun.map((snapshot) => {
    const successes = successfulJobNames(snapshot.jobs);
    const failures = new Set(failedJobs(snapshot.jobs).map(({ name }) => name));
    const complete = (snapshot.jobs_total ?? snapshot.jobs.length) <= snapshot.jobs.length;
    return {
      attempt: snapshot.attempt,
      conclusion: snapshot.conclusion,
      matching_jobs_succeeded: complete
        ? [...targetNames].filter((name) => successes.has(name) && !failures.has(name)).sort()
        : [],
      matching_jobs_failed: [...targetNames].filter((name) => failures.has(name)).sort(),
    };
  }).sort((a, b) => a.attempt - b.attempt);

  const sameShaRuns = input.sameSha.map((snapshot) => {
    const successes = successfulJobNames(snapshot.jobs);
    const failures = new Set(failedJobs(snapshot.jobs).map(({ name }) => name));
    const complete = (snapshot.jobs_total ?? snapshot.jobs.length) <= snapshot.jobs.length;
    const fingerprints = snapshotMaps.get(snapshot) || new Map();
    return {
      run_id: snapshot.run_id,
      attempt: snapshot.attempt,
      conclusion: snapshot.conclusion,
      matching_jobs_succeeded: complete
        ? [...targetNames].filter((name) => successes.has(name) && !failures.has(name)).sort()
        : [],
      matching_fingerprints: [...fingerprints.keys()].filter((value) => signatureSet.has(value)).sort(),
      html_url: snapshot.html_url,
    };
  });

  const historyAsc = [...input.historical].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const historicalMatches = historyAsc.flatMap((snapshot) => {
    const fingerprints = snapshotMaps.get(snapshot) || new Map();
    const matching = [...fingerprints.keys()].filter((value) => signatureSet.has(value)).sort();
    if (!matching.length) return [];
    return [{
      run_id: snapshot.run_id,
      attempt: snapshot.attempt,
      head_sha: snapshot.head_sha,
      created_at: snapshot.created_at,
      matching_fingerprints: matching,
      // A success on a different run/commit is not proof that this exact failure recovered.
      // Only same-run attempts authorize CONFIRMED_FLAKE, represented separately above.
      recovered_by_later_success: false,
      html_url: snapshot.html_url,
    }];
  });

  const classifications: FlakeVerdict[] = signatures.map((signature) => {
    const sameRunSuccess = sameRunAttempts.some(({ matching_jobs_succeeded }) => matching_jobs_succeeded.includes(signature.job_name));
    if (sameRunSuccess) return "CONFIRMED_FLAKE";
    const sameShaSuccess = sameShaRuns.some(({ matching_jobs_succeeded }) => matching_jobs_succeeded.includes(signature.job_name));
    if (sameShaSuccess) return "LIKELY_FLAKE";
    const matches = historicalMatches.filter(({ matching_fingerprints }) => matching_fingerprints.includes(signature.fingerprint));
    if (matches.length) return "RECURRING_FAILURE";
    const observations = input.historical.flatMap(({ jobs }) => jobs)
      .filter(({ name, status }) => name === signature.job_name && status === "completed");
    const successes = observations.filter(({ conclusion }) => conclusion === SUCCESS_CONCLUSION).length;
    const targetJobsTruncated = (input.jobsTotal ?? input.jobs.length) > input.jobs.length;
    const historyComplete = input.historical.every((snapshot) =>
      (snapshot.jobs_total ?? snapshot.jobs.length) <= snapshot.jobs.length
    );
    if (input.historical.length >= 5 && observations.length >= 3 && successes >= 2 && historyComplete && !targetJobsTruncated && partialFailures.length === 0) {
      return "NEW_FAILURE";
    }
    return "INCONCLUSIVE";
  });

  const status = String(input.run.status || "");
  const conclusion = input.run.conclusion == null ? null : String(input.run.conclusion);
  let verdict: FlakeVerdict;
  let confidence: "high" | "medium" | "low";
  let retry: "ONCE" | "NO" | "NOT_NEEDED";
  const reasons: FlakeReasonCode[] = [];

  if (status === "completed" && conclusion === SUCCESS_CONCLUSION) {
    verdict = "NOT_FAILED";
    confidence = "high";
    retry = "NOT_NEEDED";
    reasons.push("TARGET_SUCCEEDED");
  } else if (status !== "completed") {
    verdict = "INCONCLUSIVE";
    confidence = "low";
    retry = "NO";
    reasons.push("TARGET_NOT_COMPLETE");
  } else if (!FAILURE_CONCLUSIONS.has(String(conclusion || ""))) {
    verdict = "INCONCLUSIVE";
    confidence = "low";
    retry = "NO";
    reasons.push("TARGET_UNSUPPORTED_CONCLUSION");
  } else if ((input.jobsTotal ?? input.jobs.length) > input.jobs.length) {
    verdict = "INCONCLUSIVE";
    confidence = "low";
    retry = "NO";
    reasons.push("TARGET_JOBS_INCOMPLETE");
  } else if (!signatures.length) {
    verdict = "INCONCLUSIVE";
    confidence = "low";
    retry = "NO";
    reasons.push("TARGET_JOBS_INCOMPLETE");
  } else {
    const kinds = unique(classifications);
    verdict = kinds.length === 1 ? kinds[0] : "INCONCLUSIVE";
    confidence = verdict === "CONFIRMED_FLAKE" || verdict === "NEW_FAILURE"
      ? "high"
      : verdict === "LIKELY_FLAKE" || verdict === "RECURRING_FAILURE"
        ? "medium"
        : "low";
    const targetIsCurrentFailure = input.targetAttempt === input.currentAttempt && FAILURE_CONCLUSIONS.has(String(conclusion || ""));
    retry = verdict === "CONFIRMED_FLAKE" && targetIsCurrentFailure ? "ONCE" : "NO";
    if (classifications.includes("CONFIRMED_FLAKE")) reasons.push("SAME_RUN_JOB_SUCCEEDED");
    if (sameShaRuns.some(({ matching_jobs_succeeded }) => matching_jobs_succeeded.length)) reasons.push("SAME_SHA_JOB_SUCCEEDED");
    if (classifications.includes("RECURRING_FAILURE")) reasons.push("HISTORICAL_FAILURE_RECURRED");
    if (classifications.includes("NEW_FAILURE")) reasons.push("FAILURE_SIGNATURE_UNSEEN");
    if (classifications.includes("INCONCLUSIVE") && input.historical.length < 5) reasons.push("INSUFFICIENT_COMPARABLE_RUNS");
    if (kinds.length > 1) reasons.push("MIXED_EVIDENCE");
  }
  if (partialFailures.length) reasons.push("PARTIAL_HISTORY");

  const summary = verdict === "CONFIRMED_FLAKE"
    ? retry === "ONCE"
      ? "The same jobs succeeded in another attempt of this exact workflow run; retry the currently failed jobs once."
      : "The same jobs succeeded in another attempt of this exact workflow run; the selected attempt is not the current failure, so do not retry it."
    : verdict === "LIKELY_FLAKE"
      ? "A same-commit success suggests flakiness, but the evidence is not strong enough to auto-retry."
      : verdict === "RECURRING_FAILURE"
        ? "The same job-and-failed-step structure recurred in comparable history; inspect the underlying errors before deciding whether the cause is the same."
        : verdict === "NEW_FAILURE"
          ? "The exact failure signature was absent from at least five comparable historical runs."
          : verdict === "NOT_FAILED"
            ? "The requested workflow attempt completed successfully and does not need a retry."
            : "The bounded evidence is incomplete or mixed, so an automatic retry would be unsafe.";

  const targetLogsSelected = signatures.filter(({ log_status }) => log_status !== "not_selected").length;
  const sameRunAvailable = input.sameRunAttemptsAvailable ?? input.sameRun.length;
  const sameShaListed = input.sameShaRunsListed ?? input.sameSha.length;
  const earlierAvailable = input.earlierComparableRunsAvailable ?? input.historical.length;

  return {
    product: "FlakeVerdict",
    version: "1.0",
    verdict,
    summary,
    service_reuse: FLAKE_SERVICE_REUSE,
    decision: { confidence, retry, reason_codes: unique(reasons) },
    target: {
      url: input.runUrl,
      repository: input.repository,
      id: String(input.run.id || ""),
      attempt: input.targetAttempt,
      current_attempt: input.currentAttempt,
      workflow_id: Number(input.run.workflow_id || 0),
      workflow: String(input.run.name || input.run.display_title || ""),
      workflow_path: String(input.run.path || ""),
      event: String(input.run.event || ""),
      head_branch: String(input.run.head_branch || ""),
      head_sha: String(input.run.head_sha || ""),
      status,
      conclusion,
      created_at: String(input.run.created_at || ""),
      updated_at: String(input.run.updated_at || ""),
    },
    failure_signatures: signatures.map(({ job: _job, ...signature }) => signature),
    same_run_attempts: sameRunAttempts,
    same_sha_runs: sameShaRuns,
    historical_matches: historicalMatches,
    coverage: {
      target_jobs_reported: input.jobs.length,
      target_jobs_total: input.jobsTotal ?? input.jobs.length,
      target_jobs_truncated: (input.jobsTotal ?? input.jobs.length) > input.jobs.length,
      target_failed_jobs: signatures.length,
      target_logs_selected: targetLogsSelected,
      target_logs_scanned: input.logsScanned ?? [...(input.logStatus || new Map()).values()].filter((value) => value === "scanned").length,
      target_logs_unavailable: input.logsUnavailable ?? [...(input.logStatus || new Map()).values()].filter((value) => value === "unavailable").length,
      target_log_bytes_read: input.logBytesRead || 0,
      target_logs_truncated: input.logsTruncated || 0,
      same_run_attempts_available: sameRunAvailable,
      same_run_attempts_checked: input.sameRun.length,
      same_run_attempts_truncated: sameRunAvailable > input.sameRun.length,
      same_sha_runs_listed: sameShaListed,
      same_sha_runs_checked: input.sameSha.length,
      same_sha_runs_truncated: sameShaListed > input.sameSha.length,
      earlier_comparable_runs_available: earlierAvailable,
      earlier_comparable_runs_checked: input.historical.length,
      earlier_comparable_runs_truncated: earlierAvailable > input.historical.length,
      historical_job_pages: input.sameSha.length + input.historical.length,
      github_rate_limit_remaining: input.rateRemaining ?? null,
      partial_failures: partialFailures,
      deadline_ms: input.deadlineMs ?? DEFAULT_DEADLINE_MS,
    },
    checked_at: now.toISOString(),
    limitations: [
      "FlakeVerdict reads public GitHub Actions metadata and bounded target-attempt logs; it never reruns jobs or executes repository code.",
      "Failure fingerprints contain exact job and failed-step names, not error text; structural recurrence does not prove an identical root cause.",
      "Fingerprints are SHA-256 hashes of the exact job name and ordered failed-step names, so workflow renames can hide a related failure.",
      "Only another successful attempt of the exact run permits a one-time retry recommendation; likely flakes are never auto-retried.",
      "History is bounded to eight same-run attempts, twenty listed same-SHA runs, twelve earlier comparable runs, and twelve historical job pages.",
      "At most eight target logs and four MiB in aggregate are read. Historical logs are never requested.",
    ],
  };
}

type FetchLike = typeof fetch;

class Deadline {
  readonly startedAt = Date.now();
  readonly milliseconds: number;

  constructor(milliseconds: number) {
    this.milliseconds = milliseconds;
  }

  remaining(): number {
    return Math.max(0, this.milliseconds - (Date.now() - this.startedAt));
  }

  signal(maximum: number): AbortSignal {
    const remaining = this.remaining();
    if (remaining <= 0) throw new FlakeError("The bounded GitHub check exceeded its deadline.", 503, "DEADLINE_EXCEEDED");
    return AbortSignal.timeout(Math.max(1, Math.min(maximum, remaining)));
  }
}

function githubHeaders(env: FlakeEnvironment): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "FlakeVerdict-Agent/1.0",
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

type RateTracker = { remaining: number | null };

function trackRate(response: Response, tracker: RateTracker): void {
  const header = response.headers.get("x-ratelimit-remaining");
  if (header === null) return;
  const parsed = Number(header);
  if (Number.isFinite(parsed)) tracker.remaining = tracker.remaining === null ? parsed : Math.min(tracker.remaining, parsed);
}

async function githubJson(
  path: string,
  env: FlakeEnvironment,
  fetchImpl: FetchLike,
  deadline: Deadline,
  tracker: RateTracker,
): Promise<any> {
  let response: Response;
  try {
    response = await fetchImpl(`https://api.github.com${path}`, {
      headers: githubHeaders(env),
      // Workers does not implement redirect:"error" for subrequests. Manual
      // returns any 3xx without following it, preserving the same no-redirect
      // and no-credential-forwarding invariant.
      redirect: "manual",
      signal: deadline.signal(10_000),
    });
  } catch (error) {
    if (deadline.remaining() <= 0 || (error instanceof Error && error.name === "TimeoutError")) {
      throw new FlakeError("The bounded GitHub check exceeded its deadline.", 503, "DEADLINE_EXCEEDED");
    }
    console.error("FlakeVerdict GitHub transport failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message.slice(0, 240) : "non-error rejection",
    });
    throw new FlakeError("GitHub could not be reached for the bounded history check.", 502, "GITHUB_UPSTREAM_ERROR");
  }
  trackRate(response, tracker);
  if (!response.ok) {
    if (response.status === 404) throw new FlakeError("GitHub could not find that public workflow run.", 404, "RUN_NOT_FOUND");
    if (response.status === 429 || response.status === 403) {
      throw new FlakeError("GitHub API capacity is temporarily exhausted.", 503, "GITHUB_RATE_LIMITED");
    }
    throw new FlakeError(`GitHub returned HTTP ${response.status}.`, 502, "GITHUB_UPSTREAM_ERROR");
  }
  return response.json();
}

function mapJob(job: any, fallbackUrl: string): FlakeJob {
  return {
    id: Number(job.id),
    name: String(job.name || ""),
    status: String(job.status || ""),
    conclusion: job.conclusion == null ? null : String(job.conclusion),
    html_url: String(job.html_url || fallbackUrl),
    started_at: job.started_at,
    completed_at: job.completed_at,
    steps: Array.isArray(job.steps) ? job.steps.map((step: any) => ({
      number: Number(step.number),
      name: String(step.name || ""),
      status: String(step.status || ""),
      conclusion: step.conclusion == null ? null : String(step.conclusion),
    })) : [],
  };
}

async function jobsFor(
  base: string,
  runId: string,
  attempt: number,
  env: FlakeEnvironment,
  fetchImpl: FetchLike,
  deadline: Deadline,
  tracker: RateTracker,
): Promise<{ jobs: FlakeJob[]; total: number }> {
  const data = await githubJson(`${base}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`, env, fetchImpl, deadline, tracker);
  const jobs = (Array.isArray(data.jobs) ? data.jobs : []).map((job: any) => mapJob(job, `https://github.com/actions/runs/${runId}/job/${job.id}`));
  return { jobs, total: Number(data.total_count || jobs.length) };
}

async function mapLimit<T, R>(values: T[], limit: number, mapper: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function allowedLogHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "github.com" || host.endsWith(".actions.githubusercontent.com") || host.endsWith(".blob.core.windows.net");
}

async function readBounded(response: Response, allowance: number): Promise<{ bytes: number; truncated: boolean }> {
  if (!response.body) return { bytes: 0, truncated: false };
  if (allowance <= 0) {
    await response.body.cancel();
    return { bytes: 0, truncated: true };
  }
  const reader = response.body.getReader();
  let bytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const accepted = Math.min(value.byteLength, allowance - bytes);
    bytes += Math.max(0, accepted);
    // Parse a bounded prefix only to exercise redaction on untrusted output; log text is never returned.
    if (accepted > 0) redactLogLine(new TextDecoder().decode(value.subarray(0, Math.min(accepted, 1024))));
    if (accepted < value.byteLength || bytes >= allowance) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  return { bytes, truncated };
}

async function targetJobLog(
  base: string,
  jobId: number,
  allowance: number,
  env: FlakeEnvironment,
  fetchImpl: FetchLike,
  deadline: Deadline,
  tracker: RateTracker,
): Promise<{ bytes: number; truncated: boolean } | null> {
  let response = await fetchImpl(`${base}/actions/jobs/${jobId}/logs`, {
    headers: githubHeaders(env),
    redirect: "manual",
    signal: deadline.signal(10_000),
  });
  trackRate(response, tracker);
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (!location) return null;
    let target: URL;
    try {
      target = new URL(location);
    } catch {
      return null;
    }
    if (target.protocol !== "https:" || target.username || target.password || !allowedLogHost(target.hostname)) return null;
    response = await fetchImpl(target.href, { redirect: "error", signal: deadline.signal(10_000) });
  }
  if (response.status === 404 || response.status === 410 || !response.ok) return null;
  return readBounded(response, allowance);
}

function partialCode(error: unknown): PartialFailure["code"] {
  if (error instanceof FlakeError && error.code === "DEADLINE_EXCEEDED") return "DEADLINE_EXCEEDED";
  if (error instanceof FlakeError && error.status === 404) return "NOT_FOUND";
  return "UPSTREAM_ERROR";
}

function runAttempt(run: any): number {
  return Math.max(1, Number(run.run_attempt || 1));
}

function nearestOtherAttempts(currentAttempt: number, targetAttempt: number, maximum: number): number[] {
  const selected: number[] = [];
  for (let distance = 1; selected.length < maximum && (targetAttempt - distance >= 1 || targetAttempt + distance <= currentAttempt); distance += 1) {
    // Prefer the newer attempt when two candidates are equally distant.
    if (targetAttempt + distance <= currentAttempt) selected.push(targetAttempt + distance);
    if (selected.length < maximum && targetAttempt - distance >= 1) selected.push(targetAttempt - distance);
  }
  return selected;
}

function sameRunContext(run: any, target: any): boolean {
  const runRepository = String(run.head_repository?.full_name || "");
  const targetRepository = String(target.head_repository?.full_name || "");
  return Number(run.workflow_id || 0) === Number(target.workflow_id || 0) &&
    String(run.event || "") === String(target.event || "") &&
    String(run.head_branch || "") === String(target.head_branch || "") &&
    (!runRepository || !targetRepository || runRepository === targetRepository) &&
    String(run.id || "") !== String(target.id || "");
}

function earlierComparableRun(run: any, target: any): boolean {
  return sameRunContext(run, target) &&
    Date.parse(String(run.created_at || "")) < Date.parse(String(target.created_at || ""));
}

export async function diagnoseGithubFlake(
  runUrl: string,
  attemptValue?: string | number | null,
  env: FlakeEnvironment = {},
  fetchImpl: FetchLike = fetch,
  now = new Date(),
  options: { deadlineMs?: number } = {},
): Promise<FlakeResult> {
  const { owner, repo, runId } = parseRunUrl(runUrl);
  const requestedAttempt = parseFlakeAttempt(attemptValue);
  const deadlineMs = Math.max(100, Math.min(60_000, options.deadlineMs ?? DEFAULT_DEADLINE_MS));
  const deadline = new Deadline(deadlineMs);
  const tracker: RateTracker = { remaining: null };
  const partialFailures: PartialFailure[] = [];
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const repository = await githubJson(base, env, fetchImpl, deadline, tracker);
  if (repository.private === true) throw new FlakeError("GitHub could not find that public workflow run.", 404, "RUN_NOT_FOUND");
  const currentRun = await githubJson(`${base}/actions/runs/${runId}`, env, fetchImpl, deadline, tracker);
  const currentAttempt = runAttempt(currentRun);
  const targetAttempt = requestedAttempt ?? currentAttempt;
  if (targetAttempt > currentAttempt) throw new FlakeError("The requested attempt does not exist for this workflow run.", 404, "RUN_ATTEMPT_NOT_FOUND");
  const targetRun = await githubJson(`${base}/actions/runs/${runId}/attempts/${targetAttempt}`, env, fetchImpl, deadline, tracker);
  const targetJobs = await jobsFor(base, runId, targetAttempt, env, fetchImpl, deadline, tracker);

  const logStatus = new Map<string, "scanned" | "unavailable">();
  let logsScanned = 0;
  let logsUnavailable = 0;
  let logBytesRead = 0;
  let logsTruncated = 0;
  const targetFailed = failedJobs(targetJobs.jobs).slice(0, MAX_TARGET_LOGS);
  // Logs are intentionally sequential so the aggregate transfer allowance cannot race.
  for (const job of targetFailed) {
    if (logBytesRead >= MAX_LOG_BYTES) break;
    try {
      const log = await targetJobLog(base, job.id, MAX_LOG_BYTES - logBytesRead, env, fetchImpl, deadline, tracker);
      if (log) {
        logStatus.set(String(job.id), "scanned");
        logsScanned += 1;
        logBytesRead += log.bytes;
        if (log.truncated) logsTruncated += 1;
      } else {
        logStatus.set(String(job.id), "unavailable");
        logsUnavailable += 1;
        partialFailures.push({ scope: "target_log", identifier: String(job.id), code: "LOG_UNAVAILABLE" });
      }
    } catch (error) {
      logStatus.set(String(job.id), "unavailable");
      logsUnavailable += 1;
      partialFailures.push({ scope: "target_log", identifier: String(job.id), code: partialCode(error) });
      if (partialCode(error) === "DEADLINE_EXCEEDED") break;
    }
  }

  const otherAttemptsAvailable = Math.max(0, currentAttempt - 1);
  const attemptsSelected = nearestOtherAttempts(currentAttempt, targetAttempt, MAX_RUN_ATTEMPTS - 1);
  const sameRunRaw = await mapLimit(attemptsSelected, MAX_CONCURRENCY, async (attempt): Promise<FlakeSnapshot | null> => {
    try {
      // Sequential inside each worker keeps aggregate GitHub concurrency at four.
      const run = await githubJson(`${base}/actions/runs/${runId}/attempts/${attempt}`, env, fetchImpl, deadline, tracker);
      const page = await jobsFor(base, runId, attempt, env, fetchImpl, deadline, tracker);
      return {
        run_id: runId,
        attempt,
        head_sha: String(run.head_sha || targetRun.head_sha || ""),
        conclusion: run.conclusion == null ? null : String(run.conclusion),
        created_at: String(run.created_at || targetRun.created_at || ""),
        html_url: String(run.html_url || runUrl),
        jobs: page.jobs,
        jobs_total: page.total,
        source: "same_run",
      };
    } catch (error) {
      partialFailures.push({ scope: "same_run_attempt", identifier: String(attempt), code: partialCode(error) });
      return null;
    }
  });
  const sameRun = sameRunRaw.filter((value): value is FlakeSnapshot => value !== null);
  for (const snapshot of sameRun) {
    if ((snapshot.jobs_total ?? snapshot.jobs.length) > snapshot.jobs.length) {
      partialFailures.push({ scope: "same_run_attempt", identifier: String(snapshot.attempt), code: "TRUNCATED" });
    }
  }

  let sameShaList: any[] = [];
  try {
    const listed = await githubJson(`${base}/actions/runs?head_sha=${encodeURIComponent(String(targetRun.head_sha || ""))}&per_page=${MAX_SAME_SHA_LIST}`, env, fetchImpl, deadline, tracker);
    sameShaList = (Array.isArray(listed.workflow_runs) ? listed.workflow_runs : [])
      .filter((run: any) => sameRunContext(run, targetRun))
      .slice(0, MAX_SAME_SHA_LIST);
  } catch (error) {
    partialFailures.push({ scope: "same_sha_run", identifier: "list", code: partialCode(error) });
  }

  let historicalList: any[] = [];
  try {
    const workflowId = Number(targetRun.workflow_id || 0);
    if (workflowId > 0) {
      const historyQuery = new URLSearchParams({
        per_page: "20",
        event: String(targetRun.event || ""),
        branch: String(targetRun.head_branch || ""),
        status: "completed",
        created: `<${String(targetRun.created_at || "")}`,
      });
      const listed = await githubJson(`${base}/actions/workflows/${workflowId}/runs?${historyQuery}`, env, fetchImpl, deadline, tracker);
      historicalList = (Array.isArray(listed.workflow_runs) ? listed.workflow_runs : [])
        .filter((run: any) => earlierComparableRun(run, targetRun) && String(run.head_sha || "") !== String(targetRun.head_sha || ""))
        .sort((a: any, b: any) => Date.parse(String(b.created_at || "")) - Date.parse(String(a.created_at || "")));
    }
  } catch (error) {
    partialFailures.push({ scope: "historical_run", identifier: "list", code: partialCode(error) });
  }

  const candidateKeys = new Set<string>();
  const candidates: Array<{ run: any; source: "same_sha" | "historical" }> = [];
  const initialSameSha = sameShaList.slice(0, Math.min(6, MAX_HISTORICAL_JOB_PAGES));
  for (const run of initialSameSha) {
    const key = `${run.id}:${runAttempt(run)}`;
    if (!candidateKeys.has(key) && candidates.length < MAX_HISTORICAL_JOB_PAGES) {
      candidateKeys.add(key);
      candidates.push({ run, source: "same_sha" });
    }
  }
  for (const run of historicalList.slice(0, MAX_EARLIER_RUNS)) {
    const key = `${run.id}:${runAttempt(run)}`;
    if (!candidateKeys.has(key) && candidates.length < MAX_HISTORICAL_JOB_PAGES) {
      candidateKeys.add(key);
      candidates.push({ run, source: "historical" });
    }
  }
  for (const run of sameShaList.slice(initialSameSha.length)) {
    const key = `${run.id}:${runAttempt(run)}`;
    if (!candidateKeys.has(key) && candidates.length < MAX_HISTORICAL_JOB_PAGES) {
      candidateKeys.add(key);
      candidates.push({ run, source: "same_sha" });
    }
  }

  const historicalRaw = await mapLimit(candidates, MAX_CONCURRENCY, async ({ run, source }): Promise<FlakeSnapshot | null> => {
    const id = String(run.id);
    const attempt = runAttempt(run);
    try {
      const page = await jobsFor(base, id, attempt, env, fetchImpl, deadline, tracker);
      return {
        run_id: id,
        attempt,
        head_sha: String(run.head_sha || ""),
        conclusion: run.conclusion == null ? null : String(run.conclusion),
        created_at: String(run.created_at || ""),
        html_url: String(run.html_url || `https://github.com/${owner}/${repo}/actions/runs/${id}`),
        jobs: page.jobs,
        jobs_total: page.total,
        source,
      };
    } catch (error) {
      partialFailures.push({ scope: source === "same_sha" ? "same_sha_run" : "historical_run", identifier: id, code: partialCode(error) });
      return null;
    }
  });
  const historicalSnapshots = historicalRaw.filter((value): value is FlakeSnapshot => value !== null);
  for (const snapshot of historicalSnapshots) {
    if ((snapshot.jobs_total ?? snapshot.jobs.length) > snapshot.jobs.length) {
      partialFailures.push({
        scope: snapshot.source === "same_sha" ? "same_sha_run" : "historical_run",
        identifier: snapshot.run_id,
        code: "TRUNCATED",
      });
    }
  }
  const sameSha = historicalSnapshots.filter(({ source }) => source === "same_sha");
  const historical = historicalSnapshots.filter(({ source }) => source === "historical");

  const result = await analyzeFlakeSnapshots({
    runUrl: String(targetRun.html_url || runUrl),
    repository: String(repository.full_name || `${owner}/${repo}`),
    run: { ...targetRun, run_attempt: targetAttempt },
    currentAttempt,
    targetAttempt,
    jobs: targetJobs.jobs,
    jobsTotal: targetJobs.total,
    logStatus,
    logsScanned,
    logsUnavailable,
    logBytesRead,
    logsTruncated,
    sameRun,
    sameSha,
    historical,
    sameRunAttemptsAvailable: otherAttemptsAvailable,
    sameShaRunsListed: sameShaList.length,
    earlierComparableRunsAvailable: historicalList.length,
    partialFailures: partialFailures.sort((a, b) => a.scope.localeCompare(b.scope) || a.identifier.localeCompare(b.identifier) || a.code.localeCompare(b.code)),
    rateRemaining: tracker.remaining,
    deadlineMs,
  }, now);

  if (result.decision.retry !== "ONCE") return result;

  try {
    const revalidated = await githubJson(`${base}/actions/runs/${runId}`, env, fetchImpl, deadline, tracker);
    const changed = runAttempt(revalidated) !== currentAttempt ||
      String(revalidated.status || "") !== String(currentRun.status || "") ||
      String(revalidated.conclusion || "") !== String(currentRun.conclusion || "") ||
      String(revalidated.updated_at || "") !== String(currentRun.updated_at || "") ||
      String(revalidated.head_sha || "") !== String(currentRun.head_sha || "");
    if (!changed) {
      result.coverage.github_rate_limit_remaining = tracker.remaining;
      return result;
    }
    return {
      ...result,
      verdict: "INCONCLUSIVE",
      summary: "The workflow changed while FlakeVerdict was checking it, so a retry is not authorized.",
      decision: {
        confidence: "low",
        retry: "NO",
        reason_codes: ["CURRENT_RUN_CHANGED_DURING_CHECK"],
      },
      target: { ...result.target, current_attempt: runAttempt(revalidated) },
      coverage: { ...result.coverage, github_rate_limit_remaining: tracker.remaining },
    };
  } catch (error) {
    const revalidationFailure: PartialFailure = {
      scope: "current_run",
      identifier: runId,
      code: partialCode(error),
    };
    return {
      ...result,
      verdict: "INCONCLUSIVE",
      summary: "The current workflow state could not be revalidated, so a retry is not authorized.",
      decision: {
        confidence: "low",
        retry: "NO",
        reason_codes: ["CURRENT_RUN_NOT_REVALIDATED"],
      },
      coverage: {
        ...result.coverage,
        github_rate_limit_remaining: tracker.remaining,
        partial_failures: [
          ...result.coverage.partial_failures,
          revalidationFailure,
        ].sort((a, b) => a.scope.localeCompare(b.scope) || a.identifier.localeCompare(b.identifier) || a.code.localeCompare(b.code)),
      },
    };
  }
}
