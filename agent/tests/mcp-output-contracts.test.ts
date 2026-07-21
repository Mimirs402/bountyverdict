import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MCP_SUCCESS_OUTPUT_SCHEMAS } from "../src/mcp-output-contracts.ts";

const fixturePaths = {
  check_github_bounty: "../../samples/verdict.json",
  rank_github_bounties: "../../samples/portfolio.json",
  audit_agent_harness: "../../samples/harness.json",
  diagnose_github_actions_run: "../../samples/run.json",
  classify_github_actions_flake: "../../samples/flake.json",
  check_mcp_tool_drift: "../../samples/mcp-drift.json",
} as const;

function fixture(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Record<string, unknown>;
}

test("all six MCP success contracts accept their representative real service result", () => {
  assert.deepEqual(Object.keys(MCP_SUCCESS_OUTPUT_SCHEMAS), Object.keys(fixturePaths));
  for (const [name, schema] of Object.entries(MCP_SUCCESS_OUTPUT_SCHEMAS)) {
    const result = schema.safeParse(fixture(fixturePaths[name as keyof typeof fixturePaths]));
    assert.equal(result.success, true, `${name}: ${result.success ? "" : result.error.message}`);
  }
});

test("MCP success contracts reject missing or incorrect decision discriminators", () => {
  for (const [name, schema] of Object.entries(MCP_SUCCESS_OUTPUT_SCHEMAS)) {
    const value = fixture(fixturePaths[name as keyof typeof fixturePaths]);
    const discriminator = name === "check_mcp_tool_drift" ? "service" : "product";
    value[discriminator] = "WrongService";
    assert.equal(schema.safeParse(value).success, false, `${name} accepted the wrong ${discriminator}`);
  }
});

test("MCP success contracts require the fields an agent needs to act", () => {
  const mutations: Array<[keyof typeof MCP_SUCCESS_OUTPUT_SCHEMAS, string[]]> = [
    ["check_github_bounty", ["verdict"]],
    ["rank_github_bounties", ["best_candidate"]],
    ["audit_agent_harness", ["repository", "commit_sha"]],
    ["diagnose_github_actions_run", ["diagnosis"]],
    ["classify_github_actions_flake", ["decision", "retry"]],
    ["check_mcp_tool_drift", ["action"]],
  ];
  for (const [name, path] of mutations) {
    const value = structuredClone(fixture(fixturePaths[name]));
    let parent: Record<string, unknown> = value;
    for (const segment of path.slice(0, -1)) parent = parent[segment] as Record<string, unknown>;
    delete parent[path.at(-1)!];
    assert.equal(MCP_SUCCESS_OUTPUT_SCHEMAS[name].safeParse(value).success, false, `${name} accepted missing ${path.join(".")}`);
  }
});
