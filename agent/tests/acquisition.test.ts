import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateEarnedPlacementExperiment,
  parseSkillsShInstallCounts,
  PUBLISHED_SKILLS,
} from "../src/acquisition.ts";

test("skills.sh acquisition parser requires and totals every published skill", () => {
  const html = PUBLISHED_SKILLS.map((skill, index) =>
    `<a href="/cristianmoroaica/bountyverdict/${skill}"><h3>${skill}</h3><span class="count">${index === 0 ? "2" : "1"}</span></a>`
  ).join("");
  const parsed = parseSkillsShInstallCounts(html);
  assert.equal(parsed.total, 8);
  assert.equal(parsed.by_skill["route-github-agent-checks"], 2);
  assert.equal(parsed.by_skill["preflight-agent-skills"], 1);
});

test("skills.sh acquisition parser fails closed on partial or malformed telemetry", () => {
  assert.throws(() => parseSkillsShInstallCounts("<html></html>"), /route-github-agent-checks/);
  const html = PUBLISHED_SKILLS.map((skill) =>
    `<a href="/cristianmoroaica/bountyverdict/${skill}"><span>1</span></a>`
  ).join("").replace(">1</span>", ">not-a-number</span>");
  assert.throws(() => parseSkillsShInstallCounts(html), /route-github-agent-checks/);
});

const baselineExperiment = {
  checked_at: "2026-07-20T16:30:00.000Z",
  healthy: true,
  genuine_purchases: 0,
  total_installs: 8,
  router_installs: 2,
  skillverdict_installs: 1,
  placements: [{ status: "open", merged_at: null }],
} as const;

test("earned placement experiment waits for real directory exposure", () => {
  const result = evaluateEarnedPlacementExperiment(baselineExperiment);
  assert.equal(result.status, "awaiting_placement");
  assert.equal(result.started_at, null);
  assert.equal(result.delta.genuine_purchases, 0);
});

test("earned placement experiment starts at the first merge and recognizes strong success", () => {
  const result = evaluateEarnedPlacementExperiment({
    ...baselineExperiment,
    checked_at: "2026-07-22T12:00:00.000Z",
    genuine_purchases: 1,
    total_installs: 10,
    router_installs: 3,
    placements: [
      { status: "merged", merged_at: "2026-07-21T12:00:00.000Z" },
      { status: "merged", merged_at: "2026-07-22T12:00:00.000Z" },
    ],
  });
  assert.equal(result.status, "strong_success");
  assert.equal(result.started_at, "2026-07-21T12:00:00.000Z");
  assert.equal(result.ends_at, "2026-07-28T12:00:00.000Z");
  assert.equal(result.delta.installs.router, 1);
  assert.equal(result.delta.genuine_purchases, 1);
});

test("earned placement experiment starts from an immediately listed registry entry", () => {
  const result = evaluateEarnedPlacementExperiment({
    ...baselineExperiment,
    checked_at: "2026-07-20T17:00:00.000Z",
    placements: [{ status: "listed", exposed_at: "2026-07-20T16:37:12.000Z" }],
  });
  assert.equal(result.status, "running");
  assert.equal(result.started_at, "2026-07-20T16:37:12.000Z");
});

test("earned placement experiment fails only after seven exposed days without a purchase", () => {
  const running = evaluateEarnedPlacementExperiment({
    ...baselineExperiment,
    checked_at: "2026-07-28T11:59:59.000Z",
    placements: [{ status: "merged", merged_at: "2026-07-21T12:00:00.000Z" }],
  });
  assert.equal(running.status, "running");
  const failed = evaluateEarnedPlacementExperiment({
    ...baselineExperiment,
    checked_at: "2026-07-28T12:00:00.000Z",
    placements: [{ status: "merged", merged_at: "2026-07-21T12:00:00.000Z" }],
  });
  assert.equal(failed.status, "failed_no_purchase");
});
