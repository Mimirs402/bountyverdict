import assert from "node:assert/strict";
import test from "node:test";
import {
  parseToolHiveCatalogEntry,
  TOOLHIVE_SERVER_NAME,
  TOOLHIVE_SERVER_VERSION,
  TOOLHIVE_TOOLS,
} from "../src/toolhive.ts";

const repository = "https://github.com/Mimirs402/bountyverdict";
const endpoint = "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp";

function fixture() {
  return {
    name: TOOLHIVE_SERVER_NAME,
    version: TOOLHIVE_SERVER_VERSION,
    repository: { source: "github", url: repository },
    remotes: [{ type: "streamable-http", url: endpoint }],
    _meta: {
      "io.modelcontextprotocol.registry/publisher-provided": {
        "io.github.stacklok": {
          [endpoint]: {
            tier: "Community",
            status: "Active",
            custom_metadata: {
              license: "MIT",
              homepage: "https://mimirs402.github.io/bountyverdict/",
            },
            tools: [...TOOLHIVE_TOOLS],
            tags: [
              "remote",
              "github",
              "coding-agents",
              "continuous-integration",
              "developer-tools",
              "read-only",
              "x402",
            ],
          },
        },
      },
    },
  };
}

test("recognizes the exact ToolHive in-agent remote contract", () => {
  const value = fixture();
  value._meta["io.modelcontextprotocol.registry/publisher-provided"]["io.github.stacklok"][endpoint].tags.push("catalog-enriched");
  const parsed = parseToolHiveCatalogEntry(value, repository, endpoint);
  assert.equal(parsed.listed, true);
  assert.equal(parsed.contract_verified, true);
  assert.equal(parsed.name, TOOLHIVE_SERVER_NAME);
  assert.equal(parsed.version, TOOLHIVE_SERVER_VERSION);
  assert.equal(parsed.tool_count, 6);
  assert.deepEqual(new Set(parsed.tools as string[]), new Set(TOOLHIVE_TOOLS));
  assert.ok((parsed.tags as string[]).includes("catalog-enriched"));
});

test("rejects ToolHive identity, release, endpoint, and tool drift", () => {
  const cases = [
    { ...fixture(), name: "io.github.stacklok/other" },
    { ...fixture(), version: "1.1.0" },
    { ...fixture(), remotes: [{ type: "streamable-http", url: "https://wrong.example/mcp" }] },
    (() => {
      const value = fixture();
      value._meta["io.modelcontextprotocol.registry/publisher-provided"]["io.github.stacklok"][endpoint].tools.pop();
      return value;
    })(),
  ];
  for (const value of cases) {
    assert.throws(() => parseToolHiveCatalogEntry(value, repository, endpoint));
  }
});

test("rejects malformed or duplicated ToolHive metadata", () => {
  assert.throws(() => parseToolHiveCatalogEntry(null, repository, endpoint));
  const duplicate = fixture();
  duplicate._meta["io.modelcontextprotocol.registry/publisher-provided"]["io.github.stacklok"][endpoint].tools = [
    ...TOOLHIVE_TOOLS.slice(0, -1),
    TOOLHIVE_TOOLS[0],
  ];
  assert.throws(() => parseToolHiveCatalogEntry(duplicate, repository, endpoint));
});
