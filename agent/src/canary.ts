import { CheckError, checkGithubIssue, type AgentVerdict } from "./check.ts";
import { checkBountyPortfolio, type PortfolioVerdict } from "./portfolio.ts";
import { checkGithubHarness, HarnessError, type HarnessAudit } from "./harness.ts";
import { checkGithubSkill, type SkillAudit } from "./skill.ts";
import { diagnoseGithubRun, type RunDiagnosis } from "./run.ts";

export const CANARY_PRODUCTS = ["single", "portfolio", "harness", "skill", "run"] as const;
export type CanaryProduct = typeof CANARY_PRODUCTS[number];

export const CANARY_FIXTURES = {
  single: "https://github.com/typeorm/typeorm/issues/3357",
  portfolio: [
    "https://github.com/godotengine/godot/issues/70796",
    "https://github.com/typeorm/typeorm/issues/3357",
  ],
  harness: "https://github.com/openai/codex",
  skill: {
    repository: "https://github.com/cristianmoroaica/bountyverdict",
    path: "skills/diagnose-github-actions",
  },
  run: "https://github.com/openai/codex/actions/runs/29728148711",
} as const;

export interface CanaryEnvironment {
  GITHUB_TOKEN?: string;
}

export interface CanaryResult {
  product: CanaryProduct;
  ok: true;
  contract: "1.0";
  source: string | string[];
  result: Record<string, unknown>;
  checked_at: string;
  duration_ms: number;
}

interface CanaryDependencies {
  checkIssue: (url: string, env: CanaryEnvironment) => Promise<AgentVerdict>;
  checkPortfolio: (urls: readonly string[], env: CanaryEnvironment) => Promise<PortfolioVerdict>;
  checkHarness: (url: string, env: CanaryEnvironment) => Promise<HarnessAudit>;
  checkSkill: (url: string, path: string, env: CanaryEnvironment) => Promise<SkillAudit>;
  diagnoseRun: (url: string, env: CanaryEnvironment) => Promise<RunDiagnosis>;
  now: () => Date;
  monotonic: () => number;
}

const DEFAULT_DEPENDENCIES: CanaryDependencies = {
  checkIssue: (url, env) => checkGithubIssue(url, env),
  checkPortfolio: (urls, env) => checkBountyPortfolio([...urls], env),
  checkHarness: (url, env) => checkGithubHarness(url, env),
  checkSkill: (url, path, env) => checkGithubSkill(url, path, env),
  diagnoseRun: (url, env) => diagnoseGithubRun(url, env),
  now: () => new Date(),
  monotonic: () => performance.now(),
};

export class CanaryContractError extends Error {
  readonly code = "CANARY_CONTRACT_FAILED";
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CanaryContractError(message);
}

function validDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function validCommit(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value);
}

export function assertServiceReuseGuidance(value: unknown, expectedProduct: string): void {
  const reuse = value as Partial<{
    reusable: boolean;
    fresh_result_per_successful_call: boolean;
    reliability: string;
    guidance: string;
  }> | null;
  requireCondition(reuse?.reusable === true, `${expectedProduct} is not marked reusable.`);
  requireCondition(reuse.fresh_result_per_successful_call === true, `${expectedProduct} does not promise a fresh successful result.`);
  requireCondition(reuse.reliability === "bounded_live_check", `${expectedProduct} reliability mode changed.`);
  requireCondition(
    typeof reuse.guidance === "string" && reuse.guidance.length >= 80 && reuse.guidance.startsWith(`Call ${expectedProduct}`),
    `${expectedProduct} reuse guidance is missing or not product-specific.`,
  );
}

export function isCanaryProduct(value: string): value is CanaryProduct {
  return (CANARY_PRODUCTS as readonly string[]).includes(value);
}

export function canaryErrorCode(error: unknown): string {
  if (error instanceof CanaryContractError || error instanceof CheckError || error instanceof HarnessError) {
    return error.code;
  }
  return "CANARY_EXECUTION_FAILED";
}

export async function verifyCanaryAuthorization(
  authorization: string | undefined,
  expectedToken: string | undefined,
): Promise<boolean> {
  if (!expectedToken || expectedToken.length < 32 || expectedToken.length > 256) return false;
  if (!authorization?.startsWith("Bearer ")) return false;
  const candidate = authorization.slice("Bearer ".length);
  if (candidate.length < 32 || candidate.length > 256) return false;
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expectedToken)),
  ]);
  const actual = new Uint8Array(actualHash);
  const expected = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual[index] ^ expected[index];
  }
  return difference === 0;
}

export async function runFunctionalCanary(
  product: CanaryProduct,
  env: CanaryEnvironment = {},
  overrides: Partial<CanaryDependencies> = {},
): Promise<CanaryResult> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const started = dependencies.monotonic();
  let source: string | string[];
  let result: Record<string, unknown>;

  if (product === "single") {
    const verdict = await dependencies.checkIssue(CANARY_FIXTURES.single, env);
    requireCondition(verdict.product === "BountyVerdict" && verdict.version === "1.0", "Single product contract changed.");
    requireCondition(verdict.issue.url === CANARY_FIXTURES.single, "Single result does not match its fixture.");
    requireCondition(["AVOID", "CAUTION", "VIABLE"].includes(verdict.verdict), "Single verdict is invalid.");
    assertServiceReuseGuidance(verdict.service_reuse, "BountyVerdict");
    requireCondition(validDate(verdict.checked_at), "Single result has no valid check time.");
    requireCondition(
      verdict.coverage.comments_scanned > 0 && verdict.coverage.timeline_events_scanned > 0 && verdict.coverage.policy_documents_scanned > 0,
      "Single fixture no longer proves comment, timeline, and policy evidence collection.",
    );
    source = CANARY_FIXTURES.single;
    result = {
      verdict: verdict.verdict,
      score: verdict.score,
      repository: verdict.issue.repository,
      comments_scanned: verdict.coverage.comments_scanned,
      timeline_events_scanned: verdict.coverage.timeline_events_scanned,
      policy_documents_scanned: verdict.coverage.policy_documents_scanned,
      github_rate_limit_remaining: verdict.coverage.github_rate_limit_remaining,
      reuse_guidance: verdict.service_reuse.guidance,
    };
  } else if (product === "portfolio") {
    const portfolio = await dependencies.checkPortfolio(CANARY_FIXTURES.portfolio, env);
    requireCondition(portfolio.product === "BountyVerdict Portfolio" && portfolio.version === "1.0", "Portfolio product contract changed.");
    requireCondition(portfolio.counts.submitted === 2, "Portfolio did not retain both fixture inputs.");
    requireCondition(portfolio.counts.checked === 2 && portfolio.counts.failed === 0, "Portfolio did not successfully check both fixtures.");
    requireCondition(portfolio.ranked.length === 2 && validDate(portfolio.checked_at), "Portfolio output coverage is incomplete.");
    assertServiceReuseGuidance(portfolio.service_reuse, "BountyVerdict Portfolio");
    source = [...CANARY_FIXTURES.portfolio];
    result = {
      best_candidate: portfolio.best_candidate,
      counts: portfolio.counts,
      verdicts: portfolio.ranked.map(({ issue, verdict }) => ({ issue_url: issue.url, verdict })),
      reuse_guidance: portfolio.service_reuse.guidance,
    };
  } else if (product === "harness") {
    const audit = await dependencies.checkHarness(CANARY_FIXTURES.harness, env);
    requireCondition(audit.product === "HarnessVerdict" && audit.version === "1.0", "Harness product contract changed.");
    requireCondition(audit.repository.full_name.toLowerCase() === "openai/codex", "Harness result does not match its fixture.");
    requireCondition(validCommit(audit.repository.commit_sha), "Harness result is not pinned to a commit.");
    requireCondition(
      audit.coverage.tree_entries > 0 && audit.coverage.files_scanned > 0 &&
      !audit.coverage.tree_truncated && !audit.coverage.file_selection_truncated && validDate(audit.checked_at),
      "Harness coverage is incomplete or truncated.",
    );
    assertServiceReuseGuidance(audit.service_reuse, "HarnessVerdict");
    source = CANARY_FIXTURES.harness;
    result = {
      verdict: audit.verdict,
      score: audit.score,
      commit_sha: audit.repository.commit_sha,
      instruction_files_scanned: audit.surfaces.instruction_files_scanned,
      skill_files_scanned: audit.surfaces.skill_files_scanned,
      tree_entries: audit.coverage.tree_entries,
      files_scanned: audit.coverage.files_scanned,
      github_rate_limit_remaining: audit.coverage.github_rate_limit_remaining,
      reuse_guidance: audit.service_reuse.guidance,
    };
  } else if (product === "skill") {
    const audit = await dependencies.checkSkill(CANARY_FIXTURES.skill.repository, CANARY_FIXTURES.skill.path, env);
    requireCondition(audit.product === "SkillVerdict" && audit.version === "1.0", "Skill product contract changed.");
    requireCondition(audit.repository.full_name.toLowerCase() === "cristianmoroaica/bountyverdict", "Skill result does not match its fixture.");
    requireCondition(audit.skill.path === `${CANARY_FIXTURES.skill.path}/SKILL.md`, "Skill result does not match its fixture path.");
    requireCondition(validCommit(audit.repository.commit_sha), "Skill result is not pinned to a commit.");
    requireCondition(
      audit.coverage.files_scanned > 0 && audit.coverage.bytes_scanned > 0 &&
      !audit.coverage.selection_truncated && validDate(audit.checked_at),
      "Skill coverage is incomplete or truncated.",
    );
    assertServiceReuseGuidance(audit.service_reuse, "SkillVerdict");
    source = `${CANARY_FIXTURES.skill.repository}/tree/main/${CANARY_FIXTURES.skill.path}`;
    result = {
      verdict: audit.verdict,
      risk_score: audit.risk_score,
      commit_sha: audit.repository.commit_sha,
      files_scanned: audit.coverage.files_scanned,
      bytes_scanned: audit.coverage.bytes_scanned,
      github_rate_limit_remaining: audit.coverage.github_rate_limit_remaining,
      reuse_guidance: audit.service_reuse.guidance,
    };
  } else {
    const diagnosis = await dependencies.diagnoseRun(CANARY_FIXTURES.run, env);
    requireCondition(diagnosis.product === "RunVerdict" && diagnosis.version === "1.0", "Run product contract changed.");
    requireCondition(diagnosis.run.id === "29728148711", "Run result does not match its fixture.");
    requireCondition(diagnosis.run.status === "completed" && diagnosis.coverage.failed_jobs > 0, "Run fixture no longer proves failure diagnosis.");
    requireCondition(
      diagnosis.coverage.jobs_reported > 0 && diagnosis.coverage.logs_scanned > 0 &&
      diagnosis.coverage.logs_unavailable === 0 && !diagnosis.coverage.jobs_truncated,
      "RunVerdict did not retrieve complete bounded failed-job evidence.",
    );
    requireCondition(validDate(diagnosis.checked_at), "Run result has no valid check time.");
    assertServiceReuseGuidance(diagnosis.service_reuse, "RunVerdict");
    source = CANARY_FIXTURES.run;
    result = {
      verdict: diagnosis.verdict,
      primary_family: diagnosis.diagnosis.primary_family,
      retryability: diagnosis.retryability,
      failed_jobs: diagnosis.coverage.failed_jobs,
      jobs_reported: diagnosis.coverage.jobs_reported,
      logs_scanned: diagnosis.coverage.logs_scanned,
      log_bytes_read: diagnosis.coverage.log_bytes_read,
      github_rate_limit_remaining: diagnosis.coverage.github_rate_limit_remaining,
      reuse_guidance: diagnosis.service_reuse.guidance,
    };
  }

  return {
    product,
    ok: true,
    contract: "1.0",
    source,
    result,
    checked_at: dependencies.now().toISOString(),
    duration_ms: Math.max(0, Math.round(dependencies.monotonic() - started)),
  };
}
