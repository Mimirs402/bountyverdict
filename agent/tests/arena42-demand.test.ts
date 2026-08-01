import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeArena42,
  ARENA42_BASE_USDC,
  ARENA42_DEPOSIT_TOPIC,
  arena42OpportunityCompetitionIds,
  parseArena42Competitions,
} from "../src/arena42-demand.ts";

const now = Date.parse("2026-08-01T07:00:00.000Z");
const id = "11111111-1111-4111-8111-111111111111";
const escrow = "0xecfbe4735ed29dd00da74b9dd834d759dbb8de6d";
const depositor = "0x17cef556a06635566c94ad1500a9db638259727b";
const campaign = `0x${"b".repeat(64)}`;
const approvalTx = `0x${"a".repeat(64)}`;
const depositTx = `0x${"c".repeat(64)}`;
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7c4a11628f55a4df523b3ef";

function addressTopic(value: string): string {
  return `0x${value.slice(2).padStart(64, "0")}`;
}

function rawCompetition(overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: "Build a deterministic agent benchmark",
    type: "bounty",
    status: "live",
    cryptoPrizePool: "125.00000000",
    cryptoCurrency: "USDC",
    currentParticipants: 2,
    createdAt: "2026-08-01T06:00:00.000Z",
    endTime: "2026-08-01T13:00:00.000Z",
    fundingStatus: "confirmed",
    fundingChain: "base",
    fundingTxHash: approvalTx,
    fundingAmount: "125.00000000",
    campaignId: campaign,
    escrowContract: escrow,
    ticketPrice: null,
    url: `https://arena42.ai/competition/${id}`,
    ...overrides,
  };
}

function parsed(overrides: Record<string, unknown> = {}) {
  return parseArena42Competitions({
    data: [rawCompetition(overrides)],
    pagination: { total: 1 },
  });
}

test("Arena42 admits only fresh zero-ticket low-competition pools with exact escrow deposits", () => {
  const competitions = parsed();
  assert.deepEqual(arena42OpportunityCompetitionIds(competitions, now), [id]);
  const amount = `0x${(125_000_000n).toString(16)}`;
  const result = analyzeArena42({
    competitions,
    deposit_evidence: [{
      competition_id: id,
      campaign_id: campaign,
      escrow_contract: escrow,
      deposit_transaction_hash: depositTx,
      receipt: {
        status: "0x1",
        transactionHash: depositTx,
        to: escrow,
        logs: [
          {
            address: ARENA42_BASE_USDC,
            topics: [transferTopic, addressTopic(depositor), addressTopic(escrow)],
            data: amount,
          },
          {
            address: escrow,
            topics: [ARENA42_DEPOSIT_TOPIC, campaign, addressTopic(depositor)],
            data: amount,
          },
        ],
      },
    }],
    now_ms: now,
  });
  assert.equal(result.chain_verified_competitions, 1);
  assert.equal(result.fresh_low_competition_candidate_count, 1);
  assert.deepEqual((result.fresh_low_competition_candidates as Array<Record<string, unknown>>)[0], {
    market: "arena42",
    task_id: id,
    title: "Build a deterministic agent benchmark",
    mode: "competition",
    gross_reward_usdc: "125",
    net_reward_usdc: "100",
    submission_count: 2,
    created_at: "2026-08-01T06:00:00.000Z",
    deadline_at: "2026-08-01T13:00:00.000Z",
    hours_remaining: 6,
    escrow_tx_hash: depositTx,
    requester: depositor,
    task_snapshot_sha256: null,
    opportunity_score_usdc_per_current_entry: "33.333333",
    requires_agent_fit_review: true,
    selection_basis:
      "live autonomous-agent competition; zero ticket price; confirmed Base-USDC pool; campaign-specific escrow Deposit event and exact USDC transfer independently verified; 20% reserve leaves >=100 USDC; <=2 participants; <=12h old; >=2h remaining",
  });
});

test("Arena42 rejects paid entry, saturated, stale, low-value, incomplete, and approval-only evidence", () => {
  for (const competitions of [
    parsed({ ticketPrice: "1.00000000" }),
    parsed({ currentParticipants: 3 }),
    parsed({ createdAt: "2026-07-31T18:59:59.000Z" }),
    parsed({ cryptoPrizePool: "124.99999999", fundingAmount: "124.99999999" }),
  ]) assert.deepEqual(arena42OpportunityCompetitionIds(competitions, now), []);
  assert.throws(() => parseArena42Competitions({ data: [rawCompetition()], pagination: { total: 2 } }), /incomplete/);
  const competitions = parsed();
  const result = analyzeArena42({
    competitions,
    deposit_evidence: [{
      competition_id: id,
      campaign_id: campaign,
      escrow_contract: escrow,
      deposit_transaction_hash: approvalTx,
      receipt: { status: "0x1", transactionHash: approvalTx, to: ARENA42_BASE_USDC, logs: [] },
    }],
    now_ms: now,
  });
  assert.equal(result.chain_verified_competitions, 0);
  assert.equal(result.fresh_low_competition_candidate_count, 0);
});
