import { createHash } from "node:crypto";
import type { AgentVerdict } from "./check.ts";
import type { GithubAlgoraOpportunityCandidate } from "./opportunity-agent-workflow.ts";

export const ALGORA_SCOUT_COMMENTERS = ["algora-pbc[bot]", "algora-pbc"] as const;
export const ALGORA_SCOUT_MAX_INVENTORY = 100;
export const ALGORA_SCOUT_MAX_EVALUATIONS = 15;
export const ALGORA_SCOUT_LOOKBACK_MS = 48 * 60 * 60 * 1_000;
export const ALGORA_SCOUT_MINIMUM_REWARD_USD = 25;

export type AlgoraSearchIssue = {
  html_url: string;
  repository: string;
  number: number;
  title: string;
  state: "open";
  created_at: string;
  updated_at: string;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid.`);
  return new Date(value).toISOString();
}

export function parseAlgoraSearch(value: unknown): AlgoraSearchIssue[] {
  const result = record(value);
  if (result.incomplete_results !== false || !Number.isSafeInteger(result.total_count) ||
    Number(result.total_count) < 0 || Number(result.total_count) > ALGORA_SCOUT_MAX_INVENTORY ||
    !Array.isArray(result.items) || result.items.length !== result.total_count) {
    throw new Error("Algora GitHub search is incomplete, unbounded, or malformed.");
  }
  const issues = result.items.map((raw): AlgoraSearchIssue => {
    const item = record(raw);
    const repositoryUrl = typeof item.repository_url === "string" ? item.repository_url : "";
    const repository = repositoryUrl.match(
      /^https:\/\/api\.github\.com\/repos\/([-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+)$/,
    )?.[1];
    const number = item.number;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!repository || !Number.isSafeInteger(number) || Number(number) < 1 || Number(number) > 9_999_999_999 ||
      !title || title.length > 500 || item.state !== "open" ||
      item.html_url !== `https://github.com/${repository}/issues/${number}`) {
      throw new Error("Algora GitHub search returned a malformed issue.");
    }
    return {
      html_url: item.html_url as string,
      repository,
      number: Number(number),
      title,
      state: "open",
      created_at: timestamp(item.created_at, "Algora issue creation time"),
      updated_at: timestamp(item.updated_at, "Algora issue update time"),
    };
  });
  if (new Set(issues.map(({ html_url }) => html_url)).size !== issues.length) {
    throw new Error("Algora GitHub search duplicated an issue.");
  }
  return issues.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function selectAlgoraScoutIssues(
  issues: readonly AlgoraSearchIssue[],
  since: string,
): AlgoraSearchIssue[] {
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) throw new Error("Algora scout checkpoint is invalid.");
  return issues
    .filter(({ updated_at }) => Date.parse(updated_at) >= sinceMs)
    .slice(0, ALGORA_SCOUT_MAX_EVALUATIONS);
}

export function mergeAlgoraSearches(searches: readonly (readonly AlgoraSearchIssue[])[]): AlgoraSearchIssue[] {
  const deduplicated = new Map<string, AlgoraSearchIssue>();
  for (const issue of searches.flat()) {
    const existing = deduplicated.get(issue.html_url);
    if (!existing || issue.updated_at > existing.updated_at) deduplicated.set(issue.html_url, issue);
  }
  return [...deduplicated.values()].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

function decimalAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0 || value > 100_000_000) {
    throw new Error("Algora reward amount is invalid.");
  }
  return value.toFixed(6).replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, "").replace(/\.$/, "");
}

export function algoraOpportunityCandidate(
  issue: AlgoraSearchIssue,
  verdict: AgentVerdict,
): GithubAlgoraOpportunityCandidate | null {
  if (verdict.issue.url !== issue.html_url || verdict.issue.state !== "open" ||
    verdict.verdict !== "VIABLE" || verdict.score < 65 ||
    verdict.reward.state !== "LISTED" ||
    (verdict.reward.verification !== "TRUSTED_PLATFORM_API" &&
      verdict.reward.verification !== "TRUSTED_PLATFORM_APP") ||
    verdict.reward.platform !== "Algora" || verdict.reward.currency !== "USD" ||
    verdict.reward.amount === null || verdict.reward.amount < ALGORA_SCOUT_MINIMUM_REWARD_USD ||
    verdict.reward.evidence_url === null ||
    verdict.contribution_policy.ai_use === "BLOCKED" ||
    verdict.task_requirements.agent_execution !== "NO_EXPLICIT_BLOCKER_FOUND" ||
    verdict.signals.some(({ hard_stop }) => hard_stop)) return null;

  const evidence = new URL(verdict.reward.evidence_url);
  const trustedAlgoraPage = evidence.hostname === "algora.io" &&
    /^\/[-A-Za-z0-9_.]+\/bounties\/?$/.test(evidence.pathname);
  const trustedGithubComment = evidence.hostname === "github.com" &&
    verdict.reward.evidence_url.startsWith(`${issue.html_url}#issuecomment-`);
  if (evidence.protocol !== "https:" || Boolean(evidence.username || evidence.password) ||
    (!trustedAlgoraPage && !trustedGithubComment)) {
    throw new Error("Algora trusted evidence URL is malformed.");
  }
  const reward = decimalAmount(verdict.reward.amount);
  const listingSnapshot = createHash("sha256")
    .update(`${issue.html_url}\n${verdict.reward.evidence_url}\n${reward}`)
    .digest("hex");
  return {
    market: "github_algora",
    task_id: `${issue.repository}#${issue.number}`,
    title: issue.title,
    mode: "bounty",
    reward_amount_usd: reward,
    submission_count: 0,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    issue_url: issue.html_url,
    listing_evidence_url: verdict.reward.evidence_url,
    listing_snapshot_sha256: listingSnapshot,
    requires_agent_fit_review: true,
    selection_basis: "BountyVerdict verified a current trusted Algora listing with no hard stop, active claim, AI-policy block, or autonomous-execution blocker.",
  };
}
