import test from "node:test";
import assert from "node:assert/strict";
import { validatePaymentChallenge } from "../src/payment-safety.ts";

function challenge(amount: string, network = "eip155:84532") {
  const asset = network === "eip155:8453"
    ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    : "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  return {
    x402Version: 2,
    accepts: [{
      amount,
      network,
      asset,
      payTo: "0x0000000000000000000000000000000000000001",
    }],
  };
}

test("payment safety enforces the atomic price cap", () => {
  assert.throws(
    () => validatePaymentChallenge(challenge("50001"), {
      maximumAtomic: 50_000n,
      executePayment: true,
      allowMainnet: false,
    }),
    /exceeds safety cap/,
  );
});

test("payment safety rejects unexpected networks and assets", () => {
  const options = { maximumAtomic: 50_000n, executePayment: false, allowMainnet: false };
  assert.throws(
    () => validatePaymentChallenge(challenge("50000", "eip155:1"), options),
    /Unsupported payment network/,
  );
  const wrongAsset = challenge("50000");
  wrongAsset.accepts[0].asset = "0x0000000000000000000000000000000000000002";
  assert.throws(
    () => validatePaymentChallenge(wrongAsset, options),
    /canonical USDC/,
  );
});

test("payment safety rejects ambiguous challenges with multiple options", () => {
  const ambiguous = challenge("50000");
  ambiguous.accepts.push({ ...ambiguous.accepts[0] });
  assert.throws(
    () => validatePaymentChallenge(ambiguous, {
      maximumAtomic: 50_000n,
      executePayment: false,
      allowMainnet: false,
    }),
    /exactly one accepted payment option/,
  );
});

test("payment safety rejects non-v2 challenges", () => {
  const legacy = challenge("50000");
  legacy.x402Version = 1;
  assert.throws(
    () => validatePaymentChallenge(legacy, {
      maximumAtomic: 50_000n,
      executePayment: false,
      allowMainnet: false,
    }),
    /x402 version 2/,
  );
});

test("mainnet can be inspected but cannot be paid accidentally", () => {
  assert.equal(validatePaymentChallenge(challenge("50000", "eip155:8453"), {
    maximumAtomic: 50_000n,
    executePayment: false,
    allowMainnet: false,
  }).network, "eip155:8453");

  assert.throws(
    () => validatePaymentChallenge(challenge("50000", "eip155:8453"), {
      maximumAtomic: 50_000n,
      executePayment: true,
      allowMainnet: false,
    }),
    /Mainnet payment refused/,
  );
});
