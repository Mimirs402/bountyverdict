import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBounty, parseIssueUrl } from "../analysis.js";

const now = new Date("2026-07-20T12:00:00Z");
const healthyIssue = {
  state: "open",
  locked: false,
  active_lock_reason: null,
  assignees: [],
  updated_at: "2026-07-19T12:00:00Z",
  html_url: "https://github.com/acme/widget/issues/4",
  title: "Fix widget alignment",
  body: "A reproducible and bounded specification with clear current behavior, expected behavior, and acceptance criteria that are long enough."
  + " This is a $100 bounty paid after an accepted fix.",
  author_association: "OWNER",
};
const healthyRepo = {
  archived: false,
  pushed_at: "2026-07-19T12:00:00Z",
  html_url: "https://github.com/acme/widget",
  full_name: "acme/widget"
};

test("parses a canonical GitHub issue URL", () => {
  assert.deepEqual(parseIssueUrl("https://github.com/acme/widget/issues/42"), { owner: "acme", repo: "widget", number: 42 });
});

test("rejects pull request and non-GitHub URLs", () => {
  assert.throws(() => parseIssueUrl("https://github.com/acme/widget/pull/42"), /Use a URL like/);
  assert.throws(() => parseIssueUrl("https://example.com/acme/widget/issues/42"), /Only github.com/);
});

test("marks a healthy uncontested issue viable", () => {
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, now });
  assert.equal(output.verdict, "VIABLE");
  assert.ok(output.score >= 75);
});

test("locked issue is a hard stop", () => {
  const output = analyzeBounty({ issue: { ...healthyIssue, locked: true }, repository: healthyRepo, now });
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Discussion is locked" && item.hardStop));
});

test("assigned issue is a hard stop", () => {
  const output = analyzeBounty({
    issue: { ...healthyIssue, assignees: [{ login: "assigned-solver" }] },
    repository: healthyRepo,
    now,
  });
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Issue is already assigned" && item.hardStop));
});

test("a rewarded bounty label is a hard stop even when the issue stays open", () => {
  const output = analyzeBounty({
    issue: { ...healthyIssue, labels: [{ name: "💰 Rewarded" }] },
    repository: healthyRepo,
    now,
  });
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Bounty is already rewarded" && item.hardStop));
});

test("qualified rewarded labels never fabricate a paid hard stop", () => {
  for (const label of ["Maybe Rewarded", "Not Rewarded", "Reward Pending"]) {
    const output = analyzeBounty({
      issue: {
        ...healthyIssue,
        labels: [{ name: label }],
        body: "A funded $25 USDC bounty campaign pays after an accepted fix with the complete acceptance criteria below.",
      },
      repository: healthyRepo,
      now,
    });
    assert.equal(output.reward.state, "PROMISED", label);
    assert.equal(output.reward.amount, 25, label);
    assert.equal(output.reward.currency, "USDC", label);
    assert.ok(!output.signals.some((item) => item.label === "Bounty is already rewarded"), label);
  }
});

test("only explicit affirmative rewarded status labels hard-stop the bounty", () => {
  for (const label of ["Rewarded", "💰 Rewarded", "Bounty: Rewarded", "Reward - Rewarded"]) {
    const output = analyzeBounty({
      issue: { ...healthyIssue, labels: [{ name: label }] },
      repository: healthyRepo,
      now,
    });
    assert.equal(output.reward.state, "PAID_OR_AWARDED", label);
    assert.equal(output.verdict, "AVOID", label);
  }
});

test("an unconfirmed non-maintainer bounty is a hard stop", () => {
  const output = analyzeBounty({
    issue: { ...healthyIssue, author_association: "NONE", title: "$5,000 bounty", body: "Payable somehow after this issue is solved." },
    repository: healthyRepo,
    now,
  });
  assert.equal(output.reward.state, "UNVERIFIED");
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Reward is unverified"));
  assert.ok(output.signals.some((item) => item.label === "Bounty issuer lacks repository authority" && item.hardStop));
});

test("a maintainer confirmation clears the untrusted-issuer hard stop", () => {
  const comments = [{
    body: "I confirm this is a $5,000 bounty and we will pay the accepted contributor.",
    author_association: "MEMBER",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-confirmation",
    user: { login: "maintainer" },
  }];
  const output = analyzeBounty({
    issue: { ...healthyIssue, author_association: "NONE", title: "$5,000 bounty", body: "Payable after this issue is solved." },
    repository: healthyRepo,
    comments,
    now,
  });
  assert.equal(output.reward.state, "PROMISED");
  assert.ok(!output.signals.some((item) => item.label === "Bounty issuer lacks repository authority"));
});

test("parses abbreviated thousands in bounty titles", () => {
  const output = analyzeBounty({
    issue: {
      ...healthyIssue,
      title: "[Bounty $2k] Implement the widget adapter",
      body: "A reproducible and bounded specification with clear acceptance criteria for the complete adapter implementation.",
    },
    repository: healthyRepo,
    now,
  });
  assert.equal(output.reward.amount, 2_000);
  assert.equal(output.reward.currency, "USD");
});

test("parses decimal uppercase thousands in bounty descriptions", () => {
  const output = analyzeBounty({
    issue: {
      ...healthyIssue,
      title: "Implement the widget adapter bounty",
      body: "A reproducible and bounded specification with clear acceptance criteria. The accepted implementation receives $1.5K.",
    },
    repository: healthyRepo,
    now,
  });
  assert.equal(output.reward.amount, 1_500);
  assert.equal(output.reward.currency, "USD");
});

test("a verified Algora GitHub App comment establishes listing provenance only", () => {
  const comments = [{
    body: "## 💎 $250 bounty • acme\nReceive payment 2-5 days post-reward.",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-algora",
    user: { login: "algora-pbc[bot]" },
    performed_via_github_app: { slug: "algora-pbc" },
  }];
  const output = analyzeBounty({
    issue: { ...healthyIssue, author_association: "NONE", body: "Implement the complete, bounded specification described in the acceptance criteria below." },
    repository: healthyRepo,
    comments,
    now,
  });
  assert.equal(output.reward.state, "LISTED");
  assert.equal(output.reward.verification, "TRUSTED_PLATFORM_APP");
  assert.equal(output.reward.amount, 250);
  assert.equal(output.verdict, "VIABLE");
});

test("the current Algora status table makes one active attempt a hard stop", () => {
  const comments = [{
    body: "| Attempt | Started | Solution |\n| --- | --- | --- |\n| 🟢 @solver | Jul 21 | WIP |",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-3",
    created_at: "2026-07-20T10:00:00Z",
    updated_at: "2026-07-20T11:00:00Z",
    user: { login: "algora-pbc[bot]" },
    performed_via_github_app: { slug: "algora-pbc" },
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Bounty platform reports active competition" && item.hardStop));
});

test("a newer official up-for-grabs update supersedes an older active-attempt table", () => {
  const comments = [{
    body: "| Attempt | Started | Solution |\n| --- | --- | --- |\n| 🟢 @solver | Jul 19 | WIP |",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-3",
    created_at: "2026-07-19T10:00:00Z",
    updated_at: "2026-07-19T11:00:00Z",
    user: { login: "algora-pbc[bot]" },
    performed_via_github_app: { slug: "algora-pbc" },
  }, {
    body: "The bounty is now up for grabs.",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-4",
    created_at: "2026-07-20T10:00:00Z",
    updated_at: "2026-07-20T10:00:00Z",
    user: { login: "algora-pbc[bot]" },
    performed_via_github_app: { slug: "algora-pbc" },
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
  assert.equal(output.verdict, "VIABLE");
  assert.ok(!output.signals.some((item) => item.label === "Bounty platform reports active competition"));
});

test("an untrusted user cannot forge an active platform status table", () => {
  const comments = [{
    body: "| Attempt | Started | Solution |\n| --- | --- | --- |\n| 🟢 @solver | Jul 21 | WIP |",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-5",
    created_at: "2026-07-20T10:00:00Z",
    user: { login: "algora-pbc[bot]" },
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
  assert.equal(output.verdict, "VIABLE");
});

test("maintainer AI-slop warning is a hard stop", () => {
  const comments = [{
    body: "Locking this issue as it is only attracting AI slop from bounty hunters.",
    author_association: "MEMBER",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-1",
    user: { login: "maintainer" }
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
  assert.equal(output.verdict, "AVOID");
  assert.equal(output.maintainerWarnings.length, 1);
});

test("a maintainer anti-spam rule does not reject valid bounty work", () => {
  const comments = [{
    body: "Spam submissions are rejected, but valid original work remains welcome for every open slot.",
    author_association: "OWNER",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-policy",
    user: { login: "maintainer" }
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
  assert.equal(output.verdict, "VIABLE");
  assert.equal(output.maintainerWarnings.length, 0);
});

test("Opire slash commands contribute to attempt competition", () => {
  const comments = ["alice", "bob", "carol"].map((login, index) => ({
    body: "/opire try",
    author_association: "NONE",
    html_url: `https://github.com/acme/widget/issues/4#issuecomment-opire-${index}`,
    user: { login },
  }));
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
  assert.ok(output.signals.some((item) => item.label === "Attempt swarm"));
});

test("recent natural-language claim intent makes a contested bounty cautionary", () => {
  const comments = [{
    body: "Please assign this issue to me.",
    created_at: "2026-07-18T12:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-alice",
    user: { login: "alice" },
  }, {
    body: "Let me fix this; I will send a tested patch.",
    created_at: "2026-07-19T12:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-bob",
    user: { login: "bob" },
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
  assert.equal(output.verdict, "CAUTION");
  assert.equal(output.score, 73);
  assert.deepEqual(output.claimantInterest.map(({ login }) => login).sort(), ["alice", "bob"]);
  assert.ok(output.signals.some((item) =>
    item.label === "Unconfirmed claimant interest" && item.impact === -20 && !item.hardStop
  ));
});

test("passive assignment requests and explicit PR promises count as claimant intent", () => {
  const comments = [{
    body: "I have experience with Express.js and I will submit PR within 2 days max.",
    created_at: "2026-07-21T23:25:26Z",
    user: { login: "alice" },
  }, {
    body: "Hi maintainer, can I be assigned this issue please?",
    created_at: "2026-07-22T00:23:10Z",
    user: { login: "bob" },
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
  assert.equal(output.verdict, "CAUTION");
  assert.deepEqual(output.claimantInterest.map(({ login }) => login).sort(), ["alice", "bob"]);
  assert.ok(output.signals.some((item) =>
    item.label === "Unconfirmed claimant interest" && item.impact === -20 && !item.hardStop
  ));
});

test("one active natural-language claimant can never remain viable", () => {
  const comments = [{
    body: "I will like to work on this issue.",
    created_at: "2026-07-19T12:00:00Z",
    user: { login: "alice" },
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
  assert.ok(output.score >= 75);
  assert.equal(output.verdict, "CAUTION");
  assert.deepEqual(output.claimantInterest.map(({ login }) => login), ["alice"]);
});

test("current claimant phrasing observed in live bounty cohorts is recognized", () => {
  const phrases = [
    "Allow me fix this asap.",
    "I can take this brand asset kit if it is still open.",
    "I would love to resolve this issue within a few hours.",
    "Kindly assign this issue to me.",
    "I really wanna word on this issue.",
  ];
  const comments = phrases.map((body, index) => ({
    body,
    created_at: `2026-07-19T12:0${index}:00Z`,
    user: { login: `claimant-${index}` },
  }));
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
  assert.equal(output.claimantInterest.length, phrases.length);
  assert.equal(output.verdict, "CAUTION");
});

test("a later withdrawal clears only that user's natural-language claim intent", () => {
  const comments = [{
    body: "I am working on this issue.",
    created_at: "2026-07-18T12:00:00Z",
    user: { login: "alice" },
  }, {
    body: "I claim this bounty.",
    created_at: "2026-07-18T13:00:00Z",
    user: { login: "bob" },
  }, {
    body: "I am no longer working on this issue.",
    created_at: "2026-07-19T12:00:00Z",
    user: { login: "alice" },
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
  assert.deepEqual(output.claimantInterest.map(({ login }) => login), ["bob"]);
  assert.ok(output.signals.some((item) => item.label === "Unconfirmed claimant interest" && item.impact === -10));
});

test("stale or ambiguous interest does not create a claimant signal", () => {
  const comments = [{
    body: "I am working on this issue.",
    created_at: "2026-05-01T12:00:00Z",
    user: { login: "stale-solver" },
  }, {
    body: "Let me know if I can help with testing.",
    created_at: "2026-07-19T12:00:00Z",
    user: { login: "helper" },
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
  assert.equal(output.verdict, "VIABLE");
  assert.equal(output.claimantInterest.length, 0);
  assert.ok(!output.signals.some((item) => item.label === "Unconfirmed claimant interest"));
});

test("a current heading-style claim honors an explicit repository soft lock", () => {
  const comments = [{
    body: "## Claim\n\nI am taking this implementation.",
    created_at: "2026-07-19T12:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-claim",
    user: { login: "solver" },
  }];
  const output = analyzeBounty({
    issue: { ...healthyIssue, body: `${healthyIssue.body}\nComment to claim a soft lock, 7 days.` },
    repository: healthyRepo,
    comments,
    now,
  });
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Active soft-lock claim" && item.hardStop));
});

test("a claimant withdrawal clears only that user's soft lock", () => {
  const comments = [{
    body: "/attempt #4",
    created_at: "2026-07-19T12:00:00Z",
    user: { login: "solver" },
  }, {
    body: "Withdrawing this claim before implementation.",
    created_at: "2026-07-20T08:00:00Z",
    user: { login: "solver" },
  }];
  const output = analyzeBounty({
    issue: { ...healthyIssue, body: `${healthyIssue.body}\nComment to claim a soft lock, 7 days.` },
    repository: healthyRepo,
    comments,
    now,
  });
  assert.equal(output.verdict, "VIABLE");
  assert.equal(output.activeClaims.length, 0);
});

test("an expired soft-lock claim no longer blocks the bounty", () => {
  const comments = [{
    body: "/attempt #4",
    created_at: "2026-07-01T12:00:00Z",
    user: { login: "solver" },
  }];
  const output = analyzeBounty({
    issue: { ...healthyIssue, body: `${healthyIssue.body}\nComment to claim a soft lock, 7 days.` },
    repository: healthyRepo,
    comments,
    now,
  });
  assert.equal(output.verdict, "VIABLE");
  assert.equal(output.activeClaims.length, 0);
});

test("truncated evidence can never establish a viable verdict", () => {
  const output = analyzeBounty({
    issue: healthyIssue,
    repository: healthyRepo,
    coverage: { commentsTruncated: true, timelineTruncated: true },
    now,
  });
  assert.equal(output.verdict, "CAUTION");
  assert.ok(output.signals.some((item) => item.label === "Evidence coverage is truncated"));
  assert.ok(!output.signals.some((item) => item.label === "No linked open PR found"));
});

test("withdrawn bounty is detected even when issue remains open", () => {
  const comments = [{
    body: "I have removed the $1000 bounty because the issue attracted duplicate PRs.",
    author_association: "NONE",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-2",
    user: { login: "sponsor" }
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
  assert.equal(output.verdict, "AVOID");
  assert.equal(output.withdrawals.length, 1);
});

test("linked competing PR reduces the verdict", () => {
  const timeline = [{
    event: "cross-referenced",
    source: { issue: { title: "Implement fix", state: "open", user: { login: "solver" }, pull_request: { html_url: "https://github.com/acme/widget/pull/9" } } }
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, timeline, now });
  assert.equal(output.verdict, "CAUTION");
  assert.equal(output.pullRequests.length, 1);
});

test("official repository policy can block AI-assisted bounty work", () => {
  const policyDocuments = [{
    body: "We do not accept contributions generated or assisted by AI or an LLM.",
    html_url: "https://github.com/acme/widget/blob/main/CONTRIBUTING.md"
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, policyDocuments, now });
  assert.equal(output.verdict, "AVOID");
  assert.equal(output.aiPolicyBlocks.length, 1);
  assert.ok(output.signals.some((item) => item.label === "Repository AI policy blocks the work" && item.hardStop));
});

test("official repository policy surfaces an AI disclosure requirement", () => {
  const policyDocuments = [{
    body: "Contributors must clearly disclose any generative AI assistance in the pull request.",
    html_url: "https://github.com/acme/widget/blob/main/CONTRIBUTING.md"
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, policyDocuments, now });
  assert.equal(output.verdict, "VIABLE");
  assert.equal(output.aiPolicyRequirements.length, 1);
  assert.ok(output.signals.some((item) => item.label === "AI-use disclosure required"));
});
