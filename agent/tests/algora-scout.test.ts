import assert from "node:assert/strict";
import test from "node:test";
import {
  ALGORA_SCOUT_MAX_EVALUATIONS,
  ALGORA_SCOUT_MINIMUM_REWARD_USD,
  algoraOpportunityCandidate,
  mergeAlgoraSearches,
  parseAlgoraSearch,
  selectAlgoraScoutIssues,
} from "../src/algora-scout.ts";
import type { AgentVerdict } from "../src/check.ts";
import {
  buildOpportunityAgentPrompt,
  buildOpportunityTrigger,
  parseOpportunityCandidates,
  parseOpportunityTrigger,
} from "../src/opportunity-agent-workflow.ts";

function searchIssue(number: number, updatedAt = "2026-07-31T10:00:00Z") {
  return {
    html_url: `https://github.com/acme/widget/issues/${number}`,
    repository_url: "https://api.github.com/repos/acme/widget",
    number,
    title: `Funded task ${number}`,
    state: "open",
    created_at: "2026-07-30T09:00:00Z",
    updated_at: updatedAt,
  };
}

function verdict(overrides: Partial<AgentVerdict> = {}): AgentVerdict {
  return {
    product: "BountyVerdict",
    version: "1.0",
    verdict: "VIABLE",
    score: 78,
    summary: "Verified and unclaimed.",
    service_reuse: {
      reusable: true,
      fresh_result_per_successful_call: true,
      reliability: "bounded_live_check",
      guidance: "Run again after issue activity changes.",
    },
    issue: {
      url: "https://github.com/acme/widget/issues/7",
      submitted_url: "https://github.com/acme/widget/issues/7",
      transferred: false,
      title: "Funded task 7",
      state: "open",
      repository: "acme/widget",
    },
    signals: [],
    contribution_policy: { ai_use: "NO_EXPLICIT_RULE_FOUND", documents: [] },
    task_requirements: {
      agent_execution: "NO_EXPLICIT_BLOCKER_FOUND",
      blockers: [],
      capability_requirements: [],
    },
    reward: {
      state: "LISTED",
      verification: "TRUSTED_PLATFORM_API",
      platform: "Algora",
      amount: 120,
      currency: "USD",
      evidence_url: "https://algora.io/sponsor-one/bounties?status=open",
    },
    linked_source: {
      state: "NOT_APPLICABLE",
      url: null,
      verdict: null,
      reward_state: null,
      reward_verification: null,
      error_code: null,
    },
    ...overrides,
  };
}

test("Algora scout unions legacy and current bot searches and bounds changed work", () => {
  const current = parseAlgoraSearch({
    total_count: 2,
    incomplete_results: false,
    items: [searchIssue(7), searchIssue(8, "2026-07-30T08:00:00Z")],
  });
  const legacy = parseAlgoraSearch({
    total_count: 2,
    incomplete_results: false,
    items: [searchIssue(7), searchIssue(9, "2026-07-31T11:00:00Z")],
  });
  const merged = mergeAlgoraSearches([current, legacy]);
  assert.deepEqual(merged.map(({ number }) => number), [9, 7, 8]);
  assert.deepEqual(
    selectAlgoraScoutIssues(merged, "2026-07-31T00:00:00Z").map(({ number }) => number),
    [9, 7],
  );
  assert.throws(() => parseAlgoraSearch({
    total_count: 101,
    incomplete_results: false,
    items: [],
  }), /incomplete, unbounded, or malformed/);
  assert.equal(ALGORA_SCOUT_MAX_EVALUATIONS, 15);
  assert.equal(ALGORA_SCOUT_MINIMUM_REWARD_USD, 100);
});

test("only a current trusted unclaimed Algora verdict becomes an opportunity candidate", () => {
  const issue = parseAlgoraSearch({
    total_count: 1,
    incomplete_results: false,
    items: [searchIssue(7)],
  })[0];
  const candidate = algoraOpportunityCandidate(issue, verdict());
  assert.ok(candidate);
  assert.equal(candidate.market, "github_algora");
  assert.equal(candidate.task_id, "acme/widget#7");
  assert.equal(candidate.reward_amount_usd, "120");
  assert.match(candidate.listing_snapshot_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(parseOpportunityCandidates([candidate]), [candidate]);
  const event = buildOpportunityTrigger([candidate], [], "2026-07-31T12:00:00Z");
  assert.ok(event.trigger);
  assert.deepEqual(parseOpportunityTrigger(event.trigger), event.trigger);
  const prompt = buildOpportunityAgentPrompt(event.trigger);
  assert.match(prompt, /https:\/\/github\.com\/acme\/widget\/issues\/7/);
  assert.match(prompt, /https:\/\/algora\.io\/sponsor-one\/bounties/);
  assert.doesNotMatch(prompt, /escrow_tx_hash/);

  assert.equal(algoraOpportunityCandidate(issue, verdict({
    verdict: "AVOID",
    score: 0,
    signals: [{
      label: "Bounty platform reports active competition",
      impact: -100,
      detail: "Algora reports one active claim.",
      evidence_url: "https://algora.io/sponsor-one/bounties?status=open",
      hard_stop: true,
    }],
  })), null);
  const appCandidate = algoraOpportunityCandidate(issue, verdict({
    reward: {
      state: "LISTED",
      verification: "TRUSTED_PLATFORM_APP",
      platform: "Algora",
      amount: 120,
      currency: "USD",
      evidence_url: `${issue.html_url}#issuecomment-123456`,
    },
  }));
  assert.equal(appCandidate?.listing_evidence_url, `${issue.html_url}#issuecomment-123456`);
  assert.equal(algoraOpportunityCandidate(issue, verdict({
    reward: {
      state: "PROMISED",
      verification: "MAINTAINER_STATEMENT",
      platform: null,
      amount: 75,
      currency: "USD",
      evidence_url: issue.html_url,
    },
  })), null);
});
