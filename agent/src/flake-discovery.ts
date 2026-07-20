import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { addHttpMethod } from "./bazaar.ts";
import { FLAKE_SERVICE_REUSE } from "./flake.ts";
import { serviceReuseSchema } from "./reuse.ts";

export { FLAKE_SERVICE_REUSE };

const nullableString = { type: ["string", "null"] };
const nonNegativeInteger = { type: "integer", minimum: 0 };
const positiveInteger = { type: "integer", minimum: 1 };
const attemptInteger = { type: "integer", minimum: 1 };
const stringArray = { type: "array", items: { type: "string" } };

const flakeServiceReuseSchema = {
  ...serviceReuseSchema,
  properties: {
    ...serviceReuseSchema.properties,
    guidance: { type: "string", const: FLAKE_SERVICE_REUSE.guidance },
  },
};

const targetSchema = {
  type: "object",
  properties: {
    url: { type: "string" },
    repository: { type: "string" },
    id: { type: "string" },
    attempt: attemptInteger,
    current_attempt: attemptInteger,
    workflow_id: positiveInteger,
    workflow: { type: "string" },
    workflow_path: { type: "string" },
    event: { type: "string" },
    head_branch: { type: "string" },
    head_sha: { type: "string" },
    status: { type: "string" },
    conclusion: nullableString,
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
  required: [
    "url", "repository", "id", "attempt", "current_attempt", "workflow_id", "workflow",
    "workflow_path", "event", "head_branch", "head_sha", "status", "conclusion", "created_at", "updated_at",
  ],
  additionalProperties: false,
};

const failureSignatureSchema = {
  type: "object",
  properties: {
    fingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
    job_name: { type: "string" },
    conclusion: nullableString,
    failed_steps: stringArray,
    evidence_url: { type: "string" },
    log_status: { type: "string", enum: ["scanned", "unavailable", "not_selected"] },
  },
  required: ["fingerprint", "job_name", "conclusion", "failed_steps", "evidence_url", "log_status"],
  additionalProperties: false,
};

const sameRunAttemptSchema = {
  type: "object",
  properties: {
    attempt: attemptInteger,
    conclusion: nullableString,
    matching_jobs_succeeded: stringArray,
    matching_jobs_failed: stringArray,
  },
  required: ["attempt", "conclusion", "matching_jobs_succeeded", "matching_jobs_failed"],
  additionalProperties: false,
};

const sameShaRunSchema = {
  type: "object",
  properties: {
    run_id: { type: "string" },
    attempt: attemptInteger,
    conclusion: nullableString,
    matching_jobs_succeeded: stringArray,
    matching_fingerprints: stringArray,
    html_url: { type: "string" },
  },
  required: ["run_id", "attempt", "conclusion", "matching_jobs_succeeded", "matching_fingerprints", "html_url"],
  additionalProperties: false,
};

const historicalMatchSchema = {
  type: "object",
  properties: {
    run_id: { type: "string" },
    attempt: attemptInteger,
    head_sha: { type: "string" },
    created_at: { type: "string" },
    matching_fingerprints: stringArray,
    recovered_by_later_success: { type: "boolean" },
    html_url: { type: "string" },
  },
  required: ["run_id", "attempt", "head_sha", "created_at", "matching_fingerprints", "recovered_by_later_success", "html_url"],
  additionalProperties: false,
};

const partialFailureSchema = {
  type: "object",
  properties: {
    scope: { type: "string", enum: ["target_log", "current_run", "same_run_attempt", "same_sha_run", "historical_run"] },
    identifier: { type: "string" },
    code: { type: "string", enum: ["UPSTREAM_ERROR", "NOT_FOUND", "LOG_UNAVAILABLE", "DEADLINE_EXCEEDED", "TRUNCATED"] },
  },
  required: ["scope", "identifier", "code"],
  additionalProperties: false,
};

export const flakeExample = {
  product: "FlakeVerdict",
  version: "1.0",
  verdict: "CONFIRMED_FLAKE",
  summary: "The same job succeeded on another attempt of this exact workflow run.",
  service_reuse: FLAKE_SERVICE_REUSE,
  decision: {
    confidence: "high",
    retry: "ONCE",
    reason_codes: ["SAME_RUN_JOB_SUCCEEDED"],
  },
  target: {
    url: "https://github.com/acme/widget/actions/runs/123456789",
    repository: "acme/widget",
    id: "123456789",
    attempt: 2,
    current_attempt: 2,
    workflow_id: 314159,
    workflow: "CI",
    workflow_path: ".github/workflows/ci.yml",
    event: "pull_request",
    head_branch: "fix/widget-timeout",
    head_sha: "0123456789abcdef0123456789abcdef01234567",
    status: "completed",
    conclusion: "failure",
    created_at: "2026-07-20T10:00:00Z",
    updated_at: "2026-07-20T10:05:00Z",
  },
  failure_signatures: [{
    fingerprint: "5f0d96b70ecd66cc8c537887b5cc0f6b99cfed4511429aab645de32bfde619d6",
    job_name: "tests / linux",
    conclusion: "failure",
    failed_steps: ["Run tests"],
    evidence_url: "https://github.com/acme/widget/actions/runs/123456789/job/987654321",
    log_status: "scanned",
  }],
  same_run_attempts: [{
    attempt: 1,
    conclusion: "success",
    matching_jobs_succeeded: ["tests / linux"],
    matching_jobs_failed: [],
  }],
  same_sha_runs: [{
    run_id: "123456700",
    attempt: 1,
    conclusion: "success",
    matching_jobs_succeeded: ["tests / linux"],
    matching_fingerprints: [],
    html_url: "https://github.com/acme/widget/actions/runs/123456700",
  }],
  historical_matches: [{
    run_id: "123450000",
    attempt: 1,
    head_sha: "abcdef0123456789abcdef0123456789abcdef01",
    created_at: "2026-07-18T10:00:00Z",
    matching_fingerprints: ["5f0d96b70ecd66cc8c537887b5cc0f6b99cfed4511429aab645de32bfde619d6"],
    recovered_by_later_success: false,
    html_url: "https://github.com/acme/widget/actions/runs/123450000",
  }],
  coverage: {
    target_jobs_reported: 8,
    target_jobs_total: 8,
    target_jobs_truncated: false,
    target_failed_jobs: 1,
    target_logs_selected: 1,
    target_logs_scanned: 1,
    target_logs_unavailable: 0,
    target_log_bytes_read: 18240,
    target_logs_truncated: 0,
    same_run_attempts_available: 1,
    same_run_attempts_checked: 1,
    same_run_attempts_truncated: false,
    same_sha_runs_listed: 1,
    same_sha_runs_checked: 1,
    same_sha_runs_truncated: false,
    earlier_comparable_runs_available: 12,
    earlier_comparable_runs_checked: 12,
    earlier_comparable_runs_truncated: false,
    historical_job_pages: 1,
    github_rate_limit_remaining: 4970,
    partial_failures: [],
    deadline_ms: 14000,
  },
  checked_at: "2026-07-20T12:00:00.000Z",
  limitations: [
    "FlakeVerdict compares bounded public GitHub Actions history and exact job-step fingerprints; it never reruns CI and cannot prove that an unseen failure is deterministic.",
    "Failure fingerprints contain job and failed-step names, not error text; structural recurrence does not prove an identical root cause.",
  ],
};

export const flakeOutputSchema = {
  type: "object",
  properties: {
    product: { type: "string", const: "FlakeVerdict" },
    version: { type: "string", const: "1.0" },
    verdict: {
      type: "string",
      enum: ["CONFIRMED_FLAKE", "LIKELY_FLAKE", "RECURRING_FAILURE", "NEW_FAILURE", "INCONCLUSIVE", "NOT_FAILED"],
    },
    summary: { type: "string" },
    service_reuse: flakeServiceReuseSchema,
    decision: {
      type: "object",
      properties: {
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        retry: { type: "string", enum: ["ONCE", "NO", "NOT_NEEDED"] },
        reason_codes: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "TARGET_SUCCEEDED", "TARGET_NOT_COMPLETE", "TARGET_JOBS_INCOMPLETE", "SAME_RUN_JOB_SUCCEEDED",
              "SAME_SHA_JOB_SUCCEEDED", "HISTORICAL_FAILURE_RECURRED", "TARGET_UNSUPPORTED_CONCLUSION",
              "FAILURE_SIGNATURE_UNSEEN", "INSUFFICIENT_COMPARABLE_RUNS", "PARTIAL_HISTORY", "MIXED_EVIDENCE",
              "CURRENT_RUN_CHANGED_DURING_CHECK", "CURRENT_RUN_NOT_REVALIDATED",
            ],
          },
        },
      },
      required: ["confidence", "retry", "reason_codes"],
      additionalProperties: false,
    },
    target: targetSchema,
    failure_signatures: { type: "array", items: failureSignatureSchema },
    same_run_attempts: { type: "array", items: sameRunAttemptSchema },
    same_sha_runs: { type: "array", items: sameShaRunSchema },
    historical_matches: { type: "array", items: historicalMatchSchema },
    coverage: {
      type: "object",
      properties: {
        target_jobs_reported: nonNegativeInteger,
        target_jobs_total: nonNegativeInteger,
        target_jobs_truncated: { type: "boolean" },
        target_failed_jobs: nonNegativeInteger,
        target_logs_selected: nonNegativeInteger,
        target_logs_scanned: nonNegativeInteger,
        target_logs_unavailable: nonNegativeInteger,
        target_log_bytes_read: nonNegativeInteger,
        target_logs_truncated: nonNegativeInteger,
        same_run_attempts_available: nonNegativeInteger,
        same_run_attempts_checked: nonNegativeInteger,
        same_run_attempts_truncated: { type: "boolean" },
        same_sha_runs_listed: nonNegativeInteger,
        same_sha_runs_checked: nonNegativeInteger,
        same_sha_runs_truncated: { type: "boolean" },
        earlier_comparable_runs_available: nonNegativeInteger,
        earlier_comparable_runs_checked: nonNegativeInteger,
        earlier_comparable_runs_truncated: { type: "boolean" },
        historical_job_pages: nonNegativeInteger,
        github_rate_limit_remaining: { type: ["integer", "null"], minimum: 0 },
        partial_failures: { type: "array", items: partialFailureSchema },
        deadline_ms: positiveInteger,
      },
      required: [
        "target_jobs_reported", "target_jobs_total", "target_jobs_truncated", "target_failed_jobs",
        "target_logs_selected", "target_logs_scanned", "target_logs_unavailable", "target_log_bytes_read",
        "target_logs_truncated", "same_run_attempts_available", "same_run_attempts_checked",
        "same_run_attempts_truncated", "same_sha_runs_listed", "same_sha_runs_checked", "same_sha_runs_truncated",
        "earlier_comparable_runs_available", "earlier_comparable_runs_checked", "earlier_comparable_runs_truncated",
        "historical_job_pages", "github_rate_limit_remaining", "partial_failures", "deadline_ms",
      ],
      additionalProperties: false,
    },
    checked_at: { type: "string" },
    limitations: stringArray,
  },
  required: [
    "product", "version", "verdict", "summary", "service_reuse", "decision", "target",
    "failure_signatures", "same_run_attempts", "same_sha_runs", "historical_matches", "coverage", "checked_at", "limitations",
  ],
  additionalProperties: false,
};

// PAYMENT-REQUIRED is an HTTP header, so Bazaar metadata must stay well below
// common 16 KiB aggregate-header limits. This schema truthfully describes the
// decision-critical subset while allowing the documented full result fields.
const flakeDiscoveryExample = {
  product: flakeExample.product,
  version: flakeExample.version,
  verdict: flakeExample.verdict,
  summary: flakeExample.summary,
  service_reuse: flakeExample.service_reuse,
  decision: flakeExample.decision,
  target: {
    url: flakeExample.target.url,
    id: flakeExample.target.id,
    attempt: flakeExample.target.attempt,
    current_attempt: flakeExample.target.current_attempt,
    status: flakeExample.target.status,
    conclusion: flakeExample.target.conclusion,
  },
  checked_at: flakeExample.checked_at,
};

const flakeDiscoveryOutputSchema = {
  type: "object",
  properties: {
    product: { type: "string", const: "FlakeVerdict" },
    version: { type: "string", const: "1.0" },
    verdict: flakeOutputSchema.properties.verdict,
    summary: { type: "string" },
    service_reuse: flakeServiceReuseSchema,
    decision: flakeOutputSchema.properties.decision,
    target: {
      type: "object",
      properties: {
        url: { type: "string" },
        id: { type: "string" },
        attempt: attemptInteger,
        current_attempt: attemptInteger,
        status: { type: "string" },
        conclusion: nullableString,
      },
      required: ["url", "id", "attempt", "current_attempt", "status", "conclusion"],
      additionalProperties: true,
    },
    checked_at: { type: "string" },
  },
  required: ["product", "version", "verdict", "summary", "service_reuse", "decision", "target", "checked_at"],
  additionalProperties: true,
};

export const flakeDiscoveryExtension = addHttpMethod(declareDiscoveryExtension({
  input: {
    run_url: "https://github.com/acme/widget/actions/runs/123456789",
    attempt: 2,
  },
  inputSchema: {
    type: "object",
    properties: {
      run_url: {
        type: "string",
        pattern: "^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/actions/runs/[1-9][0-9]*$",
        description: "Canonical URL of a public GitHub Actions workflow run.",
      },
      attempt: {
        type: "integer",
        minimum: 1,
        description: "Optional positive run-attempt number. Omit it to inspect the current attempt.",
      },
    },
    required: ["run_url"],
    additionalProperties: false,
  },
  output: { example: flakeDiscoveryExample, schema: flakeDiscoveryOutputSchema },
}), "GET");
