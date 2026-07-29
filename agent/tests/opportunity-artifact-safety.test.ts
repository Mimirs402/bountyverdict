import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateOpportunityArtifacts } from "../src/opportunity-artifact-safety.ts";

test("opportunity artifacts accept bounded nested regular files", async () => {
  const root = await mkdtemp(join(tmpdir(), "bountyverdict-artifacts-"));
  const artifact = join(root, "solution");
  await mkdir(join(artifact, "src"), { recursive: true });
  await writeFile(join(artifact, "src", "index.ts"), "export const value = 1;\n");
  await writeFile(join(artifact, "README.md"), "Prepared locally.\n");
  await validateOpportunityArtifacts(root, [artifact]);
});

test("opportunity artifacts reject nested symbolic links and workspace escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "bountyverdict-artifacts-"));
  const outside = await mkdtemp(join(tmpdir(), "bountyverdict-outside-"));
  const artifact = join(root, "solution");
  await mkdir(artifact);
  await writeFile(join(outside, "private.txt"), "outside\n");
  await symlink(join(outside, "private.txt"), join(artifact, "nested-link"));
  await assert.rejects(
    validateOpportunityArtifacts(root, [artifact]),
    /contains a symbolic link/,
  );
  await assert.rejects(
    validateOpportunityArtifacts(root, [join(outside, "private.txt")]),
    /escapes the preparation workspace/,
  );
});
