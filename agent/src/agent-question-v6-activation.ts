import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename } from "node:fs/promises";
import { dirname } from "node:path";
import {
  AGENT_QUESTION_DESCRIPTION_V6_EXPERIMENT_ID,
  parseTaskLeadingDescriptionActivation,
  TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST,
  type DescriptionExperimentId,
  type TaskLeadingDescriptionActivation,
} from "./task-leading-description-experiment.ts";

export const AGENT_QUESTION_V6_RELEASE = "151fca29d89d9825e881c81fe0252e21b916c466";
export const AGENT_QUESTION_V6_PRODUCTION_ACTIVATION = "ba4242e43cd710e4bad82106c85009af0c5ea546";
export const AGENT_QUESTION_V6_PRODUCTION_ACTIVATED_AT = "2026-07-22T20:34:00.307Z";
export const AGENT_QUESTION_V6_ROTATION = "field-test-release-epoch-54";
export const AGENT_QUESTION_V6_EPOCH = 54;

function record(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, any>;
}

export function activationFromVerifiedEpoch54(value: unknown): TaskLeadingDescriptionActivation | null {
  const ledger = record(value, "Trusted funnel epoch ledger");
  if (ledger.schema_version !== 2 || !Number.isSafeInteger(ledger.active_epoch_id) || !Array.isArray(ledger.epochs)) {
    throw new Error("Trusted funnel epoch ledger shape is invalid.");
  }
  const rotation = ledger.rotation;
  if (!rotation || typeof rotation !== "object" || Array.isArray(rotation)) return null;
  if (rotation.id !== AGENT_QUESTION_V6_ROTATION || rotation.target_epoch_id !== AGENT_QUESTION_V6_EPOCH) {
    return null;
  }
  if (rotation.status !== "activated") return null;
  if (ledger.active_epoch_id !== AGENT_QUESTION_V6_EPOCH) {
    throw new Error("Verified v6 rotation is no longer the active measurement epoch.");
  }
  if (typeof rotation.activated_at !== "string" || new Date(rotation.activated_at).toISOString() !== rotation.activated_at) {
    throw new Error("Verified v6 rotation activation time is invalid.");
  }
  const epoch = ledger.epochs.find((candidate: Record<string, unknown>) => candidate?.id === AGENT_QUESTION_V6_EPOCH);
  const active = record(epoch, "Verified v6 active epoch");
  const baseline = record(active.baseline, "Verified v6 active baseline");
  if (active.status !== "active" || active.conversion_eligible !== true ||
      active.started_at !== rotation.activated_at || baseline.epoch_id !== AGENT_QUESTION_V6_EPOCH ||
      baseline.initialized_at !== rotation.activated_at) {
    throw new Error("Verified v6 active epoch does not match its activated rotation boundary.");
  }

  return parseTaskLeadingDescriptionActivation({
    schema_version: 1,
    experiment_id: AGENT_QUESTION_DESCRIPTION_V6_EXPERIMENT_ID,
    release_commit: AGENT_QUESTION_V6_RELEASE,
    production_activation_commit: AGENT_QUESTION_V6_PRODUCTION_ACTIVATION,
    production_activated_at: AGENT_QUESTION_V6_PRODUCTION_ACTIVATED_AT,
    drain_rotation_id: AGENT_QUESTION_V6_ROTATION,
    measurement_epoch_id: AGENT_QUESTION_V6_EPOCH,
    epoch_activated_at: rotation.activated_at,
    target_tools_list: TASK_LEADING_DESCRIPTION_TARGET_TOOLS_LIST,
  }, AGENT_QUESTION_DESCRIPTION_V6_EXPERIMENT_ID);
}

export async function readPrivateJson(path: string, maximumBytes = 64 * 1024 * 1024): Promise<unknown | null> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0 ||
        (typeof process.getuid === "function" && metadata.uid !== process.getuid()) ||
        metadata.size < 2 || metadata.size > maximumBytes) {
      throw new Error("Private JSON input must be a bounded owner-owned regular file with mode 0600.");
    }
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

export async function writePrivateActivation(
  path: string,
  activation: TaskLeadingDescriptionActivation,
  expectedExperimentId: DescriptionExperimentId = AGENT_QUESTION_DESCRIPTION_V6_EXPERIMENT_ID,
): Promise<void> {
  const validated = parseTaskLeadingDescriptionActivation(activation, expectedExperimentId);
  if (!validated) throw new Error("Agent-question activation is missing.");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle?.close();
  }
  await rename(temporary, path);
}
