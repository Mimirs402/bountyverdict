import assert from "node:assert/strict";
import test from "node:test";
import { auditedMonitorRequiresRotation } from "../src/audited-monitor.ts";

test("directory retrieval always requires a draining funnel rotation", () => {
  assert.equal(auditedMonitorRequiresRotation("directory", false), true);
  assert.equal(auditedMonitorRequiresRotation("directory", true), true);
});

test("full distribution retrieval requires a draining funnel rotation", () => {
  assert.equal(auditedMonitorRequiresRotation("distribution", false), true);
});

test("report-only distribution refresh never rotates the funnel", () => {
  assert.equal(auditedMonitorRequiresRotation("distribution", true), false);
});
