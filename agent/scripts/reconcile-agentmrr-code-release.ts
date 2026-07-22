import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { acquireExclusiveRun } from "../src/exclusive-run.ts";
import {
  AGENTMRR_PREVIOUS_CODE_RELEASE,
  AGENTMRR_PRODUCTION_ACTIVATION,
  AGENTMRR_PRODUCTION_RELEASE,
  AGENTMRR_RECONCILIATION_BASE_COMMIT,
  AGENTMRR_RECONCILIATION_FILES,
  buildAgentMrrReconciledCodeRelease,
  exactSuccessfulRun,
  validateAgentMrrReconciledCodeRelease,
} from "../src/agentmrr-reconciliation.ts";

const execFileAsync = promisify(execFile);
const enabled = process.env.RECONCILE_AGENTMRR_CODE_RELEASE === "YES";
const repository = fileURLToPath(new URL("../..", import.meta.url));
const repositoryName = "Mimirs402/bountyverdict";
const stateDirectory = `${homedir()}/.local/state/bountyverdict`;
const receiptPath = `${stateDirectory}/agentmrr-code-release.json`;
const historyDirectory = `${stateDirectory}/agentmrr-code-release-history`;
const historicalReceiptPath = `${historyDirectory}/${AGENTMRR_PREVIOUS_CODE_RELEASE}.json`;
const lockPath = `${stateDirectory}/agentmrr-code-release-reconciliation.lock`;
const expectedUid = process.getuid?.() ?? -1;

async function run(executable: string, args: string[], cwd = repository): Promise<string> {
  return (await execFileAsync(executable, args, {
    cwd,
    timeout: 30_000,
    maxBuffer: 2_000_000,
    encoding: "utf8",
  })).stdout.trim();
}

async function git(...args: string[]): Promise<string> {
  return run("git", args);
}

async function secureRead(path: string, label: string): Promise<{ raw: string; mode: number; uid: number }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600 || metadata.uid !== expectedUid ||
        metadata.size < 2 || metadata.size > 2_000_000) {
      throw new Error(`${label} must be a bounded owner-owned mode-0600 regular file.`);
    }
    return { raw: await handle.readFile({ encoding: "utf8" }), mode: metadata.mode & 0o777, uid: metadata.uid };
  } finally {
    await handle.close();
  }
}

async function durableExclusiveWrite(path: string, contents: string): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await durableExclusiveWrite(temporary, contents);
    await rename(temporary, path);
    await syncDirectory(stateDirectory);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function successfulRun(commit: string, workflow: string, event: string) {
  const payload = JSON.parse(await run("gh", [
    "run", "list", "--repo", repositoryName, "--commit", commit, "--limit", "30",
    "--json", "workflowName,status,conclusion,event,headBranch,headSha,databaseId,url,createdAt,updatedAt",
  ])) as unknown;
  if (!Array.isArray(payload) || payload.length > 30) throw new Error("GitHub release run evidence is malformed.");
  const matches = payload.filter((value) => {
    try {
      exactSuccessfulRun(value, { workflowName: workflow, event, headSha: commit });
      return true;
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) throw new Error(`Expected exactly one successful ${workflow} run for ${commit}.`);
  return matches[0];
}

async function main() {
  if (expectedUid < 0) throw new Error("AgentMRR reconciliation requires a local Unix owner identity.");
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const stateMetadata = await lstat(stateDirectory);
  if (!stateMetadata.isDirectory() || stateMetadata.isSymbolicLink() || stateMetadata.uid !== expectedUid ||
      (stateMetadata.mode & 0o777) !== 0o700) {
    throw new Error("BountyVerdict state directory must be private and owner-owned.");
  }
  const releaseLock = await acquireExclusiveRun(lockPath);
  try {
    if (await git("branch", "--show-current") !== "main" || await git("status", "--porcelain") !== "") {
      throw new Error("AgentMRR reconciliation requires the clean canonical main worktree.");
    }
    if (await run("gh", ["api", "user", "--jq", ".login"]) !== "Mimirs402") {
      throw new Error("AgentMRR reconciliation requires the Mimir's Lab GitHub identity.");
    }
    const currentCommit = await git("rev-parse", "HEAD");
    const currentParents = (await git("show", "-s", "--format=%P", currentCommit)).split(/\s+/).filter(Boolean);
    if (currentParents.length !== 1 && currentParents.length !== 2) {
      throw new Error("AgentMRR reconciliation requires a one-parent release or reviewed two-parent merge.");
    }
    const currentReleaseSourceCommit = currentParents.length === 2 ? currentParents[1] : currentCommit;
    if (currentParents.length === 2) {
      await git("merge-base", "--is-ancestor", AGENTMRR_RECONCILIATION_BASE_COMMIT, currentReleaseSourceCommit);
      if (await git("show", "-s", "--format=%T", currentReleaseSourceCommit) !==
          await git("show", "-s", "--format=%T", currentCommit)) {
        throw new Error("AgentMRR reconciliation merge tree differs from its reviewed source head.");
      }
    }
    const remoteLine = await git("ls-remote", "--exit-code", "origin", "refs/heads/main");
    if (remoteLine !== `${currentCommit}\trefs/heads/main`) {
      throw new Error("AgentMRR reconciliation requires local main to equal authoritative origin/main.");
    }
    await git("merge-base", "--is-ancestor", AGENTMRR_RECONCILIATION_BASE_COMMIT, currentCommit);
    await git("merge-base", "--is-ancestor", AGENTMRR_PREVIOUS_CODE_RELEASE, currentCommit);
    await git("merge-base", "--is-ancestor", AGENTMRR_PRODUCTION_ACTIVATION, currentCommit);
    if (await git("show", "-s", "--format=%P", AGENTMRR_PRODUCTION_ACTIVATION) !== AGENTMRR_PRODUCTION_RELEASE) {
      throw new Error("AgentMRR production activation no longer has the reviewed production release parent.");
    }
    const changed = (await git("diff", "--name-only", `${AGENTMRR_RECONCILIATION_BASE_COMMIT}..${currentCommit}`))
      .split("\n").filter(Boolean).sort();
    const allowed = [...AGENTMRR_RECONCILIATION_FILES].sort();
    if (JSON.stringify(changed) !== JSON.stringify(allowed)) {
      throw new Error("AgentMRR reconciliation head contains files outside the reviewed repair.");
    }
    try {
      await git("diff", "--quiet", `${AGENTMRR_PREVIOUS_CODE_RELEASE}..${currentCommit}`, "--",
        "agent/src/agentmrr.ts", "agent/scripts/agentmrr-publish.ts");
    } catch {
      throw new Error("AgentMRR publication contract changed after its verified code release.");
    }
    const active = await secureRead(receiptPath, "AgentMRR code release receipt");
    const [ciRun, pagesRun, productionDeployRun] = await Promise.all([
      successfulRun(currentCommit, "CI", "push"),
      successfulRun(currentCommit, "pages-build-deployment", "dynamic"),
      successfulRun(AGENTMRR_PRODUCTION_RELEASE, "Deploy paid Worker", "workflow_dispatch"),
    ]);
    const currentTree = await git("show", "-s", "--format=%T", currentCommit);
    let historical: Awaited<ReturnType<typeof secureRead>> | null = null;
    try {
      historical = await secureRead(historicalReceiptPath, "Historical AgentMRR code release receipt");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (historical) {
      const historicalSha256 = createHash("sha256").update(historical.raw).digest("hex");
      try {
        validateAgentMrrReconciledCodeRelease(
          JSON.parse(active.raw), active.mode, active.uid, expectedUid, currentCommit,
          currentReleaseSourceCommit, currentTree, historicalSha256,
          ciRun, pagesRun, productionDeployRun, new Date(),
        );
        return {
          status: "already_reconciled",
          release_commit: currentCommit,
          production_release: AGENTMRR_PRODUCTION_RELEASE,
        };
      } catch (error) {
        if (active.raw !== historical.raw) throw error;
      }
    }
    const previous = historical ?? active;
    const previousReceiptSha256 = createHash("sha256").update(previous.raw).digest("hex");
    const receipt = buildAgentMrrReconciledCodeRelease({
      previousReceipt: JSON.parse(previous.raw),
      previousReceiptSha256,
      previousReceiptMode: previous.mode,
      previousReceiptOwnerUid: previous.uid,
      expectedUid,
      currentCommit,
      currentReleaseSourceCommit,
      currentTree,
      ciRun,
      pagesRun,
      productionDeployRun,
      now: new Date(),
    });
    if (!enabled) {
      return {
        status: "armed_not_reconciled",
        current_commit: currentCommit,
        production_release: AGENTMRR_PRODUCTION_RELEASE,
        previous_receipt_sha256: previousReceiptSha256,
      };
    }
    await mkdir(historyDirectory, { recursive: true, mode: 0o700 });
    const historyMetadata = await lstat(historyDirectory);
    if (!historyMetadata.isDirectory() || historyMetadata.isSymbolicLink() || historyMetadata.uid !== expectedUid ||
        (historyMetadata.mode & 0o777) !== 0o700) {
      throw new Error("AgentMRR release history directory must be private and owner-owned.");
    }
    try {
      await durableExclusiveWrite(historicalReceiptPath, previous.raw);
      await syncDirectory(historyDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const historical = await secureRead(historicalReceiptPath, "Historical AgentMRR code release receipt");
      if (historical.raw !== previous.raw) throw new Error("Historical AgentMRR release receipt conflicts with current state.");
    }
    await atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    return { status: "reconciled", release_commit: receipt.release_commit, production_release: AGENTMRR_PRODUCTION_RELEASE };
  } finally {
    await releaseLock();
  }
}

console.log(JSON.stringify(await main(), null, 2));
