import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeZeroxWork,
  parseZeroxWorkPage,
  zeroxWorkOpportunityTaskIds,
  ZEROXWORK_BASE_USDC,
  ZEROXWORK_TASK_POOL,
  ZEROXWORK_TASK_POSTED_TOPIC,
  ZEROXWORK_TRANSFER_TOPIC,
  type ZeroxWorkTask,
} from "../src/zeroxwork-demand.ts";

const now = Date.parse("2026-08-01T12:00:00.000Z");
const poster = "0x1111111111111111111111111111111111111111";
const transactionHash = `0x${"a".repeat(64)}`;

function rawTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 700,
    chain_task_id: 400,
    poster_address: poster,
    worker_address: null,
    description: "Implement and test a bounded parser.",
    title: "Bounded parser",
    category: "Code",
    bounty_amount: "110",
    deadline: Math.floor(Date.parse("2026-08-01T18:00:00.000Z") / 1_000),
    status: "Open",
    created_at: "2026-08-01 10:00:00",
    tx_hash: transactionHash,
    contract_version: "v4",
    preferred_agent_id: null,
    hire_type: "open",
    require_approval: 0,
    allow_bidding: 0,
    results_based: 0,
    claim_scope: "public",
    attempt_count: 1,
    application_count: 0,
    min_followers: null,
    min_reputation: null,
    min_tasks_completed: null,
    min_rating: null,
    min_cred_score: null,
    linked_service_id: null,
    ...overrides,
  };
}

function page(tasks: Record<string, unknown>[]) {
  return parseZeroxWorkPage({ tasks, total: tasks.length, total_value: 110, limit: 100, offset: 0 });
}

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function evidence(task: ZeroxWorkTask, overrides: Record<string, unknown> = {}) {
  const gross = 110_000_000n;
  const chainId = BigInt(task.chainTaskId!);
  const deadline = BigInt(task.deadline!);
  const posterTopic = `0x${poster.slice(2).padStart(64, "0")}`;
  return {
    task_id: task.id,
    chain_task_id: task.chainTaskId!,
    transaction_hash: task.transactionHash!,
    receipt: {
      status: "0x1",
      transactionHash: task.transactionHash,
      from: poster,
      to: ZEROXWORK_TASK_POOL,
      logs: [{
        address: ZEROXWORK_BASE_USDC,
        topics: [
          ZEROXWORK_TRANSFER_TOPIC,
          posterTopic,
          `0x${ZEROXWORK_TASK_POOL.slice(2).padStart(64, "0")}`,
        ],
        data: `0x${word(gross)}`,
      }, {
        address: ZEROXWORK_TASK_POOL,
        topics: [ZEROXWORK_TASK_POSTED_TOPIC, `0x${word(chainId)}`, posterTopic],
        data: `0x${word(gross)}${word(deadline)}`,
      }],
    },
    onchain_task: {
      poster,
      worker: "0x0000000000000000000000000000000000000000",
      description: task.description,
      bounty_amount: String(gross),
      deadline: String(deadline),
      state: 0,
    },
    fee_bps: 500,
    protocol_paused: false,
    task_paused: false,
    ...overrides,
  };
}

test("0xWork page strictly validates open inventory and pagination", () => {
  const parsed = page([rawTask()]);
  assert.equal(parsed.tasks[0].bountyAmount, "110");
  assert.equal(parsed.tasks[0].createdAt, "2026-08-01T10:00:00Z");
  assert.throws(() => page([rawTask({ status: "Completed" })]), /non-open/);
  assert.throws(() => page([rawTask({ id: 0 })]), /task ID is invalid/);
  assert.throws(() => page([rawTask({ chain_task_id: 0 })]), /chain task ID is invalid/);
  assert.throws(() => parseZeroxWorkPage({
    tasks: [rawTask(), rawTask()], total: 2, total_value: 220, limit: 100, offset: 0,
  }), /duplicated/);
  assert.deepEqual(parseZeroxWorkPage({ tasks: [], total: 0, total_value: 0, limit: 100, offset: 0 }).tasks, []);
});

test("0xWork rejects current unescrowed social results tasks before chain reads", () => {
  const task = page([rawTask({
    chain_task_id: null,
    tx_hash: null,
    category: "Social",
    bounty_amount: "50",
    deadline: null,
    results_based: 1,
    attempt_count: 20,
  })]).tasks[0];
  assert.deepEqual(zeroxWorkOpportunityTaskIds([task], now), []);
  const result = analyzeZeroxWork({ open_tasks: [task], now_ms: now });
  assert.equal(result.results_based_unescrowed_tasks, 1);
  assert.equal(result.social_or_physical_tasks, 1);
  assert.equal(result.fresh_low_competition_candidate_count, 0);
});

test("0xWork preliminary gate excludes approval, competition, restrictions, and insufficient net", () => {
  const variants = [
    rawTask({ require_approval: 1 }),
    rawTask({ attempt_count: 3 }),
    rawTask({ attempt_count: 2, application_count: 1 }),
    rawTask({ min_reputation: 10 }),
    rawTask({ bounty_amount: "105" }),
    rawTask({ contract_version: "v3" }),
  ].map((raw, index) => ({ ...raw, id: 710 + index, chain_task_id: 410 + index, tx_hash: `0x${String(index + 1).repeat(64)}` }));
  assert.deepEqual(zeroxWorkOpportunityTaskIds(page(variants).tasks, now), []);
});

test("0xWork admits only exact live V4 escrow with dynamic net above the gate", () => {
  const task = page([rawTask()]).tasks[0];
  assert.deepEqual(zeroxWorkOpportunityTaskIds([task], now), [task.id]);
  const result = analyzeZeroxWork({
    open_tasks: [task],
    onchain_evidence: [evidence(task)],
    now_ms: now,
  });
  assert.equal(result.chain_verified_open_tasks, 1);
  assert.equal(result.fresh_low_competition_candidate_count, 1);
  const candidate = (result.fresh_low_competition_candidates as Array<Record<string, unknown>>)[0];
  assert.deepEqual({ ...candidate, selection_basis: undefined }, {
    market: "zeroxwork",
    task_id: "700",
    title: "Bounded parser",
    mode: "bounty",
    gross_reward_usdc: "110",
    net_reward_usdc: "104.5",
    submission_count: 1,
    created_at: "2026-08-01T10:00:00Z",
    deadline_at: "2026-08-01T18:00:00.000Z",
    hours_remaining: 6,
    escrow_tx_hash: transactionHash,
    requester: poster,
    task_snapshot_sha256: null,
    opportunity_score_usdc_per_current_entry: "52.25",
    requires_agent_fit_review: true,
    selection_basis: undefined,
  });
  assert.match(String(candidate.selection_basis), /verified live TaskPool state/);
});

test("0xWork fails closed on receipt, live state, pause, and fee disagreement", () => {
  const task = page([rawTask()]).tasks[0];
  for (const proof of [
    evidence(task, { protocol_paused: true }),
    evidence(task, { task_paused: true }),
    evidence(task, { fee_bps: 1_001 }),
    evidence(task, { onchain_task: { ...evidence(task).onchain_task, state: 1 } }),
    evidence(task, { receipt: { ...evidence(task).receipt, status: "0x0" } }),
  ]) {
    const result = analyzeZeroxWork({ open_tasks: [task], onchain_evidence: [proof], now_ms: now });
    assert.equal(result.fresh_low_competition_candidate_count, 0);
  }
});
