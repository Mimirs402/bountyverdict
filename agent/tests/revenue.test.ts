import test from "node:test";
import assert from "node:assert/strict";
import {
  KNOWN_NON_REVENUE_TX_HASHES,
  HARNESS_PAYMENT_ATOMIC,
  FLAKE_PAYMENT_ATOMIC,
  OWNER_CONTROLLED_CANARY_PAYER,
  SKILL_PAYMENT_ATOMIC,
  PORTFOLIO_PAYMENT_ATOMIC,
  SINGLE_PAYMENT_ATOMIC,
  RUN_PAYMENT_ATOMIC,
  summarizeRevenue,
} from "../src/revenue.ts";

const CUSTOMER_PAYER = "0x1111111111111111111111111111111111111111";

test("revenue summary recognizes only exact product settlements", () => {
  const summary = summarizeRevenue([
    { from: CUSTOMER_PAYER, amount: SINGLE_PAYMENT_ATOMIC, transaction_hash: "0x1", log_index: 0 },
    { from: CUSTOMER_PAYER, amount: PORTFOLIO_PAYMENT_ATOMIC, transaction_hash: "0x2", log_index: 0 },
    { from: CUSTOMER_PAYER, amount: HARNESS_PAYMENT_ATOMIC, transaction_hash: "0x4", log_index: 0 },
    { from: CUSTOMER_PAYER, amount: SKILL_PAYMENT_ATOMIC, transaction_hash: "0x5", log_index: 0 },
    { from: CUSTOMER_PAYER, amount: RUN_PAYMENT_ATOMIC, transaction_hash: "0x6", log_index: 0 },
    { from: CUSTOMER_PAYER, amount: FLAKE_PAYMENT_ATOMIC, transaction_hash: "0x7", log_index: 0 },
    { from: CUSTOMER_PAYER, amount: 10_000_000n, transaction_hash: "0x3", log_index: 0 },
  ]);

  assert.equal(summary.recognized_usdc, "0.65");
  assert.equal(summary.remaining_usdc, "999.35");
  assert.equal(summary.progress_percent, 0.065);
  assert.deepEqual(summary.purchases, { single: 1, portfolio: 1, harness: 1, skill: 1, run: 1, flake: 1, total: 6 });
  assert.equal(summary.unrecognized_transfers.length, 1);
  assert.equal(summary.canary_transfers.length, 0);
  assert.equal(summary.canary_usdc, "0");
  assert.equal(summary.excluded_transfers.length, 0);
});

test("revenue summary excludes the owner-funded production proofs", () => {
  const proofAmounts = [SINGLE_PAYMENT_ATOMIC, PORTFOLIO_PAYMENT_ATOMIC, HARNESS_PAYMENT_ATOMIC, SKILL_PAYMENT_ATOMIC, RUN_PAYMENT_ATOMIC];
  const proofs = KNOWN_NON_REVENUE_TX_HASHES.map((transaction_hash, index) => ({
    from: OWNER_CONTROLLED_CANARY_PAYER,
    amount: proofAmounts[index]!,
    transaction_hash,
    log_index: index,
  }));
  const customer = {
    from: CUSTOMER_PAYER,
    amount: SINGLE_PAYMENT_ATOMIC,
    transaction_hash: "0xcustomer",
    log_index: 1,
  };
  const summary = summarizeRevenue([...proofs, customer]);

  assert.equal(summary.recognized_usdc, "0.05");
  assert.deepEqual(summary.purchases, { single: 1, portfolio: 0, harness: 0, skill: 0, run: 0, flake: 0, total: 1 });
  assert.deepEqual(summary.excluded_transfers, proofs);
  assert.deepEqual(summary.recognized_transfers, [customer]);
  assert.deepEqual(summary.canary_transfers, []);
});

test("owner-controlled canary payer is excluded case-insensitively without hiding customer purchases", () => {
  const ownerCanary = {
    from: OWNER_CONTROLLED_CANARY_PAYER.toUpperCase(),
    amount: SINGLE_PAYMENT_ATOMIC,
    transaction_hash: "0xcanary",
    log_index: 0,
  };
  const ownerCanaryUnrelatedAmount = {
    from: OWNER_CONTROLLED_CANARY_PAYER.toLowerCase(),
    amount: 1_234_567n,
    transaction_hash: "0xcanary-other",
    log_index: 1,
  };
  const customerAtSamePrice = {
    from: CUSTOMER_PAYER,
    amount: SINGLE_PAYMENT_ATOMIC,
    transaction_hash: "0xcustomer-same-price",
    log_index: 0,
  };
  const unrelatedIncoming = {
    from: "0x2222222222222222222222222222222222222222",
    amount: 1_234_567n,
    transaction_hash: "0xunrelated",
    log_index: 0,
  };

  const summary = summarizeRevenue([
    ownerCanary,
    ownerCanaryUnrelatedAmount,
    customerAtSamePrice,
    unrelatedIncoming,
  ]);

  assert.equal(summary.recognized_usdc, "0.05");
  assert.equal(summary.remaining_usdc, "999.95");
  assert.deepEqual(summary.purchases, { single: 1, portfolio: 0, harness: 0, skill: 0, run: 0, flake: 0, total: 1 });
  assert.equal(summary.canary_usdc, "1.284567");
  assert.deepEqual(summary.canary_transfers, [ownerCanary, ownerCanaryUnrelatedAmount]);
  assert.deepEqual(summary.recognized_transfers, [customerAtSamePrice]);
  assert.deepEqual(summary.unrecognized_transfers, [unrelatedIncoming]);
  assert.deepEqual(summary.excluded_transfers, []);
});

test("a provisioned settlement buyer can be explicitly excluded from customer revenue", () => {
  const provisionedBuyer = "0x3333333333333333333333333333333333333333";
  const canary = {
    from: provisionedBuyer.toUpperCase(),
    amount: FLAKE_PAYMENT_ATOMIC,
    transaction_hash: "0xprovisioned-canary",
    log_index: 0,
  };
  const customer = {
    from: CUSTOMER_PAYER,
    amount: FLAKE_PAYMENT_ATOMIC,
    transaction_hash: "0xreal-customer",
    log_index: 0,
  };

  const summary = summarizeRevenue(
    [canary, customer],
    undefined,
    [OWNER_CONTROLLED_CANARY_PAYER, provisionedBuyer],
  );

  assert.equal(summary.recognized_usdc, "0.07");
  assert.equal(summary.canary_usdc, "0.07");
  assert.deepEqual(summary.canary_transfers, [canary]);
  assert.deepEqual(summary.recognized_transfers, [customer]);
});

test("revenue progress stops at zero remaining after the target", () => {
  const transfers = Array.from({ length: 2_500 }, (_, index) => ({
    from: CUSTOMER_PAYER,
    amount: PORTFOLIO_PAYMENT_ATOMIC,
    transaction_hash: `0x${index}`,
    log_index: 0,
  }));
  const summary = summarizeRevenue(transfers);

  assert.equal(summary.recognized_usdc, "1000");
  assert.equal(summary.remaining_usdc, "0");
  assert.equal(summary.progress_percent, 100);
});
