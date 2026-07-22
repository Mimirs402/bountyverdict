import { createHash } from "node:crypto";

export const AGENTWORK_TASKMARKET_PITCH = Object.freeze({
  taskId: "0x2365c7694be50babbfd2c176f0a3a4a7517bd5c970b5e6be8a3af58997e1cbcd",
  pitchId: "3f6371c1-fe5b-4128-b88e-c48384999cd1",
  workerAddress: "0xe5E0fe496B7283032d034Dc79C305b384Ad1ee67",
  workerAgentId: "59501",
  requesterAddress: "0x4AeF50A137b67749D542AC07f51D11F38F04440C",
  requesterAgentId: "59340",
  rewardAtomic: "2162162",
  netRewardAtomic: "1999999",
  artifactSha256: "e6863bbde4318893c92949e95f3af7e3f98964f41f6634f7311a3d1659e998f5",
  estimatedDurationHours: 48,
});

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed.`);
  }
  return value as Record<string, unknown>;
};

const validDate = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
};

export function parseAgentWorkTaskmarketPitch(
  taskPayload: unknown,
  pitchesPayload: unknown,
  expectedPitchText: string,
): Record<string, unknown> {
  const expected = AGENTWORK_TASKMARKET_PITCH;
  const task = asRecord(taskPayload, "Taskmarket task");
  if (task.id !== expected.taskId || task.mode !== "pitch" ||
    typeof task.status !== "string" || task.requester !== expected.requesterAddress ||
    task.requesterAgentId !== expected.requesterAgentId ||
    task.reward !== expected.rewardAtomic || task.netReward !== expected.netRewardAtomic) {
    throw new Error("Taskmarket AgentWork task identity or economics drifted.");
  }
  const pitchDeadline = validDate(task.pitchDeadline, "Taskmarket pitch deadline");
  const expiryTime = validDate(task.expiryTime, "Taskmarket task expiry");
  if (!Array.isArray(pitchesPayload) || pitchesPayload.length > 100) {
    throw new Error("Taskmarket pitches response is malformed or unbounded.");
  }
  const ids = new Set<string>();
  const records = pitchesPayload.map((value) => {
    const record = asRecord(value, "Taskmarket pitch");
    if (typeof record.id !== "string" || ids.has(record.id)) {
      throw new Error("Taskmarket pitches contain a missing or duplicate ID.");
    }
    ids.add(record.id);
    return record;
  });
  const matches = records.filter((record) => record.id === expected.pitchId);
  if (matches.length !== 1) throw new Error("Exact Taskmarket AgentWork pitch is missing or ambiguous.");
  const pitch = matches[0];
  const textHash = createHash("sha256").update(expectedPitchText).digest("hex");
  if (textHash !== expected.artifactSha256 || pitch.taskId !== expected.taskId ||
    pitch.workerAddress !== expected.workerAddress || pitch.workerAgentId !== expected.workerAgentId ||
    pitch.pitchText !== expectedPitchText || pitch.estimatedDuration !== expected.estimatedDurationHours ||
    typeof pitch.status !== "string") {
    throw new Error("Taskmarket AgentWork pitch identity or artifact drifted.");
  }
  const submittedAt = validDate(pitch.submittedAt, "Taskmarket pitch submission time");
  const selectedAddress = typeof task.claimedBy === "string" ? task.claimedBy : null;
  const selectedAgentId = typeof task.workerAgentId === "string" ? task.workerAgentId : null;
  const oursSelected = selectedAddress?.toLowerCase() === expected.workerAddress.toLowerCase() ||
    selectedAgentId === expected.workerAgentId || ["selected", "accepted"].includes(pitch.status);
  const anotherSelected = Boolean(selectedAddress && selectedAddress.toLowerCase() !== expected.workerAddress.toLowerCase()) ||
    Boolean(selectedAgentId && selectedAgentId !== expected.workerAgentId);
  const explicitlyRejected = ["rejected", "withdrawn"].includes(pitch.status);
  const terminalTask = ["completed", "cancelled", "expired", "refunded"].includes(task.status);
  const state = oursSelected
    ? "selected"
    : explicitlyRejected || anotherSelected || terminalTask
      ? "not_selected"
      : "pending_selection";
  return {
    task_id: expected.taskId,
    pitch_id: expected.pitchId,
    worker_address: expected.workerAddress,
    worker_agent_id: expected.workerAgentId,
    task_status: task.status,
    pitch_status: pitch.status,
    state,
    action: state === "selected"
      ? "implement_flowise_integration"
      : state === "not_selected"
        ? "stop_without_contacting_flowise"
        : "wait_for_requester_selection",
    reward_usdc: "2.162162",
    net_reward_usdc: "1.999999",
    pitch_fee_usdc: "0.001",
    total_pitch_count: records.length,
    submitted_at: submittedAt,
    pitch_deadline: pitchDeadline,
    task_expiry: expiryTime,
    artifact_sha256: textHash,
    accounting: "pitch_and_selection_state_are_not_purchase_award_settlement_or_revenue",
  };
}
