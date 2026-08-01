import { createHash } from "node:crypto";
import type { GithubBountyHubOpportunityCandidate } from "./opportunity-agent-workflow.ts";

export const BOUNTYHUB_API = "https://api.bountyhub.dev";
export const BOUNTYHUB_MINIMUM_GROSS_USD = 125;
export const BOUNTYHUB_FEE_RESERVE_PERCENT = 20 as const;
export const BOUNTYHUB_MINIMUM_CONSERVATIVE_NET_USD = 100;
export const BOUNTYHUB_MAX_ACTIVE_CLAIMS = 2;
export const BOUNTYHUB_MAX_PAGES = 5;
export const BOUNTYHUB_PAGE_SIZE = 100;
export const BOUNTYHUB_MAX_GITHUB_ISSUES = 10;
export const BOUNTYHUB_MAX_GITHUB_PULL_REQUESTS = 45;

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const repositoryPattern = /^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/;
const moneyPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/;

type JsonRecord = Record<string, unknown>;

export type BountyHubListing = {
  id: string;
  repository: string;
  issue_number: number;
  issue_url: string;
  title: string;
  amount_cents: number;
  payment_status: "PAID" | "PROMISED";
  created_at: string;
  updated_at: string;
  open: boolean;
};

export type BountyHubClaim = {
  id: string;
  pull_request_number: number;
  pull_request_api_url: string;
  pull_request_url: string;
  active: boolean;
  merged: boolean;
};

export type BountyHubDetail = {
  listing: BountyHubListing;
  claims: BountyHubClaim[];
};

export type BountyHubIssueReference = {
  task_id: string;
  issue_url: string;
  repository: string;
  issue_number: number;
};

export type BountyHubGithubIssue = BountyHubIssueReference & {
  state: "open" | "closed";
  state_reason: string | null;
  locked: boolean;
  updated_at: string;
};

export type BountyHubPullRequestReference = {
  task_id: string;
  claim_id: string;
  pull_request_number: number;
  pull_request_api_url: string;
  pull_request_url: string;
};

export type BountyHubGithubPullRequest = BountyHubPullRequestReference & {
  available: boolean;
  state: "open" | "closed" | null;
  merged: boolean | null;
  updated_at: string | null;
};

export type BountyHubIssueEvaluation = {
  task_id: string;
  issue_url: string;
  title: string;
  prepaid_gross_usd: string;
  conservative_net_usd: string;
  paid_listing_ids: string[];
  platform_active_claim_count: number | null;
  active_claim_count: number | null;
  canonical_open_claim_count_lower_bound: number;
  merged_claim_present: boolean | null;
  canonical_claim_evidence_complete: boolean;
  github_issue_state: "open" | "closed" | null;
  github_issue_locked: boolean | null;
  admitted: boolean;
  excluded_reason: string | null;
};

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed.`);
  return value as JsonRecord;
}

function boundedString(value: unknown, label: string, maximum = 1_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(`${label} is invalid.`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  const parsed = boundedString(value, label, 80);
  if (!Number.isFinite(Date.parse(parsed))) throw new Error(`${label} is invalid.`);
  return parsed;
}

function cents(value: unknown, label: string): number {
  const amount = boundedString(value, label, 32);
  if (!moneyPattern.test(amount)) throw new Error(`${label} is invalid.`);
  const [whole, fraction = ""] = amount.split(".");
  const parsed = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 100_000_000_00) {
    throw new Error(`${label} is outside the supported range.`);
  }
  return parsed;
}

function money(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("BountyHub money value is invalid.");
  const whole = Math.floor(value / 100);
  const fraction = String(value % 100).padStart(2, "0");
  return fraction === "00" ? String(whole) : `${whole}.${fraction.replace(/0$/, "")}`;
}

function parseListing(value: unknown, label: string): BountyHubListing {
  const item = record(value, label);
  const id = boundedString(item.id, `${label} ID`, 36);
  const repository = boundedString(item.repositoryFullName, `${label} repository`, 220);
  const issueNumber = Number(item.issueNumber);
  if (!uuidPattern.test(id) || !repositoryPattern.test(repository) || !Number.isSafeInteger(issueNumber) ||
    issueNumber < 1 || issueNumber > 9_999_999_999) {
    throw new Error(`${label} identity is invalid.`);
  }
  const issueUrl = boundedString(item.htmlURL, `${label} issue URL`);
  if (issueUrl !== `https://github.com/${repository}/issues/${issueNumber}`) {
    throw new Error(`${label} GitHub identity is inconsistent.`);
  }
  if (item.paymentStatus !== "PAID" && item.paymentStatus !== "PROMISED") {
    throw new Error(`${label} payment status is unsupported.`);
  }
  return {
    id,
    repository,
    issue_number: issueNumber,
    issue_url: issueUrl,
    title: boundedString(item.title, `${label} title`, 500),
    amount_cents: cents(item.amount, `${label} amount`),
    payment_status: item.paymentStatus,
    created_at: timestamp(item.createdAt, `${label} creation time`),
    updated_at: timestamp(item.updatedAt, `${label} update time`),
    open: item.deletedAt === null && item.retracted === false && item.solved === false &&
      item.isFrozen === false && String(item.issueState).toLowerCase() === "open",
  };
}

export function parseBountyHubPage(value: unknown): { listings: BountyHubListing[]; has_next_page: boolean } {
  const page = record(value, "BountyHub page");
  if (!Array.isArray(page.data) || page.data.length > BOUNTYHUB_PAGE_SIZE || typeof page.hasNextPage !== "boolean") {
    throw new Error("BountyHub page is unbounded or malformed.");
  }
  return {
    listings: page.data.map((item, index) => parseListing(item, `BountyHub listing ${index + 1}`)),
    has_next_page: page.hasNextPage,
  };
}

export function parseBountyHubDetail(value: unknown, expected: BountyHubListing): BountyHubDetail {
  const detail = record(value, "BountyHub detail");
  const listing = parseListing(detail, "BountyHub detail listing");
  if (listing.id !== expected.id || listing.repository !== expected.repository ||
    listing.issue_number !== expected.issue_number || listing.amount_cents !== expected.amount_cents ||
    listing.payment_status !== expected.payment_status) {
    throw new Error("BountyHub detail does not match its collection listing.");
  }
  if (!Array.isArray(detail.claims) || detail.claims.length > 10_000) {
    throw new Error("BountyHub detail claims are unbounded or malformed.");
  }
  const claims = detail.claims.map((value, index): BountyHubClaim => {
    const claim = record(value, `BountyHub claim ${index + 1}`);
    const id = boundedString(claim.id, `BountyHub claim ${index + 1} ID`, 36);
    const pullRequestNumber = Number(claim.pullRequestNumber);
    const pullRequestApiUrl = boundedString(
      claim.pullRequestURL,
      `BountyHub claim ${index + 1} pull request API URL`,
    );
    const pullRequestUrl = boundedString(
      claim.pullRequestWebURL,
      `BountyHub claim ${index + 1} pull request URL`,
    );
    if (!uuidPattern.test(id) || !Number.isSafeInteger(pullRequestNumber) ||
      pullRequestNumber < 1 || pullRequestNumber > 9_999_999_999) {
      throw new Error(`BountyHub claim ${index + 1} ID or pull request number is invalid.`);
    }
    let api;
    let web;
    try {
      api = new URL(pullRequestApiUrl);
      web = new URL(pullRequestUrl);
    } catch {
      throw new Error(`BountyHub claim ${index + 1} pull request identity is invalid.`);
    }
    const apiMatch = api.pathname.match(/^\/repos\/([-A-Za-z0-9_.]+)\/([-A-Za-z0-9_.]+)\/pulls\/([1-9][0-9]*)$/);
    const webMatch = web.pathname.match(/^\/([-A-Za-z0-9_.]+)\/([-A-Za-z0-9_.]+)\/pull\/([1-9][0-9]*)$/);
    if (api.protocol !== "https:" || api.hostname !== "api.github.com" || api.search || api.hash ||
      web.protocol !== "https:" || web.hostname !== "github.com" || web.search || web.hash ||
      !apiMatch || !webMatch || apiMatch[1] !== webMatch[1] || apiMatch[2] !== webMatch[2] ||
      Number(apiMatch[3]) !== pullRequestNumber || Number(webMatch[3]) !== pullRequestNumber) {
      throw new Error(`BountyHub claim ${index + 1} pull request identity is invalid.`);
    }
    return {
      id,
      pull_request_number: pullRequestNumber,
      pull_request_api_url: pullRequestApiUrl,
      pull_request_url: pullRequestUrl,
      active: claim.deletedAt === null && claim.rejectedAt === null &&
        (claim.isOpen === true || claim.pullRequestIsmerged === true),
      merged: claim.deletedAt === null && claim.rejectedAt === null && claim.pullRequestIsmerged === true,
    };
  });
  return { listing, claims };
}

type IssueGroup = {
  task_id: string;
  issue_url: string;
  title: string;
  listings: BountyHubListing[];
};

function groups(listings: readonly BountyHubListing[]): IssueGroup[] {
  const byIssue = new Map<string, IssueGroup>();
  for (const listing of listings) {
    if (!listing.open || listing.payment_status !== "PAID") continue;
    const taskId = `${listing.repository}#${listing.issue_number}`;
    const current = byIssue.get(taskId) || {
      task_id: taskId,
      issue_url: listing.issue_url,
      title: listing.title,
      listings: [],
    };
    current.listings.push(listing);
    byIssue.set(taskId, current);
  }
  return [...byIssue.values()].sort((left, right) => left.task_id.localeCompare(right.task_id));
}

function grossCents(group: IssueGroup): number {
  return group.listings.reduce((sum, listing) => sum + listing.amount_cents, 0);
}

export function bountyHubDetailListings(listings: readonly BountyHubListing[]): BountyHubListing[] {
  return groups(listings)
    .filter((group) => grossCents(group) >= BOUNTYHUB_MINIMUM_GROSS_USD * 100)
    .flatMap((group) => group.listings)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function bountyHubGithubIssueReferences(
  listings: readonly BountyHubListing[],
): BountyHubIssueReference[] {
  const references = groups(listings)
    .filter((group) => grossCents(group) >= BOUNTYHUB_MINIMUM_GROSS_USD * 100)
    .map((group) => {
      const [repository, issueNumber] = group.task_id.split("#");
      return {
        task_id: group.task_id,
        issue_url: group.issue_url,
        repository,
        issue_number: Number(issueNumber),
      };
    });
  if (references.length > BOUNTYHUB_MAX_GITHUB_ISSUES) {
    throw new Error(`BountyHub high-value issue inventory exceeds the ${BOUNTYHUB_MAX_GITHUB_ISSUES}-issue safety bound.`);
  }
  return references;
}

export function parseBountyHubGithubIssue(
  value: unknown,
  expected: BountyHubIssueReference,
): BountyHubGithubIssue {
  const issue = record(value, "BountyHub canonical GitHub issue");
  const state = boundedString(issue.state, "BountyHub canonical GitHub issue state", 20).toLowerCase();
  if (state !== "open" && state !== "closed") {
    throw new Error("BountyHub canonical GitHub issue state is unsupported.");
  }
  if (issue.html_url !== expected.issue_url || Number(issue.number) !== expected.issue_number ||
    issue.repository_url !== `https://api.github.com/repos/${expected.repository}` ||
    Object.hasOwn(issue, "pull_request") || typeof issue.locked !== "boolean") {
    throw new Error("BountyHub canonical GitHub issue identity is inconsistent.");
  }
  const stateReason = issue.state_reason;
  if (stateReason !== null && typeof stateReason !== "string") {
    throw new Error("BountyHub canonical GitHub issue state reason is invalid.");
  }
  return {
    ...expected,
    state,
    state_reason: stateReason,
    locked: issue.locked,
    updated_at: timestamp(issue.updated_at, "BountyHub canonical GitHub issue update time"),
  };
}

export function bountyHubGithubPullRequestReferences(
  listings: readonly BountyHubListing[],
  details: readonly BountyHubDetail[],
  githubIssues: readonly BountyHubGithubIssue[],
): BountyHubPullRequestReference[] {
  const detailById = new Map(details.map((detail) => [detail.listing.id, detail]));
  const issueByTask = new Map(githubIssues.map((issue) => [issue.task_id, issue]));
  const byClaim = new Map<string, BountyHubPullRequestReference>();
  for (const group of groups(listings)) {
    if (grossCents(group) < BOUNTYHUB_MINIMUM_GROSS_USD * 100) continue;
    const issue = issueByTask.get(group.task_id);
    if (!issue || issue.state !== "open" || issue.locked) continue;
    const requiredDetails = group.listings.map((listing) => detailById.get(listing.id));
    if (requiredDetails.some((detail) => detail === undefined)) continue;
    for (const detail of requiredDetails as BountyHubDetail[]) {
      for (const claim of detail.claims) {
        if (!claim.active) continue;
        const reference = {
          task_id: group.task_id,
          claim_id: claim.id,
          pull_request_number: claim.pull_request_number,
          pull_request_api_url: claim.pull_request_api_url,
          pull_request_url: claim.pull_request_url,
        };
        const prior = byClaim.get(claim.id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(reference)) {
          throw new Error("BountyHub duplicate claim identity is inconsistent.");
        }
        byClaim.set(claim.id, reference);
      }
    }
  }
  const references = [...byClaim.values()].sort((left, right) => left.claim_id.localeCompare(right.claim_id));
  if (references.length > BOUNTYHUB_MAX_GITHUB_PULL_REQUESTS) {
    throw new Error(
      `BountyHub active claim inventory exceeds the ${BOUNTYHUB_MAX_GITHUB_PULL_REQUESTS}-pull-request safety bound.`,
    );
  }
  return references;
}

export function parseBountyHubGithubPullRequest(
  value: unknown,
  expected: BountyHubPullRequestReference,
): BountyHubGithubPullRequest {
  if (value === null) {
    return { ...expected, available: false, state: null, merged: null, updated_at: null };
  }
  const pullRequest = record(value, "BountyHub canonical GitHub pull request");
  const state = boundedString(pullRequest.state, "BountyHub canonical GitHub pull request state", 20).toLowerCase();
  if (state !== "open" && state !== "closed") {
    throw new Error("BountyHub canonical GitHub pull request state is unsupported.");
  }
  if (pullRequest.html_url !== expected.pull_request_url || pullRequest.url !== expected.pull_request_api_url ||
    Number(pullRequest.number) !== expected.pull_request_number || typeof pullRequest.merged !== "boolean" ||
    (state === "open" && pullRequest.merged)) {
    throw new Error("BountyHub canonical GitHub pull request identity is inconsistent.");
  }
  return {
    ...expected,
    available: true,
    state,
    merged: pullRequest.merged,
    updated_at: timestamp(pullRequest.updated_at, "BountyHub canonical GitHub pull request update time"),
  };
}

export function analyzeBountyHubInventory(
  listings: readonly BountyHubListing[],
  details: readonly BountyHubDetail[],
  githubIssues: readonly BountyHubGithubIssue[],
  githubPullRequests: readonly BountyHubGithubPullRequest[],
): { evaluations: BountyHubIssueEvaluation[]; candidates: GithubBountyHubOpportunityCandidate[] } {
  const detailById = new Map(details.map((detail) => [detail.listing.id, detail]));
  const githubIssueByTask = new Map<string, BountyHubGithubIssue>();
  for (const issue of githubIssues) {
    if (githubIssueByTask.has(issue.task_id)) throw new Error("BountyHub canonical GitHub issue evidence is duplicated.");
    githubIssueByTask.set(issue.task_id, issue);
  }
  const githubPullRequestByClaim = new Map<string, BountyHubGithubPullRequest>();
  for (const pullRequest of githubPullRequests) {
    if (githubPullRequestByClaim.has(pullRequest.claim_id)) {
      throw new Error("BountyHub canonical GitHub pull request evidence is duplicated.");
    }
    githubPullRequestByClaim.set(pullRequest.claim_id, pullRequest);
  }
  const evaluations: BountyHubIssueEvaluation[] = [];
  const candidates: GithubBountyHubOpportunityCandidate[] = [];
  for (const group of groups(listings)) {
    const gross = grossCents(group);
    const conservativeNet = Math.floor(gross * (100 - BOUNTYHUB_FEE_RESERVE_PERCENT) / 100);
    const paidListingIds = group.listings.map(({ id }) => id).sort();
    const requiredDetails = paidListingIds.map((id) => detailById.get(id));
    const detailsComplete = requiredDetails.every((detail) => detail !== undefined);
    const platformActiveClaims = new Map<string, BountyHubClaim>();
    if (detailsComplete) {
      for (const detail of requiredDetails as BountyHubDetail[]) {
        for (const claim of detail.claims) {
          if (!claim.active) continue;
          const prior = platformActiveClaims.get(claim.id);
          if (prior && JSON.stringify(prior) !== JSON.stringify(claim)) {
            throw new Error("BountyHub duplicate active claim identity is inconsistent.");
          }
          platformActiveClaims.set(claim.id, claim);
        }
      }
    }
    const githubIssue = githubIssueByTask.get(group.task_id);
    const requiresCanonicalClaims = gross >= BOUNTYHUB_MINIMUM_GROSS_USD * 100 && detailsComplete &&
      githubIssue?.state === "open" && !githubIssue.locked;
    const canonicalPullRequests = requiresCanonicalClaims
      ? [...platformActiveClaims.values()].map((claim) => {
          const evidence = githubPullRequestByClaim.get(claim.id);
          if (evidence && (evidence.task_id !== group.task_id ||
            evidence.pull_request_number !== claim.pull_request_number ||
            evidence.pull_request_api_url !== claim.pull_request_api_url ||
            evidence.pull_request_url !== claim.pull_request_url)) {
            throw new Error("BountyHub canonical GitHub pull request evidence does not match its claim.");
          }
          return evidence;
        })
      : [];
    const canonicalClaimEvidenceComplete = requiresCanonicalClaims &&
      canonicalPullRequests.every((pullRequest) => pullRequest?.available === true);
    const canonicalActiveClaimIds = new Set<string>();
    const canonicalActivePullRequestUrls = new Set<string>();
    let mergedClaimPresent = false;
    for (const pullRequest of canonicalPullRequests) {
      if (!pullRequest?.available) continue;
      if (pullRequest.state === "open" || pullRequest.merged) {
        canonicalActiveClaimIds.add(pullRequest.claim_id);
        canonicalActivePullRequestUrls.add(pullRequest.pull_request_url);
      }
      if (pullRequest.merged) mergedClaimPresent = true;
    }
    const activeClaims = canonicalClaimEvidenceComplete ? canonicalActivePullRequestUrls.size : null;
    const excludedReason = gross < BOUNTYHUB_MINIMUM_GROSS_USD * 100
      ? "prepaid_gross_below_fee_reserved_gate"
      : !detailsComplete
        ? "claim_evidence_incomplete"
        : !githubIssue
          ? "github_issue_evidence_incomplete"
          : githubIssue.state !== "open"
            ? "github_issue_closed"
            : githubIssue.locked
              ? "github_issue_locked"
              : mergedClaimPresent
                ? "merged_claim_present"
                : canonicalActivePullRequestUrls.size > BOUNTYHUB_MAX_ACTIVE_CLAIMS
                  ? "active_competition_above_gate"
                  : !canonicalClaimEvidenceComplete
                    ? "github_claim_evidence_incomplete"
                  : conservativeNet < BOUNTYHUB_MINIMUM_CONSERVATIVE_NET_USD * 100
                    ? "conservative_net_below_gate"
                    : null;
    const evaluation: BountyHubIssueEvaluation = {
      task_id: group.task_id,
      issue_url: group.issue_url,
      title: group.title,
      prepaid_gross_usd: money(gross),
      conservative_net_usd: money(conservativeNet),
      paid_listing_ids: paidListingIds,
      platform_active_claim_count: detailsComplete ? platformActiveClaims.size : null,
      active_claim_count: activeClaims,
      canonical_open_claim_count_lower_bound: canonicalActivePullRequestUrls.size,
      merged_claim_present: requiresCanonicalClaims ? mergedClaimPresent : null,
      canonical_claim_evidence_complete: canonicalClaimEvidenceComplete,
      github_issue_state: githubIssue?.state ?? null,
      github_issue_locked: githubIssue?.locked ?? null,
      admitted: excludedReason === null,
      excluded_reason: excludedReason,
    };
    evaluations.push(evaluation);
    if (excludedReason !== null) continue;
    const groupDetails = requiredDetails as BountyHubDetail[];
    const createdAt = group.listings.map(({ created_at }) => created_at).sort()[0];
    const updatedAt = group.listings.map(({ updated_at }) => updated_at).sort().at(-1) as string;
    const snapshot = {
      task_id: group.task_id,
      prepaid_gross_usd: evaluation.prepaid_gross_usd,
      conservative_net_usd: evaluation.conservative_net_usd,
      paid_listing_ids: paidListingIds,
      platform_active_claim_ids: [...platformActiveClaims.keys()].sort(),
      active_claim_ids: [...canonicalActiveClaimIds].sort(),
      active_pull_request_urls: [...canonicalActivePullRequestUrls].sort(),
      details: groupDetails.map(({ listing }) => ({
        id: listing.id,
        amount_usd: money(listing.amount_cents),
        updated_at: listing.updated_at,
      })).sort((left, right) => left.id.localeCompare(right.id)),
      github_issue: {
        state: githubIssue!.state,
        state_reason: githubIssue!.state_reason,
        locked: githubIssue!.locked,
        updated_at: githubIssue!.updated_at,
      },
      github_pull_requests: (canonicalPullRequests as BountyHubGithubPullRequest[]).map((pullRequest) => ({
        claim_id: pullRequest.claim_id,
        pull_request_url: pullRequest.pull_request_url,
        state: pullRequest.state,
        merged: pullRequest.merged,
        updated_at: pullRequest.updated_at,
      })).sort((left, right) => left.claim_id.localeCompare(right.claim_id)),
    };
    candidates.push({
      market: "github_bountyhub",
      task_id: group.task_id,
      title: group.title,
      mode: "bounty",
      gross_reward_usd: evaluation.prepaid_gross_usd,
      conservative_net_reward_usd: evaluation.conservative_net_usd,
      fee_reserve_percent: BOUNTYHUB_FEE_RESERVE_PERCENT,
      submission_count: canonicalActivePullRequestUrls.size,
      created_at: createdAt,
      updated_at: updatedAt,
      issue_url: group.issue_url,
      listing_evidence_urls: paidListingIds.map((id) => `${BOUNTYHUB_API}/api/bounties/${id}`),
      listing_snapshot_sha256: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
      requires_agent_fit_review: true,
      selection_basis:
        "canonical open and unlocked GitHub issue; prepaid BountyHub listings only; 20% fee reserve leaves >=100 USD; <=2 active deduplicated claims; requires canonical fee and acceptance review",
    });
  }
  return {
    evaluations: evaluations.sort((left, right) =>
      Number(right.prepaid_gross_usd) - Number(left.prepaid_gross_usd) || left.task_id.localeCompare(right.task_id)),
    candidates: candidates.sort((left, right) =>
      Number(right.conservative_net_reward_usd) - Number(left.conservative_net_reward_usd) ||
      left.task_id.localeCompare(right.task_id)),
  };
}
