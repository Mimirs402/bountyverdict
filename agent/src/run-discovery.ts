import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { addHttpMethod } from "./bazaar.ts";
import { SERVICE_REUSE, serviceReuseSchema } from "./reuse.ts";

export const runExample = {
  product: "RunVerdict",
  version: "1.0",
  verdict: "RETRY",
  summary: "2 failed jobs; primary evidence indicates timeout.",
  service_reuse: SERVICE_REUSE.run,
  retryability: "LIKELY",
  run: {
    url: "https://github.com/acme/widget/actions/runs/123456789",
    repository: "acme/widget",
    id: "123456789",
    attempt: 1,
    workflow: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "failure",
    head_sha: "0123456789abcdef0123456789abcdef01234567",
    created_at: "2026-07-20T10:00:00Z",
    updated_at: "2026-07-20T10:05:00Z",
  },
  diagnosis: {
    primary_family: "TIMEOUT",
    confidence: "high",
    root_causes: [{
      family: "TIMEOUT",
      confidence: "high",
      summary: "A command, test, or service exceeded its time budget.",
      jobs: ["tests / linux"],
      evidence: ["Error: timed out waiting for the test service"],
    }],
  },
  failed_jobs: [{
    id: 987654321,
    name: "tests / linux",
    conclusion: "failure",
    failed_steps: ["Run tests"],
    root_cause_candidate: true,
    families: ["TIMEOUT"],
    evidence: ["Error: timed out waiting for the test service"],
    evidence_url: "https://github.com/acme/widget/actions/runs/123456789/job/987654321",
    log_status: "scanned",
  }],
  next_actions: [
    "Inspect the cited timeout evidence in the primary failed jobs before changing code.",
    "Retry the failed jobs once; if the same evidence repeats, treat it as deterministic rather than transient.",
  ],
  coverage: {
    jobs_reported: 8,
    jobs_total: 8,
    failed_jobs: 2,
    failed_jobs_selected_for_logs: 1,
    logs_scanned: 1,
    logs_unavailable: 0,
    log_bytes_read: 18240,
    logs_truncated: 0,
    jobs_truncated: false,
    github_rate_limit_remaining: 4990,
  },
  checked_at: "2026-07-20T12:00:00.000Z",
  limitations: [
    "RunVerdict reads only public GitHub Actions metadata and bounded failed-job logs; it never reruns jobs or executes repository code.",
  ],
};

const nullableString = { type: ["string", "null"] };
const rootCauseSchema = {
  type: "object",
  properties: {
    family: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    summary: { type: "string" },
    jobs: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
  },
  required: ["family", "confidence", "summary", "jobs", "evidence"],
};

export const runOutputSchema = {
  properties: {
    product: { type: "string", const: "RunVerdict" },
    version: { type: "string" },
    verdict: { type: "string", enum: ["PASS", "WAIT", "RETRY", "FIX", "INVESTIGATE"] },
    summary: { type: "string" },
    service_reuse: serviceReuseSchema,
    retryability: { type: "string", enum: ["LIKELY", "POSSIBLE", "UNLIKELY", "UNKNOWN"] },
    run: {
      type: "object",
      properties: {
        url: { type: "string" }, repository: { type: "string" }, id: { type: "string" },
        attempt: { type: "integer", minimum: 1 }, workflow: { type: "string" }, event: { type: "string" },
        status: { type: "string" }, conclusion: nullableString, head_sha: { type: "string" },
        created_at: { type: "string" }, updated_at: { type: "string" },
      },
      required: ["url", "repository", "id", "attempt", "workflow", "event", "status", "conclusion", "head_sha", "created_at", "updated_at"],
    },
    diagnosis: {
      type: "object",
      properties: {
        primary_family: nullableString,
        confidence: { type: ["string", "null"], enum: ["high", "medium", "low", null] },
        root_causes: { type: "array", items: rootCauseSchema },
      },
      required: ["primary_family", "confidence", "root_causes"],
    },
    failed_jobs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" }, name: { type: "string" }, conclusion: nullableString,
          failed_steps: { type: "array", items: { type: "string" } },
          root_cause_candidate: { type: "boolean" }, families: { type: "array", items: { type: "string" } },
          evidence: { type: "array", items: { type: "string" } }, evidence_url: { type: "string" },
          log_status: { type: "string", enum: ["scanned", "unavailable", "not_selected"] },
        },
        required: ["id", "name", "conclusion", "failed_steps", "root_cause_candidate", "families", "evidence", "evidence_url", "log_status"],
      },
    },
    next_actions: { type: "array", items: { type: "string" } },
    coverage: {
      type: "object",
      properties: {
        jobs_reported: { type: "integer", minimum: 0 }, jobs_total: { type: "integer", minimum: 0 },
        failed_jobs: { type: "integer", minimum: 0 }, failed_jobs_selected_for_logs: { type: "integer", minimum: 0 },
        logs_scanned: { type: "integer", minimum: 0 }, logs_unavailable: { type: "integer", minimum: 0 },
        log_bytes_read: { type: "integer", minimum: 0 }, logs_truncated: { type: "integer", minimum: 0 },
        jobs_truncated: { type: "boolean" }, github_rate_limit_remaining: { type: ["integer", "null"] },
      },
      required: ["jobs_reported", "jobs_total", "failed_jobs", "failed_jobs_selected_for_logs", "logs_scanned", "logs_unavailable", "log_bytes_read", "logs_truncated", "jobs_truncated", "github_rate_limit_remaining"],
    },
    checked_at: { type: "string" },
    limitations: { type: "array", items: { type: "string" } },
  },
  required: ["product", "version", "verdict", "summary", "service_reuse", "retryability", "run", "diagnosis", "failed_jobs", "next_actions", "coverage", "checked_at", "limitations"],
};

export const runDiscoveryExtension = addHttpMethod(declareDiscoveryExtension({
  input: { run_url: "https://github.com/openai/codex/actions/runs/29728148711" },
  inputSchema: {
    properties: {
      run_url: {
        type: "string",
        pattern: "^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/actions/runs/[1-9][0-9]*$",
        description: "Canonical URL of a public GitHub Actions workflow run.",
      },
    },
    required: ["run_url"],
    additionalProperties: false,
  },
  output: { example: runExample, schema: runOutputSchema },
}), "GET");
