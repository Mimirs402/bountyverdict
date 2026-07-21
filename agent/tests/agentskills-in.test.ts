import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_SKILLS_IN_GITHUB_URL,
  AGENT_SKILLS_IN_REPOSITORY,
  AGENT_SKILLS_IN_SCOPED_NAME,
  AGENT_SKILLS_IN_SKILL_NAME,
  AGENT_SKILLS_IN_SKILL_PATH,
  parseAgentSkillsInSearchPayload,
} from "../src/agentskills-in.ts";

const exactEntry = {
  id: "public-id",
  name: AGENT_SKILLS_IN_SKILL_NAME,
  description: "Public routing adapter.",
  author: "cristianmoroaica",
  stars: 0,
  forks: 0,
  githubUrl: AGENT_SKILLS_IN_GITHUB_URL,
  scopedName: AGENT_SKILLS_IN_SCOPED_NAME,
  authorAvatar: null,
  repoFullName: AGENT_SKILLS_IN_REPOSITORY,
  path: AGENT_SKILLS_IN_SKILL_PATH,
  category: null,
  hasContent: true,
};

test("recognizes only the exact AgentSkills.in adapter contract", () => {
  assert.deepEqual(parseAgentSkillsInSearchPayload({ skills: [exactEntry], total: 1, limit: 20, offset: 0 }), {
    listed: true,
    listed_skills: 1,
    expected_skills: 1,
    catalog_total: 1,
    status: "listed",
  });
  assert.deepEqual(parseAgentSkillsInSearchPayload({ skills: [], total: 0, limit: 20, offset: 0 }), {
    listed: false,
    listed_skills: 0,
    expected_skills: 1,
    catalog_total: 0,
    status: "pending_indexing",
  });
  assert.equal(parseAgentSkillsInSearchPayload({
    skills: [{ ...exactEntry, scopedName: null }], total: 1, limit: 20, offset: 0,
  }).status, "contract_drift");
});

test("rejects duplicate, malformed, and unbounded AgentSkills.in telemetry", () => {
  assert.throws(() => parseAgentSkillsInSearchPayload({ skills: [exactEntry, exactEntry], total: 2, limit: 20, offset: 0 }), /duplicated/);
  assert.throws(() => parseAgentSkillsInSearchPayload({ skills: "private", total: 0, limit: 20, offset: 0 }), /malformed/);
  assert.throws(() => parseAgentSkillsInSearchPayload({ skills: [], total: -1, limit: 20, offset: 0 }), /malformed or unbounded/);
  assert.throws(() => parseAgentSkillsInSearchPayload({
    skills: [{ ...exactEntry, hasContent: "yes" }], total: 1, limit: 20, offset: 0,
  }), /content state/);
});
