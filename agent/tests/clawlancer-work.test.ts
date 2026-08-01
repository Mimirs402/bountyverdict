import assert from "node:assert/strict";
import test from "node:test";
import {
  clawlancerWorkAction,
  parseClawlancerTransaction,
  parseClawlancerWorkState,
} from "../src/clawlancer-work.ts";

const raw = (state = "PENDING", overrides: Record<string, unknown> = {}) => ({
  id: "817ed407-c033-4acf-b6f9-7be5b41ec58e",
  listing_id: "e2c25cd3-1641-4bd5-951f-ee163c820b5a",
  amount_wei: 10000,
  currency: "USDC",
  state,
  tx_hash: null,
  release_tx_hash: null,
  escrow_id: null,
  oracle_funded: true,
  reconciled: false,
  contract_version: 1,
  deadline: "2026-07-28T08:30:55.170Z",
  buyer: { wallet_address: "0x6b3b8b8026475890f3c4d153cb712fc83e6b997d" },
  seller: { wallet_address: "0xe5e0fe496b7283032d034dc79c305b384ad1ee67" },
  ...overrides,
});

test("Clawlancer work gate maps every platform state to one bounded action", () => {
  assert.equal(clawlancerWorkAction(parseClawlancerTransaction(raw("PENDING"))), "wait_for_funding");
  assert.equal(clawlancerWorkAction(parseClawlancerTransaction(raw("FUNDED"))), "submit_work");
  assert.equal(clawlancerWorkAction(parseClawlancerTransaction(raw("DELIVERED"))), "wait_for_release");
  assert.equal(clawlancerWorkAction(parseClawlancerTransaction(raw("RELEASED"))), "verify_release");
  assert.equal(clawlancerWorkAction(parseClawlancerTransaction(raw("REFUNDED"))), "terminal");
  assert.equal(clawlancerWorkAction(parseClawlancerTransaction(raw("DISPUTED"))), "terminal");
});

test("Clawlancer transaction parsing fails closed on money and identity drift", () => {
  assert.throws(() => parseClawlancerTransaction(raw("FUNDED", { amount_wei: 0 })), /amount/);
  assert.throws(() => parseClawlancerTransaction(raw("FUNDED", { currency: "ETH" })), /currency/);
  assert.throws(() => parseClawlancerTransaction(raw("FUNDED", { seller: { wallet_address: "not-an-address" } })), /seller address/);
  assert.throws(() => parseClawlancerTransaction(raw("UNKNOWN")), /state/);
});

test("Clawlancer persisted state reconciles transaction, action, and accounting", () => {
  const transaction = parseClawlancerTransaction(raw("PENDING"));
  const state = {
    schema_version: 2,
    status: "pending",
    checked_at: "2026-07-21T08:49:28.936Z",
    action: "wait_for_funding",
    submitted_now: false,
    read_only: true,
    external_actions_enabled: false,
    delivery_disabled: true,
    transaction,
    artifact: {
      path: "/home/mcr/notes/clawlancer/mimir-reliability-intro.md",
      sha256: "d212237abd908763276b51baf45efd1421ba9d21eb816ffe7083e60f5432695b",
    },
    accounting: "no_released_payment_not_revenue",
  };
  assert.equal(parseClawlancerWorkState(state).transaction.amountAtomic, "10000");
  assert.equal(parseClawlancerWorkState(state).deliveryDisabled, true);
  assert.throws(() => parseClawlancerWorkState({ ...state, action: "submit_work" }), /status or action/);
  assert.throws(() => parseClawlancerWorkState({ ...state, accounting: "release_reported_but_not_onchain_verified_not_revenue" }), /accounting/);
  assert.throws(() => parseClawlancerWorkState({ ...state, external_actions_enabled: true }), /mutation boundary/);
  assert.throws(() => parseClawlancerWorkState({ ...state, submitted_now: true }), /cannot submit/);
});
