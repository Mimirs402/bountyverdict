import { selectExactPublicDemand } from "./exact-demand.ts";
import type { DemandCandidate } from "./demand-watch.ts";

const addressPattern = /^0x[a-f0-9]{40}$/i;
const bytes32Pattern = /^0x[a-f0-9]{64}$/i;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const atomicPattern = /^(?:0|[1-9][0-9]{0,15})$/;
const maximumTasksPerPage = 100;
const maximumSubmissionsPerTask = 1_000;
const maximumDescriptionBytes = 20_000;
// Canonical Base deployment and settlement event documented by Taskmarket:
// https://docs.taskmarket.dev/smart-contracts/overview
const baseUsdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const taskmarketDiamond = "0xDDc6cC3e4D11c1f3527B867C7DAD4ED9869C33f7";
const taskCompletedTopic = "0x0c01e82f21f6dc480e3553e62cba7e6511685aa15d312f971ea64663bef07ecb";

export const TASKMARKET_API = "https://api.taskmarket.dev";
export const TASKMARKET_WORKER_ADDRESS = "0xe5E0fe496B7283032d034Dc79C305b384Ad1ee67";
export const TASKMARKET_OWNER_IDENTITIES = Object.freeze([
  "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614",
  "0xA72C5EAc41CC69c7F0662bE25D040AdF8692fE63",
]);
export const TASKMARKET_TRACKED_SUBMISSIONS = Object.freeze([
  Object.freeze({
    task_id: "0xcb67b0a48505c60ddba84023942a93c433bb0c31722028e0b62807074e0ccf0e",
    submission_id: "11592476-6f08-472f-908c-0d9531275757",
    submit_tx_hash: "0xd27042ad5b49f93c780b56cd0b06756e470b268e00fae32070c725b8e86220b3",
    reward_atomic: "150000",
    expected_net_atomic: "138750",
  }),
  Object.freeze({
    task_id: "0xfeb98106531ea1bd30f727a0c458809e0c05159c5c6c4e65ca7d0245a3b16613",
    submission_id: "fdbc7781-5ec1-43cd-a370-0071f2d115c7",
    submit_tx_hash: "0x9e23e83d6933dd65e8ea54a5ca956257489da1629fa425b125d187b4305e76b5",
    reward_atomic: "20000",
    expected_net_atomic: "18500",
  }),
  Object.freeze({
    task_id: "0x50d1dea29821649b87c2cb08558bd9cd984c9678d9f8d30ce608eef877ca5448",
    submission_id: "7315e22e-e703-4f37-9227-41ef69632d5b",
    submit_tx_hash: "0x02cff29efb7ea9bddd34203d01d956d953179a8e0bc029cc264bc0a01c082266",
    reward_atomic: "500000",
    expected_net_atomic: "462500",
    public_proof: Object.freeze({
      service_origin: "https://listening-heart.onrender.com",
      note_id: "4aaec988-26b3-481c-8bf0-eb5f76c71286",
      author_address: "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614",
      payment_atomic: "1000",
      network: "eip155:84532",
      asset: "Base Sepolia USDC",
    }),
  }),
  Object.freeze({
    task_id: "0xd4962d4534961d4e93f93848f552dd41d48e2091a9fbb36ecc9503a8621717d0",
    submission_id: "1471cfbd-e7a6-458e-9487-b41692a0113e",
    submit_tx_hash: "0x8f01a3232478025660b4ff82a284f5cb4e5f9bf3283a0ef09d8c9b1ea4bea83d",
    reward_atomic: "10000000",
    expected_net_atomic: "9250000",
  }),
  Object.freeze({
    task_id: "0x100219baba1f9df11f7f15f226bbd9994c445060ca2bd2ac7ef820bd4f7759f7",
    submission_id: "7405cc23-ba8c-40d8-9b6d-c3647251d519",
    submit_tx_hash: "0xe70d286b0b6204bc1413534d9e9238e057e50828ce08d8b2a6cc658e650436eb",
    reward_atomic: "19000000",
    expected_net_atomic: "17575000",
    operator_estimated_net_atomic: "110000",
    terminal_reward_atomic: "1135136",
    terminal_net_reward_atomic: "1050000",
  }),
  Object.freeze({
    task_id: "0xb572510c687f254cb763989553a74a9dff1c76687579f8507335c2461de1ab1a",
    submission_id: "fe459a0b-e2e8-429b-8080-9e776af10da1",
    submit_tx_hash: "0x19a717548d6931e6a620ca79f12c4a6ae0e81284739f428a1059d9c5c7220a0a",
    reward_atomic: "150000",
    expected_net_atomic: "138750",
    operator_estimated_net_atomic: "46250",
  }),
]);

type TaskStatus = "open" | "claimed" | "worker_selected" | "pending_approval" | "review" |
  "appealing" | "disputed" | "completed" | "expired" | "cancelled";
type TaskMode = "bounty" | "claim" | "pitch" | "benchmark" | "auction";

export type TaskmarketTask = {
  id: string;
  requester: string;
  description: string;
  rewardAtomic: string;
  netRewardAtomic: string;
  escrowTxHash: string;
  createdAt: string;
  expiryTime: string;
  status: TaskStatus;
  tags: string[];
  mode: TaskMode;
  claimedBy: string | null;
  submissionWindowOpen: boolean;
};

export type TaskmarketPage = {
  tasks: TaskmarketTask[];
  has_more: boolean;
  next_cursor: string | null;
};

export type TaskmarketTrackedSpecification = Readonly<{
  task_id: string;
  submission_id: string;
  submit_tx_hash: string;
  reward_atomic: string;
  expected_net_atomic: string;
  operator_estimated_net_atomic?: string;
  terminal_reward_atomic?: string;
  terminal_net_reward_atomic?: string;
  public_proof?: Readonly<{
    service_origin: string;
    note_id: string;
    author_address: string;
    payment_atomic: string;
    network: "eip155:84532";
    asset: "Base Sepolia USDC";
  }>;
}>;

export type TaskmarketTrackedPayload = {
  task_id: string;
  detail: unknown;
  submissions: unknown;
  public_proof_notes?: unknown;
  settlement_receipts?: TaskmarketSettlementReceiptPayload[];
};

export type TaskmarketSettlementReceiptPayload = {
  transaction_hash: string;
  receipt: unknown | null;
  unavailable_reason?: "rpc_unavailable" | "receipt_not_yet_available";
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function exactPattern(value: unknown, label: string, pattern: RegExp, maximum: number): string {
  const parsed = requiredString(value, label, maximum);
  if (!pattern.test(parsed)) throw new Error(`${label} is invalid.`);
  return parsed;
}

function timestamp(value: unknown, label: string): string {
  const parsed = requiredString(value, label, 80);
  if (!Number.isFinite(Date.parse(parsed))) throw new Error(`${label} is invalid.`);
  return parsed;
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function atomic(value: unknown, label: string, allowZero = false): bigint {
  const parsed = exactPattern(value, label, atomicPattern, 16);
  const amount = BigInt(parsed);
  if ((!allowZero && amount === 0n) || amount > 1_000_000_000_000_000n) {
    throw new Error(`${label} is outside bounds.`);
  }
  return amount;
}

function atomicToDecimal(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = String(value % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function atomicToBudgetCents(value: bigint): number {
  const cents = Number(value / 10_000n);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : 0;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid.`);
  return value;
}

function nullableAddress(value: unknown, label: string): string | null {
  return value === null ? null : exactPattern(value, label, addressPattern, 42);
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error("Taskmarket tags are invalid.");
  const tags = value.map((tag) => requiredString(tag, "Taskmarket tag", 100));
  if (new Set(tags).size !== tags.length) throw new Error("Taskmarket tags are duplicated.");
  return tags;
}

function parseTask(value: unknown, requiredStatus?: TaskStatus): TaskmarketTask {
  if (!isObject(value)) throw new Error("Taskmarket task is malformed.");
  const status = requiredString(value.status, "Taskmarket task status", 30) as TaskStatus;
  if (!["open", "claimed", "worker_selected", "pending_approval", "review", "appealing", "disputed", "completed", "expired", "cancelled"].includes(status)) {
    throw new Error("Taskmarket task status is unsupported.");
  }
  if (requiredStatus && status !== requiredStatus) throw new Error(`Taskmarket feed contains a non-${requiredStatus} task.`);
  const mode = requiredString(value.mode, "Taskmarket task mode", 20) as TaskMode;
  if (!["bounty", "claim", "pitch", "benchmark", "auction"].includes(mode)) {
    throw new Error("Taskmarket task mode is unsupported.");
  }
  const reward = atomic(value.reward, "Taskmarket reward");
  const netReward = atomic(value.netReward, "Taskmarket net reward");
  if (netReward > reward) throw new Error("Taskmarket net reward exceeds its escrowed reward.");
  const description = requiredString(value.description, "Taskmarket description", maximumDescriptionBytes);
  if (new TextEncoder().encode(description).length > maximumDescriptionBytes) {
    throw new Error("Taskmarket description exceeds its byte cap.");
  }
  return {
    id: exactPattern(value.id, "Taskmarket task ID", bytes32Pattern, 66),
    requester: exactPattern(value.requester, "Taskmarket requester", addressPattern, 42),
    description,
    rewardAtomic: String(reward),
    netRewardAtomic: String(netReward),
    escrowTxHash: exactPattern(value.escrowTxHash, "Taskmarket escrow transaction", bytes32Pattern, 66),
    createdAt: timestamp(value.createdAt, "Taskmarket creation time"),
    expiryTime: timestamp(value.expiryTime, "Taskmarket expiry time"),
    status,
    tags: parseTags(value.tags),
    mode,
    claimedBy: nullableAddress(value.claimedBy, "Taskmarket claimed worker"),
    submissionWindowOpen: booleanValue(value.submissionWindowOpen, "Taskmarket submission window"),
  };
}

export function parseTaskmarketPage(value: unknown): TaskmarketPage {
  if (!isObject(value) || !Array.isArray(value.tasks) || value.tasks.length > maximumTasksPerPage ||
    typeof value.hasMore !== "boolean") {
    throw new Error("Taskmarket page is malformed or exceeds its 100-task cap.");
  }
  const nextCursor = value.nextCursor === null ? null : timestamp(value.nextCursor, "Taskmarket cursor");
  if (value.hasMore !== (nextCursor !== null)) throw new Error("Taskmarket pagination flags disagree.");
  const tasks = value.tasks.map((task) => parseTask(task, "open"));
  if (new Set(tasks.map(({ id }) => id.toLowerCase())).size !== tasks.length) {
    throw new Error("Taskmarket page duplicated a task.");
  }
  return { tasks, has_more: value.hasMore, next_cursor: nextCursor };
}

function taskTitle(description: string): string {
  return description.split(/\r?\n/, 1)[0].trim().slice(0, 500) || "Taskmarket task";
}

export function analyzeTaskmarket(tasks: TaskmarketTask[], nowMs = Date.now()): Record<string, unknown> {
  if (tasks.length > 500 || new Set(tasks.map(({ id }) => id.toLowerCase())).size !== tasks.length) {
    throw new Error("Taskmarket open inventory is duplicated or exceeds the bounded five-page audit.");
  }
  const submissionOpen = tasks.filter((task) =>
    task.status === "open" && task.submissionWindowOpen && task.claimedBy === null && Date.parse(task.expiryTime) > nowMs
  );
  const candidates = submissionOpen.flatMap((task): DemandCandidate[] => {
    if (/\b(?:implement|patch|open (?:an? )?(?:pull request|pr)|submit code|code change|deploy|publish)\b/i.test(task.description)) return [];
    const decision = selectExactPublicDemand({
      title: taskTitle(task.description),
      description: task.description,
      budget_cents: atomicToBudgetCents(BigInt(task.netRewardAtomic)),
    });
    if (!decision) return [];
    return [{
      market: "taskmarket",
      job_id: task.id,
      title: taskTitle(task.description),
      product: decision.product,
      input_sha256: decision.input_sha256,
      price_cents: decision.price_cents,
      budget_usdc: atomicToDecimal(BigInt(task.netRewardAtomic)),
      created_at: task.createdAt,
      deadline_at: task.expiryTime,
    }];
  });
  const reward = tasks.reduce((sum, task) => sum + BigInt(task.rewardAtomic), 0n);
  const submissionOpenReward = submissionOpen.reduce((sum, task) => sum + BigInt(task.rewardAtomic), 0n);
  return {
    open_tasks: tasks.length,
    api_escrow_backed_open_tasks: tasks.length,
    api_escrow_backed_reward_usdc: atomicToDecimal(reward),
    unassigned_unexpired_submission_open_tasks: submissionOpen.length,
    unassigned_unexpired_reward_usdc: atomicToDecimal(submissionOpenReward),
    exact_candidates: candidates,
    exact_candidate_count: candidates.length,
    rejected_escrow_non_matches: submissionOpen.length - candidates.length,
    excluded_expired_assigned_or_closed_window: tasks.length - submissionOpen.length,
    funding_rule: "official_open_task_feed_plus_valid_nonzero_reward_and_escrow_tx_hash; API escrow evidence is not independently relabeled as worker revenue",
  };
}

type TaskmarketSubmission = {
  id: string;
  taskId: string;
  workerAddress: string;
  submitTxHash: string;
  submittedAt: string;
  rejectedAt: string | null;
};

function parseSubmissions(value: unknown, taskId: string): TaskmarketSubmission[] {
  if (!Array.isArray(value) || value.length > maximumSubmissionsPerTask) {
    throw new Error("Taskmarket submission list is malformed or exceeds its 1,000-record cap.");
  }
  const submissions = value.map((item): TaskmarketSubmission => {
    if (!isObject(item)) throw new Error("Taskmarket submission is malformed.");
    const parsed = {
      id: exactPattern(item.id, "Taskmarket submission ID", uuidPattern, 36),
      taskId: exactPattern(item.taskId, "Taskmarket submission task ID", bytes32Pattern, 66),
      workerAddress: exactPattern(item.workerAddress, "Taskmarket submission worker", addressPattern, 42),
      submitTxHash: exactPattern(item.submitTxHash, "Taskmarket submission transaction", bytes32Pattern, 66),
      submittedAt: timestamp(item.submittedAt, "Taskmarket submission time"),
      rejectedAt: nullableTimestamp(item.rejectedAt, "Taskmarket rejection time"),
    };
    if (parsed.taskId.toLowerCase() !== taskId.toLowerCase()) {
      throw new Error("Taskmarket submission list contains a different task ID.");
    }
    return parsed;
  });
  if (new Set(submissions.map(({ id }) => id.toLowerCase())).size !== submissions.length) {
    throw new Error("Taskmarket submission list contains duplicate IDs.");
  }
  return submissions;
}

type TaskmarketAward = {
  workerAddress: string;
  grossAmount: string;
  workerPayment: string;
  platformFee: string;
  settlementTxHash: string;
  settledAt: string;
};

function parseDetail(value: unknown): { task: TaskmarketTask; awards: TaskmarketAward[] } {
  if (!isObject(value)) throw new Error("Taskmarket task detail is malformed.");
  const task = parseTask(value);
  if (!Number.isSafeInteger(value.awardCount) || Number(value.awardCount) < 0 || Number(value.awardCount) > 100 ||
    !Array.isArray(value.awards) || value.awards.length !== value.awardCount) {
    throw new Error("Taskmarket canonical award count is malformed or disagrees with its rows.");
  }
  const awards = value.awards.map((award): TaskmarketAward => {
    if (!isObject(award)) throw new Error("Taskmarket award row is malformed.");
    const gross = atomic(award.grossAmount, "Taskmarket award gross amount");
    const workerPayment = atomic(award.workerPayment, "Taskmarket worker payment");
    const platformFee = atomic(award.platformFee, "Taskmarket platform fee", true);
    if (gross !== workerPayment + platformFee) throw new Error("Taskmarket award amounts do not reconcile.");
    return {
      workerAddress: exactPattern(award.workerAddress, "Taskmarket award worker", addressPattern, 42),
      grossAmount: String(gross),
      workerPayment: String(workerPayment),
      platformFee: String(platformFee),
      settlementTxHash: exactPattern(award.settlementTxHash, "Taskmarket settlement transaction", bytes32Pattern, 66),
      settledAt: timestamp(award.settledAt, "Taskmarket settlement time"),
    };
  });
  if (new Set(awards.map(({ workerAddress }) => workerAddress.toLowerCase())).size !== awards.length) {
    throw new Error("Taskmarket canonical awards duplicate a worker.");
  }
  return { task, awards };
}

export function taskmarketAwardSettlementHashes(value: unknown): string[] {
  const hashes = parseDetail(value).awards.map(({ settlementTxHash }) => settlementTxHash);
  return [...new Map(hashes.map((hash) => [hash.toLowerCase(), hash])).values()];
}

export function verifyTaskmarketSettlementReceipt(input: {
  evidence: TaskmarketSettlementReceiptPayload | undefined;
  settlement_tx_hash: string;
  task_id: string;
  worker_address: string;
  worker_payment_atomic: string;
  platform_fee_atomic: string;
  requester_address: string;
}): Record<string, unknown> {
  const transactionHash = exactPattern(input.settlement_tx_hash, "Taskmarket expected settlement transaction", bytes32Pattern, 66);
  const taskId = exactPattern(input.task_id, "Taskmarket receipt task ID", bytes32Pattern, 66);
  const worker = exactPattern(input.worker_address, "Taskmarket receipt worker", addressPattern, 42);
  const workerPayment = atomic(input.worker_payment_atomic, "Taskmarket receipt worker payment");
  const platformFee = atomic(input.platform_fee_atomic, "Taskmarket receipt platform fee", true);
  const requester = exactPattern(input.requester_address, "Taskmarket receipt requester", addressPattern, 42);
  const unavailable = (reason: string): Record<string, unknown> => ({
    verified: false,
    reason,
    network: "eip155:8453",
    settlement_tx_hash: transactionHash,
  });
  if (!input.evidence) return unavailable("receipt_evidence_missing");
  if (!bytes32Pattern.test(input.evidence.transaction_hash) ||
    input.evidence.transaction_hash.toLowerCase() !== transactionHash.toLowerCase()) {
    return unavailable("receipt_transaction_mismatch");
  }
  if (input.evidence.receipt === null) {
    return unavailable(input.evidence.unavailable_reason === "receipt_not_yet_available"
      ? "receipt_not_yet_available"
      : "rpc_unavailable");
  }
  const receipt = input.evidence.receipt;
  if (!isObject(receipt) || receipt.status !== "0x1" ||
    typeof receipt.transactionHash !== "string" || receipt.transactionHash.toLowerCase() !== transactionHash.toLowerCase() ||
    typeof receipt.blockNumber !== "string" || !/^0x[0-9a-f]+$/i.test(receipt.blockNumber) ||
    !Array.isArray(receipt.logs) || receipt.logs.length < 1 || receipt.logs.length > 1_000) {
    return unavailable(isObject(receipt) && receipt.status !== "0x1" ? "receipt_not_successful" : "receipt_malformed");
  }
  const matchingTaskCompleted: Array<{ arrayIndex: number; logIndex: number }> = [];
  const matchingTransfers: Array<{ arrayIndex: number; logIndex: number }> = [];
  const workerTopic = `0x${"0".repeat(24)}${worker.slice(2).toLowerCase()}`;
  const requesterTopic = `0x${"0".repeat(24)}${requester.slice(2).toLowerCase()}`;
  const diamondTopic = `0x${"0".repeat(24)}${taskmarketDiamond.slice(2).toLowerCase()}`;
  const workerPaymentWord = workerPayment.toString(16).padStart(64, "0");
  const platformFeeWord = platformFee.toString(16).padStart(64, "0");
  for (let index = 0; index < receipt.logs.length; index += 1) {
    const log = receipt.logs[index];
    if (!isObject(log) || !Array.isArray(log.topics) || log.topics.length > 4 ||
      !log.topics.every((topic) => typeof topic === "string" && bytes32Pattern.test(topic))) {
      return unavailable("receipt_log_malformed");
    }
    const logIndex = typeof log.logIndex === "string" && /^0x[0-9a-f]+$/i.test(log.logIndex)
      ? Number(BigInt(log.logIndex))
      : Number.NaN;
    if (!Number.isSafeInteger(logIndex) || logIndex < 0) return unavailable("receipt_log_index_malformed");
    if (typeof log.address === "string" && log.address.toLowerCase() === taskmarketDiamond.toLowerCase() &&
      log.topics.length === 4 && String(log.topics[0]).toLowerCase() === taskCompletedTopic &&
      String(log.topics[1]).toLowerCase() === taskId.toLowerCase() &&
      String(log.topics[2]).toLowerCase() === requesterTopic &&
      String(log.topics[3]).toLowerCase() === workerTopic && typeof log.data === "string" &&
      log.data.toLowerCase() === `0x${workerPaymentWord}${platformFeeWord}`) {
      matchingTaskCompleted.push({ arrayIndex: index, logIndex });
    }
    if (typeof log.address === "string" && log.address.toLowerCase() === baseUsdcAddress.toLowerCase() &&
      log.topics.length === 3 && String(log.topics[0]).toLowerCase() === transferTopic &&
      String(log.topics[1]).toLowerCase() === diamondTopic &&
      String(log.topics[2]).toLowerCase() === workerTopic && typeof log.data === "string" &&
      /^0x[0-9a-f]{64}$/i.test(log.data) && BigInt(log.data) === workerPayment) {
      matchingTransfers.push({ arrayIndex: index, logIndex });
    }
  }
  if (matchingTaskCompleted.length !== 1) return unavailable("canonical_task_completed_event_missing_or_ambiguous");
  if (matchingTransfers.length !== 1) return unavailable("exact_usdc_diamond_worker_transfer_missing_or_ambiguous");
  const canonicalEvent = matchingTaskCompleted[0];
  const payoutTransfer = matchingTransfers[0];
  return {
    verified: true,
    reason: "canonical_task_completed_event_and_exact_usdc_diamond_worker_transfer_verified",
    network: "eip155:8453",
    settlement_tx_hash: transactionHash,
    block_number: String(BigInt(receipt.blockNumber)),
    taskmarket_settlement_contract: taskmarketDiamond,
    task_completed_topic: taskCompletedTopic,
    task_completed_log_index: canonicalEvent.logIndex,
    task_completed_receipt_array_index: canonicalEvent.arrayIndex,
    task_id: taskId,
    task_id_topic_present: true,
    onchain_requester_address: requester,
    base_usdc_address: baseUsdcAddress,
    transfer_topic: transferTopic,
    transfer_source_address: taskmarketDiamond,
    transfer_source_topic: diamondTopic,
    worker_address: worker,
    worker_payment_atomic: String(workerPayment),
    platform_fee_atomic: String(platformFee),
    matching_transfer_log_index: payoutTransfer.logIndex,
    matching_transfer_receipt_array_index: payoutTransfer.arrayIndex,
    authoritative_proof_key: `eip155:8453:${transactionHash.toLowerCase()}:${canonicalEvent.logIndex}`,
  };
}

function parsePublicProof(
  value: unknown,
  taskId: string,
  expected: NonNullable<TaskmarketTrackedSpecification["public_proof"]>,
): Record<string, unknown> {
  let origin: string;
  try {
    const parsed = new URL(expected.service_origin);
    if (parsed.protocol !== "https:" || parsed.origin !== expected.service_origin) throw new Error("not an HTTPS origin");
    origin = parsed.origin;
  } catch {
    throw new Error("Taskmarket supporting public-proof origin is invalid.");
  }
  const noteId = exactPattern(expected.note_id, "Taskmarket supporting public-proof note ID", uuidPattern, 36);
  const author = exactPattern(expected.author_address, "Taskmarket supporting public-proof author", addressPattern, 42);
  const expectedPayment = atomic(expected.payment_atomic, "Taskmarket supporting public-proof payment");
  if (expected.network !== "eip155:84532" || expected.asset !== "Base Sepolia USDC") {
    throw new Error("Taskmarket supporting public-proof testnet context is invalid.");
  }
  if (!isObject(value) || !Array.isArray(value.notes) || value.notes.length > 200 ||
    exactPattern(value.taskId, "Taskmarket public-proof task ID", bytes32Pattern, 66).toLowerCase() !== taskId.toLowerCase() ||
    !Number.isSafeInteger(value.totalNotes) || Number(value.totalNotes) < value.notes.length) {
    throw new Error("Taskmarket supporting public-proof feed is malformed or exceeds its 200-note cap.");
  }
  const matching = value.notes.filter((note) => isObject(note) && note.noteId === noteId);
  if (matching.length !== 1 || !isObject(matching[0])) throw new Error("Taskmarket supporting public-proof note is missing or duplicated.");
  const note = matching[0];
  if (exactPattern(note.taskId, "Taskmarket public-proof note task ID", bytes32Pattern, 66).toLowerCase() !== taskId.toLowerCase() ||
    exactPattern(note.author, "Taskmarket public-proof note author", addressPattern, 42).toLowerCase() !== author.toLowerCase() ||
    !Number.isSafeInteger(note.paymentAmount) || BigInt(Number(note.paymentAmount)) !== expectedPayment) {
    throw new Error("Taskmarket supporting public-proof note disagrees with its task, author, or payment amount.");
  }
  return {
    service_origin: origin,
    note_id: noteId,
    author_address: author,
    payment_atomic: String(expectedPayment),
    payment_usdc: atomicToDecimal(expectedPayment),
    network: expected.network,
    asset: expected.asset,
    note_type: requiredString(note.noteType, "Taskmarket public-proof note type", 40),
    published_at: timestamp(note.timestamp, "Taskmarket public-proof publication time"),
    verification_scope: "public note identity, task, author, and atomic amount; network and asset are pinned from the owner-validated payment receipt because the public note endpoint does not expose them",
    economic_treatment: "Base Sepolia testnet proof payment is neither customer revenue nor a mainnet tracked cost",
  };
}

function parseAgentStats(value: unknown, workerAddress: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error("Taskmarket worker stats are malformed.");
  const address = exactPattern(value.address, "Taskmarket stats worker", addressPattern, 42);
  if (address.toLowerCase() !== workerAddress.toLowerCase()) throw new Error("Taskmarket worker stats belong to another address.");
  const integerFields = ["completedTasks", "ratedTasks", "totalStars"] as const;
  for (const field of integerFields) {
    if (!Number.isSafeInteger(value[field]) || Number(value[field]) < 0) throw new Error(`Taskmarket worker stats ${field} is invalid.`);
  }
  const agentId = value.agentId === null ? null : requiredString(value.agentId, "Taskmarket agent ID", 64);
  const totalEarnings = atomic(value.totalEarnings, "Taskmarket reported total earnings", true);
  return {
    address,
    agent_id: agentId,
    completed_tasks: Number(value.completedTasks),
    rated_tasks: Number(value.ratedTasks),
    total_earnings_atomic: String(totalEarnings),
    total_earnings_usdc: atomicToDecimal(totalEarnings),
  };
}

export function reconcileTaskmarketTracked(input: {
  worker_address: string;
  tracked: readonly TaskmarketTrackedSpecification[];
  payloads: TaskmarketTrackedPayload[];
  agent_stats: unknown;
  owner_addresses?: readonly string[];
}): Record<string, unknown> {
  const worker = exactPattern(input.worker_address, "Taskmarket tracked worker", addressPattern, 42);
  const ownerAddresses = (input.owner_addresses || TASKMARKET_OWNER_IDENTITIES).map((address) =>
    exactPattern(address, "Taskmarket owner identity", addressPattern, 42).toLowerCase()
  );
  if (new Set(ownerAddresses).size !== ownerAddresses.length || ownerAddresses.includes(worker.toLowerCase())) {
    throw new Error("Taskmarket owner identities are duplicated or include the isolated worker.");
  }
  if (input.tracked.length < 1 || input.tracked.length > 100 || input.payloads.length !== input.tracked.length) {
    throw new Error("Taskmarket tracked submission inventory is empty, oversized, or incomplete.");
  }
  const payloads = new Map(input.payloads.map((payload) => [payload.task_id.toLowerCase(), payload]));
  if (payloads.size !== input.payloads.length) throw new Error("Taskmarket tracked payloads duplicate a task.");
  let settledWorkerAtomic = 0n;
  let settledSubmissions = 0;
  let unverifiedAwardSubmissions = 0;
  let rejectedSubmissions = 0;
  let pendingGrossAtomic = 0n;
  let pendingNetAtomic = 0n;
  const consumedReceiptEvidence = new Set<string>();
  const consumedCanonicalEvents = new Set<string>();
  const records = input.tracked.map((expected) => {
    const expectedTaskId = exactPattern(expected.task_id, "Taskmarket tracked task ID", bytes32Pattern, 66);
    const expectedSubmissionId = exactPattern(expected.submission_id, "Taskmarket tracked submission ID", uuidPattern, 36);
    const expectedSubmitTx = exactPattern(expected.submit_tx_hash, "Taskmarket tracked submit transaction", bytes32Pattern, 66);
    const expectedReward = atomic(expected.reward_atomic, "Taskmarket expected reward");
    const expectedNet = atomic(expected.expected_net_atomic, "Taskmarket expected net reward");
    if (expectedNet > expectedReward) throw new Error("Taskmarket expected net reward exceeds the task reward.");
    const terminalReward = expected.terminal_reward_atomic === undefined
      ? undefined
      : atomic(expected.terminal_reward_atomic, "Taskmarket terminal reward");
    const terminalNet = expected.terminal_net_reward_atomic === undefined
      ? undefined
      : atomic(expected.terminal_net_reward_atomic, "Taskmarket terminal net reward");
    if ((terminalReward === undefined) !== (terminalNet === undefined)) {
      throw new Error("Taskmarket terminal reward contract must pin both gross and net amounts.");
    }
    if (terminalReward !== undefined && terminalNet !== undefined &&
      (expected.operator_estimated_net_atomic === undefined || terminalNet > terminalReward ||
        terminalReward > expectedReward || terminalNet > expectedNet)) {
      throw new Error("Taskmarket terminal pool settlement exceeds or lacks its initial bounded pool contract.");
    }
    const potentialNet = atomic(expected.operator_estimated_net_atomic ?? expected.expected_net_atomic, "Taskmarket potential net award");
    const potentialGross = expected.operator_estimated_net_atomic === undefined
      ? expectedReward
      : (potentialNet * expectedReward + expectedNet - 1n) / expectedNet;
    if (potentialGross > expectedReward || potentialNet > expectedNet || potentialNet > potentialGross) {
      throw new Error("Taskmarket potential award exceeds the task contract or its gross amount.");
    }
    const payload = payloads.get(expectedTaskId.toLowerCase());
    if (!payload) throw new Error("Taskmarket tracked task detail is missing.");
    const { task, awards } = parseDetail(payload.detail);
    const liveReward = BigInt(task.rewardAtomic);
    const liveNet = BigInt(task.netRewardAtomic);
    const initialContract = liveReward === expectedReward && liveNet === expectedNet;
    const terminalPoolContract = task.status === "completed" && terminalReward !== undefined && terminalNet !== undefined &&
      liveReward === terminalReward && liveNet === terminalNet;
    if (task.id.toLowerCase() !== expectedTaskId.toLowerCase() || (!initialContract && !terminalPoolContract)) {
      throw new Error("Taskmarket tracked task identity or reward contract drifted.");
    }
    const submissions = parseSubmissions(payload.submissions, expectedTaskId);
    if (payload.settlement_receipts !== undefined && (!Array.isArray(payload.settlement_receipts) ||
      payload.settlement_receipts.length > 100 ||
      new Set(payload.settlement_receipts.map(({ transaction_hash }) => String(transaction_hash).toLowerCase())).size !==
        payload.settlement_receipts.length)) {
      throw new Error("Taskmarket settlement receipt evidence is malformed, duplicated, or oversized.");
    }
    const submission = submissions.find(({ id }) => id.toLowerCase() === expectedSubmissionId.toLowerCase());
    if (!submission || submission.workerAddress.toLowerCase() !== worker.toLowerCase() ||
      submission.submitTxHash.toLowerCase() !== expectedSubmitTx.toLowerCase()) {
      throw new Error("Taskmarket tracked submission receipt is missing or disagrees with its worker or transaction.");
    }
    const award = awards.find(({ workerAddress }) => workerAddress.toLowerCase() === worker.toLowerCase());
    const publicProof = expected.public_proof
      ? parsePublicProof(payload.public_proof_notes, expectedTaskId, expected.public_proof)
      : null;
    if (award && task.status !== "completed") throw new Error("Taskmarket exposed a settlement award before task completion.");
    if (award && submission.rejectedAt) throw new Error("Taskmarket submission is both rejected and awarded.");
    const receiptEvidence = award
      ? payload.settlement_receipts?.find(({ transaction_hash }) =>
          typeof transaction_hash === "string" && transaction_hash.toLowerCase() === award.settlementTxHash.toLowerCase())
      : undefined;
    const receiptVerification = award ? verifyTaskmarketSettlementReceipt({
      evidence: receiptEvidence,
      settlement_tx_hash: award.settlementTxHash,
      task_id: expectedTaskId,
      worker_address: worker,
      worker_payment_atomic: award.workerPayment,
      platform_fee_atomic: award.platformFee,
      requester_address: task.requester,
    }) : null;
    const onchainRequester = typeof receiptVerification?.onchain_requester_address === "string"
      ? receiptVerification.onchain_requester_address.toLowerCase()
      : "";
    const externalRequester = onchainRequester !== worker.toLowerCase() && !ownerAddresses.includes(onchainRequester);
    const awardVerification = award && !externalRequester
      ? {
          verified: false,
          reason: "task_requester_is_worker_or_owner_identity",
          network: "eip155:8453",
          settlement_tx_hash: award.settlementTxHash,
        }
      : receiptVerification;
    const settled = Boolean(award && awardVerification?.verified === true);
    if (settled && award) {
      const taskCompletedLogIndex = awardVerification?.task_completed_log_index;
      const transferIndex = awardVerification?.matching_transfer_log_index;
      if (!Number.isSafeInteger(taskCompletedLogIndex) || Number(taskCompletedLogIndex) < 0 ||
        !Number.isSafeInteger(transferIndex) || Number(transferIndex) < 0) {
        throw new Error("Taskmarket verified settlement event or transfer index is invalid.");
      }
      const canonicalEventKey = `eip155:8453:${award.settlementTxHash.toLowerCase()}:${Number(taskCompletedLogIndex)}`;
      const evidenceKey = `${award.settlementTxHash.toLowerCase()}:${Number(transferIndex)}`;
      if (consumedCanonicalEvents.has(canonicalEventKey)) {
        throw new Error("Taskmarket canonical settlement event evidence was reused by multiple tracked tasks.");
      }
      if (consumedReceiptEvidence.has(evidenceKey)) {
        throw new Error("Taskmarket settlement receipt transfer evidence was reused by multiple tracked tasks.");
      }
      consumedCanonicalEvents.add(canonicalEventKey);
      consumedReceiptEvidence.add(evidenceKey);
      settledSubmissions += 1;
      settledWorkerAtomic += BigInt(award.workerPayment);
    } else if (award) {
      unverifiedAwardSubmissions += 1;
    } else if (submission.rejectedAt) rejectedSubmissions += 1;
    const terminalWithoutAward = ["completed", "expired", "cancelled"].includes(task.status);
    const submissionState = settled ? "settled_award" : award ? "award_unverified" :
      submission.rejectedAt ? "rejected" : terminalWithoutAward ? "not_awarded" : "pending_award";
    if (submissionState === "pending_award") {
      pendingGrossAtomic += potentialGross;
      pendingNetAtomic += potentialNet;
    }
    return {
      task_id: expectedTaskId,
      submission_id: expectedSubmissionId,
      submit_tx_hash: expectedSubmitTx,
      submitted_at: submission.submittedAt,
      task_status: task.status,
      submission_state: submissionState,
      rejected_at: submission.rejectedAt,
      escrow_reward_usdc: atomicToDecimal(expectedReward),
      current_task_reward_usdc: atomicToDecimal(liveReward),
      current_task_net_reward_usdc: atomicToDecimal(liveNet),
      reward_contract_state: terminalPoolContract
        ? "pinned_terminal_pool_award_aggregate_with_initial_escrow_preserved"
        : "initial_escrow_contract",
      potential_gross_usdc: atomicToDecimal(potentialGross),
      potential_net_usdc: atomicToDecimal(potentialNet),
      potential_basis: expected.operator_estimated_net_atomic === undefined
        ? "full_task_reward_contract"
        : "operator_estimated_submitted_record_net_scaled_by_task_contract_not_award",
      platform_award: award ? {
        requester_address: task.requester,
        settlement_tx_hash: award.settlementTxHash,
        settled_at: award.settledAt,
        gross_usdc: atomicToDecimal(BigInt(award.grossAmount)),
        worker_payment_usdc: atomicToDecimal(BigInt(award.workerPayment)),
        platform_fee_usdc: atomicToDecimal(BigInt(award.platformFee)),
      } : null,
      award_verification: awardVerification,
      settlement: settled && award ? {
        requester_address: task.requester,
        settlement_tx_hash: award.settlementTxHash,
        settled_at: award.settledAt,
        gross_usdc: atomicToDecimal(BigInt(award.grossAmount)),
        worker_payment_usdc: atomicToDecimal(BigInt(award.workerPayment)),
        platform_fee_usdc: atomicToDecimal(BigInt(award.platformFee)),
        onchain_evidence: awardVerification,
      } : null,
      supporting_public_proof: publicProof,
      accounting_state: settled
        ? "authoritative_completed_task_award_plus_verified_base_receipt"
        : award
          ? "platform_award_unverified_onchain_not_purchase_or_revenue"
          : "submission_only_not_purchase_or_revenue",
    };
  });
  if (new Set(input.tracked.map(({ task_id }) => task_id.toLowerCase())).size !== input.tracked.length ||
    new Set(input.tracked.map(({ submission_id }) => submission_id.toLowerCase())).size !== input.tracked.length) {
    throw new Error("Taskmarket tracked configuration duplicates a task or submission.");
  }
  const stats = parseAgentStats(input.agent_stats, worker);
  return {
    worker_address: worker,
    tracked_submissions: records.length,
    pending_submissions: records.length - settledSubmissions - unverifiedAwardSubmissions - rejectedSubmissions -
      records.filter(({ submission_state }) => submission_state === "not_awarded").length,
    rejected_submissions: rejectedSubmissions,
    not_awarded_submissions: records.filter(({ submission_state }) => submission_state === "not_awarded").length,
    unverified_award_submissions: unverifiedAwardSubmissions,
    settled_submissions: settledSubmissions,
    pending_gross_potential_usdc: atomicToDecimal(pendingGrossAtomic),
    pending_net_potential_usdc: atomicToDecimal(pendingNetAtomic),
    settled_worker_earnings_usdc: atomicToDecimal(settledWorkerAtomic),
    submissions: records,
    worker_stats: stats,
    stats_correlate_with_tracked_settlements: Number(stats.completed_tasks) >= settledSubmissions &&
      BigInt(String(stats.total_earnings_atomic)) >= settledWorkerAtomic,
    accounting_rule: "only a completed task's canonical award becomes one purchase and positive worker-payment revenue after a successful Base receipt binds the canonical Taskmarket Diamond TaskCompleted event to the exact task, onchain non-owner requester, worker payment, platform fee, and a unique exact Base-USDC payout transfer from the Diamond to the worker; submissions, platform awards, and submit transaction hashes alone remain zero",
  };
}
