import {
  AGENTMRR_CODE_GATE_COMMIT,
  AGENTMRR_CODE_RELEASE_CONTRACT,
  AGENTMRR_REVIEWED_SOURCE_COMMIT,
  validateAgentMrrCodeReleaseState,
} from "./agentmrr.ts";

export const AGENTMRR_RECONCILIATION_BASE_COMMIT = "2dbe744508b05e185c5701ab66cb898064d3e1c9";
export const AGENTMRR_PREVIOUS_CODE_RELEASE = "6ff3091f7fad214ba92dd9bc8f7337e3d0dad65e";
export const AGENTMRR_PREVIOUS_RELEASE_SOURCE = "59431bb13e8c26a9bd24702759ec802148aec3d9";
export const AGENTMRR_PREVIOUS_RECEIPT_SHA256 = "ad87e3b9ef19d9f0e1fd15e29fefdf4813bc1c5a88d63e308b65c04974b56fa7";
export const AGENTMRR_PRODUCTION_RELEASE = "556b35fc200240d89a4f855716232c6484cb1e1d";
export const AGENTMRR_PRODUCTION_ACTIVATION = "4aaf56a074f91b8f74f20d72373c35ddcd2efd82";

export const AGENTMRR_RECONCILIATION_FILES = Object.freeze([
  "JOURNAL.md",
  "agent/package.json",
  "agent/scripts/release-agentmrr-current.ts",
  "agent/scripts/reconcile-agentmrr-code-release.ts",
  "agent/src/agentmrr-reconciliation.ts",
  "agent/tests/agentmrr-reconciliation.test.ts",
] as const);

export type AgentMrrReconciliationCommandResult = {
  status: "reconciled" | "already_reconciled";
  releaseCommit: string;
};

export function parseAgentMrrReconciliationCommandResult(value: unknown): AgentMrrReconciliationCommandResult {
  const result = record(value);
  if ((result.status !== "reconciled" && result.status !== "already_reconciled") ||
      result.production_release !== AGENTMRR_PRODUCTION_RELEASE) {
    throw new Error("AgentMRR reconciliation command did not complete exactly.");
  }
  return { status: result.status, releaseCommit: commit(result.release_commit, "reconciled release commit") };
}

export function parseAgentMrrPublicationCommandResult(value: unknown): {
  action: "published" | "existing";
  productId: string;
} {
  const result = record(value);
  if ((result.action !== "published" && result.action !== "existing") || result.name !== "RunVerdict" ||
      typeof result.product_id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(result.product_id)) {
    throw new Error("AgentMRR publication command did not return the exact product.");
  }
  return { action: result.action, productId: result.product_id };
}

type WorkflowRun = {
  workflowName: string;
  status: string;
  conclusion: string;
  event: string;
  headBranch: string;
  headSha: string;
  databaseId: number;
  url: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentMrrReconciliationEvidence = {
  previousReceipt: unknown;
  previousReceiptSha256: string;
  previousReceiptMode: number;
  previousReceiptOwnerUid: number;
  expectedUid: number;
  currentCommit: string;
  currentReleaseSourceCommit: string;
  currentTree: string;
  ciRun: unknown;
  pagesRun: unknown;
  productionDeployRun: unknown;
  now: Date;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AgentMRR reconciliation evidence is malformed.");
  }
  return value as Record<string, unknown>;
}

function commit(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(`AgentMRR ${label} is malformed.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`AgentMRR ${label} is malformed.`);
  }
  return value;
}

export function exactSuccessfulRun(
  value: unknown,
  expected: { workflowName: string; event: string; headSha: string },
): WorkflowRun {
  const run = record(value);
  if (run.workflowName !== expected.workflowName || run.event !== expected.event ||
      run.headBranch !== "main" || run.headSha !== expected.headSha ||
      run.status !== "completed" || run.conclusion !== "success" ||
      !Number.isSafeInteger(run.databaseId) || Number(run.databaseId) < 1 ||
      typeof run.url !== "string" ||
      !/^https:\/\/github\.com\/Mimirs402\/bountyverdict\/actions\/runs\/[1-9][0-9]*$/.test(run.url) ||
      Number(run.url.split("/").at(-1)) !== run.databaseId) {
    throw new Error(`AgentMRR ${expected.workflowName} run is not the exact successful release evidence.`);
  }
  return {
    workflowName: run.workflowName,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    headBranch: run.headBranch,
    headSha: run.headSha,
    databaseId: Number(run.databaseId),
    url: run.url,
    createdAt: timestamp(run.createdAt, `${expected.workflowName} creation time`),
    updatedAt: timestamp(run.updatedAt, `${expected.workflowName} update time`),
  };
}

export function buildAgentMrrReconciledCodeRelease(input: AgentMrrReconciliationEvidence) {
  validateAgentMrrCodeReleaseState(
    input.previousReceipt,
    input.previousReceiptMode,
    input.previousReceiptOwnerUid,
    input.expectedUid,
    AGENTMRR_PREVIOUS_CODE_RELEASE,
    AGENTMRR_PREVIOUS_RELEASE_SOURCE,
  );
  record(input.previousReceipt);
  if (input.previousReceiptSha256 !== AGENTMRR_PREVIOUS_RECEIPT_SHA256) {
    throw new Error("AgentMRR previous receipt hash does not match the reviewed receipt.");
  }
  const currentCommit = commit(input.currentCommit, "current release commit");
  const currentReleaseSourceCommit = commit(input.currentReleaseSourceCommit, "current release source commit");
  const currentTree = commit(input.currentTree, "current release tree");
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw new Error("AgentMRR reconciliation time is malformed.");
  }
  const ci = exactSuccessfulRun(input.ciRun, {
    workflowName: "CI",
    event: "push",
    headSha: currentCommit,
  });
  const pages = exactSuccessfulRun(input.pagesRun, {
    workflowName: "pages-build-deployment",
    event: "dynamic",
    headSha: currentCommit,
  });
  const deploy = exactSuccessfulRun(input.productionDeployRun, {
    workflowName: "Deploy paid Worker",
    event: "workflow_dispatch",
    headSha: AGENTMRR_PRODUCTION_RELEASE,
  });
  if (Date.parse(ci.updatedAt) > input.now.getTime() || Date.parse(pages.updatedAt) > input.now.getTime() ||
      Date.parse(deploy.updatedAt) > input.now.getTime()) {
    throw new Error("AgentMRR reconciliation cannot use future release evidence.");
  }
  return {
    schema_version: 1,
    status: "complete",
    completed_at: input.now.toISOString(),
    source_head: AGENTMRR_CODE_GATE_COMMIT,
    release_source_head: currentReleaseSourceCommit,
    reviewed_source: AGENTMRR_REVIEWED_SOURCE_COMMIT,
    code_contract: AGENTMRR_CODE_RELEASE_CONTRACT,
    hardening_parent: currentCommit,
    merge_tree: currentTree,
    release_commit: currentCommit,
    remote_main: currentCommit,
    checks: { ci, pages },
    production: {
      release_commit: AGENTMRR_PRODUCTION_RELEASE,
      activation_commit: AGENTMRR_PRODUCTION_ACTIVATION,
      deploy_run: deploy,
    },
    supersedes: {
      release_commit: AGENTMRR_PREVIOUS_CODE_RELEASE,
      receipt_sha256: input.previousReceiptSha256,
    },
  } as const;
}

export function validateAgentMrrReconciledCodeRelease(
  value: unknown,
  mode: number,
  ownerUid: number,
  expectedUid: number,
  expectedCommit: string,
  expectedReleaseSourceCommit: string,
  expectedTree: string,
  previousReceiptSha256: string,
  ciRun: unknown,
  pagesRun: unknown,
  productionDeployRun: unknown,
  now: Date,
): void {
  validateAgentMrrCodeReleaseState(
    value, mode, ownerUid, expectedUid, expectedCommit, expectedReleaseSourceCommit,
  );
  const receipt = record(value);
  const production = record(receipt.production);
  const supersedes = record(receipt.supersedes);
  const checks = record(receipt.checks);
  const completedAt = timestamp(receipt.completed_at, "reconciliation completion time");
  if (receipt.hardening_parent !== expectedCommit || receipt.merge_tree !== expectedTree ||
      production.release_commit !== AGENTMRR_PRODUCTION_RELEASE ||
      production.activation_commit !== AGENTMRR_PRODUCTION_ACTIVATION ||
      supersedes.release_commit !== AGENTMRR_PREVIOUS_CODE_RELEASE ||
      previousReceiptSha256 !== AGENTMRR_PREVIOUS_RECEIPT_SHA256 ||
      supersedes.receipt_sha256 !== previousReceiptSha256 ||
      !(now instanceof Date) || !Number.isFinite(now.getTime()) || Date.parse(completedAt) > now.getTime()) {
    throw new Error("AgentMRR reconciled code release receipt is not exact.");
  }
  const expectedCi = exactSuccessfulRun(ciRun, { workflowName: "CI", event: "push", headSha: expectedCommit });
  const expectedPages = exactSuccessfulRun(pagesRun, {
    workflowName: "pages-build-deployment", event: "dynamic", headSha: expectedCommit,
  });
  const expectedDeploy = exactSuccessfulRun(productionDeployRun, {
    workflowName: "Deploy paid Worker", event: "workflow_dispatch", headSha: AGENTMRR_PRODUCTION_RELEASE,
  });
  if (JSON.stringify(checks.ci) !== JSON.stringify(expectedCi) ||
      JSON.stringify(checks.pages) !== JSON.stringify(expectedPages) ||
      JSON.stringify(production.deploy_run) !== JSON.stringify(expectedDeploy)) {
    throw new Error("AgentMRR reconciled code release evidence drifted.");
  }
}
