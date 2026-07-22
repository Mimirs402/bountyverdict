import { execFile } from "node:child_process";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  AGENTMRR_BASE_URL,
  AGENTMRR_CATALOG_LIMIT,
  AGENTMRR_PRODUCT,
  AGENTMRR_PRODUCT_CONTRACT_SHA256,
  AGENTMRR_ROTATION_REASON,
  parseAgentMrrCatalog,
  parseAgentMrrPublishedProduct,
  parseAgentMrrSecret,
  readAgentMrrJsonResponse,
  validateAgentMrrPublicationGate,
  validateAgentMrrPublicationAttempt,
  validateAgentMrrPublicationCompletion,
  validateAgentMrrCodeReleaseState,
  validateAgentMrrLiveCollector,
  validateAgentMrrReleaseState,
} from "../src/agentmrr.ts";
import { trustedFunnelBaseline } from "../src/funnel-epoch.ts";
import { acquireExclusiveRun } from "../src/exclusive-run.ts";

const execFileAsync = promisify(execFile);
const enabled = process.env.AGENTMRR_PUBLISH === "YES";
const configDirectory = `${homedir()}/.config/bountyverdict`;
const stateDirectory = `${homedir()}/.local/state/bountyverdict`;
const secretFile = `${configDirectory}/agentmrr.env`;
const releaseStateFile = `${stateDirectory}/post-boundary-hardening-release.json`;
const codeReleaseStateFile = `${stateDirectory}/agentmrr-code-release.json`;
const baselineFile = `${stateDirectory}/funnel-trusted-baseline.json`;
const historyFile = `${stateDirectory}/funnel-trusted-epochs.json`;
const collectorStateFile = `${stateDirectory}/funnel-telemetry.json`;
const publicationLockFile = `${stateDirectory}/agentmrr-publication.lock`;
const publicationAttemptFile = `${stateDirectory}/agentmrr-publication-attempt.json`;
const funnelLockFile = `${historyFile}.lock`;
const expectedUid = process.getuid?.() ?? -1;
const ordinaryStateMaximumBytes = 2_000_000;
const historyStateMaximumBytes = 64 * 1024 * 1024;

async function secureReadFile(
  path: string,
  label: string,
  maximumBytes = ordinaryStateMaximumBytes,
): Promise<{ raw: string; metadata: Stats }> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 2 || maximumBytes > historyStateMaximumBytes) {
    throw new Error(`${label} size bound is invalid.`);
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600 || metadata.uid !== expectedUid ||
        metadata.size < 2 || metadata.size > maximumBytes) {
      throw new Error(`${label} must be a bounded regular owner-owned file with mode 0600.`);
    }
    return { raw: await handle.readFile({ encoding: "utf8" }), metadata };
  } finally {
    await handle.close();
  }
}

async function credentials(): Promise<ReturnType<typeof parseAgentMrrSecret>> {
  return parseAgentMrrSecret((await secureReadFile(secretFile, "AgentMRR credential file")).raw);
}

async function atomicWritePublicationReceipt(value: Record<string, unknown>): Promise<void> {
  const temporary = `${publicationAttemptFile}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let moved = false;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, publicationAttemptFile);
    const directory = await open(stateDirectory, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    moved = true;
  } finally {
    if (!moved) await unlink(temporary).catch(() => undefined);
  }
}

function codeReleaseIdentity(value: unknown): { releaseCommit: string; releaseSourceHead: string } {
  const receipt = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const releaseCommit = String(receipt.release_commit || "");
  const releaseSourceHead = String(receipt.release_source_head || "");
  if (!/^[a-f0-9]{40}$/.test(releaseCommit) || !/^[a-f0-9]{40}$/.test(releaseSourceHead)) {
    throw new Error("AgentMRR code release receipt identity is malformed.");
  }
  return { releaseCommit, releaseSourceHead };
}

async function currentReleaseIdentity(): Promise<{ releaseCommit: string; releaseSourceHead: string }> {
  const repository = fileURLToPath(new URL("../..", import.meta.url));
  const runGit = async (...args: string[]): Promise<string> =>
    (await execFileAsync("git", ["-C", repository, ...args], {
      timeout: 10_000,
      maxBuffer: 1_000_000,
      encoding: "utf8",
    })).stdout.trim();
  if (await runGit("branch", "--show-current") !== "main" || await runGit("status", "--porcelain") !== "") {
    throw new Error("AgentMRR publication requires the clean canonical main worktree.");
  }
  const releaseCommit = await runGit("rev-parse", "HEAD");
  const parents = (await runGit("show", "-s", "--format=%P", releaseCommit)).split(/\s+/).filter(Boolean);
  const releaseSourceHead = parents.length === 2 ? parents[1] : releaseCommit;
  if (!/^[a-f0-9]{40}$/.test(releaseCommit) || !/^[a-f0-9]{40}$/.test(releaseSourceHead) ||
      (parents.length !== 1 && parents.length !== 2)) {
    throw new Error("AgentMRR publication could not bind the canonical release commit and source head.");
  }
  return { releaseCommit, releaseSourceHead };
}

const catalogResponse = await fetch(
  `${AGENTMRR_BASE_URL}/api/products?limit=${AGENTMRR_CATALOG_LIMIT}&sort=newest`,
  {
    headers: { Accept: "application/json", "User-Agent": "BountyVerdict-Distribution/1.0" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  },
);
const existing = parseAgentMrrCatalog(
  await readAgentMrrJsonResponse(catalogResponse, "catalog"),
  AGENTMRR_CATALOG_LIMIT,
);
if (!enabled) {
  if (existing) {
    const identity = await credentials();
    if (!existing.exact || existing.submittedBy !== identity.agentId) {
      throw new Error("Existing AgentMRR RunVerdict listing is drifted or owned by another agent.");
    }
    console.log(JSON.stringify({ action: "existing", product_id: existing.id, name: existing.name }, null, 2));
  } else {
    console.log(JSON.stringify({ action: "armed_not_published", product: AGENTMRR_PRODUCT }, null, 2));
  }
} else {
  if (expectedUid < 0) throw new Error("AgentMRR publication requires a local Unix owner identity.");
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const stateDirectoryStat = await lstat(stateDirectory);
  if (!stateDirectoryStat.isDirectory() || stateDirectoryStat.isSymbolicLink() ||
      stateDirectoryStat.uid !== expectedUid || (stateDirectoryStat.mode & 0o077) !== 0) {
    throw new Error("BountyVerdict state directory must be owner-owned and private.");
  }
  const releasePublicationLock = await acquireExclusiveRun(publicationLockFile);
  try {
    const identity = await credentials();
    const codeRelease = await secureReadFile(codeReleaseStateFile, "AgentMRR code release receipt");
    const codeReleaseState = JSON.parse(codeRelease.raw);
    const codeReleaseIdentityValue = codeReleaseIdentity(codeReleaseState);
    validateAgentMrrCodeReleaseState(
      codeReleaseState,
      codeRelease.metadata.mode & 0o777,
      codeRelease.metadata.uid,
      expectedUid,
      codeReleaseIdentityValue.releaseCommit,
      codeReleaseIdentityValue.releaseSourceHead,
    );
    const codeReleaseCommit = codeReleaseIdentityValue.releaseCommit;

    if (existing) {
      if (!existing.exact || existing.submittedBy !== identity.agentId) {
        throw new Error("Existing AgentMRR RunVerdict listing is drifted or owned by another agent.");
      }
      const attempt = await secureReadFile(publicationAttemptFile, "AgentMRR publication attempt receipt");
      const attemptState = JSON.parse(attempt.raw) as Record<string, unknown>;
      if (attemptState.status === "complete") {
        validateAgentMrrPublicationCompletion(
          attemptState,
          attempt.metadata.mode & 0o777,
          attempt.metadata.uid,
          expectedUid,
          identity.agentId,
          codeReleaseCommit,
          existing.id,
        );
      } else {
        validateAgentMrrPublicationAttempt(
          attemptState,
          attempt.metadata.mode & 0o777,
          attempt.metadata.uid,
          expectedUid,
          identity.agentId,
          codeReleaseCommit,
        );
        const completion = {
          ...attemptState,
          status: "complete",
          completed_at: new Date().toISOString(),
          action: "existing",
          product_id: existing.id,
        };
        validateAgentMrrPublicationCompletion(
          completion,
          0o600,
          expectedUid,
          expectedUid,
          identity.agentId,
          codeReleaseCommit,
          existing.id,
        );
        await atomicWritePublicationReceipt(completion);
      }
      console.log(JSON.stringify({ action: "existing", product_id: existing.id, name: existing.name }, null, 2));
    } else {
      const currentRelease = await currentReleaseIdentity();
      if (currentRelease.releaseCommit !== codeReleaseIdentityValue.releaseCommit ||
          currentRelease.releaseSourceHead !== codeReleaseIdentityValue.releaseSourceHead) {
        throw new Error("AgentMRR publication requires the current clean code release receipt.");
      }
      const release = await secureReadFile(releaseStateFile, "AgentMRR release receipt");
      const releaseState = JSON.parse(release.raw);
      validateAgentMrrReleaseState(
        releaseState,
        release.metadata.mode & 0o777,
        release.metadata.uid,
        expectedUid,
      );
      const collector = await secureReadFile(collectorStateFile, "Funnel collector state");
      validateAgentMrrLiveCollector(
        JSON.parse(collector.raw),
        collector.metadata.mode & 0o777,
        collector.metadata.uid,
        expectedUid,
        new Date(),
      );
      const rotationId = `agentmrr-publish-${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
      const rotationScript = new URL("./start-funnel-epoch.ts", import.meta.url);
      const rotation = await execFileAsync(
      process.execPath,
      ["--experimental-strip-types", rotationScript.pathname],
      {
        env: {
          ...process.env,
          START_FUNNEL_EPOCH: "YES",
          FUNNEL_ROTATION_ID: rotationId,
          FUNNEL_EPOCH_REASON: AGENTMRR_ROTATION_REASON,
          QUIET_PERIOD_SECONDS: "900",
        },
        timeout: 30_000,
        maxBuffer: 1_000_000,
        encoding: "utf8",
      },
      );
      if (!/"status": "draining_started"/.test(rotation.stdout)) {
        throw new Error(`AgentMRR publication could not establish a fresh drain: ${rotation.stdout.trim()}`);
      }

      const releaseFunnelLock = await acquireExclusiveRun(funnelLockFile);
      try {
        const [freshRelease, freshCodeRelease, baselineFileState, historyFileState, collectorFileState] =
          await Promise.all([
          secureReadFile(releaseStateFile, "AgentMRR release receipt"),
          secureReadFile(codeReleaseStateFile, "AgentMRR code release receipt"),
          secureReadFile(baselineFile, "Trusted funnel baseline"),
          secureReadFile(historyFile, "Trusted funnel history", historyStateMaximumBytes),
          secureReadFile(collectorStateFile, "Funnel collector state"),
          ]);
        const baseline = trustedFunnelBaseline(JSON.parse(baselineFileState.raw));
        if (!baseline) throw new Error("Trusted funnel baseline is malformed; refusing AgentMRR publication.");
        validateAgentMrrPublicationGate({
        releaseState: JSON.parse(freshRelease.raw),
        releaseMode: freshRelease.metadata.mode & 0o777,
        releaseOwnerUid: freshRelease.metadata.uid,
        codeReleaseState: JSON.parse(freshCodeRelease.raw),
        codeReleaseMode: freshCodeRelease.metadata.mode & 0o777,
        codeReleaseOwnerUid: freshCodeRelease.metadata.uid,
        expectedCodeReleaseCommit: currentRelease.releaseCommit,
        expectedReleaseSourceHead: currentRelease.releaseSourceHead,
        baselineMode: baselineFileState.metadata.mode & 0o777,
        baselineOwnerUid: baselineFileState.metadata.uid,
        historyMode: historyFileState.metadata.mode & 0o777,
        historyOwnerUid: historyFileState.metadata.uid,
        collectorState: JSON.parse(collectorFileState.raw),
        collectorMode: collectorFileState.metadata.mode & 0o777,
        collectorOwnerUid: collectorFileState.metadata.uid,
        expectedUid,
        trustedBaseline: baseline,
        baselineEpochId: baseline.epoch_id,
        funnelLedger: JSON.parse(historyFileState.raw),
        expectedRotationId: rotationId,
        now: new Date(),
        });
        const attemptHandle = await open(publicationAttemptFile, "wx", 0o600)
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === "EEXIST") {
              throw new Error("An AgentMRR publication attempt already exists without a reconciled listing.");
            }
            throw error;
          });
        try {
          await attemptHandle.writeFile(`${JSON.stringify({
          schema_version: 1,
          status: "posting",
          created_at: new Date().toISOString(),
          agent_id: identity.agentId,
          rotation_id: rotationId,
          product_contract_sha256: AGENTMRR_PRODUCT_CONTRACT_SHA256,
          code_release_commit: codeReleaseCommit,
          }, null, 2)}\n`);
          await attemptHandle.sync();
        } finally {
          await attemptHandle.close();
        }
        const publishResponse = await fetch(`${AGENTMRR_BASE_URL}/api/products`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${identity.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "BountyVerdict-Distribution/1.0",
        },
        body: JSON.stringify(AGENTMRR_PRODUCT),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        });
        const published = parseAgentMrrPublishedProduct(
          await readAgentMrrJsonResponse(publishResponse, "publication"),
          identity.agentId,
        );
        const originalAttemptFile = await secureReadFile(
          publicationAttemptFile,
          "AgentMRR publication attempt receipt",
        );
        const originalAttempt = JSON.parse(originalAttemptFile.raw) as Record<string, unknown>;
        validateAgentMrrPublicationAttempt(
          originalAttempt,
          originalAttemptFile.metadata.mode & 0o777,
          originalAttemptFile.metadata.uid,
          expectedUid,
          identity.agentId,
          codeReleaseCommit,
        );
        const completion = {
          ...originalAttempt,
          status: "complete",
          completed_at: new Date().toISOString(),
          action: "published",
          product_id: published.id,
        };
        validateAgentMrrPublicationCompletion(
          completion,
          0o600,
          expectedUid,
          expectedUid,
          identity.agentId,
          codeReleaseCommit,
          published.id,
        );
        await atomicWritePublicationReceipt(completion);
        console.log(JSON.stringify({ action: "published", product_id: published.id, name: published.name }, null, 2));
      } finally {
        await releaseFunnelLock();
      }
    }
  } finally {
    await releasePublicationLock();
  }
}
