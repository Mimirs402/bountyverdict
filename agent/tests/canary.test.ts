import test from "node:test";
import assert from "node:assert/strict";
import {
  CANARY_FIXTURES,
  CanaryContractError,
  assertServiceReuseGuidance,
  runFunctionalCanary,
  verifyCanaryAuthorization,
} from "../src/canary.ts";
import app from "../src/index.ts";
import { SERVICE_REUSE } from "../src/reuse.ts";
import { FLAKE_SERVICE_REUSE, type FlakeResult } from "../src/flake.ts";
import { MCP_DRIFT_SERVICE_REUSE, analyzeMcpDrift } from "../src/mcp-drift.ts";

const now = new Date("2026-07-20T12:00:00.000Z");
const base = {
  now: () => now,
  monotonic: (() => {
    let value = 100;
    return () => (value += 25);
  })(),
};

test("canary authorization requires an exact strong bearer token", async () => {
  const token = "0123456789abcdef0123456789abcdef0123456789abcdef";
  assert.equal(await verifyCanaryAuthorization(`Bearer ${token}`, token), true);
  assert.equal(await verifyCanaryAuthorization(`Bearer ${token}x`, token), false);
  assert.equal(await verifyCanaryAuthorization(token, token), false);
  assert.equal(await verifyCanaryAuthorization("Bearer too-short", "too-short"), false);
});

test("canaries require complete product-specific reuse guidance", () => {
  assert.doesNotThrow(() => assertServiceReuseGuidance(SERVICE_REUSE.run, "RunVerdict"));
  assert.throws(() => assertServiceReuseGuidance({
    reusable: true,
    fresh_result_per_successful_call: true,
    reliability: "bounded_live_check",
    guidance: "",
  }, "RunVerdict"), CanaryContractError);
  assert.throws(() => assertServiceReuseGuidance({
    ...SERVICE_REUSE.run,
    reliability: "uptime_guarantee",
  }, "RunVerdict"), CanaryContractError);
});

test("internal canary route stays closed without its exact token", async () => {
  const token = "0123456789abcdef0123456789abcdef0123456789abcdef";
  const missing = await app.request("/_internal/canary/single", {}, {});
  assert.equal(missing.status, 404);
  const invalid = await app.request("/_internal/canary/single", {
    headers: { Authorization: "Bearer xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
  }, { CANARY_TOKEN: token });
  assert.equal(invalid.status, 404);
  assert.equal(invalid.headers.get("cache-control"), "no-store");
  const unknown = await app.request("/_internal/canary/unknown", {
    headers: { Authorization: `Bearer ${token}` },
  }, { CANARY_TOKEN: token });
  assert.equal(unknown.status, 404);

  const limited = await app.request("/_internal/canary/single", {
    headers: { Authorization: `Bearer ${token}` },
  }, {
    CANARY_TOKEN: token,
    CANARY_RATE_LIMITER: { limit: async () => ({ success: false }) },
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
});

test("single canary validates and compacts the real handler contract", async () => {
  const result = await runFunctionalCanary("single", {}, {
    ...base,
    checkIssue: async (url) => ({
      product: "BountyVerdict", version: "1.0", verdict: "CAUTION", score: 45,
      summary: "fixture", issue: { url, title: "Fixture", state: "open", repository: "typeorm/typeorm" },
      service_reuse: SERVICE_REUSE.single,
      signals: [], contribution_policy: { ai_use: "NO_EXPLICIT_RULE_FOUND", documents: [] },
      coverage: { comments_scanned: 3, timeline_events_scanned: 4, linked_pull_requests_found: 1, policy_documents_scanned: 2, github_rate_limit_remaining: 4990 },
      checked_at: now.toISOString(), limitations: [],
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.source, CANARY_FIXTURES.single);
  assert.equal(result.result.verdict, "CAUTION");
  assert.equal(result.result.timeline_events_scanned, 4);
  assert.equal("signals" in result.result, false);
});

test("portfolio canary fails unless both inputs produce real verdicts", async () => {
  await assert.rejects(() => runFunctionalCanary("portfolio", {}, {
    ...base,
    checkPortfolio: async () => ({
      product: "BountyVerdict Portfolio", version: "1.0", recommendation: "fixture", best_candidate: null,
      service_reuse: SERVICE_REUSE.portfolio,
      counts: { submitted: 2, checked: 1, viable: 0, caution: 1, avoid: 0, failed: 1 },
      ranked: [], failures: [], checked_at: now.toISOString(),
    }),
  }), CanaryContractError);
});

test("harness, skill, and run canaries enforce commit, file, and log coverage", async () => {
  const harness = await runFunctionalCanary("harness", {}, {
    ...base,
    checkHarness: async () => ({
      product: "HarnessVerdict", version: "1.0", verdict: "REVIEW", score: 75, summary: "fixture",
      service_reuse: SERVICE_REUSE.harness,
      repository: { url: CANARY_FIXTURES.harness, full_name: "openai/codex", default_branch: "main", commit_sha: "a".repeat(40) },
      surfaces: { instruction_files_found: 1, instruction_files_scanned: 1, skill_files_scanned: 0, files: ["AGENTS.md"] },
      portability: { codex: true, claude_code: false, gemini_cli: false, github_copilot: false, cursor: false },
      findings: [], recommendations: [],
      coverage: { tree_entries: 20, candidate_files: 1, files_scanned: 1, bytes_scanned: 100, tree_truncated: false, file_selection_truncated: false, github_rate_limit_remaining: 4980 },
      checked_at: now.toISOString(), limitations: [],
    }),
  });
  assert.equal(harness.result.commit_sha, "a".repeat(40));

  const skill = await runFunctionalCanary("skill", {}, {
    ...base,
    checkSkill: async () => ({
      product: "SkillVerdict", version: "1.0", verdict: "LOW_RISK", risk_score: 4, summary: "fixture",
      service_reuse: SERVICE_REUSE.skill,
      repository: { url: CANARY_FIXTURES.skill.repository, full_name: "Mimirs402/bountyverdict", archived: false, default_branch: "main", commit_sha: "b".repeat(40) },
      skill: { path: `${CANARY_FIXTURES.skill.path}/SKILL.md`, name: "diagnose-github-actions", description: "fixture", files: [`${CANARY_FIXTURES.skill.path}/SKILL.md`] },
      capabilities: { declared: [], observed: [], external_domains: [] }, findings: [], recommendations: [],
      coverage: { entries_in_skill: 1, files_scanned: 1, bytes_scanned: 250, skipped_binary: 0, skipped_oversized: 0, selection_truncated: false, github_rate_limit_remaining: 4970 },
      checked_at: now.toISOString(), limitations: [],
    }),
  });
  assert.equal(skill.result.files_scanned, 1);

  await assert.rejects(() => runFunctionalCanary("run", {}, {
    ...base,
    diagnoseRun: async () => ({
      product: "RunVerdict", version: "1.0", verdict: "FIX", summary: "fixture", retryability: "UNLIKELY",
      service_reuse: SERVICE_REUSE.run,
      run: { url: CANARY_FIXTURES.run, repository: "openai/codex", id: "29728148711", attempt: 1, workflow: "CI", event: "push", status: "completed", conclusion: "failure", head_sha: "c".repeat(40), created_at: now.toISOString(), updated_at: now.toISOString() },
      diagnosis: { primary_family: "TEST_FAILURE", confidence: "high", root_causes: [] }, failed_jobs: [], next_actions: [],
      coverage: { jobs_reported: 3, jobs_total: 3, failed_jobs: 1, failed_jobs_selected_for_logs: 1, logs_scanned: 0, logs_unavailable: 1, log_bytes_read: 0, logs_truncated: 0, jobs_truncated: false, github_rate_limit_remaining: 4960 },
      checked_at: now.toISOString(), limitations: [],
    }),
  }), /failed-job evidence/);
});

function flakeFixtureResult(overrides: Partial<FlakeResult> = {}): FlakeResult {
  return {
    product: "FlakeVerdict",
    version: "1.0",
    verdict: "CONFIRMED_FLAKE",
    summary: "The selected failed attempt recovered on attempt 2.",
    service_reuse: FLAKE_SERVICE_REUSE,
    decision: {
      confidence: "high",
      retry: "NO",
      reason_codes: ["SAME_RUN_JOB_SUCCEEDED"],
    },
    target: {
      url: CANARY_FIXTURES.flake.run,
      repository: "actions/runner",
      id: "29423388605",
      attempt: 1,
      current_attempt: 2,
      workflow_id: 3200,
      workflow: "Runner CI",
      workflow_path: ".github/workflows/build.yml",
      event: "pull_request",
      head_branch: "test-label-managers",
      head_sha: "6b74a3cb775dcae48bd7a906ca18f766d6b36423",
      status: "completed",
      conclusion: "failure",
      created_at: "2026-07-15T14:24:12Z",
      updated_at: "2026-07-15T14:35:13Z",
    },
    failure_signatures: [{
      fingerprint: "d".repeat(64),
      job_name: "Test",
      conclusion: "failure",
      failed_steps: ["Run tests"],
      evidence_url: `${CANARY_FIXTURES.flake.run}/job/1`,
      log_status: "scanned",
    }],
    same_run_attempts: [{
      attempt: 2,
      conclusion: "success",
      matching_jobs_succeeded: ["Test"],
      matching_jobs_failed: [],
    }],
    same_sha_runs: [],
    historical_matches: [],
    coverage: {
      target_jobs_reported: 12,
      target_jobs_total: 12,
      target_jobs_truncated: false,
      target_failed_jobs: 1,
      target_logs_selected: 1,
      target_logs_scanned: 1,
      target_logs_unavailable: 0,
      target_log_bytes_read: 1200,
      target_logs_truncated: 0,
      same_run_attempts_available: 1,
      same_run_attempts_checked: 1,
      same_run_attempts_truncated: false,
      same_sha_runs_listed: 0,
      same_sha_runs_checked: 0,
      same_sha_runs_truncated: false,
      earlier_comparable_runs_available: 7,
      earlier_comparable_runs_checked: 7,
      earlier_comparable_runs_truncated: false,
      historical_job_pages: 7,
      github_rate_limit_remaining: 4900,
      partial_failures: [],
      deadline_ms: 25_000,
    },
    checked_at: now.toISOString(),
    limitations: [],
    ...overrides,
  };
}

test("flake canary pins attempt 1 while proving multi-attempt coverage and refusing an obsolete retry", async () => {
  let observedUrl = "";
  let observedAttempt = 0;
  const result = await runFunctionalCanary("flake", {}, {
    ...base,
    diagnoseFlake: async (url, attempt) => {
      observedUrl = url;
      observedAttempt = attempt;
      return flakeFixtureResult();
    },
  });

  assert.equal(observedUrl, CANARY_FIXTURES.flake.run);
  assert.equal(observedAttempt, 1);
  assert.equal(result.source, CANARY_FIXTURES.flake.run);
  assert.equal(result.result.verdict, "CONFIRMED_FLAKE");
  assert.equal(result.result.retry, "NO");
  assert.equal(result.result.target_attempt, 1);
  assert.equal(result.result.current_attempt, 2);
  assert.equal(result.result.same_run_attempts_checked, 1);
  assert.equal(result.result.reuse_guidance, FLAKE_SERVICE_REUSE.guidance);
});

test("flake canary rejects incomplete attempt coverage, altered reuse guidance, and unsafe retries", async () => {
  await assert.rejects(() => runFunctionalCanary("flake", {}, {
    ...base,
    diagnoseFlake: async () => flakeFixtureResult({
      same_run_attempts: [],
      coverage: {
        ...flakeFixtureResult().coverage,
        same_run_attempts_checked: 0,
      },
    }),
  }), /at least two attempts/);

  await assert.rejects(() => runFunctionalCanary("flake", {}, {
    ...base,
    diagnoseFlake: async () => flakeFixtureResult({
      service_reuse: {
        ...FLAKE_SERVICE_REUSE,
        guidance: `${FLAKE_SERVICE_REUSE.guidance} Changed.`,
      },
    }),
  }), /reuse guidance changed/);

  await assert.rejects(() => runFunctionalCanary("flake", {}, {
    ...base,
    diagnoseFlake: async () => flakeFixtureResult({
      verdict: "LIKELY_FLAKE",
      decision: {
        confidence: "medium",
        retry: "ONCE",
        reason_codes: ["SAME_SHA_JOB_SUCCEEDED"],
      },
    }),
  }), /no-retry safety invariant/);
});

test("MCP drift canary proves exact hashes, full coverage, and immutable reuse guidance", async () => {
  const result = await runFunctionalCanary("mcpdrift", {}, base);
  assert.equal(result.source, CANARY_FIXTURES.mcpdrift.subject.server_id);
  assert.equal(result.result.verdict, "SAFE_ADDITIVE");
  assert.equal(result.result.proven_subset, 1);
  assert.equal(result.result.truncated, false);
  assert.equal(result.result.reuse_guidance, MCP_DRIFT_SERVICE_REUSE);
  assert.notEqual(result.result.baseline_snapshot, result.result.current_snapshot);

  await assert.rejects(() => runFunctionalCanary("mcpdrift", {}, {
    ...base,
    analyzeMcpDrift: async input => ({
      ...await analyzeMcpDrift(input),
      service_reuse: `${MCP_DRIFT_SERVICE_REUSE} changed` as typeof MCP_DRIFT_SERVICE_REUSE,
    }),
  }), /reuse guidance changed/);
});
