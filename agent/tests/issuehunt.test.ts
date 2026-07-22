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
  const pageProps = {
    repository: { ownerName: owner, name: repo, githubId: String(repositoryId) },
    issue: {
      repositoryOwnerName: owner,
      repositoryName: repo,
      repositoryGithubId: String(repositoryId),
      number: issueNumber,
      status: "funded",
      depositAmount: 4000,
    },
    deposits: [{ _id: "5d82dd50a64b4b0068bae8f4", amount: "4000", cancelled: false }],
    anonymousDeposits: [],
    organizationGithubIdBalanceAmountEntries: [],
    pullRequests: [{
      _id: "5d8371ed874954009a39fe83",
      cancelled: false,
      url: "https://github.com/acme/widget/pull/12",
      repositoryOwnerName: owner,
      repositoryName: repo,
      number: 12,
    }],
    depositRequests: [],
    ...overrides,
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

test("parses exact funded IssueHunt SSR evidence and submitted outputs", () => {
  assert.deepEqual(parseIssueHuntPage(html(payload()), owner, repo, repositoryId, issueNumber), {
    platform: "IssueHunt",
    verification: "TRUSTED_PLATFORM_API",
    state: "FUNDED",
    amount: 40,
    currency: "USD",
    evidence_url: "https://oss.issuehunt.io/r/acme/widget/issues/4",
    submitted_pull_requests: ["https://github.com/acme/widget/pull/12"],
  });
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
      status: "funded",
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
    state: "FUNDED",
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
      _id: "5d82dd50a64b4b0068bae8f4",
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
      _id: "5d8371ed874954009a39fe83",
      cancelled: true,
      url: "https://github.com/acme/widget/pull/12",
      repositoryOwnerName: owner,
      repositoryName: repo,
      number: 12,
    }],
  });
  const result = parseIssueHuntPage(html(value), owner, repo, repositoryId, issueNumber);
  assert.equal(result?.state, "REWARDED");
  assert.deepEqual(result?.submitted_pull_requests, []);
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
