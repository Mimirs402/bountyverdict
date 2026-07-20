import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDiscoveryExtension, validateDiscoveryExtensionSpec } from "@x402/extensions/bazaar";
import {
  FLAKE_SERVICE_REUSE,
  flakeDiscoveryExtension,
  flakeExample,
  flakeOutputSchema,
} from "../src/flake-discovery.ts";

function assertObjectSchemasAreClosed(schema: unknown, path = "output"): void {
  if (!schema || typeof schema !== "object") return;
  const record = schema as Record<string, unknown>;
  if (record.type === "object" || record.properties) {
    assert.equal(record.additionalProperties, false, `${path} must reject undeclared fields`);
  }
  if (record.properties && typeof record.properties === "object") {
    for (const [name, child] of Object.entries(record.properties)) {
      assertObjectSchemasAreClosed(child, `${path}.${name}`);
    }
  }
  if (record.items) assertObjectSchemasAreClosed(record.items, `${path}[]`);
}

test("FlakeVerdict publishes valid strict GET discovery metadata", () => {
  const extension = flakeDiscoveryExtension.bazaar;
  const querySchema = extension.schema.properties.input.properties.queryParams;
  assert.equal(extension.info.input.method, "GET");
  assert.deepEqual(querySchema.required, ["run_url"]);
  assert.equal(querySchema.properties.attempt.minimum, 1);
  assert.equal(querySchema.properties.attempt.maximum, undefined);
  assert.equal(querySchema.additionalProperties, false);
  assert.deepEqual(validateDiscoveryExtensionSpec(extension), { valid: true });
  assert.deepEqual(validateDiscoveryExtension(extension), { valid: true });
  assert.ok(
    JSON.stringify(flakeDiscoveryExtension).length < 7_000,
    "Bazaar metadata must leave room under common HTTP header limits",
  );
});

test("FlakeVerdict output contract is closed and exposes all retry-gate verdicts", () => {
  assertObjectSchemasAreClosed(flakeOutputSchema);
  assert.deepEqual(flakeOutputSchema.properties.verdict.enum, [
    "CONFIRMED_FLAKE",
    "LIKELY_FLAKE",
    "RECURRING_FAILURE",
    "NEW_FAILURE",
    "INCONCLUSIVE",
    "NOT_FAILED",
  ]);
  assert.deepEqual(flakeOutputSchema.properties.decision.properties.retry.enum, ["ONCE", "NO", "NOT_NEEDED"]);
  assert.equal(
    flakeOutputSchema.properties.service_reuse.properties.guidance.const,
    FLAKE_SERVICE_REUSE.guidance,
  );
});

test("static FlakeVerdict sample is identical to the declared example", async () => {
  const sampleUrl = new URL("../../samples/flake.json", import.meta.url);
  const sample = JSON.parse(await readFile(sampleUrl, "utf8"));
  assert.deepEqual(sample, flakeExample);
});
