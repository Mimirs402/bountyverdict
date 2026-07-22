import { createHash } from "node:crypto";
import { trustedBoundaryFingerprint, trustedFunnelBaseline } from "./funnel-epoch.ts";
import {
  FUNNEL_COLLECTOR_CAPABILITIES,
  isFunnelSnapshot,
} from "./funnel-telemetry.ts";

export const AGENTMRR_BASE_URL = "https://agentmrr.ai";
export const AGENTMRR_REQUIRED_RELEASE_COMMIT = "eaa4c2481ac0ccc15a931790f490b950e623e291";
export const AGENTMRR_REVIEWED_SOURCE_COMMIT = "f23f043142f356584393992f399f6b11e560920d";
export const AGENTMRR_CODE_GATE_COMMIT = "ec1b7f827015408efc54c6c2e34e17ccbd573bda";
export const AGENTMRR_CODE_RELEASE_CONTRACT = "agentmrr-attribution-v1";
export const AGENTMRR_AGENT_NAME = "BountyVerdict";
export const AGENTMRR_CATALOG_LIMIT = 1_000;
export const AGENTMRR_ROTATION_REASON =
  "AgentMRR publication can trigger unattributed downstream origin crawls; exclude the publication and drain until external aggregates are stable.";
export const AGENTMRR_AGENT_DESCRIPTION =
  "Runs evidence-linked, read-only GitHub bounty, repository-agent, Actions, flake, and MCP drift checks.";
export const AGENTMRR_RUN_ENDPOINT =
  "https://bountyverdict-agent-production.mimirslab.workers.dev/api/github-actions-run-diagnosis?source=agentmrr";
export const AGENTMRR_MCP_ENDPOINT =
  "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp?source=agentmrr";

export const AGENTMRR_PRODUCT = Object.freeze({
  name: "RunVerdict",
  tagline: "Diagnose why a public GitHub Actions run failed with cited evidence.",
  type: "api",
  category: "developer-tools",
  description:
    `Send {"run_url":"https://github.com/OWNER/REPO/actions/runs/ID"} to POST ${AGENTMRR_RUN_ENDPOINT}. RunVerdict reads bounded failed-job logs without executing or rerunning code, redacts secret-like excerpts, cites job and log evidence, classifies likely root-cause families, and returns probabilistic retryability with concrete next actions. A valid unsigned request first discloses the exact $0.04 Base USDC x402 requirement. The same RunVerdict product is the diagnose_github_actions_run tool at ${AGENTMRR_MCP_ENDPOINT}; tool discovery is free.`,
  github_url: "https://github.com/Mimirs402/bountyverdict",
  docs_url: "https://mimirs402.github.io/bountyverdict/agents.html",
  pricing_model: "paid",
  tags: ["github-actions", "ci-cd", "debugging", "coding-agents", "x402", "mcp"],
});
export const AGENTMRR_PRODUCT_CONTRACT_SHA256 = createHash("sha256")
  .update(JSON.stringify(AGENTMRR_PRODUCT))
  .digest("hex");

export interface AgentMrrChallenge {
  nonce: string;
  difficulty: number;
}

export interface AgentMrrRegistration {
  agentId: string;
  apiKey: string;
}

export interface AgentMrrProductRecord {
  id: string;
  name: string;
  exact: boolean;
  submittedBy: string;
}

export interface AgentMrrPublicationGateInput {
  releaseState: unknown;
  releaseMode: number;
  releaseOwnerUid: number;
  codeReleaseState: unknown;
  codeReleaseMode: number;
  codeReleaseOwnerUid: number;
  baselineMode: number;
  baselineOwnerUid: number;
  historyMode: number;
  historyOwnerUid: number;
  collectorState: unknown;
  collectorMode: number;
  collectorOwnerUid: number;
  expectedUid: number;
  trustedBaseline: unknown;
  baselineEpochId: number;
  funnelLedger: unknown;
  expectedRotationId: string;
  now: Date;
}

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function isAgentMrrUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export async function readAgentMrrJsonResponse(
  response: Response,
  operation: string,
  maximumBytes = 262_144,
): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 1_048_576) {
    throw new Error("AgentMRR response bound is invalid.");
  }
  if (!response.ok) throw new Error(`AgentMRR ${operation} returned HTTP ${response.status}.`);
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new Error(`AgentMRR ${operation} returned a non-JSON response.`);
  }
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    throw new Error(`AgentMRR ${operation} response exceeded the byte limit.`);
  }
  if (!response.body) throw new Error(`AgentMRR ${operation} returned an empty response.`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel();
      throw new Error(`AgentMRR ${operation} response exceeded the byte limit.`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new Error(`AgentMRR ${operation} returned invalid JSON.`);
  }
}

export function parseAgentMrrSecret(value: string): AgentMrrRegistration {
  if (typeof value !== "string" || value.length > 512) {
    throw new Error("AgentMRR credential file is invalid.");
  }
  const match = value.match(
    /^AGENTMRR_AGENT_ID=([a-f0-9-]{36})\nAGENTMRR_API_KEY=(ah_[A-Za-z0-9_-]{16,128})\n?$/,
  );
  if (!match || !isAgentMrrUuid(match[1])) throw new Error("AgentMRR credential file is invalid.");
  return { agentId: match[1], apiKey: match[2] };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AgentMRR returned an invalid object.");
  }
  return value as Record<string, unknown>;
}

export function parseAgentMrrChallenge(value: unknown): AgentMrrChallenge {
  const payload = record(value);
  if (typeof payload.nonce !== "string" || !/^[a-f0-9]{32,128}$/.test(payload.nonce)) {
    throw new Error("AgentMRR returned an invalid proof-of-work nonce.");
  }
  if (!Number.isSafeInteger(payload.difficulty) || Number(payload.difficulty) < 1 || Number(payload.difficulty) > 5) {
    throw new Error("AgentMRR returned an unsupported proof-of-work difficulty.");
  }
  return { nonce: payload.nonce, difficulty: Number(payload.difficulty) };
}

export function solveAgentMrrChallenge(challenge: AgentMrrChallenge, maxIterations = 5_000_000): string {
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > 5_000_000) {
    throw new Error("AgentMRR proof-of-work iteration bound is invalid.");
  }
  const prefix = "0".repeat(challenge.difficulty);
  for (let index = 0; index < maxIterations; index += 1) {
    const solution = index.toString(36);
    const digest = createHash("sha256").update(challenge.nonce + solution).digest("hex");
    if (digest.startsWith(prefix)) return solution;
  }
  throw new Error("AgentMRR proof-of-work exceeded the bounded iteration limit.");
}

export function parseAgentMrrRegistration(value: unknown): AgentMrrRegistration {
  const payload = record(value);
  const apiKey = payload.api_key;
  const agentId = payload.agent_id ?? payload.id;
  if (typeof apiKey !== "string" || !/^ah_[A-Za-z0-9_-]{16,128}$/.test(apiKey)) {
    throw new Error("AgentMRR returned an invalid API key.");
  }
  if (!isAgentMrrUuid(agentId)) {
    throw new Error("AgentMRR returned an invalid agent identity.");
  }
  return { apiKey, agentId };
}

function exactProduct(item: Record<string, unknown>): boolean {
  const tags = item.tags;
  return item.name === AGENTMRR_PRODUCT.name &&
    item.tagline === AGENTMRR_PRODUCT.tagline &&
    item.type === AGENTMRR_PRODUCT.type &&
    item.category === AGENTMRR_PRODUCT.category &&
    item.description === AGENTMRR_PRODUCT.description &&
    item.github_url === AGENTMRR_PRODUCT.github_url &&
    item.docs_url === AGENTMRR_PRODUCT.docs_url &&
    item.pricing_model === AGENTMRR_PRODUCT.pricing_model &&
    Array.isArray(tags) &&
    tags.length === AGENTMRR_PRODUCT.tags.length &&
    AGENTMRR_PRODUCT.tags.every((tag, index) => tags[index] === tag);
}

export function parseAgentMrrCatalog(
  value: unknown,
  requestedLimit = AGENTMRR_CATALOG_LIMIT,
): AgentMrrProductRecord | null {
  const payload = record(value);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > AGENTMRR_CATALOG_LIMIT ||
      !Array.isArray(payload.products) || payload.products.length > requestedLimit ||
      !Number.isSafeInteger(payload.total) || payload.total !== payload.products.length ||
      payload.sort !== "newest" || payload.has_more === true ||
      (payload.next_cursor !== undefined && payload.next_cursor !== null) ||
      (payload.cursor !== undefined && payload.cursor !== null)) {
    throw new Error("AgentMRR returned an invalid or unbounded product catalog.");
  }
  if (payload.products.length === requestedLimit) {
    throw new Error("AgentMRR duplicate check is incomplete at the bounded catalog limit.");
  }
  const matches = payload.products
    .map(record)
    .filter((item) => item.name === AGENTMRR_PRODUCT.name);
  if (matches.length > 1) throw new Error("AgentMRR returned duplicate BountyVerdict products.");
  if (!matches.length) return null;
  const item = matches[0];
  if (!isAgentMrrUuid(item.id) || !isAgentMrrUuid(item.submitted_by)) {
    throw new Error("AgentMRR returned an invalid BountyVerdict product identity.");
  }
  return { id: item.id, name: AGENTMRR_PRODUCT.name, exact: exactProduct(item), submittedBy: item.submitted_by };
}

export function parseAgentMrrPublishedProduct(value: unknown, expectedOwner: string): AgentMrrProductRecord {
  const item = record(value);
  const product = "product" in item ? record(item.product) : item;
  if (!isAgentMrrUuid(expectedOwner) || !isAgentMrrUuid(product.id) || product.submitted_by !== expectedOwner ||
      product.name !== AGENTMRR_PRODUCT.name || !exactProduct(product)) {
    throw new Error("AgentMRR returned a drifted published product.");
  }
  return { id: product.id, name: AGENTMRR_PRODUCT.name, exact: true, submittedBy: expectedOwner };
}

export function validateAgentMrrReleaseState(
  releaseState: unknown,
  releaseMode: number,
  releaseOwnerUid: number,
  expectedUid: number,
): void {
  const release = record(releaseState);
  if (releaseMode !== 0o600 || releaseOwnerUid !== expectedUid ||
      release.schema_version !== 1 || release.status !== "complete" ||
      release.release_commit !== AGENTMRR_REQUIRED_RELEASE_COMMIT) {
    throw new Error("AgentMRR publication requires the exact completed reviewed release.");
  }
}

export function validateAgentMrrCodeReleaseState(
  codeReleaseState: unknown,
  codeReleaseMode: number,
  codeReleaseOwnerUid: number,
  expectedUid: number,
): void {
  const release = record(codeReleaseState);
  if (codeReleaseMode !== 0o600 || codeReleaseOwnerUid !== expectedUid || expectedUid < 0 ||
      release.schema_version !== 1 || release.status !== "complete" ||
      release.source_head !== AGENTMRR_CODE_GATE_COMMIT ||
      release.reviewed_source !== AGENTMRR_REVIEWED_SOURCE_COMMIT ||
      release.code_contract !== AGENTMRR_CODE_RELEASE_CONTRACT ||
      typeof release.release_commit !== "string" || !/^[a-f0-9]{40}$/.test(release.release_commit) ||
      release.remote_main !== release.release_commit ||
      typeof release.completed_at !== "string" || !Number.isFinite(Date.parse(release.completed_at))) {
    throw new Error("AgentMRR publication requires the exact completed code release.");
  }
}

export function validateAgentMrrLiveCollector(
  collectorState: unknown,
  collectorMode: number,
  collectorOwnerUid: number,
  expectedUid: number,
  now: Date,
): void {
  const collector = isFunnelSnapshot(collectorState) ? collectorState : null;
  const collectorHeartbeat = collector ? Date.parse(collector.collector_heartbeat_at) : NaN;
  const collectorAgeMs = now instanceof Date ? now.getTime() - collectorHeartbeat : NaN;
  const capabilityHeartbeats = collector
    ? FUNNEL_COLLECTOR_CAPABILITIES.map((capability) =>
      Date.parse(collector.collector_capability_heartbeats[capability] || ""))
    : [];
  if (collectorMode !== 0o600 || collectorOwnerUid !== expectedUid || expectedUid < 0 ||
      !(now instanceof Date) || !Number.isFinite(now.getTime()) || !collector ||
      !FUNNEL_COLLECTOR_CAPABILITIES.every((capability) =>
        collector.collector_capabilities.includes(capability)) ||
      !Number.isFinite(collectorHeartbeat) || collectorAgeMs < -5_000 || collectorAgeMs > 60_000 ||
      capabilityHeartbeats.length !== FUNNEL_COLLECTOR_CAPABILITIES.length ||
      capabilityHeartbeats.some((heartbeat) => !Number.isFinite(heartbeat) ||
        now.getTime() - heartbeat < -5_000 || now.getTime() - heartbeat > 60_000)) {
    throw new Error("AgentMRR publication requires a fresh capable collector lease.");
  }
}

export function validateAgentMrrPublicationAttempt(
  value: unknown,
  mode: number,
  ownerUid: number,
  expectedUid: number,
  expectedAgentId: string,
  expectedCodeReleaseCommit: string,
): string {
  const attempt = record(value);
  if (mode !== 0o600 || ownerUid !== expectedUid || expectedUid < 0 || !isAgentMrrUuid(expectedAgentId) ||
      !/^[a-f0-9]{40}$/.test(expectedCodeReleaseCommit) || attempt.schema_version !== 1 ||
      attempt.status !== "posting" || attempt.agent_id !== expectedAgentId ||
      attempt.product_contract_sha256 !== AGENTMRR_PRODUCT_CONTRACT_SHA256 ||
      attempt.code_release_commit !== expectedCodeReleaseCommit ||
      typeof attempt.rotation_id !== "string" ||
      !/^agentmrr-publish-[a-z0-9]{6,24}-[a-f0-9]{16}$/.test(attempt.rotation_id) ||
      typeof attempt.created_at !== "string" || !Number.isFinite(Date.parse(attempt.created_at))) {
    throw new Error("AgentMRR existing listing requires the exact publication attempt receipt.");
  }
  return attempt.rotation_id;
}

export function validateAgentMrrPublicationGate(input: AgentMrrPublicationGateInput): void {
  const release = record(input.releaseState);
  const ledger = record(input.funnelLedger);
  const rotation = record(ledger.rotation);
  validateAgentMrrReleaseState(release, input.releaseMode, input.releaseOwnerUid, input.expectedUid);
  validateAgentMrrCodeReleaseState(
    input.codeReleaseState,
    input.codeReleaseMode,
    input.codeReleaseOwnerUid,
    input.expectedUid,
  );
  validateAgentMrrLiveCollector(
    input.collectorState,
    input.collectorMode,
    input.collectorOwnerUid,
    input.expectedUid,
    input.now,
  );
  if (input.baselineMode !== 0o600 || input.baselineOwnerUid !== input.expectedUid ||
      input.historyMode !== 0o600 || input.historyOwnerUid !== input.expectedUid ||
      input.collectorMode !== 0o600 || input.collectorOwnerUid !== input.expectedUid ||
      input.expectedUid < 0) {
    throw new Error("AgentMRR publication requires the exact completed reviewed release.");
  }
  if (!Array.isArray(ledger.epochs) || ledger.epochs.length < 1 || ledger.epochs.length > 200 ||
      typeof input.expectedRotationId !== "string" ||
      !/^agentmrr-publish-[a-z0-9]{6,24}-[a-f0-9]{16}$/.test(input.expectedRotationId) ||
      !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw new Error("AgentMRR publication requires an active trusted-funnel draining rotation.");
  }
  const baseline = trustedFunnelBaseline(input.trustedBaseline);
  const activeMatches = ledger.epochs
    .map(record)
    .filter((epoch) => epoch.id === input.baselineEpochId);
  const active = activeMatches.length === 1 ? activeMatches[0] : null;
  const activeBaseline = active ? trustedFunnelBaseline(active.baseline) : null;
  const candidate = trustedFunnelBaseline(rotation.candidate);
  const requestedAt = typeof rotation.requested_at === "string" ? Date.parse(rotation.requested_at) : NaN;
  const observedAt = typeof rotation.last_observed_at === "string" ? Date.parse(rotation.last_observed_at) : NaN;
  const ageMs = input.now.getTime() - requestedAt;
  if (!Number.isSafeInteger(input.baselineEpochId) || input.baselineEpochId < 1 ||
      ledger.schema_version !== 2 || ledger.active_epoch_id !== input.baselineEpochId ||
      rotation.status !== "draining" || rotation.id !== input.expectedRotationId ||
      rotation.reason !== AGENTMRR_ROTATION_REASON || rotation.target_epoch_id !== input.baselineEpochId + 1 ||
      !Number.isSafeInteger(rotation.observations) || Number(rotation.observations) < 1 ||
      !Number.isFinite(requestedAt) || !Number.isFinite(observedAt) || observedAt < requestedAt ||
      ageMs < -5_000 || ageMs > 300_000 ||
      !active || active.status !== "draining" || active.conversion_eligible !== false ||
      !baseline || baseline.epoch_id !== input.baselineEpochId ||
      !activeBaseline || activeBaseline.epoch_id !== input.baselineEpochId ||
      trustedBoundaryFingerprint(activeBaseline) !== trustedBoundaryFingerprint(baseline) ||
      !candidate || candidate.epoch_id !== input.baselineEpochId + 1) {
    throw new Error("AgentMRR publication requires an active trusted-funnel draining rotation.");
  }
}
