import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchLightningBountiesEvidence,
  parseLightningBountiesListingPage,
  parseLightningBountiesRewards,
  type LightningBountiesIssueRoute,
} from "../src/lightning-bounties.ts";

const githubIssueId = 4_727_309_482;
const canonicalRoute = { owner: "PrimalHQ", repo: "primal-ios-app", number: 206 };
const submittedRoute = { owner: "old-primal", repo: "ios", number: 206 };
const routes: LightningBountiesIssueRoute[] = [canonicalRoute, submittedRoute];
const now = new Date("2026-08-01T12:00:00Z");

const record = {
  created_at: "2026-06-23T17:43:23.127896Z",
  modified_at: "2026-06-23T17:43:23.127896Z",
  id: "9035b808-41cf-4d64-b251-f0871cd0dd20",
  repository_id: "1eb2d4eb-eee0-4188-bfb4-d17ae9b41b0d",
  github_id: githubIssueId,
  issue_number: 206,
  title: "Feature: Translate posts",
  html_url: "https://github.com/PrimalHQ/primal-ios-app/issues/206",
  is_closed: false,
  winner_id: null,
  claimed_at: null,
  repository_data: {
    id: "1eb2d4eb-eee0-4188-bfb4-d17ae9b41b0d",
    full_name: "PrimalHQ/primal-ios-app",
  },
  winner_data: null,
  total_rewards: 1,
  total_reward_sats: 50_000,
  unlocked_total_rewards: 0,
  unexpired_total_rewards: 50_000,
};

const reward = {
  created_at: "2026-06-23T17:43:23.127896",
  modified_at: "2026-06-23T17:43:23.127896",
  id: "79d438e3-518d-4ec1-9c6f-b3a384399886",
  issue_id: record.id,
  rewarder_id: "87d0b35b-9b2a-44ff-a5e5-e62b63a9daaf",
  reward_sats: 50_000,
  unlocks_at: "2026-08-23T17:43:22.427000Z",
  expires_at: null,
  is_anonymous: false,
  issue_data: {
    id: record.id,
    issue_number: 206,
    title: "Feature: Translate posts",
    is_closed: false,
  },
};

function page(records: unknown[], extraScripts = ""): string {
  const payload = `8:${JSON.stringify(["$", "main", null, { issues: records }])}`;
  return `<html><body>${extraScripts}<script>self.__next_f.push(${JSON.stringify([1, payload])})</script></body></html>`;
}

test("uses the listing page only to identify and reconcile the platform issue", () => {
  const bootstrap = "<script>(self.__next_f=self.__next_f||[]).push([0]);self.__next_f.push([2,null])</script>";
  assert.deepEqual(parseLightningBountiesListingPage(page([record], bootstrap), githubIssueId, routes), {
    platform_issue_id: record.id,
    state: "OPEN",
    total_rewards: 1,
    total_reward_sats: 50_000,
    unexpired_total_rewards: 50_000,
  });
});

test("uses exact unlock times instead of a stale aggregate unlocked total", () => {
  const listing = parseLightningBountiesListingPage(page([record]), githubIssueId, routes);
  assert.ok(listing);
  const evidence = parseLightningBountiesRewards([{
    ...reward,
    unlocks_at: "2026-07-23T17:43:22.427000Z",
  }], listing, now);
  assert.deepEqual(evidence, {
    platform: "Lightning Bounties",
    verification: "TRUSTED_PLATFORM_API",
    state: "OPEN",
    amount: 50_000,
    secured_amount: 0,
    reclaimable_amount: 50_000,
    currency: "SATS",
    evidence_url: "https://app.lightningbounties.com/",
  });
});

test("separates exact locked and reclaimable rewards", () => {
  const listing = {
    platform_issue_id: record.id,
    state: "OPEN" as const,
    total_rewards: 2,
    total_reward_sats: 80_000,
    unexpired_total_rewards: 80_000,
  };
  const evidence = parseLightningBountiesRewards([
    { ...reward, reward_sats: 50_000 },
    {
      ...reward,
      id: "f30f8e24-51fd-46ae-8ba7-a8d3f547ad74",
      reward_sats: 30_000,
      unlocks_at: "2026-07-23T17:43:22.427000Z",
    },
  ], listing, now);
  assert.equal(evidence?.amount, 80_000);
  assert.equal(evidence?.secured_amount, 50_000);
  assert.equal(evidence?.reclaimable_amount, 30_000);
});

test("recognizes only a consistent awarded record as terminal", () => {
  const winnerId = "4f7e48ca-54db-4c14-bd95-e635a0973994";
  const listing = parseLightningBountiesListingPage(page([{
    ...record,
    is_closed: true,
    winner_id: winnerId,
    claimed_at: "2026-07-20T12:00:00Z",
    winner_data: { id: winnerId },
  }]), githubIssueId, routes);
  assert.ok(listing);
  const evidence = parseLightningBountiesRewards([{
    ...reward,
    issue_data: { ...reward.issue_data, is_closed: true },
  }], listing, now);
  assert.equal(evidence?.state, "AWARDED");
});

test("accepts an exact pre-transfer route only with the immutable GitHub issue ID", () => {
  const transferred = {
    ...record,
    html_url: "https://github.com/old-primal/ios/issues/206",
    repository_data: {
      id: record.repository_id,
      full_name: "old-primal/ios",
    },
  };
  assert.equal(
    parseLightningBountiesListingPage(page([transferred]), githubIssueId, routes)?.platform_issue_id,
    record.id,
  );
  assert.equal(
    parseLightningBountiesListingPage(page([{ ...transferred, github_id: 999 }]), githubIssueId, routes),
    null,
  );
});

test("fails closed on route, identity, totals, and terminal-state drift", () => {
  const winnerId = "4f7e48ca-54db-4c14-bd95-e635a0973994";
  const cases = [
    { ...record, html_url: "https://github.com/other/repo/issues/206" },
    { ...record, html_url: `${record.html_url}?ref=feed` },
    { ...record, repository_id: "not-a-uuid" },
    { ...record, repository_data: { ...record.repository_data, full_name: "other/repo" } },
    { ...record, issue_number: 207 },
    { ...record, total_rewards: 0 },
    { ...record, total_reward_sats: 49_999 },
    { ...record, unexpired_total_rewards: 40_000, unlocked_total_rewards: 40_001 },
    { ...record, unexpired_total_rewards: 0 },
    { ...record, winner_id: winnerId },
    { ...record, claimed_at: "2026-07-20T12:00:00Z" },
    { ...record, is_closed: true, winner_id: winnerId, claimed_at: "next Tuesday" },
    { ...record, is_closed: true },
  ];
  for (const value of cases) {
    assert.equal(parseLightningBountiesListingPage(page([value]), githubIssueId, routes), null);
  }
});

test("deduplicates identical RSC records and rejects conflicting duplicates", () => {
  assert.equal(
    parseLightningBountiesListingPage(page([record, record]), githubIssueId, routes)?.total_reward_sats,
    50_000,
  );
  assert.equal(
    parseLightningBountiesListingPage(page([
      record,
      { ...record, unlocked_total_rewards: 1 },
    ]), githubIssueId, routes),
    null,
  );
  assert.equal(
    parseLightningBountiesListingPage(page([
      record,
      { ...record, id: "f30f8e24-51fd-46ae-8ba7-a8d3f547ad74" },
    ]), githubIssueId, routes),
    null,
  );
});

test("rejects malformed or over-capacity RSC evidence", () => {
  assert.equal(parseLightningBountiesListingPage(
    "<script>self.__next_f.push([1,\"unterminated\"]</script>",
    githubIssueId,
    routes,
  ), null);
  assert.equal(parseLightningBountiesListingPage(
    page(Array.from({ length: 101 }, (_, index) => ({
      ...record,
      github_id: githubIssueId + index + 1,
      id: `9035b808-41cf-4d64-b251-f0871cd0dd20`,
    }))),
    githubIssueId,
    routes,
  ), null);
  assert.equal(parseLightningBountiesListingPage("x".repeat(1_000_001), githubIssueId, routes), null);
  assert.equal(parseLightningBountiesListingPage(page([record]), githubIssueId, []), null);
  assert.equal(parseLightningBountiesListingPage(
    page([record]),
    githubIssueId,
    [null as unknown as LightningBountiesIssueRoute],
  ), null);
});

test("fails closed when exact rewards are expired, malformed, duplicated, or inconsistent", () => {
  const listing = {
    platform_issue_id: record.id,
    state: "OPEN" as const,
    total_rewards: 1,
    total_reward_sats: 50_000,
    unexpired_total_rewards: 50_000,
  };
  const cases = [
    [],
    [{ ...reward, issue_id: "f30f8e24-51fd-46ae-8ba7-a8d3f547ad74" }],
    [{ ...reward, reward_sats: 49_999 }],
    [{ ...reward, unlocks_at: "soon" }],
    [{ ...reward, expires_at: "2026-08-02T00:00:00Z" }],
    [{ ...reward, issue_data: { ...reward.issue_data, is_closed: true } }],
  ];
  for (const value of cases) assert.equal(parseLightningBountiesRewards(value, listing, now), null);
  assert.equal(parseLightningBountiesRewards([reward, reward], {
    ...listing,
    total_rewards: 2,
    total_reward_sats: 100_000,
    unexpired_total_rewards: 100_000,
  }, now), null);
  assert.equal(parseLightningBountiesRewards([{
    ...reward,
    expires_at: "2026-07-31T00:00:00Z",
  }], { ...listing, unexpired_total_rewards: 0 }, now), null);
});

test("fetches one bounded HTML page without redirects and fails soft", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const evidence = await fetchLightningBountiesEvidence(githubIssueId, routes, async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    return url === "https://app.lightningbounties.com/"
      ? new Response(page([record]), { headers: { "content-type": "text/html; charset=utf-8" } })
      : Response.json([reward]);
  }, now);
  assert.equal(evidence?.secured_amount, 50_000);
  assert.equal(requests[0].url, "https://app.lightningbounties.com/");
  assert.equal(requests[0].init?.redirect, "error");
  assert.equal(requests[1].url,
    `https://app.lightningbounties.com/api/rewards/?issue_id=${record.id}&skip=0&limit=100`);
  assert.equal(requests[1].init?.redirect, "error");

  assert.equal(await fetchLightningBountiesEvidence(githubIssueId, routes, async () =>
    Response.json({ issues: [record] })
  ), null);
  assert.equal(await fetchLightningBountiesEvidence(githubIssueId, routes, async () =>
    new Response("x", {
      headers: { "content-type": "text/html", "content-length": "1000001" },
    })
  ), null);
  assert.equal(await fetchLightningBountiesEvidence(githubIssueId, routes, async () => {
    throw new Error("unavailable");
  }), null);
  assert.equal(await fetchLightningBountiesEvidence(githubIssueId, routes, async (input) =>
    String(input) === "https://app.lightningbounties.com/"
      ? new Response(page([record]), { headers: { "content-type": "text/html" } })
      : new Response("not-json", { headers: { "content-type": "application/json" } })
  ), null);
});
