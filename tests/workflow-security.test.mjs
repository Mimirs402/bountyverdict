import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflows = ["ci.yml", "deploy-worker.yml", "publish-mcp.yml"];
const approvedActions = new Map([
  ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
  ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
  ["actions/upload-artifact", "ea165f8d65b6e75b540449e92b4886f43607fa02"],
  ["actions/download-artifact", "d3f86a106a0bac45b974a628896c90dbdf5c8093"],
]);

test("every third-party GitHub Action is pinned to its reviewed immutable commit", async () => {
  for (const workflow of workflows) {
    const source = await readFile(new URL(`../.github/workflows/${workflow}`, import.meta.url), "utf8");
    const actions = [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
    assert.ok(actions.length > 0, `${workflow} must retain at least one reviewed action`);
    for (const action of actions) {
      const separator = action.lastIndexOf("@");
      assert.ok(separator > 0, `${workflow}: ${action} must include a ref`);
      const name = action.slice(0, separator);
      const ref = action.slice(separator + 1);
      assert.equal(ref, approvedActions.get(name), `${workflow}: ${name} must use its reviewed immutable commit`);
    }
  }
});

test("the MCP Registry publisher is version- and digest-pinned", async () => {
  const source = await readFile(new URL("../.github/workflows/publish-mcp.yml", import.meta.url), "utf8");
  assert.doesNotMatch(source, /releases\/latest\/download/);
  assert.match(source, /releases\/download\/v1\.8\.0\/\$asset/);
  assert.match(source, /1370446bbe74d562608e8005a6ccce02d146a661fbd78674e11cc70b9618d6cf/);
  assert.match(source, /sha256sum --check --strict/);
});

test("the MCP Registry manifest keeps schema-bounded public metadata", async () => {
  const manifest = JSON.parse(await readFile(new URL("../server.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, "1.1.3");
  assert.ok(manifest.description.length <= 100, "server description must fit the current registry schema");
});
