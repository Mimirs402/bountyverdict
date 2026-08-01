import { createHash } from "node:crypto";
import type { GithubBountyHubOpportunityCandidate } from "./opportunity-agent-workflow.ts";

export const BOUNTYHUB_API = "https://api.bountyhub.dev";
export const BOUNTYHUB_MINIMUM_GROSS_USD = 125;
export const BOUNTYHUB_FEE_RESERVE_PERCENT = 20 as const;
export const BOUNTYHUB_MINIMUM_CONSERVATIVE_NET_USD = 100;
export const BOUNTYHUB_MAX_ACTIVE_CLAIMS = 2;
export const BOUNTYHUB_MAX_PAGES = 5;
export const BOUNTYHUB_PAGE_SIZE = 100;

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
  active: boolean;
  merged: boolean;
};

export type BountyHubDetail = {
  listing: BountyHubListing;
  claims: BountyHubClaim[];
};

export type BountyHubIssueEvaluation = {
  task_id: string;
  issue_url: string;
  title: string;
  prepaid_gross_usd: string;
  conservative_net_usd: string;
  paid_listing_ids: string[];
  active_claim_count: number | null;
  merged_claim_present: boolean | null;
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
    if (!uuidPattern.test(id)) throw new Error(`BountyHub claim ${index + 1} ID is invalid.`);
    return {
      id,
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

export function analyzeBountyHubInventory(
  listings: readonly BountyHubListing[],
  details: readonly BountyHubDetail[],
): { evaluations: BountyHubIssueEvaluation[]; candidates: GithubBountyHubOpportunityCandidate[] } {
  const detailById = new Map(details.map((detail) => [detail.listing.id, detail]));
  const evaluations: BountyHubIssueEvaluation[] = [];
  const candidates: GithubBountyHubOpportunityCandidate[] = [];
  for (const group of groups(listings)) {
    const gross = grossCents(group);
    const conservativeNet = Math.floor(gross * (100 - BOUNTYHUB_FEE_RESERVE_PERCENT) / 100);
    const paidListingIds = group.listings.map(({ id }) => id).sort();
    const requiredDetails = paidListingIds.map((id) => detailById.get(id));
    const detailsComplete = requiredDetails.every((detail) => detail !== undefined);
    const activeClaimIds = new Set<string>();
    let mergedClaimPresent = false;
    if (detailsComplete) {
      for (const detail of requiredDetails as BountyHubDetail[]) {
        for (const claim of detail.claims) {
          if (claim.active) activeClaimIds.add(claim.id);
          if (claim.merged) mergedClaimPresent = true;
        }
      }
    }
    const activeClaims = detailsComplete ? activeClaimIds.size : null;
    const excludedReason = gross < BOUNTYHUB_MINIMUM_GROSS_USD * 100
      ? "prepaid_gross_below_fee_reserved_gate"
      : !detailsComplete
        ? "claim_evidence_incomplete"
        : mergedClaimPresent
          ? "merged_claim_present"
          : activeClaimIds.size > BOUNTYHUB_MAX_ACTIVE_CLAIMS
            ? "active_competition_above_gate"
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
      active_claim_count: activeClaims,
      merged_claim_present: detailsComplete ? mergedClaimPresent : null,
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
      active_claim_ids: [...activeClaimIds].sort(),
      details: groupDetails.map(({ listing }) => ({
        id: listing.id,
        amount_usd: money(listing.amount_cents),
        updated_at: listing.updated_at,
      })).sort((left, right) => left.id.localeCompare(right.id)),
    };
    candidates.push({
      market: "github_bountyhub",
      task_id: group.task_id,
      title: group.title,
      mode: "bounty",
      gross_reward_usd: evaluation.prepaid_gross_usd,
      conservative_net_reward_usd: evaluation.conservative_net_usd,
      fee_reserve_percent: BOUNTYHUB_FEE_RESERVE_PERCENT,
      submission_count: activeClaimIds.size,
      created_at: createdAt,
      updated_at: updatedAt,
      issue_url: group.issue_url,
      listing_evidence_urls: paidListingIds.map((id) => `${BOUNTYHUB_API}/api/bounties/${id}`),
      listing_snapshot_sha256: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
      requires_agent_fit_review: true,
      selection_basis:
        "open GitHub issue; prepaid BountyHub listings only; 20% fee reserve leaves >=100 USD; <=2 active deduplicated claims; requires canonical fee and acceptance review",
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
