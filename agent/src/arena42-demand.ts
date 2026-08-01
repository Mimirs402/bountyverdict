import type { EscrowOpportunityCandidate } from "./opportunity-agent-workflow.ts";

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const addressPattern = /^0x[a-f0-9]{40}$/i;
const txPattern = /^0x[a-f0-9]{64}$/i;
const decimalPattern = /^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,8})?$/;
const maximumRecords = 100;
const maximumCompetition = 2;
const minimumConservativeNetAtomic = 100_000_000n;
const maximumAgeMs = 12 * 60 * 60 * 1_000;
const minimumRemainingMs = 2 * 60 * 60 * 1_000;
const reserveNumerator = 80n;
const reserveDenominator = 100n;

export const ARENA42_API = "https://api.arena42.ai";
export const ARENA42_BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const ARENA42_DEPOSIT_TOPIC =
  "0x87d4c0b5e30d6808bc8a94ba1c4d839b29d664151551a31753387ee9ef48429b";
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7c4a11628f55a4df523b3ef";

type JsonRecord = Record<string, unknown>;

export type Arena42Competition = {
  id: string;
  name: string;
  type: string;
  status: "live";
  cryptoPrizePool: string;
  currentParticipants: number;
  createdAt: string;
  endTime: string;
  fundingStatus: "confirmed";
  fundingChain: "base";
  fundingTxHash: string;
  fundingAmount: string;
  campaignId: string;
  escrowContract: string;
  ticketPrice: string | null;
  url: string;
};

export type Arena42DepositEvidence = {
  competition_id: string;
  campaign_id: string;
  escrow_contract: string;
  deposit_transaction_hash: string;
  receipt: unknown;
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

function nullableDecimal(value: unknown, label: string): string | null {
  if (value === null) return null;
  return decimal(value, label);
}

function decimal(value: unknown, label: string): string {
  const parsed = string(value, label, 32);
  if (!decimalPattern.test(parsed)) throw new Error(`${label} is invalid.`);
  return parsed;
}

function atomic(value: string, label: string): bigint {
  const [whole, fraction = ""] = decimal(value, label).split(".");
  return BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
}

function decimalFromAtomic(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = String(value % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
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

function address(value: unknown, label: string): string {
  const parsed = string(value, label, 42);
  if (!addressPattern.test(parsed)) throw new Error(`${label} is invalid.`);
  return parsed.toLowerCase();
}

function transaction(value: unknown, label: string): string {
  const parsed = string(value, label, 66);
  if (!txPattern.test(parsed)) throw new Error(`${label} is invalid.`);
  return parsed.toLowerCase();
}

function parseCompetition(value: unknown): Arena42Competition | null {
  const item = object(value, "Arena42 competition");
  const prize = decimal(item.cryptoPrizePool, "Arena42 crypto prize pool");
  if (atomic(prize, "Arena42 crypto prize pool") === 0n) return null;
  const id = string(item.id, "Arena42 competition ID", 64);
  if (!uuidPattern.test(id)) throw new Error("Arena42 competition ID is invalid.");
  if (item.status !== "live" || item.cryptoCurrency !== "USDC" || item.fundingStatus !== "confirmed" ||
    item.fundingChain !== "base") throw new Error("Arena42 real-reward competition has unsupported funding state.");
  const fundingAmount = decimal(item.fundingAmount, "Arena42 funding amount");
  if (atomic(fundingAmount, "Arena42 funding amount") !== atomic(prize, "Arena42 crypto prize pool")) {
    throw new Error("Arena42 prize and funding amounts disagree.");
  }
  const campaignId = transaction(item.campaignId, "Arena42 campaign ID");
  const url = string(item.url, "Arena42 competition URL", 1_000);
  if (url !== `https://arena42.ai/competition/${id}`) throw new Error("Arena42 competition URL is inconsistent.");
  return {
    id,
    name: string(item.name, "Arena42 competition name", 500),
    type: string(item.type, "Arena42 competition type", 80),
    status: "live",
    cryptoPrizePool: prize,
    currentParticipants: safeInteger(item.currentParticipants, "Arena42 participant count", 1_000_000),
    createdAt: timestamp(item.createdAt, "Arena42 creation time"),
    endTime: timestamp(item.endTime, "Arena42 deadline"),
    fundingStatus: "confirmed",
    fundingChain: "base",
    fundingTxHash: transaction(item.fundingTxHash, "Arena42 approval transaction"),
    fundingAmount,
    campaignId,
    escrowContract: address(item.escrowContract, "Arena42 escrow contract"),
    ticketPrice: nullableDecimal(item.ticketPrice, "Arena42 ticket price"),
    url,
  };
}

export function parseArena42Competitions(value: unknown): Arena42Competition[] {
  const payload = object(value, "Arena42 competition feed");
  if (!Array.isArray(payload.data) || payload.data.length > maximumRecords) {
    throw new Error("Arena42 competition feed is oversized or malformed.");
  }
  const pagination = object(payload.pagination, "Arena42 pagination");
  const total = safeInteger(pagination.total, "Arena42 total", 1_000_000);
  if (total > payload.data.length) throw new Error("Arena42 competition feed is incomplete.");
  const competitions = payload.data.map(parseCompetition).filter((item): item is Arena42Competition => item !== null);
  if (new Set(competitions.map(({ id }) => id.toLowerCase())).size !== competitions.length) {
    throw new Error("Arena42 competition feed duplicated a competition.");
  }
  return competitions;
}

export function arena42OpportunityCompetitionIds(
  competitions: readonly Arena42Competition[],
  nowMs = Date.now(),
): string[] {
  return competitions.filter((competition) => {
    const gross = atomic(competition.cryptoPrizePool, "Arena42 crypto prize pool");
    const createdMs = Date.parse(competition.createdAt);
    const deadlineMs = Date.parse(competition.endTime);
    const ticket = competition.ticketPrice === null ? 0n : atomic(competition.ticketPrice, "Arena42 ticket price");
    return ticket === 0n && competition.currentParticipants <= maximumCompetition &&
      gross * reserveNumerator / reserveDenominator >= minimumConservativeNetAtomic &&
      createdMs <= nowMs && nowMs - createdMs <= maximumAgeMs && deadlineMs - nowMs >= minimumRemainingMs;
  }).map(({ id }) => id);
}

function logAddressTopic(value: string): string {
  return `0x${value.toLowerCase().slice(2).padStart(64, "0")}`;
}

function hexAtomic(value: unknown, label: string): bigint {
  const parsed = string(value, label, 66);
  if (!/^0x[a-f0-9]{1,64}$/i.test(parsed)) throw new Error(`${label} is invalid.`);
  return BigInt(parsed);
}

function verifyDeposit(competition: Arena42Competition, evidence: Arena42DepositEvidence): string | null {
  if (evidence.competition_id !== competition.id || evidence.campaign_id.toLowerCase() !== competition.campaignId ||
    evidence.escrow_contract.toLowerCase() !== competition.escrowContract ||
    !txPattern.test(evidence.deposit_transaction_hash)) return null;
  const receipt = object(evidence.receipt, "Arena42 deposit receipt");
  if (receipt.status !== "0x1" || typeof receipt.transactionHash !== "string" ||
    receipt.transactionHash.toLowerCase() !== evidence.deposit_transaction_hash.toLowerCase() ||
    typeof receipt.to !== "string" || receipt.to.toLowerCase() !== competition.escrowContract ||
    !Array.isArray(receipt.logs) || receipt.logs.length > 1_000) return null;
  const amount = atomic(competition.fundingAmount, "Arena42 funding amount");
  const deposits = receipt.logs.filter((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const log = value as JsonRecord;
    return typeof log.address === "string" && log.address.toLowerCase() === competition.escrowContract &&
      Array.isArray(log.topics) && log.topics[0]?.toString().toLowerCase() === ARENA42_DEPOSIT_TOPIC &&
      log.topics[1]?.toString().toLowerCase() === competition.campaignId;
  }) as JsonRecord[];
  if (deposits.length !== 1 || !Array.isArray(deposits[0].topics) ||
    typeof deposits[0].topics[2] !== "string" || !addressPattern.test(`0x${String(deposits[0].topics[2]).slice(-40)}`) ||
    hexAtomic(deposits[0].data, "Arena42 deposit amount") !== amount) return null;
  const depositor = `0x${String(deposits[0].topics[2]).slice(-40)}`.toLowerCase();
  const transfers = receipt.logs.filter((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const log = value as JsonRecord;
    return typeof log.address === "string" && log.address.toLowerCase() === ARENA42_BASE_USDC &&
      Array.isArray(log.topics) && log.topics[0]?.toString().toLowerCase() === transferTopic &&
      log.topics[1]?.toString().toLowerCase() === logAddressTopic(depositor) &&
      log.topics[2]?.toString().toLowerCase() === logAddressTopic(competition.escrowContract) &&
      hexAtomic(log.data, "Arena42 USDC transfer amount") === amount;
  });
  return transfers.length === 1 ? depositor : null;
}

export function analyzeArena42(input: {
  competitions: Arena42Competition[];
  deposit_evidence?: Arena42DepositEvidence[];
  now_ms?: number;
}): Record<string, unknown> {
  const nowMs = input.now_ms ?? Date.now();
  if (input.competitions.length > maximumRecords) throw new Error("Arena42 inventory is oversized.");
  const evidence = new Map((input.deposit_evidence || []).map((item) => [item.competition_id, item]));
  if (evidence.size !== (input.deposit_evidence || []).length) throw new Error("Arena42 deposit evidence is duplicated.");
  const candidates: EscrowOpportunityCandidate[] = [];
  let verifiedFunding = 0;
  for (const competition of input.competitions) {
    const proof = evidence.get(competition.id);
    if (!proof) continue;
    const depositor = verifyDeposit(competition, proof);
    if (!depositor) continue;
    verifiedFunding += 1;
    if (!arena42OpportunityCompetitionIds([competition], nowMs).length) continue;
    const gross = atomic(competition.cryptoPrizePool, "Arena42 crypto prize pool");
    const conservativeNet = gross * reserveNumerator / reserveDenominator;
    const deadlineMs = Date.parse(competition.endTime);
    candidates.push({
      market: "arena42",
      task_id: competition.id,
      title: competition.name,
      mode: "competition",
      gross_reward_usdc: decimalFromAtomic(gross),
      net_reward_usdc: decimalFromAtomic(conservativeNet),
      submission_count: competition.currentParticipants,
      created_at: competition.createdAt,
      deadline_at: competition.endTime,
      hours_remaining: Math.round((deadlineMs - nowMs) / 36_000) / 100,
      escrow_tx_hash: proof.deposit_transaction_hash,
      requester: depositor,
      task_snapshot_sha256: null,
      opportunity_score_usdc_per_current_entry: decimalFromAtomic(
        conservativeNet / BigInt(competition.currentParticipants + 1),
      ),
      requires_agent_fit_review: true,
      selection_basis:
        "live autonomous-agent competition; zero ticket price; confirmed Base-USDC pool; campaign-specific escrow Deposit event and exact USDC transfer independently verified; 20% reserve leaves >=100 USDC; <=2 participants; <=12h old; >=2h remaining",
    });
  }
  return {
    live_real_reward_competitions: input.competitions.length,
    gross_live_usdc: decimalFromAtomic(input.competitions.reduce(
      (sum, competition) => sum + atomic(competition.cryptoPrizePool, "Arena42 crypto prize pool"), 0n,
    )),
    chain_verified_competitions: verifiedFunding,
    fresh_low_competition_candidates: candidates,
    fresh_low_competition_candidate_count: candidates.length,
    read_only: true,
    external_actions_enabled: false,
  };
}
