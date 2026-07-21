import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeMoltJobs,
  analyzeOpenJobs,
  parseMoltJobsPage,
  parseOpenJobs,
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
