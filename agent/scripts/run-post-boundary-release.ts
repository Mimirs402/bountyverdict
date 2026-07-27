import { execFile as execFileCallback } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { readPrivateJson } from "../src/agent-question-v6-activation.ts";
import { acquireExclusiveRun } from "../src/exclusive-run.ts";
import {
  POST_BOUNDARY_PULL_REQUEST,
  POST_BOUNDARY_REPOSITORY,
  exactWorkflowRun,
  selectExactWorkflowRun,
  validateActivatedManifest,
  validateActivationCommit,
  validateMergedReleasePullRequest,
  validateOpenReleasePullRequest,
  type ExactWorkflowRun,
} from "../src/post-boundary-release.ts";
import {
  POST_BOUNDARY_DRAIN_ID,
  RELEASE_CANDIDATE_BRANCH,
  RELEASE_CANDIDATE_WORKTREE,
  SNAPSHOT_SOURCE_COMMIT,
  SNAPSHOT_SOURCE_WORKTREE,
} from "../src/post-boundary-release-gate.ts";
import {
  FREE_SELECTION_ROUTER_EXPERIMENT_ID,
  parseTaskLeadingDescriptionActivation,
} from "../src/task-leading-description-experiment.ts";

const execFile = promisify(execFileCallback);
const enabled = process.env.EXECUTE_POST_BOUNDARY_RELEASE === "YES";
const stateDirectory = `${homedir()}/.local/state/bountyverdict`;
const lockPath = `${stateDirectory}/post-boundary-release.lock`;
const freeRouterActivationPath =
  `${homedir()}/.config/bountyverdict/free-selection-router-v1.activation.json`;
const runFields = "workflowName,status,conclusion,event,headBranch,headSha,databaseId,url,createdAt,updatedAt";
const pullFields = "number,state,baseRefName,baseRefOid,headRefName,headRefOid,mergeStateStatus,statusCheckRollup,mergedAt,mergeCommit";

async function run(executable: string, args: string[], cwd = RELEASE_CANDIDATE_WORKTREE, timeout = 30_000) {
  return (await execFile(executable, args, {
    cwd,
    timeout,
    maxBuffer: 4_000_000,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
  })).stdout.trim();
}

async function runWithEnvironment(
  executable: string,
  args: string[],
  cwd: string,
  extraEnvironment: NodeJS.ProcessEnv,
  timeout = 30_000,
) {
  return (await execFile(executable, args, {
    cwd,
    timeout,
    maxBuffer: 4_000_000,
    encoding: "utf8",
    env: { ...process.env, ...extraEnvironment, LC_ALL: "C", TZ: "UTC" },
  })).stdout.trim();
}

async function git(worktree: string, ...args: string[]) {
  return run("git", ["-C", worktree, ...args]);
}

async function pullRequest(): Promise<unknown> {
  return JSON.parse(await run("gh", [
    "pr", "view", String(POST_BOUNDARY_PULL_REQUEST),
    "--repo", POST_BOUNDARY_REPOSITORY,
    "--json", pullFields,
  ]));
}

async function remoteMain(): Promise<string> {
  const line = await git(RELEASE_CANDIDATE_WORKTREE, "ls-remote", "--exit-code", "origin", "refs/heads/main");
  const match = line.match(/^([a-f0-9]{40})\trefs\/heads\/main$/);
  if (!match) throw new Error("Authoritative origin/main is malformed.");
  return match[1];
}

async function listRuns(workflowFile: string, commit: string): Promise<unknown> {
  return JSON.parse(await run("gh", [
    "run", "list",
    "--repo", POST_BOUNDARY_REPOSITORY,
    "--workflow", workflowFile,
    "--commit", commit,
    "--limit", "30",
    "--json", runFields,
  ]));
}

async function waitForRun(
  workflowFile: string,
  expected: Parameters<typeof selectExactWorkflowRun>[1],
  allowDispatch: boolean,
): Promise<ExactWorkflowRun> {
  let selected = selectExactWorkflowRun(await listRuns(workflowFile, expected.headSha), expected);
  if (!selected && allowDispatch) {
    if (!enabled) throw new Error(`Post-boundary release is not armed to dispatch ${expected.workflowName}.`);
    const output = await run("gh", [
      "workflow", "run", workflowFile,
      "--repo", POST_BOUNDARY_REPOSITORY,
      "--ref", "main",
    ]);
    if (output && !/^https:\/\/github\.com\/Mimirs402\/bountyverdict\/actions\/runs\/[1-9][0-9]*$/.test(output)) {
      throw new Error(`${expected.workflowName} dispatch returned an unexpected response.`);
    }
  }
  for (let attempt = 0; !selected && attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    selected = selectExactWorkflowRun(await listRuns(workflowFile, expected.headSha), expected);
  }
  if (!selected) throw new Error(`${expected.workflowName} run did not appear for the exact release.`);
  if (selected.status !== "completed") {
    await run("gh", [
      "run", "watch", String(selected.databaseId),
      "--repo", POST_BOUNDARY_REPOSITORY,
      "--compact", "--exit-status", "--interval", "5",
    ], RELEASE_CANDIDATE_WORKTREE, 30 * 60_000);
    const refreshed = JSON.parse(await run("gh", [
      "run", "view", String(selected.databaseId),
      "--repo", POST_BOUNDARY_REPOSITORY,
      "--json", runFields,
    ]));
    selected = exactWorkflowRun(refreshed, expected);
  }
  if (selected.status !== "completed" || selected.conclusion !== "success") {
    throw new Error(`${expected.workflowName} did not complete successfully.`);
  }
  return selected;
}

async function releaseWorkflowEvidence(releaseMergeCommit: string, activationCommit: string) {
  const [releaseCi, deployment, activationCi, pages, registry] = await Promise.all([
    waitForRun("ci.yml", {
      workflowName: "CI",
      event: "push",
      headSha: releaseMergeCommit,
    }, false),
    waitForRun("deploy-worker.yml", {
      workflowName: "Deploy paid Worker",
      event: "workflow_dispatch",
      headSha: releaseMergeCommit,
    }, false),
    waitForRun("ci.yml", {
      workflowName: "CI",
      event: "push",
      headSha: activationCommit,
    }, false),
    waitForRun("pages-build-deployment", {
      workflowName: "pages-build-deployment",
      event: "dynamic",
      headSha: activationCommit,
    }, false),
    waitForRun("publish-mcp.yml", {
      workflowName: "Publish remote MCP server",
      event: "workflow_dispatch",
      headSha: activationCommit,
    }, false),
  ]);
  return { releaseCi, deployment, activationCi, pages, registry };
}

async function manifestAt(commit: string): Promise<{ value: unknown; activatedAt: string }> {
  const value = JSON.parse(await git(RELEASE_CANDIDATE_WORKTREE, "show", `${commit}:agent-manifest.json`));
  return { value, activatedAt: validateActivatedManifest(value) };
}

async function exactFreeRouterActivation(
  releaseMergeCommit: string,
  activationCommit: string,
  productionActivatedAt: string,
) {
  const value = await readPrivateJson(freeRouterActivationPath, 64 * 1024);
  if (!value) throw new Error("Free selection router activation receipt is missing.");
  const activation = parseTaskLeadingDescriptionActivation(value, FREE_SELECTION_ROUTER_EXPERIMENT_ID);
  if (!activation ||
      activation.release_commit !== releaseMergeCommit ||
      activation.production_activation_commit !== activationCommit ||
      activation.production_activated_at !== productionActivatedAt ||
      activation.drain_rotation_id !== POST_BOUNDARY_DRAIN_ID ||
      activation.measurement_epoch_id !== 57) {
    throw new Error("Free selection router activation does not match the exact production release.");
  }
  return activation;
}

async function main() {
  const releaseLock = await acquireExclusiveRun(lockPath, { staleAfterMs: 35 * 60_000 });
  try {
    if (await run("gh", ["api", "user", "--jq", ".login"]) !== "Mimirs402") {
      throw new Error("Post-boundary release requires the Mimir's Lab GitHub identity.");
    }
    if (await git(RELEASE_CANDIDATE_WORKTREE, "branch", "--show-current") !== RELEASE_CANDIDATE_BRANCH ||
        await git(RELEASE_CANDIDATE_WORKTREE, "status", "--porcelain=v1", "--untracked-files=all") !== "") {
      throw new Error("Post-boundary release requires the clean candidate worktree.");
    }
    const releaseCommit = await git(RELEASE_CANDIDATE_WORKTREE, "rev-parse", "HEAD");
    if (await git(RELEASE_CANDIDATE_WORKTREE, "rev-parse",
      `refs/remotes/origin/${RELEASE_CANDIDATE_BRANCH}`) !== releaseCommit) {
      throw new Error("Post-boundary release candidate is not synchronized to the business remote.");
    }
    const canonicalHead = await git(SNAPSHOT_SOURCE_WORKTREE, "rev-parse", "HEAD");
    if (canonicalHead !== SNAPSHOT_SOURCE_COMMIT) {
      if (await git(SNAPSHOT_SOURCE_WORKTREE, "status", "--porcelain=v1", "--untracked-files=all") !== "" ||
          await git(SNAPSHOT_SOURCE_WORKTREE, "branch", "--show-current") !== "main" ||
          await remoteMain() !== canonicalHead) {
        throw new Error("Advanced canonical main is not the exact clean authoritative release.");
      }
      const releaseMergeCommit = validateMergedReleasePullRequest(await pullRequest(), releaseCommit);
      const activationPayload = JSON.parse(await run("gh", [
        "api", `repos/${POST_BOUNDARY_REPOSITORY}/commits/${canonicalHead}`,
      ]));
      const activationCommit = validateActivationCommit(activationPayload, releaseMergeCommit);
      await git(RELEASE_CANDIDATE_WORKTREE, "fetch", "--no-tags", "origin",
        "refs/heads/main:refs/remotes/origin/main");
      const manifest = await manifestAt(activationCommit);
      await exactFreeRouterActivation(
        releaseMergeCommit,
        activationCommit,
        manifest.activatedAt,
      );
      const evidence = await releaseWorkflowEvidence(releaseMergeCommit, activationCommit);
      return {
        status: "already_released",
        release_candidate_commit: releaseCommit,
        release_merge_commit: releaseMergeCommit,
        production_activation_commit: activationCommit,
        measurement_epoch_id: 57,
        deployment_run: evidence.deployment.url,
        registry_run: evidence.registry.url,
      };
    }
    const gate = JSON.parse(await run("node", [
      "--experimental-strip-types",
      "scripts/verify-post-boundary-release-gate.ts",
    ], `${RELEASE_CANDIDATE_WORKTREE}/agent`, 5 * 60_000));
    if (gate.ready !== true || typeof gate.release_candidate_commit !== "string") {
      throw new Error("Post-boundary release gate did not return ready.");
    }
    if (gate.release_candidate_commit !== releaseCommit) {
      throw new Error("Post-boundary release gate candidate drifted.");
    }
    let pull = await pullRequest();
    let releaseMergeCommit: string;
    if ((pull as Record<string, unknown>).state === "OPEN") {
      validateOpenReleasePullRequest(pull, releaseCommit);
      if (await remoteMain() !== SNAPSHOT_SOURCE_COMMIT) {
        throw new Error("origin/main changed before the reviewed release merge.");
      }
      if (!enabled) {
        return { status: "armed_not_executed", release_candidate_commit: releaseCommit };
      }
      await run("gh", [
        "pr", "merge", String(POST_BOUNDARY_PULL_REQUEST),
        "--repo", POST_BOUNDARY_REPOSITORY,
        "--merge",
        "--match-head-commit", releaseCommit,
        "--subject", "Release free selector and executable x402 handoff (#11)",
      ], RELEASE_CANDIDATE_WORKTREE, 2 * 60_000);
      pull = await pullRequest();
      releaseMergeCommit = validateMergedReleasePullRequest(pull, releaseCommit);
    } else {
      releaseMergeCommit = validateMergedReleasePullRequest(pull, releaseCommit);
    }

    await git(RELEASE_CANDIDATE_WORKTREE, "fetch", "--no-tags", "origin", "refs/heads/main:refs/remotes/origin/main");
    await git(RELEASE_CANDIDATE_WORKTREE, "merge-base", "--is-ancestor", releaseMergeCommit, "refs/remotes/origin/main");
    await waitForRun("ci.yml", {
      workflowName: "CI",
      event: "push",
      headSha: releaseMergeCommit,
    }, false);
    const deployment = await waitForRun("deploy-worker.yml", {
      workflowName: "Deploy paid Worker",
      event: "workflow_dispatch",
      headSha: releaseMergeCommit,
    }, true);

    const activationHead = await remoteMain();
    const activationPayload = JSON.parse(await run("gh", [
      "api", `repos/${POST_BOUNDARY_REPOSITORY}/commits/${activationHead}`,
    ]));
    const activationCommit = validateActivationCommit(activationPayload, releaseMergeCommit);
    await git(RELEASE_CANDIDATE_WORKTREE, "fetch", "--no-tags", "origin",
      "refs/heads/main:refs/remotes/origin/main");
    const manifest = await manifestAt(activationCommit);
    await Promise.all([
      waitForRun("ci.yml", {
        workflowName: "CI",
        event: "push",
        headSha: activationCommit,
      }, false),
      waitForRun("pages-build-deployment", {
        workflowName: "pages-build-deployment",
        event: "dynamic",
        headSha: activationCommit,
      }, false),
    ]);
    const registry = await waitForRun("publish-mcp.yml", {
      workflowName: "Publish remote MCP server",
      event: "workflow_dispatch",
      headSha: activationCommit,
    }, true);

    const activationResult = JSON.parse(await runWithEnvironment(
      "node",
      ["--experimental-strip-types", "scripts/activate-free-selection-router.ts"],
      `${RELEASE_CANDIDATE_WORKTREE}/agent`,
      {
        ACTIVATE_FREE_SELECTION_ROUTER_EXPERIMENT: "YES",
        FREE_SELECTION_ROUTER_RELEASE_COMMIT: releaseMergeCommit,
        FREE_SELECTION_ROUTER_PRODUCTION_ACTIVATION_COMMIT: activationCommit,
        FREE_SELECTION_ROUTER_PRODUCTION_ACTIVATED_AT: manifest.activatedAt,
        FREE_SELECTION_ROUTER_DRAIN_ROTATION_ID: POST_BOUNDARY_DRAIN_ID,
      },
    ));
    if ((activationResult.status !== "activated" && activationResult.status !== "already_activated") ||
        activationResult.measurement_epoch_id !== 57) {
      throw new Error("Free selection router is still awaiting the exact clean post-release epoch.");
    }
    await exactFreeRouterActivation(
      releaseMergeCommit,
      activationCommit,
      manifest.activatedAt,
    );
    if (await git(SNAPSHOT_SOURCE_WORKTREE, "status", "--porcelain=v1", "--untracked-files=all") !== "" ||
        await git(SNAPSHOT_SOURCE_WORKTREE, "branch", "--show-current") !== "main") {
      throw new Error("Canonical main worktree is not clean after the immutable snapshot.");
    }
    await git(SNAPSHOT_SOURCE_WORKTREE, "fetch", "--no-tags", "origin", "refs/heads/main:refs/remotes/origin/main");
    await git(SNAPSHOT_SOURCE_WORKTREE, "merge", "--ff-only", "refs/remotes/origin/main");
    if (await git(SNAPSHOT_SOURCE_WORKTREE, "rev-parse", "HEAD") !== activationCommit) {
      throw new Error("Canonical main did not fast-forward to the production activation.");
    }
    return {
      status: "released",
      release_candidate_commit: releaseCommit,
      release_merge_commit: releaseMergeCommit,
      production_activation_commit: activationCommit,
      measurement_epoch_id: 57,
      deployment_run: deployment.url,
      registry_run: registry.url,
    };
  } finally {
    await releaseLock();
  }
}

console.log(JSON.stringify(await main(), null, 2));
