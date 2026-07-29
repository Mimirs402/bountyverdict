import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_CATALOG,
  PRODUCT_KEYS,
  LEGACY_GET_PATHS,
  productForAtomicAmount,
  productForTransport,
} from "../src/product-catalog.ts";

test("product catalog has unique service, route, sample, and accounting price", () => {
  for (const field of ["service", "path", "samplePath", "priceUsd", "amountAtomic"] as const) {
    const values = PRODUCT_KEYS.map(product => PRODUCT_CATALOG[product][field]);
    assert.equal(new Set(values).size, values.length, `${field} must remain unique`);
  }
});

test("canonical POST and GET compatibility transports remain one accounting product", () => {
  const transports = [
    ["single", "/api/bounty-preflight", "/api/verdict"],
    ["harness", "/api/repository-agent-instructions-audit", "/api/harness"],
    ["run", "/api/github-actions-run-diagnosis", "/api/run"],
    ["flake", "/api/github-actions-flake-retry-gate", "/api/flake"],
  ] as const;

  for (const [product, canonicalPath, legacyPath] of transports) {
    assert.equal(PRODUCT_CATALOG[product].path, canonicalPath);
    assert.equal(PRODUCT_CATALOG[product].method, "POST");
    assert.equal(LEGACY_GET_PATHS[product], legacyPath);
    assert.equal(productForTransport(canonicalPath, "POST"), product);
    assert.equal(productForTransport(legacyPath, "GET"), product);
    assert.equal(
      productForTransport(canonicalPath, "GET"),
      product === "single" ? "single" : null,
    );
    assert.equal(productForTransport(legacyPath, "POST"), null);
    assert.equal(productForTransport(canonicalPath, "PUT"), null);
  }
  assert.equal(PRODUCT_CATALOG.skill.path, "/api/skill");
  assert.equal(PRODUCT_CATALOG.skill.method, "POST");
  assert.equal(productForTransport("/api/skill", "POST"), "skill");
  assert.equal(productForTransport("/api/skill", "GET"), "skill");
});

test("product catalog preserves all public payment contracts", () => {
  assert.deepEqual(PRODUCT_KEYS, ["single", "portfolio", "harness", "skill", "run", "flake", "mcpdrift"]);
  assert.equal(productForAtomicAmount(50_000n), "single");
  assert.equal(productForAtomicAmount(400_000n), "portfolio");
  assert.equal(productForAtomicAmount(30_000n), "harness");
  assert.equal(productForAtomicAmount(60_000n), "skill");
  assert.equal(productForAtomicAmount(40_000n), "run");
  assert.equal(productForAtomicAmount(70_000n), "flake");
  assert.equal(productForAtomicAmount(20_000n), "mcpdrift");
  assert.equal(productForAtomicAmount(1n), null);
});
