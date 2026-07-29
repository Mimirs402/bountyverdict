import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

const MAXIMUM_ARTIFACT_ENTRIES = 2_000;
const MAXIMUM_ARTIFACT_DEPTH = 12;
const MAXIMUM_ARTIFACT_BYTES = 100 * 1024 * 1024;

function insideRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

export async function validateOpportunityArtifacts(
  preparationRoot: string,
  artifactPaths: readonly string[],
): Promise<void> {
  const rootMetadata = await lstat(preparationRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("Opportunity preparation root is not a regular directory.");
  }
  const canonicalRoot = await realpath(preparationRoot);
  const visited = new Set<string>();
  let entries = 0;
  let bytes = 0;

  async function inspect(path: string, depth: number): Promise<void> {
    if (depth > MAXIMUM_ARTIFACT_DEPTH) {
      throw new Error("Opportunity artifact directory exceeds the recursion limit.");
    }
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new Error("Opportunity artifact tree contains a symbolic link.");
    }
    const canonical = await realpath(path);
    if (!insideRoot(canonicalRoot, canonical)) {
      throw new Error("Opportunity artifact escapes the preparation workspace.");
    }
    if (visited.has(canonical)) return;
    visited.add(canonical);
    entries += 1;
    if (entries > MAXIMUM_ARTIFACT_ENTRIES) {
      throw new Error("Opportunity artifact tree exceeds the entry limit.");
    }
    if (metadata.isFile()) {
      bytes += metadata.size;
      if (bytes > MAXIMUM_ARTIFACT_BYTES) {
        throw new Error("Opportunity artifact tree exceeds the byte limit.");
      }
      return;
    }
    if (!metadata.isDirectory()) {
      throw new Error("Opportunity artifact tree contains a special file.");
    }
    const children = await readdir(path);
    children.sort();
    for (const child of children) await inspect(join(path, child), depth + 1);
  }

  for (const artifactPath of artifactPaths) {
    if (!isAbsolute(artifactPath)) throw new Error("Opportunity artifact path is not absolute.");
    await inspect(artifactPath, 0);
  }
}
