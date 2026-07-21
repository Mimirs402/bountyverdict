import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSkillsShSearchPayload,
  SKILLS_SH_DEDICATED_ID,
  SKILLS_SH_DEDICATED_SOURCE,
} from "../src/skills-sh.ts";

test("recognizes the exact dedicated Skills.sh adapter without owner-case drift", () => {
  const result = parseSkillsShSearchPayload({
    count: 2,
    skills: [
      { id: "other/example/skill", source: "other/example" },
      { id: SKILLS_SH_DEDICATED_ID.toLowerCase(), source: SKILLS_SH_DEDICATED_SOURCE.toLowerCase() },
    ],
  });
  assert.deepEqual(result, {
    found: true,
    rank: 2,
    returned_results: 2,
    catalog_matches: 2,
  });
});

test("reports a bounded miss and rejects malformed or duplicate Skills.sh telemetry", () => {
  assert.deepEqual(parseSkillsShSearchPayload({ count: 0, skills: [] }), {
    found: false,
    rank: null,
    returned_results: 0,
    catalog_matches: 0,
  });
  assert.throws(() => parseSkillsShSearchPayload({ count: 1, skills: [{}] }), /identity/);
  assert.throws(() => parseSkillsShSearchPayload({ count: -1, skills: [] }), /malformed/);
  assert.throws(() => parseSkillsShSearchPayload({
    count: 1,
    skills: [{ id: SKILLS_SH_DEDICATED_ID, source: "someone-else/fork" }],
  }), /source drifted/);
  assert.throws(() => parseSkillsShSearchPayload({
    count: 2,
    skills: [
      { id: SKILLS_SH_DEDICATED_ID, source: SKILLS_SH_DEDICATED_SOURCE },
      { id: SKILLS_SH_DEDICATED_ID, source: SKILLS_SH_DEDICATED_SOURCE },
    ],
  }), /duplicated/);
});
