import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchAlgoraEvidence,
  hasTrustedAlgoraReference,
  parseAlgoraSponsorPage,
} from "../src/algora.ts";

const canonical = { owner: "newco", repo: "gadget", number: 4 };
const submitted = { owner: "acme", repo: "widget", number: 4 };
const bountyId = "cliq08aod000cl60fo6yqmsu2";

function row(overrides: {
  id?: string;
  amount?: string;
  issueUrl?: string;
  claims?: number;
} = {}): string {
  return `<tr>
    <td>
      <div class="font-extrabold text-emerald-300">$${overrides.amount ?? "100"}</div>
      <a href="${overrides.issueUrl ?? "https://github.com/acme/widget/issues/4"}"
        class="group/issue inline-flex flex-col">Issue</a>
    </td>
    <td>
      <div phx-click="toggle-claims" phx-value-id="${overrides.id ?? bountyId}">
        <div>${overrides.claims ?? 1} claim</div>
      </div>
    </td>
  </tr>`;
}

const legacyComment = {
  body: `💎 **$100** bounty created by @McPizza0
👉 To claim this bounty, https://console.algora.io/bounties/${bountyId}
🙏 Thank you for contributing to acme/widget!`,
  performed_via_github_app: null,
  user: { id: 136125894, login: "algora-pbc", type: "User" },
};
const legacyBotComment = {
  body: `## 💎 $200 bounty [• Gyroflow](https://algora.io/gyroflow)
Thank you for contributing to gyroflow/gyroflow!`,
  performed_via_github_app: null,
  user: { id: 121443259, login: "algora-pbc[bot]", type: "Bot" },
};

test("parses a transfer-safe Algora sponsor row and exposes active claims", () => {
  const result = parseAlgoraSponsorPage(
    `<table>${row()}</table>`,
    "McPizza0",
    [canonical, submitted],
    bountyId,
  );
  assert.deepEqual(result, {
    platform: "Algora",
    verification: "TRUSTED_PLATFORM_API",
    state: "CLAIMED",
    amount: 100,
    currency: "USD",
    claim_count: 1,
    bounty_ids: [bountyId],
    bounty_records: [{ bounty_id: bountyId, amount: 100, claim_count: 1 }],
  });
});

test("rejects wrong routes, ambiguous rows, malformed amounts, and excessive pages", () => {
  assert.equal(parseAlgoraSponsorPage(
    `<table>${row({ issueUrl: "https://github.com/other/project/issues/4" })}</table>`,
    "McPizza0",
    [canonical, submitted],
    bountyId,
  ), null);
  assert.equal(parseAlgoraSponsorPage(
    `<table>${row()}${row({ amount: "101" })}</table>`,
    "McPizza0",
    [canonical, submitted],
    bountyId,
  ), null);
  assert.equal(parseAlgoraSponsorPage(
    `<table>${row({ amount: "0" })}</table>`,
    "McPizza0",
    [canonical, submitted],
    bountyId,
  ), null);
  assert.equal(parseAlgoraSponsorPage(
    `<table>${row().repeat(101)}</table>`,
    "McPizza0",
    [canonical, submitted],
    bountyId,
  ), null);
  assert.equal(parseAlgoraSponsorPage(
    "x".repeat(1_000_001),
    "McPizza0",
    [canonical, submitted],
    bountyId,
  ), null);
});

test("requires immutable legacy actor identity plus the exact console bounty reference", () => {
  assert.equal(hasTrustedAlgoraReference([legacyComment]), true);
  assert.equal(hasTrustedAlgoraReference([{
    ...legacyComment,
    user: { ...legacyComment.user, id: 1 },
  }]), false);
  assert.equal(hasTrustedAlgoraReference([{
    ...legacyComment,
    body: "💎 **$100** bounty created by @McPizza0",
  }]), false);
  assert.equal(hasTrustedAlgoraReference([{
    ...legacyComment,
    performed_via_github_app: { slug: "untrusted" },
  }]), false);
});

test("recognizes the immutable legacy Algora app bot and still binds the exact issue row", async () => {
  assert.equal(hasTrustedAlgoraReference([legacyBotComment]), true);
  assert.equal(hasTrustedAlgoraReference([{
    ...legacyBotComment,
    user: { ...legacyBotComment.user, id: 1 },
  }]), false);
  const requested: string[] = [];
  const result = await fetchAlgoraEvidence(
    [legacyBotComment],
    { owner: "gyroflow", repo: "gyroflow", number: 150 },
    { owner: "gyroflow", repo: "gyroflow", number: 150 },
    async (input) => {
      requested.push(String(input));
      return new Response(`<table>${row({
        id: "clmtxwkem0018lb0ghxnjrmjz",
        amount: "200",
        claims: 4,
        issueUrl: "https://github.com/gyroflow/gyroflow/issues/150",
      })}</table>`, { headers: { "content-type": "text/html" } });
    },
  );
  assert.deepEqual(requested, ["https://algora.io/gyroflow/bounties?status=open"]);
  assert.equal(result?.verification, "TRUSTED_PLATFORM_API");
  assert.equal(result?.state, "CLAIMED");
  assert.equal(result?.amount, 200);
  assert.equal(result?.claim_count, 4);
  assert.deepEqual(result?.bounty_ids, ["clmtxwkem0018lb0ghxnjrmjz"]);
});

test("fetches one exact official sponsor page and binds a submitted pre-transfer route", async () => {
  const requested: string[] = [];
  const result = await fetchAlgoraEvidence(
    [legacyComment],
    canonical,
    submitted,
    async (input) => {
      requested.push(String(input));
      return new Response(`<table>${row()}</table>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  );
  assert.deepEqual(requested, ["https://algora.io/McPizza0/bounties?status=open"]);
  assert.deepEqual(result, {
    platform: "Algora",
    verification: "TRUSTED_PLATFORM_API",
    state: "CLAIMED",
    amount: 100,
    currency: "USD",
    claim_count: 1,
    bounty_ids: [bountyId],
    evidence_url: "https://algora.io/McPizza0/bounties?status=open",
    completeness: "discovered_trusted_sponsor_records",
  });
});

test("does not trust a login-only actor or a sponsor page bound to another issue", async () => {
  const loginOnly = { ...legacyComment, user: { login: "algora-pbc", type: "User", id: 1 } };
  assert.equal(await fetchAlgoraEvidence(
    [loginOnly],
    canonical,
    submitted,
    async () => {
      throw new Error("must not fetch");
    },
  ), null);
  assert.equal(await fetchAlgoraEvidence(
    [legacyComment],
    canonical,
    submitted,
    async () => new Response(
      `<table>${row({ issueUrl: "https://github.com/other/project/issues/4" })}</table>`,
      { headers: { "content-type": "text/html" } },
    ),
  ), null);
});
