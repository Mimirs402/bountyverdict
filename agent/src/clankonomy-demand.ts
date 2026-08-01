const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const addressPattern = /^0x[a-f0-9]{40}$/i;
const txPattern = /^0x[a-f0-9]{64}$/i;
const atomicPattern = /^(?:0|[1-9][0-9]{0,14})$/;
const maximumRecords = 100;
const maximumCompetition = 2;
const minimumNetAtomic = 100_000_000n;
const maximumAgeMs = 12 * 60 * 60 * 1_000;
const minimumRemainingMs = 2 * 60 * 60 * 1_000;

export const CLANKONOMY_API = "https://api.clankonomy.com";
export const CLANKONOMY_BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const CLANKONOMY_BOUNTY_CREATED_TOPIC =
  "0xd92de3ec3f8b89142c096441bbc8b7ceaa890621c08c1dc46a5541f1da0adacc";

type JsonRecord = Record<string, unknown>;

export type ClankonomyBountySummary = {
  id: string;
  title: string;
  token: string;
  amount: string;
  deadline: string;
  numWinners: number;
  status: "active";
  createdAt: string;
  submissionCount: number;
};

export type ClankonomyBountyDetail = ClankonomyBountySummary & {
  chainBountyId: number;
  contractAddress: string;
  posterAddress: string;
  payoutSharesBps: number[];
  platformFeeBps: number;
};

export type ClankonomyOnchainEvidence = {
  bounty_id: string;
  contract_address: string;
  chain_bounty_id: number;
  transaction_hash: string;
  receipt: unknown;
  onchain_bounty: {
    poster: string;
    token: string;
    amount: string;
    deadline: string;
    num_winners: number;
    status: number;
  };
};

function object(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed.`);
  return value as JsonRecord;
}

function string(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== "string" || !value || value.trim() !== value || value.length > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function address(value: unknown, label: string): string {
  const parsed = string(value, label, 42);
  if (!addressPattern.test(parsed)) throw new Error(`${label} is invalid.`);
  return parsed.toLowerCase();
}

function timestamp(value: unknown, label: string): string {
  const parsed = string(value, label, 80);
  if (!Number.isFinite(Date.parse(parsed))) throw new Error(`${label} is invalid.`);
  return parsed;
}

function safeInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return Number(value);
}

function atomic(value: unknown, label: string): bigint {
  const parsed = string(value, label, 32);
  if (!atomicPattern.test(parsed)) throw new Error(`${label} is invalid.`);
  return BigInt(parsed);
}

function decimal(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = String(value % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function parseSummary(value: unknown): ClankonomyBountySummary {
  const item = object(value, "Clankonomy bounty");
  if (item.status !== "active") throw new Error("Clankonomy active feed contains a non-active bounty.");
  const id = string(item.id, "Clankonomy bounty ID", 64);
  if (!uuidPattern.test(id)) throw new Error("Clankonomy bounty ID is invalid.");
  const numWinners = safeInteger(item.numWinners, "Clankonomy winner count", 3);
  if (numWinners < 1) throw new Error("Clankonomy winner count is invalid.");
  return {
    id,
    title: string(item.title, "Clankonomy title", 500),
    token: address(item.token ?? item.tokenAddress, "Clankonomy token"),
    amount: String(atomic(item.amount, "Clankonomy amount")),
    deadline: timestamp(item.deadline, "Clankonomy deadline"),
    numWinners,
    status: "active",
    createdAt: timestamp(item.createdAt, "Clankonomy creation time"),
    submissionCount: safeInteger(item.submissionCount, "Clankonomy submission count", 100_000),
  };
}

export function parseClankonomyActive(value: unknown): ClankonomyBountySummary[] {
  const payload = object(value, "Clankonomy active feed");
  if (!Array.isArray(payload.bounties) || payload.bounties.length > maximumRecords) {
    throw new Error("Clankonomy active feed is oversized or malformed.");
  }
  const bounties = payload.bounties.map(parseSummary);
  if (new Set(bounties.map(({ id }) => id.toLowerCase())).size !== bounties.length) {
    throw new Error("Clankonomy active feed duplicated a bounty.");
  }
  return bounties;
}

export function parseClankonomyDetail(value: unknown): ClankonomyBountyDetail {
  const payload = object(value, "Clankonomy detail");
  const item = object(payload.bounty, "Clankonomy detail bounty");
  const summary = parseSummary({ ...item, submissionCount: payload.submissionCount });
  if (!Array.isArray(item.payoutSharesBps) || item.payoutSharesBps.length !== summary.numWinners) {
    throw new Error("Clankonomy payout shares are malformed.");
  }
  const payoutSharesBps = item.payoutSharesBps.map((share) => safeInteger(share, "Clankonomy payout share", 10_000));
  if (payoutSharesBps.reduce((sum, share) => sum + share, 0) !== 10_000 || payoutSharesBps.some((share) => share === 0)) {
    throw new Error("Clankonomy payout shares do not sum to 10000.");
  }
  const platformFeeBps = safeInteger(item.platformFeeBps, "Clankonomy platform fee", 1_000);
  return {
    ...summary,
    chainBountyId: safeInteger(item.chainBountyId, "Clankonomy chain bounty ID", 10_000_000),
    contractAddress: address(item.contractAddress, "Clankonomy contract"),
    posterAddress: address(object(item.poster, "Clankonomy poster").walletAddress, "Clankonomy poster wallet"),
    payoutSharesBps,
    platformFeeBps,
  };
}

export function clankonomyOpportunityDetailIds(
  bounties: readonly ClankonomyBountySummary[],
  nowMs = Date.now(),
): string[] {
  return bounties.filter((bounty) => {
    const gross = atomic(bounty.amount, "Clankonomy amount");
    const createdMs = Date.parse(bounty.createdAt);
    const deadlineMs = Date.parse(bounty.deadline);
    return bounty.token === CLANKONOMY_BASE_USDC &&
      bounty.submissionCount <= maximumCompetition &&
      gross * 95n / 100n >= minimumNetAtomic &&
      createdMs <= nowMs && nowMs - createdMs <= maximumAgeMs &&
      deadlineMs - nowMs >= minimumRemainingMs;
  }).map(({ id }) => id);
}

function sameSummary(summary: ClankonomyBountySummary, detail: ClankonomyBountyDetail): boolean {
  return summary.id === detail.id && summary.title === detail.title && summary.token === detail.token &&
    summary.amount === detail.amount && summary.deadline === detail.deadline &&
    summary.numWinners === detail.numWinners && summary.status === detail.status &&
    summary.createdAt === detail.createdAt && summary.submissionCount === detail.submissionCount;
}

function verifyOnchain(detail: ClankonomyBountyDetail, evidence: ClankonomyOnchainEvidence): boolean {
  if (evidence.bounty_id !== detail.id || evidence.contract_address.toLowerCase() !== detail.contractAddress ||
    evidence.chain_bounty_id !== detail.chainBountyId || !txPattern.test(evidence.transaction_hash)) return false;
  const receipt = object(evidence.receipt, "Clankonomy funding receipt");
  const onchain = evidence.onchain_bounty;
  if (receipt.status !== "0x1" || typeof receipt.transactionHash !== "string" ||
    receipt.transactionHash.toLowerCase() !== evidence.transaction_hash.toLowerCase() ||
    typeof receipt.to !== "string" || receipt.to.toLowerCase() !== detail.contractAddress ||
    !Array.isArray(receipt.logs) || receipt.logs.length > 1_000) return false;
  const expectedIdTopic = `0x${detail.chainBountyId.toString(16).padStart(64, "0")}`;
  const matchingLogs = receipt.logs.filter((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const log = value as JsonRecord;
    return typeof log.address === "string" && log.address.toLowerCase() === detail.contractAddress &&
      Array.isArray(log.topics) && log.topics[0]?.toString().toLowerCase() === CLANKONOMY_BOUNTY_CREATED_TOPIC &&
      log.topics[1]?.toString().toLowerCase() === expectedIdTopic;
  });
  return matchingLogs.length === 1 &&
    onchain.poster.toLowerCase() === detail.posterAddress &&
    onchain.token.toLowerCase() === detail.token &&
    onchain.amount === detail.amount &&
    onchain.deadline === String(Math.floor(Date.parse(detail.deadline) / 1_000)) &&
    onchain.num_winners === detail.numWinners && onchain.status === 0;
}

export function analyzeClankonomy(input: {
  active_bounties: ClankonomyBountySummary[];
  details?: ClankonomyBountyDetail[];
  onchain_evidence?: ClankonomyOnchainEvidence[];
  now_ms?: number;
}): Record<string, unknown> {
  const nowMs = input.now_ms ?? Date.now();
  if (input.active_bounties.length > maximumRecords) throw new Error("Clankonomy inventory is oversized.");
  const summaries = new Map(input.active_bounties.map((item) => [item.id, item]));
  const details = new Map((input.details || []).map((item) => [item.id, item]));
  const evidence = new Map((input.onchain_evidence || []).map((item) => [item.bounty_id, item]));
  if (summaries.size !== input.active_bounties.length || details.size !== (input.details || []).length ||
    evidence.size !== (input.onchain_evidence || []).length) throw new Error("Clankonomy evidence is duplicated.");

  const candidates: Record<string, unknown>[] = [];
  let verifiedFunding = 0;
  for (const [id, detail] of details) {
    const summary = summaries.get(id);
    const proof = evidence.get(id);
    if (!summary || !sameSummary(summary, detail)) throw new Error("Clankonomy detail disagrees with its active summary.");
    if (!proof || !verifyOnchain(detail, proof)) continue;
    verifiedFunding += 1;
    const gross = atomic(detail.amount, "Clankonomy amount");
    const netPool = gross * BigInt(10_000 - detail.platformFeeBps) / 10_000n;
    const firstPrize = netPool * BigInt(detail.payoutSharesBps[0]) / 10_000n;
    const createdMs = Date.parse(detail.createdAt);
    const deadlineMs = Date.parse(detail.deadline);
    if (detail.submissionCount > maximumCompetition || firstPrize < minimumNetAtomic ||
      createdMs > nowMs || nowMs - createdMs > maximumAgeMs || deadlineMs - nowMs < minimumRemainingMs) continue;
    candidates.push({
      market: "clankonomy",
      task_id: detail.id,
      title: detail.title,
      mode: "bounty",
      gross_reward_usdc: decimal(gross),
      net_reward_usdc: decimal(firstPrize),
      submission_count: detail.submissionCount,
      created_at: detail.createdAt,
      deadline_at: detail.deadline,
      hours_remaining: Math.round((deadlineMs - nowMs) / 36_000) / 100,
      escrow_tx_hash: proof.transaction_hash,
      requester: detail.posterAddress,
      task_snapshot_sha256: null,
      opportunity_score_usdc_per_current_entry: decimal(firstPrize / BigInt(detail.submissionCount + 1)),
      requires_agent_fit_review: true,
      selection_basis:
        "active agent-native Base-USDC bounty; exact API detail agrees with summary; BountyCreated receipt and live getBounty state bind contract, chain ID, poster, token, amount, deadline, winner count, and active status; first-prize net after exact fee/share >=100 USDC; <=2 submissions; <=12h old; >=2h remaining",
    });
  }
  return {
    active_bounties: input.active_bounties.length,
    active_usdc_bounties: input.active_bounties.filter(({ token }) => token === CLANKONOMY_BASE_USDC).length,
    gross_active_usdc: decimal(input.active_bounties.filter(({ token }) => token === CLANKONOMY_BASE_USDC)
      .reduce((sum, bounty) => sum + atomic(bounty.amount, "Clankonomy amount"), 0n)),
    details_verified: details.size,
    chain_verified_active_bounties: verifiedFunding,
    fresh_low_competition_candidates: candidates,
    fresh_low_competition_candidate_count: candidates.length,
    exact_candidates: [],
    exact_candidate_count: 0,
    read_only: true,
    external_actions_enabled: false,
  };
}
