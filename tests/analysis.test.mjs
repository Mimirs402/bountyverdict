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

test("terminal bounty lifecycle labels close an otherwise open issue", () => {
  for (const label of ["Delivered", "Bounty: Paid", "Reward - Settled", "Awarded", "Claimed", "Fulfilled", "Completed"]) {
    const output = analyzeBounty({
      issue: { ...healthyIssue, labels: [{ name: "bounty" }, { name: label }] },
      repository: healthyRepo,
      now,
    });
    assert.equal(output.reward.state, "PAID_OR_AWARDED", label);
    assert.equal(output.verdict, "AVOID", label);
    assert.ok(output.signals.some((item) => item.label === "Bounty has no open work slot" && item.hardStop), label);
  }

  for (const label of ["Delivery Pending", "Payment Pending", "Not Delivered"]) {
    const output = analyzeBounty({
      issue: { ...healthyIssue, labels: [{ name: "bounty" }, { name: label }] },
      repository: healthyRepo,
      now,
    });
    assert.equal(output.reward.state, "PROMISED", label);
    assert.ok(!output.signals.some((item) => item.label === "Bounty has no open work slot"), label);
  }
});

test("terminal lifecycle labels are cautionary when claim slots explicitly remain open", () => {
  for (const label of ["Claimed", "Delivered"]) {
    const output = analyzeBounty({
      issue: {
        ...healthyIssue,
        body: `${healthyIssue.body}\nSlots: 3 (2 open)`,
        labels: [{ name: "bounty" }, { name: label }],
      },
      repository: healthyRepo,
      now,
    });

    assert.equal(output.reward.state, "PROMISED", label);
    assert.equal(output.verdict, "CAUTION", label);
    assert.ok(output.signals.some((item) =>
      item.label === "Bounty lifecycle label coexists with open slots" && !item.hardStop
    ), label);
    assert.ok(!output.signals.some((item) => item.label === "Bounty has no open work slot"), label);
  }
});

test("a newer maintainer reopening supersedes an older closed-slot comment", () => {
  const comments = [{
    body: "Claim gate: closed.",
    author_association: "OWNER",
    created_at: "2026-07-20T08:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-closed",
    user: { login: "maintainer" },
  }, {
    body: "Reopened: two separate claim slots remain open.",
    author_association: "OWNER",
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-reopened",
    user: { login: "maintainer" },
  }];
  const output = analyzeBounty({
    issue: { ...healthyIssue, labels: [{ name: "bounty" }, { name: "Claimed" }] },
    repository: healthyRepo,
    comments,
    now,
  });

  assert.equal(output.reward.state, "PROMISED");
  assert.equal(output.verdict, "CAUTION");
  assert.ok(output.signals.some((item) =>
    item.label === "Bounty lifecycle label coexists with open slots" &&
    item.evidenceUrl === "https://github.com/acme/widget/issues/4#issuecomment-reopened"
  ));
  assert.ok(!output.signals.some((item) => item.label === "Bounty has no open work slot"));
});

test("a delivered external-platform mirror cannot remain viable", () => {
  const issue = {
    ...healthyIssue,
    title: "Frantic bounty #118: Vendor UX dogfood",
    body: "Frantic bounty #118\n\nWorker price: $1\nSlots: 2 (filled)\nStatus: delivered\n" +
      "Claim: https://gofrantic.com/bounties/118\n\nFrantic is the source of truth. This GitHub issue is a mirrored board thread.",
    labels: [{ name: "bounty" }, { name: "funded" }, { name: "delivered" }],
  };
  const comments = [{
    body: "Frantic accepted the delivery.",
    author_association: "OWNER",
    created_at: "2026-07-21T10:26:49Z",
    html_url: "https://github.com/auscaster/frantic-board/issues/320#issuecomment-accepted",
    user: { login: "auscaster" },
  }, {
    body: "Frantic paid one accepted claim.",
    author_association: "OWNER",
    created_at: "2026-07-21T10:46:12Z",
    html_url: "https://github.com/auscaster/frantic-board/issues/320#issuecomment-paid",
    user: { login: "auscaster" },
  }];
  const output = analyzeBounty({ issue, repository: healthyRepo, comments, now });

  assert.equal(output.reward.state, "PAID_OR_AWARDED");
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Bounty has no open work slot" && item.hardStop));
  assert.ok(output.signals.some((item) =>
    item.label === "External bounty platform requires separate verification" &&
    item.evidenceUrl === "https://gofrantic.com/bounties/118"
  ));
});

test("one accepted delivery is cautionary when separate slots remain open", () => {
  const comments = [{
    body: "We accepted the first delivery. Two separate claim slots remain open.",
    author_association: "OWNER",
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-accepted",
    user: { login: "maintainer" },
  }];
  const output = analyzeBounty({
    issue: { ...healthyIssue, body: `${healthyIssue.body}\nSlots: 3 (2 open)` },
    repository: healthyRepo,
    comments,
    now,
  });

  assert.equal(output.reward.state, "PROMISED");
  assert.equal(output.verdict, "CAUTION");
  assert.ok(output.signals.some((item) => item.label === "Maintainer reports accepted or paid work" && !item.hardStop));
  assert.ok(!output.signals.some((item) => item.label === "Bounty has no open work slot"));
});

test("affirmative terminal statements retain harmless modifiers", () => {
  for (const body of [
    "We accepted the delivery without revisions.",
    "Frantic paid one accepted claim without delay.",
    "Not only did we accept the delivery, we paid the claim.",
  ]) {
    const comments = [{
      body,
      author_association: "OWNER",
      created_at: "2026-07-20T10:00:00Z",
      html_url: "https://github.com/acme/widget/issues/4#issuecomment-terminal",
      user: { login: "maintainer" },
    }];
    const output = analyzeBounty({
      issue: { ...healthyIssue, body: `${healthyIssue.body}\nSlots: 2 (2 open)` },
      repository: healthyRepo,
      comments,
      now,
    });

    assert.equal(output.reward.state, "PROMISED", body);
    assert.equal(output.verdict, "CAUTION", body);
    assert.ok(output.signals.some((item) => item.label === "Maintainer reports accepted or paid work"), body);
  }
});

test("a future acceptance promise is not mistaken for completed work", () => {
  for (const body of [
    "We will accept the first delivery that satisfies the acceptance criteria. Two claim slots remain open.",
    "The accepted delivery will receive the advertised $100 after review.",
    "A paid bounty must have complete acceptance criteria before publication.",
    "No claim was paid; both slots remain open.",
    "No delivery was accepted; both slots remain open.",
    "No work was accepted; this bounty is still available.",
  ]) {
    const comments = [{
      body,
      author_association: "OWNER",
      created_at: "2026-07-20T10:00:00Z",
      html_url: "https://github.com/acme/widget/issues/4#issuecomment-future",
      user: { login: "maintainer" },
    }];
    const output = analyzeBounty({
      issue: { ...healthyIssue, body: `${healthyIssue.body}\nSlots: 2 (2 open)` },
      repository: healthyRepo,
      comments,
      now,
    });

    assert.equal(output.reward.state, "PROMISED", body);
    assert.equal(output.verdict, "VIABLE", body);
    assert.ok(!output.signals.some((item) => item.label === "Maintainer reports accepted or paid work"), body);
    assert.ok(!output.signals.some((item) => item.label === "Bounty has no open work slot"), body);
  }
});

test("a non-maintainer issue cannot supply closed capacity or an external platform source", () => {
  const output = analyzeBounty({
    issue: {
      ...healthyIssue,
      author_association: "NONE",
      body: `${healthyIssue.body}\nSlots: 2 (filled)\nStatus: delivered\nClaim: https://evil.example/phish\n` +
        "Evil is the source of truth. This issue is a mirrored board thread.",
    },
    repository: healthyRepo,
    now,
  });

  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Bounty issuer lacks repository authority"));
  assert.ok(!output.signals.some((item) => item.label === "Bounty has no open work slot"));
  assert.ok(!output.signals.some((item) => item.label === "External bounty platform requires separate verification"));
});

test("GitHub aliases and credential-bearing URLs are not external bounty platforms", () => {
  for (const claimUrl of [
    "https://www.github.com/acme/widget/issues/4",
    "https://github.com./acme/widget/issues/4",
    "https://user:pass@example.com/bounties/4",
  ]) {
    const output = analyzeBounty({
      issue: {
        ...healthyIssue,
        body: `${healthyIssue.body}\nClaim: ${claimUrl}\nAcme is the source of truth. This is a mirrored board thread.`,
      },
      repository: healthyRepo,
      now,
    });
    assert.ok(!output.signals.some((item) => item.label === "External bounty platform requires separate verification"), claimUrl);
  }
});

test("a generic delivered label is not a paid signal without bounty context", () => {
  const output = analyzeBounty({
    issue: {
      ...healthyIssue,
      title: "Publish documentation",
      body: "Publish the completed documentation package after final review with enough implementation detail for contributors.",
      labels: [{ name: "Delivered" }],
    },
    repository: healthyRepo,
    now,
  });
  assert.equal(output.reward.state, "NOT_FOUND");
  assert.ok(!output.signals.some((item) => item.label === "Bounty has no open work slot"));
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

test("a maintainer denial cannot masquerade as reward confirmation", () => {
  const comments = [{
    body: "This bounty will not be paid.",
    author_association: "MEMBER",
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-denial",
    user: { login: "maintainer" },
  }];
  const output = analyzeBounty({
    issue: { ...healthyIssue, author_association: "NONE", title: "$5,000 bounty", body: "Payable after this issue is solved." },
    repository: healthyRepo,
    comments,
    now,
  });

  assert.equal(output.reward.state, "WITHDRAWN");
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Reward withdrawal signal" && item.hardStop));
  assert.ok(!output.signals.some((item) => item.label === "Maintainer reward promise found"));
});

test("a maintainer-authored issue denial is a withdrawn reward hard stop", () => {
  const issue = {
    ...healthyIssue,
    body: `${healthyIssue.body}\n\nThis bounty will not be paid.`,
  };
  const output = analyzeBounty({ issue, repository: healthyRepo, now });

  assert.equal(output.reward.state, "WITHDRAWN");
  assert.equal(output.reward.verification, "MAINTAINER_STATEMENT");
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Reward withdrawal signal" && item.hardStop));
});

test("issue updated_at is never used as a body-edit timestamp", () => {
  const issue = {
    ...healthyIssue,
    body: `${healthyIssue.body}\n\nThis bounty will not be paid.`,
    updated_at: "2026-07-18T10:00:00Z",
  };
  const comments = [{
    body: "We restored this $100 bounty and will pay it after merge.",
    author_association: "OWNER",
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-restored",
  }];
  const output = analyzeBounty({ issue, repository: healthyRepo, comments, now });

  assert.equal(output.reward.state, "WITHDRAWN");
  assert.equal(output.verdict, "AVOID");
  assert.match(output.signals.find((item) => item.label === "Reward withdrawal signal")?.detail ?? "", /cannot establish when that text was edited/i);
});

test("a later maintainer confirmation supersedes an earlier withdrawal", () => {
  const comments = [{
    body: "We cancelled the bounty.",
    author_association: "MEMBER",
    created_at: "2026-07-19T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-withdrawn",
    user: { login: "maintainer" },
  }, {
    body: "We restored this $100 bounty and will pay the accepted contributor.",
    author_association: "MEMBER",
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-restored",
    user: { login: "maintainer" },
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });

  assert.equal(output.reward.state, "PROMISED");
  assert.equal(output.verdict, "VIABLE");
  assert.equal(output.withdrawals.length, 0);
});

test("same-comment restoration supersedes its historical cancellation clause", () => {
  const comments = [{
    body: "We cancelled the bounty yesterday, but restored it today. This $100 reward will be paid after acceptance.",
    author_association: "OWNER",
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-restored",
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });

  assert.equal(output.reward.state, "PROMISED");
  assert.equal(output.verdict, "VIABLE");
  assert.ok(!output.signals.some((item) => item.label === "Reward withdrawal signal"));
});

test("same-comment cancellation supersedes an earlier restoration clause", () => {
  const comments = [{
    body: "We restored the $100 bounty yesterday, but cancelled the bounty today.",
    author_association: "OWNER",
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-cancelled",
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });

  assert.equal(output.reward.state, "WITHDRAWN");
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Reward withdrawal signal" && item.hardStop));
});

test("negated or hypothetical restoration language cannot bypass denial", () => {
  const denials = [
    "We will not restore this $100 bounty. It will not be paid.",
    "We cannot restore this $100 bounty.",
    "Do not restore this $100 bounty; it remains cancelled.",
    "We discussed restoring the $100 bounty but decided not to.",
    "The $100 bounty has not been restored and will not be paid.",
    "We restored the $100 bounty yesterday, then withdrew it today.",
    "We restored the $100 bounty and it will be paid after merge, but later cancelled it.",
    "We restored the $100 bounty and it will be paid after merge, but then removed it.",
    "We restored the $100 bounty and it will be paid after merge, but decided to cancel it.",
    "We restored the $100 bounty and it will be paid after merge, but it is no longer available.",
  ];
  for (const body of denials) {
    const comments = [{
      body,
      author_association: "OWNER",
      created_at: "2026-07-20T10:00:00Z",
      html_url: "https://github.com/acme/widget/issues/4#issuecomment-denial",
    }];
    const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
    assert.equal(output.reward.state, "WITHDRAWN", body);
    assert.equal(output.verdict, "AVOID", body);
    assert.ok(output.signals.some((item) => item.label === "Reward withdrawal signal" && item.hardStop), body);
  }
});

test("a mirrored bounty requires checking its external source issue", () => {
  const output = analyzeBounty({
    issue: {
      ...healthyIssue,
      body: "### Source URL\nhttps://github.com/upstream/project/issues/77\n\n$500 reward for completing the copied task specification, including reproducible current behavior, expected behavior, implementation scope, tests, and acceptance criteria.",
    },
    repository: healthyRepo,
    now,
  });

  assert.equal(output.reward.state, "PROMISED");
  assert.equal(output.verdict, "CAUTION");
  assert.ok(output.signals.some((item) =>
    item.label === "External source issue requires separate verification" &&
    item.evidenceUrl === "https://github.com/upstream/project/issues/77"
  ));
});

test("a same-repository source link is not treated as a mirror", () => {
  const output = analyzeBounty({
    issue: {
      ...healthyIssue,
      body: "Original issue: https://github.com/acme/widget/issues/77\n\n$500 reward with a complete implementation specification.",
    },
    repository: healthyRepo,
    now,
  });

  assert.ok(!output.signals.some((item) => item.label === "External source issue requires separate verification"));
});

test("common source-issue and mirror labels are recognized", () => {
  for (const prefix of ["Source issue:", "Mirror of", "Mirrored from"]) {
    const output = analyzeBounty({
      issue: {
        ...healthyIssue,
        body: `${prefix} https://github.com/upstream/project/issues/77\n\n$500 bounty with complete acceptance criteria and a reproducible implementation scope.`,
      },
      repository: healthyRepo,
      now,
    });
    assert.ok(output.signals.some((item) => item.label === "External source issue requires separate verification"), prefix);
  }
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
    author_association: "MEMBER",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-2",
    user: { login: "maintainer" }
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });
  assert.equal(output.verdict, "AVOID");
  assert.equal(output.withdrawals.length, 1);
});

test("an untrusted commenter cannot forge a generic reward withdrawal", () => {
  const comments = [{
    body: "I cancelled this bounty.",
    author_association: "NONE",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-forged-withdrawal",
    user: { login: "random-user" },
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });

  assert.equal(output.reward.state, "PROMISED");
  assert.equal(output.verdict, "VIABLE");
  assert.equal(output.withdrawals.length, 0);
});

test("an authenticated platform rejection of the advertised amount is a hard stop", () => {
  const rejectedIssue = {
    ...healthyIssue,
    title: "Fix slice precedence",
    body: `${"A complete reproducible implementation specification and acceptance criteria. ".repeat(2)}\n<details><summary>This repo is using Opire - what does it mean?</summary>Everyone can add rewards commenting /reward 100.</details>`,
    labels: [{ name: "bounty" }, { name: "opire" }, { name: "$10" }],
  };
  const comments = [{
    body: "You cannot create a reward of $10. It needs to be at least $20.",
    author_association: "NONE",
    performed_via_github_app: { slug: "opirebot" },
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-opire-rejected",
    user: { login: "opirebot[bot]" },
  }];
  const output = analyzeBounty({ issue: rejectedIssue, repository: healthyRepo, comments, now });

  assert.equal(output.reward.state, "WITHDRAWN");
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) =>
    item.label === "Reward platform rejected listing" && item.hardStop
  ));
});

test("a failed Opire add-on cannot cancel an unrelated Algora listing", () => {
  const comments = [{
    body: "## 💎 $100 bounty • acme\nReceive payment after the accepted fix.",
    author_association: "NONE",
    performed_via_github_app: { slug: "algora-pbc" },
    created_at: "2026-07-19T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-algora",
    user: { login: "algora-pbc[bot]" },
  }, {
    body: "You cannot create a reward of $10. It needs to be at least $20.",
    author_association: "NONE",
    performed_via_github_app: { slug: "opirebot" },
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-opire-rejected",
    user: { login: "opirebot[bot]" },
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });

  assert.equal(output.reward.state, "LISTED");
  assert.equal(output.reward.platform, "Algora");
  assert.equal(output.verdict, "VIABLE");
  assert.ok(!output.signals.some((item) => item.label === "Reward platform rejected listing"));
});

test("a later authenticated Opire listing supersedes an earlier failed attempt", () => {
  const comments = [{
    body: "You cannot create a reward of $10. It needs to be at least $20.",
    author_association: "NONE",
    performed_via_github_app: { slug: "opirebot" },
    created_at: "2026-07-19T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-opire-rejected",
    user: { login: "opirebot[bot]" },
  }, {
    body: "@sponsor created a $20.00 reward using [Opire](https://opire.dev)",
    author_association: "NONE",
    performed_via_github_app: { slug: "opirebot" },
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-opire-listed",
    user: { login: "opirebot[bot]" },
  }];
  const output = analyzeBounty({ issue: { ...healthyIssue, author_association: "NONE" }, repository: healthyRepo, comments, now });

  assert.equal(output.reward.state, "LISTED");
  assert.equal(output.reward.platform, "Opire");
  assert.equal(output.reward.amount, 20);
  assert.ok(!output.signals.some((item) => item.label === "Bounty issuer lacks repository authority"));
  assert.ok(!output.signals.some((item) => item.label === "Reward platform rejected listing"));
});

test("authenticated Opire claim state makes an already-claimed reward unavailable", () => {
  const comments = [{
    body: "@sponsor created a $20.00 reward using [Opire](https://opire.dev)",
    author_association: "NONE",
    performed_via_github_app: { slug: "opirebot" },
    created_at: "2026-07-19T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-opire-listed",
    user: { login: "opirebot[bot]" },
  }, {
    body: "The user @solver has claimed all rewards for this issue.",
    author_association: "NONE",
    performed_via_github_app: { slug: "opirebot" },
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-opire-claimed",
    user: { login: "opirebot[bot]" },
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });

  assert.equal(output.reward.state, "PAID_OR_AWARDED");
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Bounty platform reports reward claimed" && item.hardStop));
});

test("an Opire claim cannot cancel an independent Algora listing", () => {
  const comments = [{
    body: "The user @solver has claimed all rewards for this issue.",
    author_association: "NONE",
    performed_via_github_app: { slug: "opirebot" },
    created_at: "2026-07-19T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-opire-claimed",
  }, {
    body: "## 💎 $250 bounty\nThe bounty is now up for grabs.",
    author_association: "NONE",
    performed_via_github_app: { slug: "algora-pbc" },
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-algora-listed",
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });

  assert.equal(output.reward.state, "LISTED");
  assert.equal(output.reward.platform, "Algora");
  assert.equal(output.verdict, "VIABLE");
  assert.ok(!output.signals.some((item) => item.label === "Bounty platform reports reward claimed"));
});

test("authenticated Opire empty state blocks an Opire-bound maintainer promise", () => {
  const issue = {
    ...healthyIssue,
    body: `${healthyIssue.body}\n<details><summary>This repo is using Opire - what does it mean?</summary></details>`,
  };
  const comments = [{
    body: "This issue does not have any reward yet!",
    author_association: "NONE",
    performed_via_github_app: { slug: "opirebot" },
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-opire-empty",
  }];
  const output = analyzeBounty({ issue, repository: healthyRepo, comments, now });

  assert.equal(output.reward.state, "NOT_FOUND");
  assert.equal(output.reward.verification, "TRUSTED_PLATFORM_APP");
  assert.equal(output.reward.platform, "Opire");
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Reward platform reports no current reward" && item.hardStop));
});

test("a maintainer cannot confirm a bounty by disclaiming ownership or authorization", () => {
  const comments = [{
    body: "A user mentioned a $100 bounty, but that bounty is not ours and we do not authorize it.",
    author_association: "MEMBER",
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-disclaimer",
  }];
  const output = analyzeBounty({
    issue: { ...healthyIssue, author_association: "NONE" },
    repository: healthyRepo,
    comments,
    now,
  });

  assert.equal(output.reward.state, "WITHDRAWN");
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Reward withdrawal signal" && item.hardStop));
});

test("a maintainer-authored issue disclaimer is terminal denial authority", () => {
  const issue = {
    ...healthyIssue,
    body: `${healthyIssue.body}\n\nA user mentioned a $100 bounty, but that bounty is not ours and we do not authorize it.`,
  };
  const output = analyzeBounty({ issue, repository: healthyRepo, now });

  assert.equal(output.reward.state, "WITHDRAWN");
  assert.equal(output.reward.verification, "MAINTAINER_STATEMENT");
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Reward withdrawal signal" && item.hardStop));
});

test("Opire rejection binding considers every advertised dollar amount", () => {
  const issue = {
    ...healthyIssue,
    title: "Fix $100 invoice bug",
    body: `${"A complete reproducible implementation specification and acceptance criteria. ".repeat(2)}\n<details><summary>This repo is using Opire - what does it mean?</summary></details>`,
    labels: ["opire", "$10"],
  };
  const comments = [{
    body: "You cannot create a reward of $10. It needs to be at least $20.",
    author_association: "NONE",
    performed_via_github_app: { slug: "opirebot" },
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-opire-rejected",
  }];
  const output = analyzeBounty({ issue, repository: healthyRepo, comments, now });

  assert.equal(output.reward.state, "WITHDRAWN");
  assert.equal(output.reward.amount, 10);
  assert.equal(output.verdict, "AVOID");
  assert.ok(output.signals.some((item) => item.label === "Reward platform rejected listing" && item.hardStop));
});

test("authenticated Opire rejection overrides an Opire-bound maintainer promise", () => {
  const issue = {
    ...healthyIssue,
    title: "[Opire bounty $10] Fix widget",
    labels: ["opire", "$10"],
  };
  const comments = [{
    body: "You cannot create a reward of $10. It needs to be at least $20.",
    author_association: "NONE",
    performed_via_github_app: { slug: "opirebot" },
    created_at: "2026-07-20T10:00:00Z",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-opire-rejected",
  }];
  const output = analyzeBounty({ issue, repository: healthyRepo, comments, now });

  assert.equal(output.reward.state, "WITHDRAWN");
  assert.equal(output.reward.verification, "TRUSTED_PLATFORM_APP");
  assert.equal(output.verdict, "AVOID");
});

test("Opire installation boilerplate alone is not a reward promise", () => {
  const issue = {
    ...healthyIssue,
    title: "Make MCP timeouts cancellation-safe",
    body: `${"A complete reproducible implementation specification and acceptance criteria. ".repeat(2)}\n<details><summary>This repo is using Opire - what does it mean?</summary>Everyone can add rewards commenting /reward 100.</details>`,
  };
  const output = analyzeBounty({ issue, repository: healthyRepo, now });

  assert.equal(output.reward.state, "NOT_FOUND");
  assert.equal(output.verdict, "CAUTION");
  assert.ok(!output.signals.some((item) => item.label === "Maintainer reward promise found"));
});

test("an untrusted commenter cannot forge a platform reward rejection", () => {
  const comments = [{
    body: "You cannot create a reward of $10. It needs to be at least $20.",
    author_association: "NONE",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-untrusted-rejection",
    user: { login: "random-user" },
  }];
  const output = analyzeBounty({ issue: healthyIssue, repository: healthyRepo, comments, now });

  assert.equal(output.verdict, "VIABLE");
  assert.ok(!output.signals.some((item) => item.label === "Reward platform rejected listing"));
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
