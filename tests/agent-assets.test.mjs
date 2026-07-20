import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const assertReusable = (value) => {
  assert.equal(value?.reusable, true);
  assert.equal(value?.fresh_result_per_successful_call, true);
  assert.equal(value?.reliability, "bounded_live_check");
  assert.match(value?.guidance || "", /^Call /);
};

test("agent manifest is honest and links inspectable products", async () => {
  const manifest = await readJson("../agent-manifest.json");
  assert.ok(["awaiting_production", "active"].includes(manifest.status));
  if (manifest.status === "awaiting_production") assert.equal(manifest.production_api, null);
  if (manifest.status === "active") assert.match(manifest.production_api, /^https:\/\//);
  assert.match(manifest.test_api, /^https:\/\//);
  assert.equal(manifest.test_network, "eip155:84532");
  assert.deepEqual(manifest.products.map((product) => product.price_usdc), ["0.05", "0.40", "0.03", "0.06", "0.04"]);
  assert.ok(manifest.products.every((product) => product.reusable === true));
  assert.equal(manifest.reliability.result_guidance_field, "service_reuse");
  assert.equal(manifest.reliability.scheduled_functional_canaries, true);
  assert.match(manifest.skill, /\/SKILL\.md$/);
  assert.match(manifest.skills.audit_agent_harness, /audit-agent-harness\/SKILL\.md$/);
  assert.match(manifest.skills.preflight_agent_skills, /preflight-agent-skills\/SKILL\.md$/);
  assert.match(manifest.skills.diagnose_github_actions, /diagnose-github-actions\/SKILL\.md$/);
});

test("public samples remain valid JSON with the declared product contracts", async () => {
  const verdict = await readJson("../samples/verdict.json");
  const portfolio = await readJson("../samples/portfolio.json");
  const harness = await readJson("../samples/harness.json");
  const skillAudit = await readJson("../samples/skill.json");
  const runDiagnosis = await readJson("../samples/run.json");
  assert.equal(verdict.product, "BountyVerdict");
  assert.ok(["AVOID", "CAUTION", "VIABLE"].includes(verdict.verdict));
  assertReusable(verdict.service_reuse);
  assert.equal(portfolio.product, "BountyVerdict Portfolio");
  assertReusable(portfolio.service_reuse);
  portfolio.ranked.forEach((result) => assertReusable(result.service_reuse));
  assert.equal(portfolio.counts.checked, portfolio.ranked.length);
  assert.equal(portfolio.counts.failed, portfolio.failures.length);
  assert.equal(harness.product, "HarnessVerdict");
  assert.ok(["READY", "REVIEW", "REPAIR"].includes(harness.verdict));
  assertReusable(harness.service_reuse);
  assert.match(harness.repository.commit_sha, /^[a-f0-9]{40}$/);
  assert.equal(skillAudit.product, "SkillVerdict");
  assert.ok(["LOW_RISK", "REVIEW", "BLOCK"].includes(skillAudit.verdict));
  assertReusable(skillAudit.service_reuse);
  assert.match(skillAudit.repository.commit_sha, /^[a-f0-9]{40}$/);
  assert.equal(runDiagnosis.product, "RunVerdict");
  assert.ok(["PASS", "WAIT", "RETRY", "FIX", "INVESTIGATE"].includes(runDiagnosis.verdict));
  assertReusable(runDiagnosis.service_reuse);
  assert.match(runDiagnosis.run.head_sha, /^[a-f0-9]{40}$/);
});

test("hosted RunVerdict workflow caps payment and treats logs as untrusted", async () => {
  const skill = await readFile(
    new URL("../skills/diagnose-github-actions/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(skill, /^---\nname: diagnose-github-actions\ndescription: .+\n---/);
  assert.match(skill, /40000/);
  assert.match(skill, /untrusted evidence/i);
  assert.match(skill, /Never reveal wallet secrets/);
  assert.match(skill, /service_reuse/);
});

test("hosted SkillVerdict workflow blocks unsafe installation and caps payment", async () => {
  const skill = await readFile(
    new URL("../skills/preflight-agent-skills/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(skill, /^---\nname: preflight-agent-skills\ndescription: .+\n---/);
  assert.match(skill, /60000/);
  assert.match(skill, /BLOCK/);
  assert.match(skill, /Never install, load, or execute/);
  assert.match(skill, /Never reveal wallet secrets/);
  assert.match(skill, /service_reuse/);
});

test("hosted HarnessVerdict skill has payment and evidence safety gates", async () => {
  const skill = await readFile(
    new URL("../skills/audit-agent-harness/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(skill, /^---\nname: audit-agent-harness\ndescription: .+\n---/);
  assert.match(skill, /30000/);
  assert.match(skill, /commit_sha/);
  assert.match(skill, /Never reveal wallet secrets/);
  assert.match(skill, /service_reuse/);
});

test("hosted agent skill has valid minimal frontmatter and safety gates", async () => {
  const skill = await readFile(
    new URL("../skills/preflight-github-bounties/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(skill, /^---\nname: preflight-github-bounties\ndescription: .+\n---/);
  assert.match(skill, /awaiting_production/);
  assert.match(skill, /50000/);
  assert.match(skill, /400000/);
  assert.match(skill, /Never reveal wallet secrets/);
  assert.match(skill, /service_reuse/);
});
