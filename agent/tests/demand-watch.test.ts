import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeMoltJobs,
  analyzeOpenJobs,
  moltJobsOpportunityDetailIds,
  parseMoltJobPublicSummary,
  parseMoltJobsPage,
  parseOpenJobs,
  verifyMoltJobsFundingReceipt,
  type MoltJob,
} from "../src/demand-watch.ts";

const now = Date.parse("2026-07-21T12:00:00.000Z");
const escrowJobId = Object.fromEntries(Array.from({ length: 32 }, (_, index) => [String(index), index]));

function rawMolt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    posterId: "22222222-2222-4222-8222-222222222222",
    agentId: null,
    status: "OPEN",
    templateId: "research-v1",
    title: "Research request",
    budgetUsdc: "0.5",
    inputData: { topic: "safe" },
    acceptanceCriteria: null,
    deadlineAt: "2026-07-25T00:00:00.000Z",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    paymentProvider: "ON_CHAIN_USDC",
    paymentStatus: null,
    escrowTxHash: `0x${"a".repeat(64)}`,
    escrowJobId,
    isPubliclyShareable: true,
    ...overrides,
  };
}

function molt(raw: Record<string, unknown>): MoltJob {
  return parseMoltJobsPage({ data: [raw], meta: { nextCursor: null } }).data[0];
}

function rawOpen(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Small paid job",
    description: "A complete brief.",
    reward: 10,
    currency: "WAGE",
    status: "open",
    jobType: "paid",
    posterId: "44444444-4444-4444-8444-444444444444",
    workerId: null,
    acceptMode: "manual",
    complexityBand: "T1",
    createdAt: "2026-07-20T00:00:00.000Z",
    submittedAt: null,
    isTest: false,
    isSandbox: false,
    isOnboarding: false,
    riskFlagged: false,
    escrowFrozen: false,
    disputeStatus: null,
    ...overrides,
  };
}

function rawMoltPublicSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    data: {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Research request",
      status: "OPEN",
      budgetUsdc: "6",
      deadlineAt: "2026-07-21T18:00:00.000Z",
      createdAt: "2026-07-21T06:00:00.000Z",
      assignedAgent: null,
      bidCount: 2,
      escrowFunded: true,
      ...overrides,
    },
  };
}

function hexWord(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function moltFundingReceipt(job: MoltJob, overrides: Record<string, unknown> = {}) {
  const sender = "0x3333333333333333333333333333333333333333";
  const escrow = "0xa845fba3f4428d4abf76df453f4b57e391328f71";
  const jobId = `0x${Array.from({ length: 32 }, (_, index) =>
    job.escrowJobId?.[String(index)].toString(16).padStart(2, "0")
  ).join("")}`;
  const budgetAtomic = 6_000_000n;
  const feeAtomic = 150_000n;
  return {
    transaction_hash: job.escrowTxHash!,
    receipt: {
      status: "0x1",
      transactionHash: job.escrowTxHash,
      from: sender,
      to: escrow,
      logs: [{
        address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          `0x${sender.slice(2).padStart(64, "0")}`,
          `0x${escrow.slice(2).padStart(64, "0")}`,
        ],
        data: `0x${hexWord(budgetAtomic)}`,
      }, {
        address: escrow,
        topics: [
          "0x2dcdaad87b561ba5a69835009b4c53ef9d3c41ca6cc9574049187659d6c6a715",
          jobId,
          `0x${sender.slice(2).padStart(64, "0")}`,
        ],
        data: `0x${hexWord(budgetAtomic - feeAtomic)}${hexWord(feeAtomic)}`,
      }],
      ...overrides,
    },
  };
}

test("MoltJobs page validates decimal and paired onchain escrow evidence", () => {
  const page = parseMoltJobsPage({ data: [rawMolt()], meta: { nextCursor: "opaque-cursor" } });
  assert.equal(page.data[0].budgetUsdc, "0.5");
  assert.equal(page.next_cursor, "opaque-cursor");
  assert.throws(() => parseMoltJobsPage({
    data: [rawMolt({ escrowJobId: null })], meta: { nextCursor: null },
  }), /escrow evidence disagrees/);
  assert.throws(() => parseMoltJobsPage({
    data: [rawMolt({ budgetUsdc: "1e2" })], meta: { nextCursor: null },
  }), /budget is invalid/);
});

test("MoltJobs accounting excludes an expired unfunded headline budget", () => {
  const expired = molt(rawMolt({
    id: "55555555-5555-4555-8555-555555555555",
    title: "find good product to buy",
    budgetUsdc: "100",
    deadlineAt: "2026-06-07T00:00:00.000Z",
    escrowTxHash: null,
    escrowJobId: null,
  }));
  const funded = [0, 1, 2, 3].map((index) => molt(rawMolt({
    id: `${String(index + 6).repeat(8)}-${String(index + 6).repeat(4)}-4${String(index + 6).repeat(3)}-8${String(index + 6).repeat(3)}-${String(index + 6).repeat(12)}`,
    escrowTxHash: `0x${String(index + 1).repeat(64)}`,
  })));
  const result = analyzeMoltJobs({ open_jobs: [expired, ...funded], funded_jobs: funded, now_ms: now });
  assert.equal(result.nominal_open_budget_usdc, "102");
  assert.equal(result.verified_funded_open_jobs, 4);
  assert.equal(result.verified_funded_budget_usdc, "2");
  assert.equal(result.exact_candidate_count, 0);
});

test("MoltJobs surfaces only a funded exact structured existing-product contract", () => {
  const exact = molt(rawMolt({
    title: "Is this GitHub bounty still worth pursuing?",
    budgetUsdc: "0.05",
    inputData: { issue_url: "https://github.com/example/project/issues/42" },
  }));
  const result = analyzeMoltJobs({ open_jobs: [exact], funded_jobs: [exact], now_ms: now });
  assert.equal(result.exact_candidate_count, 1);
  assert.deepEqual((result.exact_candidates as Array<Record<string, unknown>>)[0].product, "single");
});

test("MoltJobs emits a guarded assessment marker only after independent public funding and competition agree", () => {
  const funded = molt(rawMolt({
    budgetUsdc: "6",
    createdAt: "2026-07-21T06:00:00.000Z",
    updatedAt: "2026-07-21T06:00:00.000Z",
    deadlineAt: "2026-07-21T18:00:00.000Z",
  }));
  assert.deepEqual(moltJobsOpportunityDetailIds([funded], now), [funded.id]);
  const summary = parseMoltJobPublicSummary(rawMoltPublicSummary());
  const receipt = moltFundingReceipt(funded);
  assert.equal(verifyMoltJobsFundingReceipt(funded, receipt), true);
  const result = analyzeMoltJobs({
    open_jobs: [funded],
    funded_jobs: [funded],
    public_opportunity_summaries: [summary],
    funding_receipts: [receipt],
    excluded_owner_poster_ids: [],
    opportunity_triggers_enabled: true,
    now_ms: now,
  });
  assert.equal(result.fresh_low_competition_candidate_count, 1);
  assert.equal(result.chain_receipt_verified_jobs, 1);
  assert.equal(result.chain_receipt_rejected_jobs, 0);
  assert.deepEqual(result.fresh_low_competition_candidates, [{
    market: "moltjobs",
    task_id: funded.id,
    title: funded.title,
    mode: "competitive_job",
    gross_reward_usdc: "6",
    net_reward_usdc: "5.7",
    submission_count: 2,
    created_at: "2026-07-21T06:00:00.000Z",
    deadline_at: "2026-07-21T18:00:00.000Z",
    hours_remaining: 6,
    escrow_tx_hash: funded.escrowTxHash,
    requester: funded.posterId,
    task_snapshot_sha256: null,
    opportunity_score_usdc_per_current_entry: "1.9",
    requires_agent_fit_review: true,
    selection_basis:
      "official funded filter plus paired escrow identifiers plus agreeing public escrow flag plus successful Base receipt binding exact USDC and escrowJobId; non-owner poster; <=3 public bids; conservative 95% net >=5 USDC; <=12h old; >=2h remaining",
  }]);

  const disabled = analyzeMoltJobs({
    open_jobs: [funded],
    funded_jobs: [funded],
    now_ms: now,
  });
  assert.equal(disabled.fresh_low_competition_candidate_count, 0);
  assert.equal(disabled.opportunity_triggering_suppressed_reason, "owner_poster_identity_scope_unconfigured");
  assert.throws(() => analyzeMoltJobs({
    open_jobs: [funded],
    funded_jobs: [funded],
    opportunity_triggers_enabled: true,
    now_ms: now,
  }), /lacks a public summary/);
  assert.throws(() => analyzeMoltJobs({
    open_jobs: [funded],
    funded_jobs: [funded],
    public_opportunity_summaries: [parseMoltJobPublicSummary(rawMoltPublicSummary({ budgetUsdc: "7" }))],
    funding_receipts: [receipt],
    opportunity_triggers_enabled: true,
    now_ms: now,
  }), /summary disagrees/);
});

test("MoltJobs high-confidence markers reject owner posters, saturated bids, and false escrow flags", () => {
  const funded = molt(rawMolt({
    budgetUsdc: "6",
    createdAt: "2026-07-21T06:00:00.000Z",
    updatedAt: "2026-07-21T06:00:00.000Z",
    deadlineAt: "2026-07-21T18:00:00.000Z",
  }));
  for (const summary of [
    parseMoltJobPublicSummary(rawMoltPublicSummary({ bidCount: 4 })),
    parseMoltJobPublicSummary(rawMoltPublicSummary({ escrowFunded: false })),
  ]) {
    const result = analyzeMoltJobs({
      open_jobs: [funded],
      funded_jobs: [funded],
      public_opportunity_summaries: [summary],
      funding_receipts: [moltFundingReceipt(funded)],
      opportunity_triggers_enabled: true,
      now_ms: now,
    });
    assert.equal(result.fresh_low_competition_candidate_count, 0);
  }
  const owner = analyzeMoltJobs({
    open_jobs: [funded],
    funded_jobs: [funded],
    public_opportunity_summaries: [parseMoltJobPublicSummary(rawMoltPublicSummary())],
    funding_receipts: [moltFundingReceipt(funded)],
    excluded_owner_poster_ids: [funded.posterId],
    opportunity_triggers_enabled: true,
    now_ms: now,
  });
  assert.equal(owner.fresh_low_competition_candidate_count, 0);
  assert.equal(verifyMoltJobsFundingReceipt(funded, moltFundingReceipt(funded, { status: "0x0" })), false);
  const rejectedChain = analyzeMoltJobs({
    open_jobs: [funded],
    funded_jobs: [funded],
    public_opportunity_summaries: [parseMoltJobPublicSummary(rawMoltPublicSummary())],
    funding_receipts: [moltFundingReceipt(funded, { status: "0x0" })],
    opportunity_triggers_enabled: true,
    now_ms: now,
  });
  assert.equal(rejectedChain.fresh_low_competition_candidate_count, 0);
  assert.equal(rejectedChain.chain_receipt_verified_jobs, 0);
  assert.equal(rejectedChain.chain_receipt_rejected_jobs, 1);
});

test("OpenJobs accepts live arrays and its documented wrapper without treating WAGE as USDC", () => {
  const live = parseOpenJobs([rawOpen()]);
  const wrapped = parseOpenJobs({ jobs: [rawOpen()], count: 1 });
  assert.deepEqual(live, wrapped);
  const result = analyzeOpenJobs(live, now);
  assert.equal(result.open_jobs, 1);
  assert.equal(result.wage_open_jobs, 1);
  assert.equal(result.usdc_open_jobs, 0);
  assert.equal(result.exact_candidate_count, 0);
});

test("OpenJobs accepts zero only for non-paid WAGE negotiation", () => {
  const negotiable = parseOpenJobs([rawOpen({
    currency: "WAGE",
    jobType: "negotiable",
    reward: 0,
  })]);
  const result = analyzeOpenJobs(negotiable, now);
  assert.equal(result.open_jobs, 1);
  assert.equal(result.excluded_non_usdc, 1);
  assert.equal(result.usdc_open_jobs, 0);
  assert.throws(
    () => parseOpenJobs([rawOpen({ currency: "USDC", jobType: "paid", reward: 0 })]),
    /exact six-decimal/,
  );
  assert.throws(
    () => parseOpenJobs([rawOpen({ currency: "WAGE", jobType: "paid", reward: 0 })]),
    /exact six-decimal/,
  );
});

test("OpenJobs rejects implementation work even when the text contains an exact product input", () => {
  const jobs = parseOpenJobs([rawOpen({
    currency: "USDC",
    reward: 1,
    title: "Diagnose whether this GitHub bounty is worth pursuing",
    description: "Implement a patch and open a PR for https://github.com/example/project/issues/42. Code change required.",
  })]);
  const result = analyzeOpenJobs(jobs, now);
  assert.equal(result.eligible_usdc_open_jobs, 1);
  assert.equal(result.exact_candidate_count, 0);
});

test("OpenJobs parser rejects duplicates, unsafe precision, and an unbounded feed", () => {
  assert.throws(() => parseOpenJobs([rawOpen(), rawOpen()]), /duplicated/);
  assert.throws(() => parseOpenJobs([rawOpen({ reward: 0.0000001 })]), /exact six-decimal/);
  assert.throws(() => parseOpenJobs(Array.from({ length: 101 }, (_, index) => rawOpen({
    id: `${String(index % 10).repeat(8)}-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`,
  }))), /exceeds its public cap/);
});
