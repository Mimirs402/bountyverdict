import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeClankonomy,
  clankonomyOpportunityDetailIds,
  CLANKONOMY_BOUNTY_CREATED_TOPIC,
  parseClankonomyActive,
  parseClankonomyDetail,
} from "../src/clankonomy-demand.ts";

const now = Date.parse("2026-08-01T07:00:00.000Z");
const id = "11111111-1111-4111-8111-111111111111";
const contract = "0xb657c8b8bf22ef880a206b59ed7ff3883a61c8f1";
const poster = "0xe607cca0257351dca72c7a7ace1fe5b6159d554a";
const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const tx = `0x${"a".repeat(64)}`;

function rawSummary(overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: "Deterministic agent challenge",
    token,
    amount: "110000000",
    deadline: "2026-08-01T13:00:00.000Z",
    numWinners: 1,
    status: "active",
    createdAt: "2026-08-01T06:00:00.000Z",
    submissionCount: 2,
    ...overrides,
  };
}

function rawDetail(overrides: Record<string, unknown> = {}) {
  return {
    bounty: {
      ...rawSummary(),
      chainBountyId: 7,
      contractAddress: contract,
      poster: { walletAddress: poster },
      payoutSharesBps: [10000],
      platformFeeBps: 250,
      ...overrides,
    },
    submissionCount: overrides.submissionCount ?? 2,
  };
}

test("Clankonomy admits only exact fresh low-competition onchain-funded first prizes", () => {
  const active = parseClankonomyActive({ bounties: [rawSummary()], limit: 100, offset: 0 });
  assert.deepEqual(clankonomyOpportunityDetailIds(active, now), [id]);
  const detail = parseClankonomyDetail(rawDetail());
  const idTopic = `0x${detail.chainBountyId.toString(16).padStart(64, "0")}`;
  const result = analyzeClankonomy({
    active_bounties: active,
    details: [detail],
    onchain_evidence: [{
      bounty_id: id,
      contract_address: contract,
      chain_bounty_id: 7,
      transaction_hash: tx,
      receipt: {
        status: "0x1",
        transactionHash: tx,
        to: contract,
        logs: [{ address: contract, topics: [CLANKONOMY_BOUNTY_CREATED_TOPIC, idTopic], data: "0x" }],
      },
      onchain_bounty: {
        poster,
        token,
        amount: "110000000",
        deadline: String(Date.parse("2026-08-01T13:00:00.000Z") / 1_000),
        num_winners: 1,
        status: 0,
      },
    }],
    now_ms: now,
  });
  assert.equal(result.chain_verified_active_bounties, 1);
  assert.equal(result.fresh_low_competition_candidate_count, 1);
  assert.deepEqual((result.fresh_low_competition_candidates as Array<Record<string, unknown>>)[0], {
    market: "clankonomy",
    task_id: id,
    title: "Deterministic agent challenge",
    mode: "bounty",
    gross_reward_usdc: "110",
    net_reward_usdc: "107.25",
    submission_count: 2,
    created_at: "2026-08-01T06:00:00.000Z",
    deadline_at: "2026-08-01T13:00:00.000Z",
    hours_remaining: 6,
    escrow_tx_hash: tx,
    requester: poster,
    task_snapshot_sha256: null,
    opportunity_score_usdc_per_current_entry: "35.75",
    requires_agent_fit_review: true,
    selection_basis:
      "active agent-native Base-USDC bounty; exact API detail agrees with summary; BountyCreated receipt and live getBounty state bind contract, chain ID, poster, token, amount, deadline, winner count, and active status; first-prize net after exact fee/share >=100 USDC; <=2 submissions; <=12h old; >=2h remaining",
  });
});

test("Clankonomy rejects stale, saturated, split, and non-USDC headline rewards", () => {
  for (const summary of [
    rawSummary({ submissionCount: 3 }),
    rawSummary({ token: "0x1111111111111111111111111111111111111111" }),
    rawSummary({ createdAt: "2026-07-31T18:59:59.000Z" }),
  ]) {
    assert.deepEqual(clankonomyOpportunityDetailIds(parseClankonomyActive({ bounties: [summary] }), now), []);
  }
  assert.throws(() => parseClankonomyDetail(rawDetail({ numWinners: 2, payoutSharesBps: [5000, 4000] })), /sum to 10000/);
});
