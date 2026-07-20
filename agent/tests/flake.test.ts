import test from "node:test";
import assert from "node:assert/strict";
import {
  FLAKE_SERVICE_REUSE,
  FlakeError,
  analyzeFlakeSnapshots,
  diagnoseGithubFlake,
  flakeFingerprint,
  parseFlakeAttempt,
  type FlakeJob,
  type FlakeSnapshot,
} from "../src/flake.ts";

const runUrl = "https://github.com/acme/widget/actions/runs/42";
const baseRun = {
  id: 42,
  run_attempt: 3,
  workflow_id: 7,
  name: "CI",
  path: ".github/workflows/ci.yml",
  event: "pull_request",
  head_branch: "feature",
  head_sha: "0123456789abcdef0123456789abcdef01234567",
  status: "completed",
  conclusion: "failure",
  created_at: "2026-07-20T10:00:00Z",
  updated_at: "2026-07-20T10:05:00Z",
  html_url: runUrl,
};

function job(id: number, name: string, conclusion: string, failedStep = "test"): FlakeJob {
  return {
    id,
    name,
    status: "completed",
    conclusion,
    html_url: `${runUrl}/job/${id}`,
    steps: [{ number: 1, name: failedStep, status: "completed", conclusion }],
  };
}

function snapshot(
  id: number,
  jobs: FlakeJob[],
  source: FlakeSnapshot["source"] = "historical",
  created = `2026-07-${String(id).padStart(2, "0")}T09:00:00Z`,
): FlakeSnapshot {
  return {
    run_id: String(id),
    attempt: 1,
    head_sha: source === "same_sha" ? baseRun.head_sha : `${String(id).padStart(40, "0")}`,
    conclusion: jobs.every(({ conclusion }) => conclusion === "success") ? "success" : "failure",
    created_at: created,
    html_url: `https://github.com/acme/widget/actions/runs/${id}`,
    jobs,
    source,
  };
}

async function analyze(options: {
  run?: any;
  jobs?: FlakeJob[];
  jobsTotal?: number;
  sameRun?: FlakeSnapshot[];
  sameSha?: FlakeSnapshot[];
  historical?: FlakeSnapshot[];
  partial?: any[];
} = {}) {
  return analyzeFlakeSnapshots({
    runUrl,
    repository: "acme/widget",
    run: options.run || baseRun,
    currentAttempt: 3,
    targetAttempt: 3,
    jobs: options.jobs || [job(1, "test (node 22)", "failure", "unit tests")],
    jobsTotal: options.jobsTotal,
    sameRun: options.sameRun || [],
    sameSha: options.sameSha || [],
    historical: options.historical || [],
    partialFailures: options.partial || [],
  }, new Date("2026-07-20T12:00:00Z"));
}

test("validates the optional exact attempt without coercing unsafe values", () => {
  assert.equal(parseFlakeAttempt(undefined), undefined);
  assert.equal(parseFlakeAttempt("1"), 1);
  assert.equal(parseFlakeAttempt(101), 101);
  for (const value of ["0", "01", "1.5", -1, Number.NaN, "9007199254740992"]) {
    assert.throws(
      () => parseFlakeAttempt(value),
      (error: unknown) => error instanceof FlakeError && error.code === "INVALID_ATTEMPT",
    );
  }
});

test("fingerprints exact job and ordered failed-step names with SHA-256", async () => {
  const first = await flakeFingerprint("test", ["setup", "run"]);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, await flakeFingerprint("test", ["setup", "run"]));
  assert.notEqual(first, await flakeFingerprint("Test", ["setup", "run"]));
  assert.notEqual(first, await flakeFingerprint("test", ["run", "setup"]));
  assert.notEqual(first, await flakeFingerprint("test ", ["setup", "run"]));
});

test("confirms only a same-run recovery and permits exactly one retry", async () => {
  const result = await analyze({
    sameRun: [snapshot(42, [job(2, "test (node 22)", "success")], "same_run")],
  });
  assert.equal(result.verdict, "CONFIRMED_FLAKE");
  assert.deepEqual(result.decision, {
    confidence: "high",
    retry: "ONCE",
    reason_codes: ["SAME_RUN_JOB_SUCCEEDED"],
  });
  assert.deepEqual(result.same_run_attempts[0].matching_jobs_succeeded, ["test (node 22)"]);
});

test("a duplicate same-name success and failure never authorizes retry", async () => {
  const result = await analyze({
    sameRun: [snapshot(42, [
      job(2, "test (node 22)", "success"),
      job(3, "test (node 22)", "failure", "unit tests"),
    ], "same_run")],
  });
  assert.equal(result.verdict, "INCONCLUSIVE");
  assert.equal(result.decision.retry, "NO");
  assert.deepEqual(result.same_run_attempts[0].matching_jobs_succeeded, []);
  assert.deepEqual(result.same_run_attempts[0].matching_jobs_failed, ["test (node 22)"]);
});

test("a truncated comparison attempt never authorizes retry", async () => {
  const comparison = snapshot(42, [job(2, "test (node 22)", "success")], "same_run");
  comparison.jobs_total = 101;
  const result = await analyze({ sameRun: [comparison] });
  assert.equal(result.verdict, "INCONCLUSIVE");
  assert.equal(result.decision.retry, "NO");
  assert.deepEqual(result.same_run_attempts[0].matching_jobs_succeeded, []);
});

test("same-SHA success is only likely and never automatically retried", async () => {
  const result = await analyze({
    sameSha: [snapshot(30, [job(30, "test (node 22)", "success")], "same_sha")],
  });
  assert.equal(result.verdict, "LIKELY_FLAKE");
  assert.equal(result.decision.confidence, "medium");
  assert.equal(result.decision.retry, "NO");
  assert.ok(result.decision.reason_codes.includes("SAME_SHA_JOB_SUCCEEDED"));
});

test("a later success on a different run does not mislabel an exact recurring failure as flaky", async () => {
  const result = await analyze({
    historical: [
      snapshot(10, [job(10, "test (node 22)", "failure", "unit tests")], "historical", "2026-07-10T09:00:00Z"),
      snapshot(11, [job(11, "test (node 22)", "success")], "historical", "2026-07-11T09:00:00Z"),
    ],
  });
  assert.equal(result.verdict, "RECURRING_FAILURE");
  assert.equal(result.decision.retry, "NO");
  assert.ok(result.decision.reason_codes.includes("HISTORICAL_FAILURE_RECURRED"));
  assert.equal(result.historical_matches[0].recovered_by_later_success, false);
});

test("an exact historical failure without recovery is recurring", async () => {
  const result = await analyze({
    historical: [snapshot(10, [job(10, "test (node 22)", "failure", "unit tests")])],
  });
  assert.equal(result.verdict, "RECURRING_FAILURE");
  assert.equal(result.decision.retry, "NO");
  assert.deepEqual(result.decision.reason_codes, ["HISTORICAL_FAILURE_RECURRED"]);
});

test("an unseen signature after five complete comparable runs is new", async () => {
  const historical = Array.from({ length: 5 }, (_, index) => snapshot(
    10 + index,
    [job(10 + index, "test (node 22)", index < 3 ? "success" : "failure", `different step ${index}`)],
  ));
  const result = await analyze({ historical });
  assert.equal(result.verdict, "NEW_FAILURE");
  assert.equal(result.decision.retry, "NO");
  assert.ok(result.decision.reason_codes.includes("FAILURE_SIGNATURE_UNSEEN"));
});

test("new failure requires observed successful history and complete target jobs", async () => {
  const unrelated = Array.from({ length: 5 }, (_, index) =>
    snapshot(10 + index, [job(10 + index, "other job", "success")]));
  assert.equal((await analyze({ historical: unrelated })).verdict, "INCONCLUSIVE");

  const observed = Array.from({ length: 5 }, (_, index) =>
    snapshot(20 + index, [job(20 + index, "test (node 22)", "success")]));
  assert.equal((await analyze({ historical: observed, jobsTotal: 2 })).verdict, "INCONCLUSIVE");
});

test("a truncated failed target remains inconclusive even with same-run recovery evidence", async () => {
  const result = await analyze({
    jobsTotal: 101,
    sameRun: [snapshot(42, [job(2, "test (node 22)", "success")], "same_run")],
  });
  assert.equal(result.verdict, "INCONCLUSIVE");
  assert.equal(result.decision.retry, "NO");
  assert.deepEqual(result.decision.reason_codes, ["TARGET_JOBS_INCOMPLETE"]);
  assert.equal(result.coverage.target_jobs_truncated, true);
});

test("cancelled and other unsupported completed conclusions remain inconclusive", async () => {
  for (const conclusion of ["cancelled", "neutral", "skipped", "stale", "action_required"]) {
    const result = await analyze({
      run: { ...baseRun, conclusion },
      jobs: [job(1, "test (node 22)", "failure", "unit tests")],
      sameRun: [snapshot(42, [job(2, "test (node 22)", "success")], "same_run")],
    });
    assert.equal(result.verdict, "INCONCLUSIVE", conclusion);
    assert.equal(result.decision.retry, "NO", conclusion);
    assert.deepEqual(result.decision.reason_codes, ["TARGET_UNSUPPORTED_CONCLUSION"], conclusion);
  }
});

test("weak, partial, or mixed evidence remains inconclusive", async () => {
  const weak = await analyze();
  assert.equal(weak.verdict, "INCONCLUSIVE");
  assert.ok(weak.decision.reason_codes.includes("INSUFFICIENT_COMPARABLE_RUNS"));

  const partial = await analyze({
    historical: Array.from({ length: 5 }, (_, index) => snapshot(10 + index, [job(10 + index, "other", "success")])),
    partial: [{ scope: "historical_run", identifier: "9", code: "UPSTREAM_ERROR" }],
  });
  assert.equal(partial.verdict, "INCONCLUSIVE");
  assert.ok(partial.decision.reason_codes.includes("PARTIAL_HISTORY"));

  const mixed = await analyze({
    jobs: [job(1, "test a", "failure", "one"), job(2, "test b", "failure", "two")],
    sameRun: [snapshot(42, [job(3, "test a", "success")], "same_run")],
  });
  assert.equal(mixed.verdict, "INCONCLUSIVE");
  assert.equal(mixed.decision.retry, "NO");
  assert.ok(mixed.decision.reason_codes.includes("MIXED_EVIDENCE"));
});

test("a successful exact attempt is not failed and needs no retry", async () => {
  const result = await analyze({
    run: { ...baseRun, conclusion: "success" },
    jobs: [job(1, "test", "success")],
  });
  assert.equal(result.verdict, "NOT_FAILED");
  assert.equal(result.decision.retry, "NOT_NEEDED");
  assert.deepEqual(result.decision.reason_codes, ["TARGET_SUCCEEDED"]);
  assert.equal(result.failure_signatures.length, 0);
});

test("service reuse pins results to the exact run ID and attempt", async () => {
  const result = await analyze();
  assert.deepEqual(result.service_reuse, FLAKE_SERVICE_REUSE);
  assert.match(result.service_reuse.guidance, /exact run ID and attempt/);
  assert.equal(result.service_reuse.reliability, "bounded_live_check");
});

test("live transport pins the selected attempt, caps concurrency and history, strips redirect auth, and never reads historical logs", async () => {
  const requested: Array<{ url: string; authorization: boolean; redirect?: RequestRedirect }> = [];
  let active = 0;
  let maximumActive = 0;
  const targetSha = baseRun.head_sha;

  const transport = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).has("authorization");
    requested.push({ url, authorization, redirect: init?.redirect });
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    const headers = { "x-ratelimit-remaining": "4990" };

    if (url === "https://api.github.com/repos/acme/widget") {
      return Response.json({ private: false, full_name: "acme/widget" }, { headers });
    }
    if (url === "https://api.github.com/repos/acme/widget/actions/runs/42") {
      return Response.json({ ...baseRun, run_attempt: 10 }, { headers });
    }
    if (/\/actions\/runs\/42\/attempts\/\d+$/.test(url)) {
      const attempt = Number(url.split("/").at(-1));
      return Response.json({ ...baseRun, run_attempt: attempt, conclusion: attempt === 3 ? "success" : "failure" }, { headers });
    }
    if (/\/actions\/runs\/42\/attempts\/\d+\/jobs\?per_page=100$/.test(url)) {
      const attempt = Number(url.match(/attempts\/(\d+)/)?.[1]);
      return Response.json({
        total_count: 1,
        jobs: [job(4_000 + attempt, "test (node 22)", attempt === 3 ? "success" : "failure", "unit tests")],
      }, { headers });
    }
    if (url.endsWith("/actions/jobs/4004/logs")) {
      assert.equal(init?.redirect, "manual");
      return new Response(null, { status: 302, headers: { ...headers, location: "https://results.example.blob.core.windows.net/logs/job.txt?sig=secret" } });
    }
    if (url.startsWith("https://results.example.blob.core.windows.net/logs/job.txt")) {
      assert.equal(authorization, false);
      assert.equal(init?.redirect, "error");
      return new Response("test failed\nAssertionError: expected true");
    }
    if (url.includes("/actions/runs?head_sha=") && url.endsWith("&per_page=20")) {
      const runs = Array.from({ length: 20 }, (_, index) => ({
        ...baseRun,
        id: 100 + index,
        run_attempt: 1,
        head_sha: targetSha,
        conclusion: index === 0 ? "success" : "failure",
        created_at: `2026-07-19T${String(index).padStart(2, "0")}:00:00Z`,
        html_url: `https://github.com/acme/widget/actions/runs/${100 + index}`,
      }));
      return Response.json({ total_count: 20, workflow_runs: runs }, { headers });
    }
    if (url.includes("/actions/workflows/7/runs?") && url.includes("status=completed")) {
      const runs = Array.from({ length: 20 }, (_, index) => ({
        ...baseRun,
        id: 200 + index,
        run_attempt: 1,
        head_sha: `${String(index + 1).padStart(40, "0")}`,
        created_at: `2026-07-18T${String(index).padStart(2, "0")}:00:00Z`,
        html_url: `https://github.com/acme/widget/actions/runs/${200 + index}`,
      }));
      return Response.json({ total_count: 20, workflow_runs: runs }, { headers });
    }
    const historyMatch = url.match(/\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs\?per_page=100$/);
    if (historyMatch) {
      const id = Number(historyMatch[1]);
      return Response.json({
        total_count: 1,
        jobs: [job(id * 10, "test (node 22)", id === 100 ? "success" : "failure", id >= 200 ? "older step" : "unit tests")],
      }, { headers });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const result = await diagnoseGithubFlake(runUrl, 4, { GITHUB_TOKEN: "server-token" }, transport, new Date("2026-07-20T12:00:00Z"));
  assert.equal(result.target.attempt, 4);
  assert.equal(result.target.current_attempt, 10);
  assert.equal(result.verdict, "CONFIRMED_FLAKE");
  assert.equal(result.decision.retry, "NO", "an older selected attempt must never authorize a retry");
  assert.equal(result.coverage.same_run_attempts_checked, 7);
  assert.equal(result.coverage.same_run_attempts_truncated, true);
  assert.equal(result.coverage.same_sha_runs_listed, 20);
  assert.equal(result.coverage.historical_job_pages, 12);
  assert.ok(result.coverage.earlier_comparable_runs_checked <= 12);
  assert.ok(result.coverage.target_logs_selected <= 8);
  assert.ok(result.coverage.target_log_bytes_read <= 4 * 1024 * 1024);
  assert.ok(maximumActive <= 4, `maximum concurrency was ${maximumActive}`);
  assert.ok(requested.some(({ url }) => url.endsWith("/actions/runs/42/attempts/4/jobs?per_page=100")));
  assert.ok(requested
    .filter(({ url }) => url.startsWith("https://api.github.com"))
    .every(({ redirect }) => redirect === "manual"));
  assert.ok(!requested.some(({ url }) => /\/actions\/runs\/(?:1\d\d|2\d\d)\/.*\/logs/.test(url)), "historical logs must never be requested");
  assert.ok(requested.filter(({ url }) => /\/actions\/runs\/(?:1\d\d|2\d\d)\/attempts\/\d+\/jobs/.test(url)).length <= 12);
});

test("live transport rejects private repositories and nonexistent attempts", async () => {
  const privateTransport = (async (input: URL | RequestInfo) => {
    if (String(input).endsWith("/repos/acme/widget")) return Response.json({ private: true });
    throw new Error("visibility check did not stop");
  }) as typeof fetch;
  await assert.rejects(
    () => diagnoseGithubFlake(runUrl, 1, {}, privateTransport),
    (error: unknown) => error instanceof FlakeError && error.code === "RUN_NOT_FOUND" && error.status === 404,
  );

  const missingAttempt = (async (input: URL | RequestInfo) => {
    const url = String(input);
    if (url.endsWith("/repos/acme/widget")) return Response.json({ private: false, full_name: "acme/widget" });
    if (url.endsWith("/actions/runs/42")) return Response.json({ ...baseRun, run_attempt: 2 });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  await assert.rejects(
    () => diagnoseGithubFlake(runUrl, 3, {}, missingAttempt),
    (error: unknown) => error instanceof FlakeError && error.code === "RUN_ATTEMPT_NOT_FOUND" && error.status === 404,
  );
});

test("live retry authorization revalidates unchanged, changed, and unavailable current state", async () => {
  async function run(mode: "unchanged" | "changed" | "unavailable") {
    let currentReads = 0;
    const current = { ...baseRun, run_attempt: 2, status: "completed", conclusion: "failure" };
    const transport = (async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/repos/acme/widget")) {
        return Response.json({ private: false, full_name: "acme/widget" });
      }
      if (url.endsWith("/actions/runs/42")) {
        currentReads += 1;
        if (currentReads === 2 && mode === "unavailable") throw new TypeError("connection reset");
        if (currentReads === 2 && mode === "changed") {
          return Response.json({
            ...current,
            run_attempt: 3,
            status: "in_progress",
            conclusion: null,
            updated_at: "2026-07-20T10:06:00Z",
          });
        }
        return Response.json(current);
      }
      if (url.endsWith("/actions/runs/42/attempts/2")) return Response.json(current);
      if (url.endsWith("/actions/runs/42/attempts/2/jobs?per_page=100")) {
        return Response.json({ total_count: 1, jobs: [job(1, "test (node 22)", "failure", "unit tests")] });
      }
      if (url.endsWith("/actions/jobs/1/logs")) return new Response(null, { status: 404 });
      if (url.endsWith("/actions/runs/42/attempts/1")) {
        return Response.json({ ...current, run_attempt: 1, conclusion: "success" });
      }
      if (url.endsWith("/actions/runs/42/attempts/1/jobs?per_page=100")) {
        return Response.json({ total_count: 1, jobs: [job(2, "test (node 22)", "success")] });
      }
      if (url.includes("/actions/runs?head_sha=")) return Response.json({ total_count: 0, workflow_runs: [] });
      if (url.includes("/actions/workflows/7/runs?")) return Response.json({ total_count: 0, workflow_runs: [] });
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    return diagnoseGithubFlake(runUrl, 2, {}, transport, new Date("2026-07-20T12:00:00Z"));
  }

  const unchanged = await run("unchanged");
  assert.equal(unchanged.verdict, "CONFIRMED_FLAKE");
  assert.equal(unchanged.decision.retry, "ONCE");

  const changed = await run("changed");
  assert.equal(changed.verdict, "INCONCLUSIVE");
  assert.equal(changed.decision.retry, "NO");
  assert.deepEqual(changed.decision.reason_codes, ["CURRENT_RUN_CHANGED_DURING_CHECK"]);
  assert.equal(changed.target.current_attempt, 3);

  const unavailable = await run("unavailable");
  assert.equal(unavailable.verdict, "INCONCLUSIVE");
  assert.equal(unavailable.decision.retry, "NO");
  assert.deepEqual(unavailable.decision.reason_codes, ["CURRENT_RUN_NOT_REVALIDATED"]);
  assert.ok(unavailable.coverage.partial_failures.some(({ scope }) => scope === "current_run"));
});

test("target log collection stops at eight logs and four MiB in aggregate", async () => {
  async function runWithLogSize(bytesPerLog: number) {
    const logRequests: string[] = [];
    const transport = (async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/repos/acme/widget")) return Response.json({ private: false, full_name: "acme/widget" });
      if (url.endsWith("/actions/runs/42")) return Response.json({ ...baseRun, run_attempt: 1 });
      if (url.endsWith("/actions/runs/42/attempts/1")) return Response.json({ ...baseRun, run_attempt: 1 });
      if (url.endsWith("/actions/runs/42/attempts/1/jobs?per_page=100")) {
        return Response.json({
          total_count: 9,
          jobs: Array.from({ length: 9 }, (_, index) => job(5_000 + index, `test ${index}`, "failure", "unit tests")),
        });
      }
      if (/\/actions\/jobs\/5\d{3}\/logs$/.test(url)) {
        logRequests.push(url);
        return new Response(new Uint8Array(bytesPerLog));
      }
      if (url.includes("/actions/runs?head_sha=")) return Response.json({ total_count: 0, workflow_runs: [] });
      if (url.includes("/actions/workflows/7/runs?")) return Response.json({ total_count: 0, workflow_runs: [] });
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    const result = await diagnoseGithubFlake(runUrl, 1, {}, transport);
    return { result, logRequests };
  }

  const exact = await runWithLogSize(512 * 1024);
  assert.equal(exact.result.coverage.target_logs_selected, 8);
  assert.equal(exact.result.coverage.target_logs_scanned, 8);
  assert.equal(exact.result.coverage.target_log_bytes_read, 4 * 1024 * 1024);
  assert.equal(exact.logRequests.length, 8);

  const oversized = await runWithLogSize(5 * 1024 * 1024);
  assert.equal(oversized.result.coverage.target_logs_selected, 1);
  assert.equal(oversized.result.coverage.target_log_bytes_read, 4 * 1024 * 1024);
  assert.equal(oversized.result.coverage.target_logs_truncated, 1);
  assert.equal(oversized.logRequests.length, 1);
});
