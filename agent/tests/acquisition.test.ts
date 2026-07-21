import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateEarnedPlacementExperiment,
  parseAgentSkillSearchPayload,
  parseSkillsShInstallCounts,
  PUBLISHED_SKILLS,
} from "../src/acquisition.ts";

test("AgentSkill acquisition parser retains per-skill conversion and quality signals", () => {
  const parsed = parseAgentSkillSearchPayload({
    results: PUBLISHED_SKILLS.map((skill, index) => ({
      slug: `cristianmoroaica/${skill}`,
      name: skill,
      owner: "cristianmoroaica",
      installCount: index,
      githubStars: 3,
      score: 90 - index,
      ratingCount: index === 0 ? 2 : 0,
      securityScore: 100,
      contentQualityScore: 95,
      contentSha: "93327fe3e47e241851570700e46e332353ebfb6f",
      updatedAt: "2026-07-20T23:40:19.000Z",
    })),
    total: 7,
    hasMore: false,
    totalExact: true,
  });
  assert.equal(parsed.listed, true);
  assert.equal(parsed.listed_skills, 7);
  assert.equal(parsed.total_installs, 21);
  assert.equal(parsed.total_ratings, 2);
  assert.equal(parsed.skills[0].skill, "route-github-agent-checks");
  assert.equal(parsed.skills[0].security_score, 100);
  assert.equal(parsed.skills[0].content_quality_score, 95);
});

test("AgentSkill acquisition parser distinguishes empty and partial indexes", () => {
  const empty = parseAgentSkillSearchPayload({ results: [], total: 0, hasMore: false, totalExact: false });
  assert.equal(empty.status, "not_indexed");
  assert.equal(empty.total_installs, 0);

  const partial = parseAgentSkillSearchPayload({
    results: [{ slug: "cristianmoroaica/audit-agent-harness", owner: "cristianmoroaica", installCount: 4 }],
    total: 1,
    hasMore: false,
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.listed_skills, 1);
  assert.equal(partial.total_installs, 4);
});

test("AgentSkill acquisition parser rejects malformed counters and ignores other owners", () => {
  assert.throws(() => parseAgentSkillSearchPayload({ results: [], total: -1, hasMore: false }), /malformed/);
  const parsed = parseAgentSkillSearchPayload({
    results: [{ slug: "other/preflight-agent-skills", owner: "other", installCount: 99 }],
    total: 1,
    hasMore: false,
  });
  assert.equal(parsed.listed_skills, 0);
  assert.equal(parsed.total_installs, 0);
});

test("skills.sh acquisition parser requires and totals every published skill", () => {
  const html = PUBLISHED_SKILLS.map((skill, index) =>
    `<a href="/Mimirs402/bountyverdict/${skill}"><h3>${skill}</h3><span class="count">${index === 0 ? "2" : "1"}</span></a>`
  ).join("");
  const parsed = parseSkillsShInstallCounts(html);
  assert.equal(parsed.total, 8);
  assert.equal(parsed.by_skill["route-github-agent-checks"], 2);
  assert.equal(parsed.by_skill["preflight-agent-skills"], 1);
});

test("skills.sh acquisition parser fails closed on partial or malformed telemetry", () => {
  assert.throws(() => parseSkillsShInstallCounts("<html></html>"), /route-github-agent-checks/);
  const html = PUBLISHED_SKILLS.map((skill) =>
    `<a href="/Mimirs402/bountyverdict/${skill}"><span>1</span></a>`
  ).join("").replace(">1</span>", ">not-a-number</span>");
  assert.throws(() => parseSkillsShInstallCounts(html), /route-github-agent-checks/);
});

const baselineExperiment = {
  checked_at: "2026-07-20T16:30:00.000Z",
  healthy: true,
  total_installs: 8,
  router_installs: 2,
  skillverdict_installs: 1,
  skillverdict_registry_queries: 0,
  non_target_registry_queries: 0,
  recognized_purchases: [],
  placements: [{ status: "open", merged_at: null }],
} as const;

test("earned placement experiment waits for real directory exposure", () => {
  const result = evaluateEarnedPlacementExperiment(baselineExperiment);
  assert.equal(result.status, "awaiting_placement");
  assert.equal(result.started_at, null);
  assert.equal(result.delta.genuine_purchases, 0);
  assert.equal(result.next_action.code, "secure_verified_placement");
});

test("non-target catalog telemetry cannot start the SkillVerdict experiment", () => {
  const result = evaluateEarnedPlacementExperiment({
    ...baselineExperiment,
    placements: [{ status: "catalog_listed", exposed_at: "2026-07-20T16:37:12.000Z" }],
  });
  assert.equal(result.status, "awaiting_placement");
  assert.equal(result.started_at, null);
});

test("earned placement experiment starts at the first merge and stays running before the boundary", () => {
  const result = evaluateEarnedPlacementExperiment({
    ...baselineExperiment,
    checked_at: "2026-07-22T12:00:00.000Z",
    recognized_purchases: [{ product: "skill", settled_at: "2026-07-21T18:00:00.000Z" }],
    total_installs: 10,
    router_installs: 3,
    placements: [
      { status: "merged", merged_at: "2026-07-21T12:00:00.000Z" },
      { status: "merged", merged_at: "2026-07-22T12:00:00.000Z" },
    ],
  });
  assert.equal(result.status, "running");
  assert.equal(result.started_at, "2026-07-21T12:00:00.000Z");
  assert.equal(result.ends_at, "2026-07-28T12:00:00.000Z");
  assert.equal(result.delta.installs.router, 1);
  assert.equal(result.delta.genuine_purchases, 1);
  assert.equal(result.next_action.code, "hold_experiment_constant");
});

test("earned placement experiment starts from an immediately listed registry entry", () => {
  const result = evaluateEarnedPlacementExperiment({
    ...baselineExperiment,
    checked_at: "2026-07-20T17:00:00.000Z",
    placements: [{ status: "listed", exposed_at: "2026-07-20T16:37:12.000Z" }],
  });
  assert.equal(result.status, "running");
  assert.equal(result.started_at, "2026-07-20T16:37:12.000Z");
  assert.equal(result.next_action.code, "hold_experiment_constant");
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
  assert.equal(failed.status, "reach_failure");
  assert.equal(failed.next_action.code, "expand_earned_reach");
});

test("post-window action distinguishes listing conversion from purchase friction", () => {
  const listingConversion = evaluateEarnedPlacementExperiment({
    ...baselineExperiment,
    checked_at: "2026-07-28T12:00:00.000Z",
    skillverdict_registry_queries: 3,
    placements: [{ status: "listed", exposed_at: "2026-07-21T12:00:00.000Z" }],
  });
  assert.equal(listingConversion.status, "listing_to_install_failure");
  assert.equal(listingConversion.next_action.code, "improve_listing_conversion");

  const purchaseFriction = evaluateEarnedPlacementExperiment({
    ...baselineExperiment,
    checked_at: "2026-07-28T12:00:00.000Z",
    router_installs: 3,
    placements: [{ status: "listed", exposed_at: "2026-07-21T12:00:00.000Z" }],
  });
  assert.equal(purchaseFriction.status, "install_to_purchase_failure");
  assert.equal(purchaseFriction.next_action.code, "test_purchase_friction");
});

test("degraded health or telemetry blocks acquisition conclusions", () => {
  const unhealthy = evaluateEarnedPlacementExperiment({
    ...baselineExperiment,
    healthy: false,
  });
  assert.equal(unhealthy.next_action.code, "restore_distribution_health");
  const missingTelemetry = evaluateEarnedPlacementExperiment({
    ...baselineExperiment,
    skillverdict_registry_queries: undefined,
  });
  assert.equal(missingTelemetry.next_action.code, "restore_acquisition_measurement");
});

test("terminal outcomes distinguish target and off-target purchases", () => {
  const target = evaluateEarnedPlacementExperiment({
    ...baselineExperiment,
    checked_at: "2026-07-28T12:00:00.000Z",
    recognized_purchases: [{ product: "skill", settled_at: "2026-07-24T12:00:00.000Z" }],
    placements: [{ status: "listed", exposed_at: "2026-07-21T12:00:00.000Z" }],
  });
  assert.equal(target.status, "target_purchase_success");
  assert.equal(target.next_action.code, "scale_proven_distribution");

  const other = evaluateEarnedPlacementExperiment({
    ...baselineExperiment,
    checked_at: "2026-07-28T12:00:00.000Z",
    recognized_purchases: [{ product: "run", settled_at: "2026-07-24T12:00:00.000Z" }],
    placements: [{ status: "listed", exposed_at: "2026-07-21T12:00:00.000Z" }],
  });
  assert.equal(other.status, "off_target_purchase_success");
  assert.equal(other.next_action.code, "scale_purchased_product");
});

test("purchases outside the immutable exposure window are excluded", () => {
  const result = evaluateEarnedPlacementExperiment({
    ...baselineExperiment,
    checked_at: "2026-07-30T12:00:00.000Z",
    persisted_started_at: "2026-07-21T12:00:00.000Z",
    recognized_purchases: [
      { product: "skill", settled_at: "2026-07-21T11:59:59.000Z" },
      { product: "skill", settled_at: "2026-07-28T12:00:01.000Z" },
    ],
    placements: [],
  });
  assert.equal(result.status, "reach_failure");
  assert.equal(result.current.genuine_purchases, 0);
});

test("persisted exposure survives listing disappearance and future exposure fails closed", () => {
  const persisted = evaluateEarnedPlacementExperiment({
    ...baselineExperiment,
    checked_at: "2026-07-22T12:00:00.000Z",
    persisted_started_at: "2026-07-21T12:00:00.000Z",
    placements: [],
  });
  assert.equal(persisted.status, "running");
  assert.throws(() => evaluateEarnedPlacementExperiment({
    ...baselineExperiment,
    checked_at: "2026-07-20T12:00:00.000Z",
    placements: [{ status: "listed", exposed_at: "2026-07-21T12:00:00.000Z" }],
  }), /future/);
});
