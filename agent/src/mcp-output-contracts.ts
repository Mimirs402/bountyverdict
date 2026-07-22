import { z } from "zod";

const serviceReuseSchema = z.object({
  reusable: z.literal(true),
  fresh_result_per_successful_call: z.literal(true),
  reliability: z.literal("bounded_live_check"),
  guidance: z.string().min(1),
}).strict();

const checkedAtSchema = z.string();
const nullableStringSchema = z.string().nullable();
const evidenceObjectsSchema = z.array(z.object({}).passthrough());

const rankedBountySchema = z.object({
  verdict: z.enum(["AVOID", "CAUTION", "VIABLE"]),
  score: z.number().int().min(0).max(100),
  summary: z.string(),
  issue: z.object({
    url: z.string(),
    title: z.string(),
    state: z.string(),
    repository: z.string(),
  }).passthrough(),
}).passthrough();

const bountyVerdictOutputSchema = rankedBountySchema.extend({
  product: z.literal("BountyVerdict"),
  version: z.literal("1.0"),
  service_reuse: serviceReuseSchema,
  signals: evidenceObjectsSchema,
  linked_source: z.object({
    state: z.enum(["NOT_APPLICABLE", "CHECKED", "UNAVAILABLE", "DEPTH_LIMITED"]),
    url: nullableStringSchema,
    verdict: z.enum(["AVOID", "CAUTION", "VIABLE"]).nullable(),
    reward_state: z.enum(["LISTED", "PROMISED", "UNVERIFIED", "NOT_FOUND", "WITHDRAWN", "PAID_OR_AWARDED"]).nullable(),
    reward_verification: z.enum(["TRUSTED_PLATFORM_APP", "TRUSTED_PLATFORM_API", "MAINTAINER_STATEMENT", "UNVERIFIED", "NONE"]).nullable(),
    error_code: nullableStringSchema,
  }).strict(),
  checked_at: checkedAtSchema,
}).passthrough();

const bountyPortfolioOutputSchema = z.object({
  product: z.literal("BountyVerdict Portfolio"),
  version: z.literal("1.0"),
  recommendation: z.string(),
  service_reuse: serviceReuseSchema,
  best_candidate: nullableStringSchema,
  counts: z.object({
    submitted: z.number().int().min(2).max(10),
    checked: z.number().int().min(1).max(10),
    failed: z.number().int().nonnegative(),
  }).passthrough(),
  ranked: z.array(rankedBountySchema).min(1),
  failures: evidenceObjectsSchema,
  checked_at: checkedAtSchema,
}).passthrough();

const harnessVerdictOutputSchema = z.object({
  product: z.literal("HarnessVerdict"),
  version: z.literal("1.0"),
  verdict: z.enum(["READY", "REVIEW", "REPAIR"]),
  score: z.number().int().min(0).max(100),
  summary: z.string(),
  service_reuse: serviceReuseSchema,
  repository: z.object({
    url: z.string(),
    full_name: z.string(),
    default_branch: z.string(),
    commit_sha: z.string(),
  }).passthrough(),
  findings: evidenceObjectsSchema,
  recommendations: z.array(z.string()),
  checked_at: checkedAtSchema,
}).passthrough();

const runVerdictOutputSchema = z.object({
  product: z.literal("RunVerdict"),
  version: z.literal("1.0"),
  verdict: z.enum(["PASS", "WAIT", "RETRY", "FIX", "INVESTIGATE"]),
  summary: z.string(),
  service_reuse: serviceReuseSchema,
  retryability: z.enum(["LIKELY", "POSSIBLE", "UNLIKELY", "UNKNOWN"]),
  run: z.object({
    url: z.string(),
    repository: z.string(),
    id: z.string(),
    attempt: z.number().int().positive(),
    status: z.string(),
    conclusion: nullableStringSchema,
  }).passthrough(),
  diagnosis: z.object({
    primary_family: nullableStringSchema,
    confidence: z.enum(["high", "medium", "low"]).nullable(),
    root_causes: evidenceObjectsSchema,
  }).passthrough(),
  next_actions: z.array(z.string()),
  checked_at: checkedAtSchema,
}).passthrough();

const flakeVerdictOutputSchema = z.object({
  product: z.literal("FlakeVerdict"),
  version: z.literal("1.0"),
  verdict: z.enum([
    "CONFIRMED_FLAKE",
    "LIKELY_FLAKE",
    "RECURRING_FAILURE",
    "NEW_FAILURE",
    "INCONCLUSIVE",
    "NOT_FAILED",
  ]),
  summary: z.string(),
  service_reuse: serviceReuseSchema,
  decision: z.object({
    confidence: z.enum(["high", "medium", "low"]),
    retry: z.enum(["ONCE", "NO", "NOT_NEEDED"]),
    reason_codes: z.array(z.string()),
  }).passthrough(),
  target: z.object({
    url: z.string(),
    repository: z.string(),
    id: z.string(),
    attempt: z.number().int().positive(),
    current_attempt: z.number().int().positive(),
    conclusion: nullableStringSchema,
  }).passthrough(),
  failure_signatures: evidenceObjectsSchema,
  checked_at: checkedAtSchema,
}).passthrough();

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const mcpDriftVerdictOutputSchema = z.object({
  service: z.literal("MCPDriftVerdict"),
  contract_version: z.literal("mcp-drift/1"),
  ruleset_version: z.string(),
  verdict: z.enum(["UNCHANGED", "SAFE_ADDITIVE", "REVIEW", "INCONCLUSIVE", "BREAKING", "SECURITY_REGRESSION"]),
  action: z.enum(["ACCEPT_CURRENT", "REVIEW_CURRENT", "HOLD_BASELINE", "BLOCK_CURRENT"]),
  trust: z.object({
    annotation_source: z.enum(["caller_asserted_trusted", "untrusted"]),
    server_identity: z.literal("not_verified"),
    runtime_behavior: z.literal("not_verified"),
    completeness: z.literal("caller_asserted"),
  }).passthrough(),
  hashes: z.object({
    baseline_snapshot: hashSchema,
    current_snapshot: hashSchema,
    baseline_contract: hashSchema,
    current_contract: hashSchema,
  }).passthrough(),
  summary: z.object({
    baseline_tools: z.number().int().nonnegative(),
    current_tools: z.number().int().nonnegative(),
    breaking_findings: z.number().int().nonnegative(),
    security_findings: z.number().int().nonnegative(),
  }).passthrough(),
  findings: evidenceObjectsSchema.max(256),
  service_reuse: z.string().min(1),
}).passthrough();

export const MCP_SUCCESS_OUTPUT_SCHEMAS = Object.freeze({
  check_github_bounty: bountyVerdictOutputSchema,
  rank_github_bounties: bountyPortfolioOutputSchema,
  audit_agent_harness: harnessVerdictOutputSchema,
  diagnose_github_actions_run: runVerdictOutputSchema,
  classify_github_actions_flake: flakeVerdictOutputSchema,
  check_mcp_tool_drift: mcpDriftVerdictOutputSchema,
});
