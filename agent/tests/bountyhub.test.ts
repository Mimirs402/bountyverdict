import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchBountyHubEvidence,
  hasBountyHubReference,
  parseBountyHubCollectionPage,
  parseBountyHubEvidence,
} from "../src/bountyhub.ts";

const record = {
  id: "5bd7b660-5c46-4686-bead-39a53699e98d",
  htmlURL: "https://github.com/microg/GmsCore/issues/2851",
  repositoryFullName: "microg/GmsCore",
  issueNumber: 2851,
  claimed: false,
  retracted: false,
  solved: false,
  totalAmount: "100.00",
  paymentStatus: "PAID",
  isFrozen: false,
  deletedAt: null,
  assignmentType: "open",
  assignee: null,
  pledges: [{
    id: "e6f823a6-da48-4896-82e0-8622fc018bb4",
    retracted: false,
    amount: "100.00",
    paymentStatus: "PAID",
    isPaid: false,
    deletedAt: null,
  }],
  claims: [],
};

test("detects only issue-specific BountyHub view references", () => {
  assert.equal(hasBountyHubReference({}, [{ body: "https://www.bountyhub.dev/en/bounty/view/5bd7b660-5c46-4686-bead-39a53699e98d" }]), true);
  assert.equal(hasBountyHubReference({ body: "https://bountyhub.dev/bounty/view/5bd7b660-5c46-4686-bead-39a53699e98d" }, []), true);
  assert.equal(hasBountyHubReference({ body: "https://www.bountyhub.dev/en/bounty/new" }, []), false);
});

test("parses one exact paid BountyHub listing without relabeling payout certainty", () => {
  assert.deepEqual(parseBountyHubCollectionPage({ data: [record], hasNextPage: false }, "microg", "GmsCore", 2851), {
    ids: [record.id],
    hasNextPage: false,
  });
  const evidence = parseBountyHubEvidence([record], "microg", "GmsCore", 2851);
  assert.deepEqual(evidence, {
    platform: "BountyHub",
    verification: "TRUSTED_PLATFORM_API",
    state: "OPEN",
    amount: 100,
    secured_amount: 100,
    promised_amount: 0,
    currency: "USD",
    funding_status: "PREPAID",
    evidence_url: "https://www.bountyhub.dev/en/bounty/view/5bd7b660-5c46-4686-bead-39a53699e98d",
  });
});

test("maps terminal and unavailable platform states conservatively", () => {
  for (const [patch, state] of [
    [{ claimed: true }, "CLAIMED"],
    [{ isFrozen: true }, "FROZEN"],
    [{ solved: true }, "SOLVED"],
    [{ retracted: true }, "RETRACTED"],
    [{ deletedAt: "2026-07-22T00:00:00Z" }, "RETRACTED"],
  ] as const) {
    const evidence = parseBountyHubEvidence([{ ...record, ...patch }], "microg", "GmsCore", 2851);
    assert.equal(evidence?.state, state);
  }
});

test("rejects ambiguous, paginated, or drifted BountyHub responses", () => {
  assert.equal(parseBountyHubEvidence([record, record], "microg", "GmsCore", 2851), null);
  assert.equal(parseBountyHubCollectionPage({ data: [record], hasNextPage: true }, "microg", "GmsCore", 2851)?.hasNextPage, true);
  assert.equal(parseBountyHubEvidence([{ ...record, pledges: [{ ...record.pledges[0], paymentStatus: "UNKNOWN" }] }], "microg", "GmsCore", 2851), null);
  assert.equal(parseBountyHubEvidence([{ ...record, htmlURL: "https://github.com/other/repo/issues/1" }], "microg", "GmsCore", 2851), null);
});

test("derives mixed funding from unique pledge-level detail instead of summary totals", () => {
  const promised = {
    ...record.pledges[0],
    id: "45900118-89e3-4efb-a651-2a46b69bd35a",
    amount: "100.00",
    paymentStatus: "PROMISED",
  };
  const evidence = parseBountyHubEvidence([{ ...record, totalAmount: "999.00", pledges: [
    { ...record.pledges[0], amount: "50.00" },
    promised,
  ] }], "microg", "GmsCore", 2851);
  assert.equal(evidence?.amount, 150);
  assert.equal(evidence?.secured_amount, 50);
  assert.equal(evidence?.promised_amount, 100);
  assert.equal(evidence?.funding_status, "MIXED");
});

test("deduplicates matching pledge IDs across exact records and rejects conflicts", () => {
  const secondRecord = {
    ...record,
    id: "8d2e8090-6fe6-4bfd-b66d-81d5ad8b61a2",
  };
  const evidence = parseBountyHubEvidence([record, secondRecord], "microg", "GmsCore", 2851);
  assert.equal(evidence?.amount, 100);
  assert.equal(evidence?.secured_amount, 100);
  assert.match(evidence?.evidence_url || "", /^https:\/\/api\.bountyhub\.dev\/api\/bounties\?/);

  const conflictingRecord = {
    ...secondRecord,
    pledges: [{ ...record.pledges[0], amount: "99.00" }],
  };
  assert.equal(parseBountyHubEvidence([record, conflictingRecord], "microg", "GmsCore", 2851), null);
});

test("uses one bounded repository-filtered public request and fails soft", async () => {
  const requests: URL[] = [];
  const evidence = await fetchBountyHubEvidence("microg", "GmsCore", 2851, async (input) => {
    const requested = new URL(String(input));
    requests.push(requested);
    return requested.pathname === "/api/bounties"
      ? Response.json({ data: [record], hasNextPage: false })
      : Response.json(record);
  });
  assert.equal(evidence?.state, "OPEN");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].origin, "https://api.bountyhub.dev");
  assert.equal(requests[0].pathname, "/api/bounties");
  assert.equal(requests[0].searchParams.get("page"), "1");
  assert.equal(requests[0].searchParams.get("limit"), "100");
  assert.deepEqual(JSON.parse(requests[0].searchParams.get("filters") || "{}"), { repositoryFullName: "microg/GmsCore" });
  assert.equal(requests[1].pathname, `/api/bounties/${record.id}`);

  assert.equal(await fetchBountyHubEvidence("microg", "GmsCore", 2851, async () =>
    Response.json({ message: "unavailable" }, { status: 503 })
  ), null);
});

test("follows bounded collection pagination before fetching exact details", async () => {
  const requests: URL[] = [];
  const evidence = await fetchBountyHubEvidence("microg", "GmsCore", 2851, async (input) => {
    const requested = new URL(String(input));
    requests.push(requested);
    if (requested.pathname === "/api/bounties") {
      return requested.searchParams.get("page") === "1"
        ? Response.json({ data: [], hasNextPage: true })
        : Response.json({ data: [record], hasNextPage: false });
    }
    return Response.json(record);
  });
  assert.equal(evidence?.amount, 100);
  assert.deepEqual(
    requests.filter((request) => request.pathname === "/api/bounties").map((request) => request.searchParams.get("page")),
    ["1", "2"],
  );
});
