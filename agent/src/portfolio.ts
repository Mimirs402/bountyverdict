import { parseIssueUrl } from "../../analysis.js";
import {
  CheckError,
  checkGithubIssue,
  type AgentVerdict,
  type CheckEnvironment,
} from "./check.ts";
import { SERVICE_REUSE, type ServiceReuseGuidance } from "./reuse.ts";

type FetchLike = typeof fetch;
type CheckFunction = typeof checkGithubIssue;

export interface PortfolioFailure {
  issue_url: string;
  error: { code: string; message: string };
}

export interface PortfolioVerdict {
  product: "BountyVerdict Portfolio";
  version: "1.0";
  recommendation: string;
  service_reuse: ServiceReuseGuidance;
  best_candidate: string | null;
  counts: {
    submitted: number;
    checked: number;
    viable: number;
    caution: number;
    avoid: number;
    failed: number;
  };
  ranked: AgentVerdict[];
  failures: PortfolioFailure[];
  checked_at: string;
}

function validateUrls(values: unknown): string[] {
  if (!Array.isArray(values) || values.length < 2 || values.length > 10) {
    throw new CheckError("issue_urls must contain between 2 and 10 GitHub issue URLs.", 400, "INVALID_PORTFOLIO_SIZE");
  }
  const urls = values.map((value) => {
    if (typeof value !== "string") {
      throw new CheckError("Every issue_urls entry must be a string.", 400, "INVALID_ISSUE_URL");
    }
    try {
      const parsed = parseIssueUrl(value);
      return `https://github.com/${parsed.owner}/${parsed.repo}/issues/${parsed.number}`;
    } catch (error) {
      throw new CheckError(
        error instanceof Error ? error.message : "Invalid GitHub issue URL.",
        400,
        "INVALID_ISSUE_URL",
      );
    }
  });
  if (new Set(urls).size !== urls.length) {
    throw new CheckError("issue_urls must not contain duplicates.", 400, "DUPLICATE_ISSUE_URL");
  }
  return urls;
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await operation(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return output;
}

function verdictRank(verdict: AgentVerdict["verdict"]): number {
  return verdict === "VIABLE" ? 2 : verdict === "CAUTION" ? 1 : 0;
}

export async function checkBountyPortfolio(
  issueUrls: unknown,
  env: CheckEnvironment = {},
  fetchImpl: FetchLike = fetch,
  now = new Date(),
  checkImpl: CheckFunction = checkGithubIssue,
): Promise<PortfolioVerdict> {
  const urls = validateUrls(issueUrls);
  const checks = await mapConcurrent(urls, 2, async (issueUrl) => {
    try {
      return { verdict: await checkImpl(issueUrl, env, fetchImpl, now), failure: null };
    } catch (error) {
      const failure = error instanceof CheckError
        ? { issue_url: issueUrl, error: { code: error.code, message: error.message } }
        : { issue_url: issueUrl, error: { code: "CHECK_FAILED", message: "The issue could not be checked." } };
      return { verdict: null, failure };
    }
  });
  const ranked = checks
    .map((result) => result.verdict)
    .filter((verdict): verdict is AgentVerdict => verdict !== null)
    .sort((left, right) =>
      verdictRank(right.verdict) - verdictRank(left.verdict) || right.score - left.score,
    );
  const failures = checks
    .map((result) => result.failure)
    .filter((failure): failure is PortfolioFailure => failure !== null);
  if (!ranked.length) {
    throw new CheckError("None of the submitted issues could be checked.", 502, "PORTFOLIO_CHECK_FAILED");
  }

  const viable = ranked.filter((result) => result.verdict === "VIABLE").length;
  const caution = ranked.filter((result) => result.verdict === "CAUTION").length;
  const avoid = ranked.filter((result) => result.verdict === "AVOID").length;
  const best = ranked.find((result) => result.verdict !== "AVOID") ?? null;
  return {
    product: "BountyVerdict Portfolio",
    version: "1.0",
    recommendation: best
      ? `Investigate ${best.issue.url} first; it ranked ${best.verdict} with score ${best.score}.`
      : "Do not start any submitted bounty; every successfully checked candidate ranked AVOID.",
    service_reuse: SERVICE_REUSE.portfolio,
    best_candidate: best?.issue.url ?? null,
    counts: {
      submitted: urls.length,
      checked: ranked.length,
      viable,
      caution,
      avoid,
      failed: failures.length,
    },
    ranked,
    failures,
    checked_at: now.toISOString(),
  };
}
