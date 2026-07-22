import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import {
  AGENTWORK_TASKMARKET_PITCH,
  parseAgentWorkTaskmarketPitch,
} from "../src/taskmarket-pitch.ts";

const api = "https://api.taskmarket.dev";
const artifactFile = new URL("../config/taskmarket-agentwork-flowise-pitch.md", import.meta.url);
const stateFile = process.env.TASKMARKET_AGENTWORK_PITCH_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/taskmarket-agentwork-pitch.json`;
const maximumBytes = 2_000_000;

async function readJson(path: string): Promise<unknown> {
  const response = await fetch(new URL(path, api), {
    method: "GET",
    redirect: "error",
    headers: { Accept: "application/json", "User-Agent": "bountyverdict-taskmarket-pitch-monitor/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok || !(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    throw new Error(`Taskmarket pitch monitor received HTTP ${response.status}.`);
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).length > maximumBytes) throw new Error("Taskmarket pitch response exceeded the byte cap.");
  return JSON.parse(body) as unknown;
}

async function atomicWrite(value: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
  const temporary = `${stateFile}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, stateFile);
}

const checkedAt = new Date().toISOString();
try {
  const encoded = encodeURIComponent(AGENTWORK_TASKMARKET_PITCH.taskId);
  const [task, pitches, pitchText] = await Promise.all([
    readJson(`/api/tasks/${encoded}`),
    readJson(`/api/tasks/${encoded}/pitches`),
    readFile(artifactFile, "utf8"),
  ]);
  const result = parseAgentWorkTaskmarketPitch(task, pitches, pitchText.trimEnd());
  const state = { schema_version: 1, checked_at: checkedAt, available: true, ...result };
  await atomicWrite(state);
  console.log(JSON.stringify(state, null, 2));
} catch (error) {
  const state = {
    schema_version: 1,
    checked_at: checkedAt,
    available: false,
    task_id: AGENTWORK_TASKMARKET_PITCH.taskId,
    pitch_id: AGENTWORK_TASKMARKET_PITCH.pitchId,
    error: error instanceof Error ? error.message.slice(0, 500) : "unknown pitch monitor failure",
  };
  await atomicWrite(state);
  console.error(JSON.stringify(state, null, 2));
  process.exitCode = 1;
}
