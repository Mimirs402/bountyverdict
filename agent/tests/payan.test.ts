import assert from "node:assert/strict";
import test from "node:test";
import { PAYAN_OFFERS, PAYAN_PROVIDER_ID } from "../src/payan.ts";

test("PayanAgent offers preserve the six frozen products and direct prices", () => {
  assert.match(PAYAN_PROVIDER_ID, /^[a-z0-9]{20,64}$/);
  assert.deepEqual(PAYAN_OFFERS.map(({ product }) => product).sort(), [
    "flake", "harness", "mcpdrift", "portfolio", "run", "single",
  ]);
  assert.deepEqual(Object.fromEntries(PAYAN_OFFERS.map(({ product, priceCents }) => [product, priceCents])), {
    single: 5,
    portfolio: 40,
    harness: 3,
    run: 4,
    flake: 7,
    mcpdrift: 2,
  });
  for (const offer of PAYAN_OFFERS) {
    assert.equal(offer.offerType, "api");
    assert.equal(offer.httpMethod, "POST");
    assert.ok(offer.tags.length <= 10);
    assert.doesNotThrow(() => JSON.parse(offer.inputSchema));
    assert.doesNotThrow(() => JSON.parse(offer.outputSchema));
    assert.match(offer.endpoint, /^https:\/\/bountyverdict-agent-production\.mimirslab\.workers\.dev\/api\/near-market\//);
  }
});

