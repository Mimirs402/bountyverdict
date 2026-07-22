import { constants } from "node:fs";
import { mkdir, open, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const CHECKPOINT_SCHEMA_VERSION = 1;

type CheckpointEnvelope = {
  schema_version: number;
  experiment_id: string;
  persisted_at: string;
  state: Record<string, unknown>;
};

function checkpointEnvelope(value: unknown, expectedExperimentId: string): CheckpointEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Measurement experiment checkpoint must be an object.");
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.schema_version !== CHECKPOINT_SCHEMA_VERSION) {
    throw new Error("Measurement experiment checkpoint schema is unsupported.");
  }
  if (envelope.experiment_id !== expectedExperimentId) {
    throw new Error("Measurement experiment checkpoint belongs to a different experiment.");
  }
  if (typeof envelope.persisted_at !== "string" || !Number.isFinite(Date.parse(envelope.persisted_at))) {
    throw new Error("Measurement experiment checkpoint time is invalid.");
  }
  if (!envelope.state || typeof envelope.state !== "object" || Array.isArray(envelope.state)) {
    throw new Error("Measurement experiment checkpoint state is missing.");
  }
  const state = envelope.state as Record<string, unknown>;
  if (state.id !== expectedExperimentId) {
    throw new Error("Measurement experiment checkpoint state ID does not match its envelope.");
  }
  return envelope as CheckpointEnvelope;
}

export async function readMeasurementExperimentCheckpoint(
  path: string,
  expectedExperimentId: string,
): Promise<Record<string, unknown> | null> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Measurement experiment checkpoint is not a regular file.");
    if ((stat.mode & 0o077) !== 0) throw new Error("Measurement experiment checkpoint must use mode 0600.");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw new Error("Measurement experiment checkpoint is not owned by the monitor user.");
    }
    const parsed = JSON.parse(await handle.readFile("utf8"));
    return checkpointEnvelope(parsed, expectedExperimentId).state;
  } finally {
    await handle.close();
  }
}

export async function writeMeasurementExperimentCheckpoint(
  path: string,
  experimentId: string,
  persistedAt: string,
  state: Record<string, unknown>,
): Promise<void> {
  const envelope = checkpointEnvelope({
    schema_version: CHECKPOINT_SCHEMA_VERSION,
    experiment_id: experimentId,
    persisted_at: persistedAt,
    state,
  }, experimentId);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle?.close();
  }
  await rename(temporary, path);
}

export const readRecoveryExperimentCheckpoint = readMeasurementExperimentCheckpoint;
export const writeRecoveryExperimentCheckpoint = writeMeasurementExperimentCheckpoint;
