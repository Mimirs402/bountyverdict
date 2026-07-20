import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_CATALOG,
  PRODUCT_KEYS,
  productForAtomicAmount,
} from "../src/product-catalog.ts";

test("product catalog has unique service, route, sample, and accounting price", () => {
  for (const field of ["service", "path", "samplePath", "priceUsd", "amountAtomic"] as const) {
    const values = PRODUCT_KEYS.map(product => PRODUCT_CATALOG[product][field]);
    assert.equal(new Set(values).size, values.length, `${field} must remain unique`);
  }
});

test("product catalog preserves all public payment contracts", () => {
  assert.deepEqual(PRODUCT_KEYS, ["single", "portfolio", "harness", "skill", "run", "flake"]);
  assert.equal(productForAtomicAmount(50_000n), "single");
  assert.equal(productForAtomicAmount(400_000n), "portfolio");
  assert.equal(productForAtomicAmount(30_000n), "harness");
  assert.equal(productForAtomicAmount(60_000n), "skill");
  assert.equal(productForAtomicAmount(40_000n), "run");
  assert.equal(productForAtomicAmount(70_000n), "flake");
  assert.equal(productForAtomicAmount(1n), null);
});
