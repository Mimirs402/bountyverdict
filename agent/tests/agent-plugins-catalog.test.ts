import assert from "node:assert/strict";
import test from "node:test";
import { PUBLISHED_SKILLS } from "../src/acquisition.ts";
import { readAgentPluginsCatalogStatus } from "../src/agent-plugins-catalog.ts";

const catalogUrl = "https://cdn.example/catalog.json";
const publicUrl = "https://directory.example/";
const repository = "https://github.com/Mimirs402/bountyverdict";
const observedAt = "2026-07-31T15:30:00.000Z";
const previousStatus = {
  listed: true,
  listed_skills: PUBLISHED_SKILLS.length,
  total_catalog_skills: 100,
  generated_at: "2026-07-30T00:00:00.000Z",
  skills: PUBLISHED_SKILLS.map((name) => ({ name })),
  last_success_at: "2026-07-30T01:00:00.000Z",
};

const baseOptions = {
  catalogUrl,
  publicUrl,
  repository,
  publishedSkills: PUBLISHED_SKILLS,
  previousStatus,
  observedAt,
  timeoutMs: 10_000,
};

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function exactPayload(): Record<string, unknown> {
  return {
    generated_at: observedAt,
    providers: { github: {} },
    total_skills: PUBLISHED_SKILLS.length,
    skills: PUBLISHED_SKILLS.map((name, index) => ({
      id: `skill-${index}`,
      name,
      source: { repo: repository },
      quality_score: 90,
      maintenance_status: "active",
    })),
  };
}

test("parses the exact Agent Plugins catalog contract", async () => {
  const result = await readAgentPluginsCatalogStatus({
    ...baseOptions,
    fetchImpl: async (_input, init) => {
      assert.equal(new Headers(init?.headers).get("user-agent"), "bountyverdict-directory-monitor/1.0");
      return response(exactPayload());
    },
  });
  assert.equal(result.status, "listed");
  assert.equal(result.contract_verified, true);
  assert.equal(result.stale, false);
  assert.equal(result.listed_skills, PUBLISHED_SKILLS.length);
  assert.equal(result.last_success_at, observedAt);
});

test("a rejected fetch preserves last-known catalog presence and sibling results", async () => {
  const [result, sibling] = await Promise.all([
    readAgentPluginsCatalogStatus({
      ...baseOptions,
      fetchImpl: async () => { throw new Error("connect timeout"); },
    }),
    Promise.resolve({ status: "listed" }),
  ]);
  assert.deepEqual(sibling, { status: "listed" });
  assert.equal(result.status, "request_failed");
  assert.equal(result.available, false);
  assert.equal(result.stale, true);
  assert.equal(result.listed, true);
  assert.equal(result.listed_skills, PUBLISHED_SKILLS.length);
  assert.equal(result.last_success_at, previousStatus.last_success_at);
});

test("an unsuccessful HTTP response is unavailable rather than a false delisting", async () => {
  const result = await readAgentPluginsCatalogStatus({
    ...baseOptions,
    fetchImpl: async () => new Response("unavailable", { status: 503 }),
  });
  assert.equal(result.status, "request_failed");
  assert.equal(result.http_status, 503);
  assert.equal(result.listed, true);
  assert.equal(result.listed_skills, PUBLISHED_SKILLS.length);
});

test("malformed and duplicate catalog contracts are explicit drift", async () => {
  const malformed = await readAgentPluginsCatalogStatus({
    ...baseOptions,
    fetchImpl: async () => response({ providers: {}, total_skills: 1, skills: [] }),
  });
  assert.equal(malformed.status, "contract_drift");
  assert.equal(malformed.available, true);
  assert.equal(malformed.contract_verified, false);
  assert.equal(malformed.listed_skills, PUBLISHED_SKILLS.length);

  const duplicatedPayload = exactPayload() as { skills: Array<Record<string, any>>; total_skills: number };
  duplicatedPayload.skills[1] = { ...duplicatedPayload.skills[0] };
  const duplicated = await readAgentPluginsCatalogStatus({
    ...baseOptions,
    fetchImpl: async () => response(duplicatedPayload),
  });
  assert.equal(duplicated.status, "contract_drift");
  assert.match(String(duplicated.error), /duplicated/);
});

test("a first-run outage remains unknown instead of becoming zero of seven", async () => {
  const result = await readAgentPluginsCatalogStatus({
    ...baseOptions,
    previousStatus: {},
    fetchImpl: async () => { throw new Error("connect timeout"); },
  });
  assert.equal(result.listed, null);
  assert.equal(result.listed_skills, null);
});
