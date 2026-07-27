import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchOpireEvidence,
  parseOpireEvidence,
  parseOpireSearch,
} from "../src/opire.ts";

const ISSUE_ID = "01J8T24PJDXX69RM7XV24SQT11";
const REWARD_ID = "01KKEPHJSWQ2X1SRQ6K888WYPP";
const CREATOR_ID = "01KKEKSTRBVYZR6VEWJQQNRWXB";
const CLAIMANT_ID = "01KMZ4AG0VGXAQJKZ6BA6GHB34";
const ISSUE_URL = "https://github.com/denoland/deno/issues/18147";

const searchEntry = {
  id: ISSUE_ID,
  title: "feat: view test coverage in editor",
  url: ISSUE_URL,
};

const detail = {
  id: ISSUE_ID,
  platform: "GitHub",
  platformId: "1620326273",
  issueURL: ISSUE_URL,
  isClosed: false,
  isDeleted: false,
  project: {
    platform: "GitHub",
    platformId: "133442384",
    name: "deno",
    url: "https://github.com/denoland/deno",
  },
  rewards: [{
    id: REWARD_ID,
    price: { value: 7_000, unit: "USD_CENT" },
    commentURL: ISSUE_URL,
    creatorId: CREATOR_ID,
    rewardedUserId: null,
    status: "Available",
  }],
  usersTrying: [CLAIMANT_ID],
  usersClaiming: [CLAIMANT_ID],
};

test("Opire search binds one exact canonical GitHub issue", () => {
  assert.equal(parseOpireSearch([searchEntry], "denoland", "deno", 18147), ISSUE_ID);
  assert.equal(parseOpireSearch([{ ...searchEntry, url: `${ISSUE_URL}?ref=bad` }], "denoland", "deno", 18147), null);
  assert.equal(parseOpireSearch([searchEntry, searchEntry], "denoland", "deno", 18147), null);
});

test("Opire detail preserves available USD and active solver counts", () => {
  const paidReward = {
    ...detail.rewards[0],
    id: "01KKEPHJSWQ2X1SRQ6K888WYPQ",
    status: "Paid",
    rewardedUserId: CLAIMANT_ID,
  };
  assert.deepEqual(
    parseOpireEvidence(
      { ...detail, rewards: [...detail.rewards, paidReward] },
      ISSUE_ID,
      "denoland",
      "deno",
      18147,
      1_620_326_273,
      133_442_384,
    ),
    {
      platform: "Opire",
      verification: "TRUSTED_PLATFORM_API",
      state: "OPEN",
      amount: 70,
      currency: "USD",
      claim_count: 1,
      try_count: 1,
      evidence_url: `https://app.opire.dev/issues/${ISSUE_ID}`,
    },
  );
});

test("Opire detail fails closed on route, identity, status, and duplicate drift", () => {
  const cases = [
    { ...detail, issueURL: "https://github.com/other/repo/issues/18147" },
    { ...detail, platformId: "999" },
    { ...detail, project: { ...detail.project, platformId: "999" } },
    { ...detail, rewards: [{ ...detail.rewards[0], status: "Unknown" }] },
    { ...detail, rewards: [{ ...detail.rewards[0], rewardedUserId: CLAIMANT_ID }] },
    { ...detail, usersClaiming: [CLAIMANT_ID, CLAIMANT_ID] },
  ];
  for (const value of cases) {
    assert.equal(
      parseOpireEvidence(value, ISSUE_ID, "denoland", "deno", 18147, 1_620_326_273, 133_442_384),
      null,
    );
  }
});

test("Opire fetch uses bounded public search and exact detail routes", async () => {
  const requested: string[] = [];
  const result = await fetchOpireEvidence(
    "denoland",
    "deno",
    18147,
    1_620_326_273,
    133_442_384,
    async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/api/backend/rewards?")) return Response.json([searchEntry]);
      if (url.endsWith(`/api/backend/issues/${ISSUE_ID}`)) return Response.json(detail);
      return new Response(null, { status: 404 });
    },
  );
  assert.equal(result?.amount, 70);
  assert.equal(requested.length, 2);
  assert.match(requested[0], /^https:\/\/app\.opire\.dev\/api\/backend\/rewards\?search=deno$/);
  assert.equal(requested[1], `https://app.opire.dev/api/backend/issues/${ISSUE_ID}`);
});
