import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchIssueHuntEvidence,
  hasIssueHuntReference,
  issueHuntReferenceRoutes,
  parseIssueHuntPage,
} from "../src/issuehunt.ts";

const owner = "acme";
const repo = "widget";
const repositoryId = 123456;
const issueNumber = 4;

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const repositoryObjectId = "4d82dd50a64b4b0068bae8f4";
  const issueObjectId = "5d82dd50a64b4b0068bae8f3";
  const pullRequestObjectId = "5d8371ed874954009a39fe83";
  const rewardObjectId = "7d8371ed874954009a39fe83";
  const issueOverride = typeof overrides.issue === "object" && overrides.issue !== null &&
      !Array.isArray(overrides.issue)
    ? overrides.issue as Record<string, unknown>
    : {};
  const mergedIssue = {
    _id: issueObjectId,
    repositoryOwnerName: owner,
    repositoryName: repo,
    repositoryGithubId: String(repositoryId),
    number: issueNumber,
    status: "rewarded",
    depositAmount: 4000,
    rewardedAt: "2026-07-01T12:00:00.006Z",
    ...issueOverride,
  };
  const gross = Number(mergedIssue.depositAmount);
  const fee = Math.floor(gross * 0.1);
  const repositoryReward = Math.floor(gross * 0.2);
  const userReward = gross - fee - repositoryReward;
  const reward = {
    _id: rewardObjectId,
    repository: repositoryObjectId,
    issue: issueObjectId,
    pullRequest: pullRequestObjectId,
    repositoryPercentge: 20,
    feePercentage: 10,
    amount: String(gross),
    feeAmount: String(fee),
    repositoryRewardAmount: String(repositoryReward),
    userRewardAmount: String(userReward),
    createdAt: "2026-07-01T12:00:00.000Z",
  };
  const { issue: _issue, ...remainingOverrides } = overrides;
  const pageProps = {
    repository: { _id: repositoryObjectId, ownerName: owner, name: repo, githubId: String(repositoryId) },
    issue: mergedIssue,
    deposits: [{ _id: "5d82dd50a64b4b0068bae8f4", amount: "4000", cancelled: false }],
    anonymousDeposits: [],
    organizationGithubIdBalanceAmountEntries: [],
    pullRequests: [{
      _id: pullRequestObjectId,
      cancelled: false,
      url: "https://github.com/acme/widget/pull/12",
      repositoryOwnerName: owner,
      repositoryName: repo,
      number: 12,
      reward: rewardObjectId,
    }],
    reward,
    events: [{
      __t: "RewardEvent",
      type: "Reward",
      _id: "8d8371ed874954009a39fe83",
      createdAt: "2026-07-01T12:00:00.050Z",
      rewardId: rewardObjectId,
      repositoryId: repositoryObjectId,
      repositoryOwnerName: owner,
      repositoryName: repo,
      repositoryGithubId: String(repositoryId),
      issueId: issueObjectId,
      issueNumber,
      amount: reward.amount,
      feeAmount: reward.feeAmount,
      repositoryRewardAmount: reward.repositoryRewardAmount,
      userRewardAmount: reward.userRewardAmount,
    }],
    depositRequests: [],
    ...remainingOverrides,
  };
  return {
    props: {
      pageProps,
      route: {
        pathname: "/issues/show",
        query: { repositoryOwnerName: owner, repositoryName: repo, issueNumber: String(issueNumber) },
        asPath: `/r/${owner}/${repo}/issues/${issueNumber}`,
      },
    },
    page: "/issues/show",
    query: { repositoryOwnerName: owner, repositoryName: repo, issueNumber: String(issueNumber) },
  };
}

function html(value: unknown): string {
  return `<html><script>__NEXT_DATA__ = ${JSON.stringify(value)};__NEXT_LOADED_PAGES__ = []</script></html>`;
}

function mutatedPayload(mutate: (page: Record<string, unknown>) => void): Record<string, unknown> {
  const value = payload();
  const props = value.props as Record<string, unknown>;
  const page = props.pageProps as Record<string, unknown>;
  mutate(page);
  return value;
}

test("parses exact terminal rewarded IssueHunt SSR evidence and submitted outputs", () => {
  assert.deepEqual(parseIssueHuntPage(html(payload()), owner, repo, repositoryId, issueNumber), {
    platform: "IssueHunt",
    verification: "TRUSTED_PLATFORM_API",
    state: "REWARDED",
    amount: 40,
    currency: "USD",
    evidence_url: "https://oss.issuehunt.io/r/acme/widget/issues/4",
    submitted_pull_requests: ["https://github.com/acme/widget/pull/12"],
  });
});

test("requires a complete identity-bound reward proof chain for terminal records", () => {
  const cases = [
    mutatedPayload((page) => { delete page.reward; }),
    mutatedPayload((page) => {
      (page.reward as Record<string, unknown>).issue = "6d82dd50a64b4b0068bae8f3";
    }),
    mutatedPayload((page) => {
      const pulls = page.pullRequests as Array<Record<string, unknown>>;
      pulls[0].reward = "6d8371ed874954009a39fe83";
    }),
    mutatedPayload((page) => {
      (page.reward as Record<string, unknown>).userRewardAmount = "2799";
    }),
    mutatedPayload((page) => { page.events = []; }),
    mutatedPayload((page) => {
      const events = page.events as Array<Record<string, unknown>>;
      page.events = [events[0], { ...events[0], _id: "9d8371ed874954009a39fe83" }];
    }),
  ];

  for (const value of cases) {
    assert.equal(parseIssueHuntPage(html(value), owner, repo, repositoryId, issueNumber), null);
  }
});

test("classifies identity-bound funded or ready SSR accounting as active but unverified", () => {
  for (const status of ["funded", "ready"]) {
    const value = payload({
      issue: {
        repositoryOwnerName: owner,
        repositoryName: repo,
        repositoryGithubId: String(repositoryId),
        number: issueNumber,
        status,
        depositAmount: 4000,
      },
    });
    assert.deepEqual(parseIssueHuntPage(html(value), owner, repo, repositoryId, issueNumber), {
      platform: "IssueHunt",
      verification: "UNVERIFIED",
      state: "ACTIVE_UNVERIFIED",
      amount: null,
      currency: null,
      evidence_url: "https://oss.issuehunt.io/r/acme/widget/issues/4",
      submitted_pull_requests: ["https://github.com/acme/widget/pull/12"],
    });
  }
});

test("does not mistake a zero-dollar deposit request for funded evidence", () => {
  const value = payload({
    issue: {
      repositoryOwnerName: owner,
      repositoryName: repo,
      repositoryGithubId: String(repositoryId),
      number: issueNumber,
      status: "idle",
      depositAmount: 0,
    },
    deposits: [],
    depositRequests: [{ amount: 10_000, status: "idle" }],
  });
  assert.equal(parseIssueHuntPage(html(value), owner, repo, repositoryId, issueNumber), null);
});

test("fails closed on identity, aggregate, duplicate, and unknown funding drift", () => {
  const cases = [
    payload({ repository: { ownerName: owner, name: repo, githubId: "999" } }),
    payload({ deposits: [{ _id: "5d82dd50a64b4b0068bae8f4", amount: "3999", cancelled: false }] }),
    payload({ anonymousDeposits: [{ _id: "5d82dd50a64b4b0068bae8f4", amount: "4000", cancelled: false }] }),
    payload({ organizationGithubIdBalanceAmountEntries: [{ amount: "4000" }] }),
    payload({ pullRequests: [
      {
        _id: "5d8371ed874954009a39fe83",
        cancelled: false,
        url: "https://github.com/acme/widget/pull/12",
        repositoryOwnerName: owner,
        repositoryName: repo,
        number: 12,
      },
      {
        _id: "6d8371ed874954009a39fe83",
        cancelled: false,
        url: "https://github.com/acme/widget/pull/12",
        repositoryOwnerName: owner,
        repositoryName: repo,
        number: 12,
      },
    ] }),
  ];
  for (const value of cases) {
    assert.equal(parseIssueHuntPage(html(value), owner, repo, repositoryId, issueNumber), null);
  }
});

test("includes bounded anonymous deposits without retaining funder identity", () => {
  const value = payload({
    issue: {
      repositoryOwnerName: owner,
      repositoryName: repo,
      repositoryGithubId: String(repositoryId),
      number: issueNumber,
      status: "rewarded",
      depositAmount: 5000,
    },
    anonymousDeposits: [{
      _id: "6d82dd50a64b4b0068bae8f4",
      amount: "1000",
      cancelled: false,
      email: "must-not-be-returned@example.test",
    }],
  });
  assert.deepEqual(parseIssueHuntPage(html(value), owner, repo, repositoryId, issueNumber), {
    platform: "IssueHunt",
    verification: "TRUSTED_PLATFORM_API",
    state: "REWARDED",
    amount: 50,
    currency: "USD",
    evidence_url: "https://oss.issuehunt.io/r/acme/widget/issues/4",
    submitted_pull_requests: ["https://github.com/acme/widget/pull/12"],
  });
});

test("cancelled, duplicate, malformed, and over-capacity anonymous deposits fail closed", () => {
  const cancelled = {
    _id: "6d82dd50a64b4b0068bae8f4",
    amount: "1000",
    cancelled: true,
  };
  const cases = [
    payload({
      issue: {
        repositoryOwnerName: owner,
        repositoryName: repo,
        repositoryGithubId: String(repositoryId),
        number: issueNumber,
        status: "funded",
        depositAmount: 5000,
      },
      anonymousDeposits: [cancelled],
    }),
    payload({ anonymousDeposits: [{
      _id: "5D82DD50A64B4B0068BAE8F4",
      amount: "1000",
      cancelled: false,
    }] }),
    payload({ anonymousDeposits: [{
      _id: "6d82dd50a64b4b0068bae8f4",
      amount: "10.00",
      cancelled: false,
    }] }),
    payload({ anonymousDeposits: Array.from({ length: 20 }, (_, index) => ({
      _id: `${(index + 1).toString(16).padStart(24, "0")}`,
      amount: "1",
      cancelled: false,
    })) }),
  ];
  for (const value of cases) {
    assert.equal(parseIssueHuntPage(html(value), owner, repo, repositoryId, issueNumber), null);
  }
});

test("ignores cancelled submissions and recognizes terminal rewarded state", () => {
  const value = payload({
    issue: {
      repositoryOwnerName: owner,
      repositoryName: repo,
      repositoryGithubId: String(repositoryId),
      number: issueNumber,
      status: "rewarded",
      depositAmount: 4000,
    },
    pullRequests: [{
      _id: "6d8371ed874954009a39fe83",
      cancelled: true,
      url: "https://github.com/acme/widget/pull/11",
      repositoryOwnerName: owner,
      repositoryName: repo,
      number: 11,
    }, {
      _id: "5d8371ed874954009a39fe83",
      cancelled: false,
      url: "https://github.com/acme/widget/pull/12",
      repositoryOwnerName: owner,
      repositoryName: repo,
      number: 12,
      reward: "7d8371ed874954009a39fe83",
    }],
  });
  const result = parseIssueHuntPage(html(value), owner, repo, repositoryId, issueNumber);
  assert.equal(result?.state, "REWARDED");
  assert.deepEqual(result?.submitted_pull_requests, ["https://github.com/acme/widget/pull/12"]);
});

test("fetches only bounded HTML without redirects and fails soft", async () => {
  let observedInit: RequestInit | undefined;
  const result = await fetchIssueHuntEvidence(owner, repo, repositoryId, issueNumber, async (input, init) => {
    assert.equal(String(input), "https://oss.issuehunt.io/r/acme/widget/issues/4");
    observedInit = init;
    return new Response(html(payload()), { headers: { "content-type": "text/html; charset=utf-8" } });
  });
  assert.equal(result?.amount, 40);
  assert.equal(observedInit?.redirect, "error");

  const wrongType = await fetchIssueHuntEvidence(owner, repo, repositoryId, issueNumber, async () =>
    Response.json(payload())
  );
  assert.equal(wrongType, null);
  const oversized = await fetchIssueHuntEvidence(owner, repo, repositoryId, issueNumber, async () =>
    new Response("x", { headers: { "content-type": "text/html", "content-length": "1000001" } })
  );
  assert.equal(oversized, null);
});

test("uses only exact IssueHunt links or the exact funded label as fetch triggers", () => {
  assert.equal(hasIssueHuntReference({ labels: [{ name: "Funded on Issuehunt" }] }, []), true);
  assert.equal(hasIssueHuntReference({ body: "https://oss.issuehunt.io/r/acme/widget/issues/4" }, []), true);
  assert.equal(hasIssueHuntReference({ body: "issuehunt might fund this later" }, []), false);
});

test("extracts a bounded set of exact same-issue IssueHunt routes", () => {
  const routes = issueHuntReferenceRoutes({
    body: [
      "https://issuehunt.io/r/old-owner/widget/issues/4",
      "https://oss.issuehunt.io/r/old-owner/widget/issues/4",
      "https://issuehunt.io/r/acme/other/issues/5",
    ].join(" "),
  }, [{ body: "https://issuehunt.io/r/second-owner/widget.js/issues/4" }], 4);
  assert.deepEqual(routes, [
    { owner: "old-owner", repo: "widget", number: 4 },
    { owner: "second-owner", repo: "widget.js", number: 4 },
  ]);
  assert.deepEqual(issueHuntReferenceRoutes({ body: "https://issuehunt.io/r/acme/widget/issues/4" }, [], 5), []);
});
