const addressPattern = /^0x[a-f0-9]{40}$/i;
const txPattern = /^0x[a-f0-9]{64}$/i;
const moneyPattern = /^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/;
const sqlTimestampPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const maximumRecords = 500;
const maximumCompetition = 2;
const minimumGrossAtomic = 110_000_000n;
const minimumNetAtomic = 100_000_000n;
const maximumAgeMs = 12 * 60 * 60 * 1_000;
const minimumRemainingMs = 2 * 60 * 60 * 1_000;

export const ZEROXWORK_API = "https://api.0xwork.org";
export const ZEROXWORK_TASK_POOL = "0xf404afdba46e05af7b395fb45c43e66db549c6d2";
export const ZEROXWORK_BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const ZEROXWORK_TASK_POSTED_TOPIC =
  "0xcdf01a7fce2cec80e8e617626f3f34f334ed96168dfcbebc5b9fd0a64170337e";
export const ZEROXWORK_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type JsonRecord = Record<string, unknown>;

export type ZeroxWorkTask = {
  id: number;
  chainTaskId: number | null;
  posterAddress: string;
  workerAddress: string | null;
  description: string;
  title: string | null;
  category: "Writing" | "Research" | "Code" | "Creative" | "Data" | "Social" | "Verification";
  bountyAmount: string;
  deadline: number | null;
  status: "Open";
  createdAt: string;
  transactionHash: string | null;
  contractVersion: string;
  preferredAgentId: number | null;
  hireType: string;
  requireApproval: boolean;
  allowBidding: boolean;
  resultsBased: boolean;
  claimScope: string;
  attemptCount: number;
  applicationCount: number;
  hasCapabilityRestrictions: boolean;
};

export type ZeroxWorkPage = {
  tasks: ZeroxWorkTask[];
  total: number;
  total_value: string;
  limit: number;
  offset: number;
};

export type ZeroxWorkOnchainEvidence = {
  task_id: number;
  chain_task_id: number;
  transaction_hash: string;
  receipt: unknown;
  onchain_task: {
    poster: string;
    worker: string;
    description: string;
    bounty_amount: string;
    deadline: string;
    state: number;
  };
  fee_bps: number;
  protocol_paused: boolean;
  task_paused: boolean;
};

function object(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed.`);
  return value as JsonRecord;
}

function string(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== "string" || !value || value.trim() !== value || value.length > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function nullableString(value: unknown, label: string, maximum = 500): string | null {
  return value === null ? null : string(value, label, maximum);
}

function address(value: unknown, label: string): string {
  const parsed = string(value, label, 42);
  if (!addressPattern.test(parsed)) throw new Error(`${label} is invalid.`);
  return parsed.toLowerCase();
}

function nullableAddress(value: unknown, label: string): string | null {
  return value === null ? null : address(value, label);
}

function integer(value: unknown, label: string, maximum = 10_000_000): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return Number(value);
}

function nullableInteger(value: unknown, label: string, maximum = 10_000_000): number | null {
  return value === null ? null : integer(value, label, maximum);
}

function positiveInteger(value: unknown, label: string, maximum = 10_000_000): number {
  const parsed = integer(value, label, maximum);
  if (parsed === 0) throw new Error(`${label} is invalid.`);
  return parsed;
}

function nullablePositiveInteger(value: unknown, label: string, maximum = 10_000_000): number | null {
  return value === null ? null : positiveInteger(value, label, maximum);
}

function flag(value: unknown, label: string): boolean {
  if (value !== 0 && value !== 1) throw new Error(`${label} is invalid.`);
  return value === 1;
}

function atomic(value: unknown, label: string, allowZero = false): bigint {
  const parsed = string(value, label, 32);
  if (!moneyPattern.test(parsed)) throw new Error(`${label} is invalid.`);
  const [whole, fraction = ""] = parsed.split(".");
  const amount = BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  if ((!allowZero && amount <= 0n) || amount < 0n || amount > 1_000_000_000_000_000n) {
    throw new Error(`${label} is outside bounds.`);
  }
  return amount;
}

function decimal(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = String(value % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function taskTimestamp(value: unknown): string {
  const parsed = string(value, "0xWork creation time", 19);
  if (!sqlTimestampPattern.test(parsed) || !Number.isFinite(Date.parse(`${parsed.replace(" ", "T")}Z`))) {
    throw new Error("0xWork creation time is invalid.");
  }
  return `${parsed.replace(" ", "T")}Z`;
}

function parseTask(value: unknown): ZeroxWorkTask {
  const task = object(value, "0xWork task");
  if (task.status !== "Open") throw new Error("0xWork open feed contains a non-open task.");
  const transactionHash = nullableString(task.tx_hash, "0xWork posting transaction", 66);
  if (transactionHash !== null && !txPattern.test(transactionHash)) {
    throw new Error("0xWork posting transaction is invalid.");
  }
  const category = string(task.category, "0xWork category", 32);
  if (!["Writing", "Research", "Code", "Creative", "Data", "Social", "Verification"].includes(category)) {
    throw new Error("0xWork category is unsupported.");
  }
  return {
    id: positiveInteger(task.id, "0xWork task ID"),
    chainTaskId: nullablePositiveInteger(task.chain_task_id, "0xWork chain task ID"),
    posterAddress: address(task.poster_address, "0xWork poster"),
    workerAddress: nullableAddress(task.worker_address, "0xWork worker"),
    description: string(task.description, "0xWork description", 20_000),
    title: nullableString(task.title, "0xWork title", 500),
    category: category as ZeroxWorkTask["category"],
    bountyAmount: decimal(atomic(task.bounty_amount, "0xWork bounty")),
    deadline: nullableInteger(task.deadline, "0xWork deadline", 10_000_000_000),
    status: "Open",
    createdAt: taskTimestamp(task.created_at),
    transactionHash: transactionHash?.toLowerCase() || null,
    contractVersion: string(task.contract_version, "0xWork contract version", 16),
    preferredAgentId: nullableInteger(task.preferred_agent_id, "0xWork preferred agent ID"),
    hireType: string(task.hire_type, "0xWork hire type", 32),
    requireApproval: flag(task.require_approval, "0xWork approval flag"),
    allowBidding: flag(task.allow_bidding, "0xWork bidding flag"),
    resultsBased: flag(task.results_based, "0xWork results-based flag"),
    claimScope: string(task.claim_scope, "0xWork claim scope", 32),
    attemptCount: integer(task.attempt_count, "0xWork attempt count", 100_000),
    applicationCount: integer(task.application_count, "0xWork application count", 100_000),
    hasCapabilityRestrictions: [
      task.min_followers,
      task.min_reputation,
      task.min_tasks_completed,
      task.min_rating,
      task.min_cred_score,
      task.linked_service_id,
    ].some((item) => item !== null),
  };
}

export function parseZeroxWorkPage(value: unknown): ZeroxWorkPage {
  const page = object(value, "0xWork task page");
  if (!Array.isArray(page.tasks) || page.tasks.length > 100) throw new Error("0xWork task page is oversized.");
  const tasks = page.tasks.map(parseTask);
  if (new Set(tasks.map(({ id }) => id)).size !== tasks.length) throw new Error("0xWork task page duplicated a task.");
  const total = integer(page.total, "0xWork task total", maximumRecords);
  const limit = integer(page.limit, "0xWork task limit", 100);
  const offset = integer(page.offset, "0xWork task offset", maximumRecords);
  if (limit < 1 || page.tasks.length > limit || offset + tasks.length > total || total < tasks.length) {
    throw new Error("0xWork task pagination is inconsistent.");
  }
  return {
    tasks,
    total,
    total_value: decimal(atomic(String(page.total_value), "0xWork page value", true)),
    limit,
    offset,
  };
}

function preliminarilyEligible(task: ZeroxWorkTask, nowMs: number): boolean {
  const createdMs = Date.parse(task.createdAt);
  const deadlineMs = (task.deadline || 0) * 1_000;
  return task.chainTaskId !== null && task.transactionHash !== null && task.workerAddress === null &&
    task.contractVersion === "v4" && task.preferredAgentId === null && task.hireType === "open" &&
    !task.requireApproval && !task.allowBidding && !task.resultsBased && task.claimScope === "public" &&
    !task.hasCapabilityRestrictions && task.category !== "Social" && task.category !== "Verification" &&
    task.attemptCount + task.applicationCount <= maximumCompetition &&
    atomic(task.bountyAmount, "0xWork bounty") >= minimumGrossAtomic &&
    createdMs <= nowMs && nowMs - createdMs <= maximumAgeMs && deadlineMs - nowMs >= minimumRemainingMs;
}

export function zeroxWorkOpportunityTaskIds(tasks: readonly ZeroxWorkTask[], nowMs = Date.now()): number[] {
  if (!Number.isFinite(nowMs)) throw new Error("0xWork opportunity time is invalid.");
  return tasks.filter((task) => preliminarilyEligible(task, nowMs)).map(({ id }) => id);
}

function exactWord(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function verifyEvidence(task: ZeroxWorkTask, evidence: ZeroxWorkOnchainEvidence): boolean {
  if (task.chainTaskId === null || task.transactionHash === null || evidence.task_id !== task.id ||
    evidence.chain_task_id !== task.chainTaskId || evidence.transaction_hash.toLowerCase() !== task.transactionHash ||
    evidence.protocol_paused || evidence.task_paused || !Number.isInteger(evidence.fee_bps) ||
    evidence.fee_bps < 0 || evidence.fee_bps > 1_000) return false;
  const receipt = object(evidence.receipt, "0xWork posting receipt");
  if (receipt.status !== "0x1" || typeof receipt.transactionHash !== "string" ||
    receipt.transactionHash.toLowerCase() !== task.transactionHash || typeof receipt.from !== "string" ||
    receipt.from.toLowerCase() !== task.posterAddress || typeof receipt.to !== "string" ||
    receipt.to.toLowerCase() !== ZEROXWORK_TASK_POOL || !Array.isArray(receipt.logs) || receipt.logs.length > 1_000) {
    return false;
  }
  const chainIdTopic = `0x${exactWord(BigInt(task.chainTaskId))}`;
  const posterTopic = `0x${task.posterAddress.slice(2).padStart(64, "0")}`;
  const gross = atomic(task.bountyAmount, "0xWork bounty");
  const deadline = BigInt(task.deadline || 0);
  const posted = receipt.logs.filter((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const log = value as JsonRecord;
    return typeof log.address === "string" && log.address.toLowerCase() === ZEROXWORK_TASK_POOL &&
      Array.isArray(log.topics) && log.topics.length === 3 &&
      log.topics[0]?.toString().toLowerCase() === ZEROXWORK_TASK_POSTED_TOPIC &&
      log.topics[1]?.toString().toLowerCase() === chainIdTopic &&
      log.topics[2]?.toString().toLowerCase() === posterTopic &&
      typeof log.data === "string" && log.data.toLowerCase() === `0x${exactWord(gross)}${exactWord(deadline)}`;
  });
  const transfers = receipt.logs.filter((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const log = value as JsonRecord;
    return typeof log.address === "string" && log.address.toLowerCase() === ZEROXWORK_BASE_USDC &&
      Array.isArray(log.topics) && log.topics.length === 3 &&
      log.topics[0]?.toString().toLowerCase() === ZEROXWORK_TRANSFER_TOPIC &&
      log.topics[1]?.toString().toLowerCase() === posterTopic &&
      log.topics[2]?.toString().toLowerCase() === `0x${ZEROXWORK_TASK_POOL.slice(2).padStart(64, "0")}` &&
      typeof log.data === "string" && log.data.toLowerCase() === `0x${exactWord(gross)}`;
  });
  const onchain = evidence.onchain_task;
  return posted.length === 1 && transfers.length === 1 &&
    onchain.poster.toLowerCase() === task.posterAddress &&
    onchain.worker.toLowerCase() === "0x0000000000000000000000000000000000000000" &&
    onchain.description === task.description && onchain.bounty_amount === String(gross) &&
    onchain.deadline === String(task.deadline) && onchain.state === 0;
}

export function analyzeZeroxWork(input: {
  open_tasks: ZeroxWorkTask[];
  onchain_evidence?: ZeroxWorkOnchainEvidence[];
  now_ms?: number;
}): Record<string, unknown> {
  const nowMs = input.now_ms ?? Date.now();
  if (!Number.isFinite(nowMs) || input.open_tasks.length > maximumRecords) {
    throw new Error("0xWork inventory is oversized or has an invalid time.");
  }
  const tasks = new Map(input.open_tasks.map((task) => [task.id, task]));
  const evidence = new Map((input.onchain_evidence || []).map((item) => [item.task_id, item]));
  if (tasks.size !== input.open_tasks.length || evidence.size !== (input.onchain_evidence || []).length) {
    throw new Error("0xWork inventory or evidence is duplicated.");
  }
  const candidates: Record<string, unknown>[] = [];
  let chainVerified = 0;
  for (const [id, proof] of evidence) {
    const task = tasks.get(id);
    if (!task || !preliminarilyEligible(task, nowMs)) throw new Error("0xWork evidence is not bound to an eligible task.");
    if (!verifyEvidence(task, proof)) continue;
    chainVerified += 1;
    const gross = atomic(task.bountyAmount, "0xWork bounty");
    const net = gross * BigInt(10_000 - proof.fee_bps) / 10_000n;
    if (net < minimumNetAtomic) continue;
    const submissionCount = task.attemptCount + task.applicationCount;
    const deadlineMs = (task.deadline || 0) * 1_000;
    candidates.push({
      market: "zeroxwork",
      task_id: String(task.id),
      title: task.title || task.description.split("\n", 1)[0].slice(0, 500),
      mode: "bounty",
      gross_reward_usdc: decimal(gross),
      net_reward_usdc: decimal(net),
      submission_count: submissionCount,
      created_at: task.createdAt,
      deadline_at: new Date(deadlineMs).toISOString(),
      hours_remaining: Math.round((deadlineMs - nowMs) / 36_000) / 100,
      escrow_tx_hash: task.transactionHash,
      requester: task.posterAddress,
      task_snapshot_sha256: null,
      opportunity_score_usdc_per_current_entry: decimal(net / BigInt(submissionCount + 1)),
      requires_agent_fit_review: true,
      selection_basis:
        "fresh public non-social 0xWork V4 task; no approval, bidding, preferred-agent, capability, or results-based gate; exact API task agrees with verified live TaskPool state and TaskPosted plus Base-USDC escrow transfer; dynamic onchain fee leaves >=100 USDC net; <=2 attempts/applications; <=12h old; >=2h remaining; local assessment only because poster rejection can enter stake-risking dispute",
    });
  }
  const totalGross = input.open_tasks.reduce((sum, task) => sum + atomic(task.bountyAmount, "0xWork bounty"), 0n);
  return {
    public_open_tasks: input.open_tasks.length,
    public_open_value_usdc: decimal(totalGross),
    results_based_unescrowed_tasks: input.open_tasks.filter(({ resultsBased, chainTaskId, transactionHash }) =>
      resultsBased || chainTaskId === null || transactionHash === null
    ).length,
    social_or_physical_tasks: input.open_tasks.filter(({ category }) =>
      category === "Social" || category === "Verification"
    ).length,
    preliminary_onchain_candidates: zeroxWorkOpportunityTaskIds(input.open_tasks, nowMs).length,
    chain_verified_open_tasks: chainVerified,
    fresh_low_competition_candidates: candidates,
    fresh_low_competition_candidate_count: candidates.length,
    exact_candidates: [],
    exact_candidate_count: 0,
    read_only: true,
    external_actions_enabled: false,
    admission_rule:
      "public fresh V4 task; exact verified TaskPosted and Base-USDC escrow; current onchain Open/unclaimed/unpaused state; dynamic net >=100 USDC with gross >=110; <=2 attempts/applications; no results-based, approval, bidding, preferred-agent, capability, social, or physical requirement; trigger only local fit and stake-risk assessment",
  };
}
