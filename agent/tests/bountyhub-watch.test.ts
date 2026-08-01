import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeBountyHubInventory,
  bountyHubDetailListings,
  bountyHubGithubIssueReferences,
  parseBountyHubDetail,
  parseBountyHubGithubIssue,
  parseBountyHubPage,
} from "../src/bountyhub-watch.ts";
import {
  buildOpportunityAgentPrompt,
  buildOpportunityTrigger,
  parseOpportunityCandidates,
  parseOpportunityTrigger,
} from "../src/opportunity-agent-workflow.ts";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];

function listing({
  id = ids[0],
  amount = "100.00",
  paymentStatus = "PAID",
  issueNumber = 7,
}: {
  id?: string;
  amount?: string;
  paymentStatus?: "PAID" | "PROMISED";
  issueNumber?: number;
} = {}) {
  return {
    id,
    repositoryFullName: "acme/widget",
    issueNumber,
    htmlURL: `https://github.com/acme/widget/issues/${issueNumber}`,
    title: `Implement funded issue ${issueNumber}`,
    amount,
    paymentStatus,
    createdAt: "2026-07-30T09:00:00.000Z",
    updatedAt: "2026-07-31T10:00:00.000Z",
    deletedAt: null,
    retracted: false,
    solved: false,
    isFrozen: false,
    issueState: "open",
  };
}

function claim(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    deletedAt: null,
    rejectedAt: null,
    isOpen: true,
    pullRequestIsmerged: false,
    ...overrides,
  };
}

function githubIssue(
  reference: ReturnType<typeof bountyHubGithubIssueReferences>[number],
  overrides: Record<string, unknown> = {},
) {
  return parseBountyHubGithubIssue({
    html_url: reference.issue_url,
    repository_url: `https://api.github.com/repos/${reference.repository}`,
    number: reference.issue_number,
    state: "open",
    state_reason: null,
    locked: false,
    updated_at: "2026-08-01T08:00:00.000Z",
    ...overrides,
  }, reference);
}

test("BountyHub parser bounds pages and verifies detail identity", () => {
  const first = listing();
  const parsed = parseBountyHubPage({ data: [first], hasNextPage: false });
  assert.equal(parsed.listings.length, 1);
  assert.equal(parsed.listings[0].amount_cents, 10_000);
  assert.equal(parsed.has_next_page, false);
  assert.throws(() => parseBountyHubPage({ data: Array(101).fill(first), hasNextPage: false }), /unbounded/);
  assert.throws(() => parseBountyHubDetail({ ...first, id: ids[1], claims: [] }, parsed.listings[0]), /does not match/);
});

test("BountyHub analysis aggregates prepaid sponsors and deduplicates active claims", () => {
  const rows = [
    listing({ id: ids[0], amount: "100.00" }),
    listing({ id: ids[1], amount: "50.00" }),
    listing({ id: ids[2], amount: "500.00", paymentStatus: "PROMISED" }),
  ];
  const parsed = parseBountyHubPage({ data: rows, hasNextPage: false }).listings;
  assert.deepEqual(bountyHubDetailListings(parsed).map(({ id }) => id), [ids[0], ids[1]]);
  const details = [
    parseBountyHubDetail({ ...rows[0], claims: [claim(ids[3])] }, parsed[0]),
    parseBountyHubDetail({
      ...rows[1],
      claims: [claim(ids[3]), claim(ids[4], { rejectedAt: "2026-07-31T12:00:00.000Z" })],
    }, parsed[1]),
  ];
  const issue = githubIssue(bountyHubGithubIssueReferences(parsed)[0]);
  const result = analyzeBountyHubInventory(parsed, details, [issue]);
  assert.equal(result.evaluations.length, 1);
  assert.deepEqual(result.evaluations[0], {
    task_id: "acme/widget#7",
    issue_url: "https://github.com/acme/widget/issues/7",
    title: "Implement funded issue 7",
    prepaid_gross_usd: "150",
    conservative_net_usd: "120",
    paid_listing_ids: [ids[0], ids[1]],
    active_claim_count: 1,
    merged_claim_present: false,
    github_issue_state: "open",
    github_issue_locked: false,
    admitted: true,
    excluded_reason: null,
  });
  const candidate = result.candidates[0];
  assert.equal(candidate.market, "github_bountyhub");
  assert.equal(candidate.submission_count, 1);
  assert.equal(candidate.conservative_net_reward_usd, "120");
  assert.deepEqual(parseOpportunityCandidates([candidate]), [candidate]);
  const event = buildOpportunityTrigger([candidate], [], "2026-08-01T07:00:00.000Z");
  assert.ok(event.trigger);
  assert.deepEqual(parseOpportunityTrigger(event.trigger), event.trigger);
  const prompt = buildOpportunityAgentPrompt(event.trigger);
  assert.match(prompt, /api\.bountyhub\.dev\/api\/bounties/);
  assert.match(prompt, /fee_reserve_percent/);
  assert.doesNotMatch(prompt, /Implement funded issue 7/);
});

test("BountyHub analysis fails closed on incomplete or excessive competition evidence", () => {
  const row = listing({ amount: "125.00" });
  const parsed = parseBountyHubPage({ data: [row], hasNextPage: false }).listings;
  const issue = githubIssue(bountyHubGithubIssueReferences(parsed)[0]);
  assert.equal(analyzeBountyHubInventory(parsed, [], [issue]).evaluations[0].excluded_reason, "claim_evidence_incomplete");
  const detail = parseBountyHubDetail({
    ...row,
    claims: [claim(ids[1]), claim(ids[2]), claim(ids[3])],
  }, parsed[0]);
  const crowded = analyzeBountyHubInventory(parsed, [detail], [issue]);
  assert.equal(crowded.candidates.length, 0);
  assert.equal(crowded.evaluations[0].excluded_reason, "active_competition_above_gate");

  const merged = parseBountyHubDetail({
    ...row,
    claims: [claim(ids[1], { isOpen: false, pullRequestIsmerged: true })],
  }, parsed[0]);
  const terminal = analyzeBountyHubInventory(parsed, [merged], [issue]);
  assert.equal(terminal.candidates.length, 0);
  assert.equal(terminal.evaluations[0].excluded_reason, "merged_claim_present");
});

test("BountyHub analysis rejects a stale listing when canonical GitHub says the issue is closed", () => {
  const row = listing({ amount: "250.00", issueNumber: 207 });
  const parsed = parseBountyHubPage({ data: [row], hasNextPage: false }).listings;
  const detail = parseBountyHubDetail({ ...row, claims: [] }, parsed[0]);
  const reference = bountyHubGithubIssueReferences(parsed)[0];
  const closed = githubIssue(reference, {
    state: "closed",
    state_reason: "completed",
    updated_at: "2026-05-23T09:48:45.000Z",
  });
  const result = analyzeBountyHubInventory(parsed, [detail], [closed]);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.evaluations[0].github_issue_state, "closed");
  assert.equal(result.evaluations[0].excluded_reason, "github_issue_closed");

  const missing = analyzeBountyHubInventory(parsed, [detail], []);
  assert.equal(missing.evaluations[0].excluded_reason, "github_issue_evidence_incomplete");
  assert.throws(() => githubIssue(reference, { pull_request: { url: "https://api.github.com/repos/acme/widget/pulls/207" } }),
    /identity is inconsistent/);
});
