import { execFile } from "node:child_process";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  buildOpportunityAgentPrompt,
  parseOpportunityTrigger,
} from "../src/opportunity-agent-workflow.ts";

const execFileAsync = promisify(execFile);
const stateRoot = process.env.BOUNTY_OPPORTUNITY_STATE_ROOT ||
  `${homedir()}/.local/state/bountyverdict`;
const triggerFile = process.env.BOUNTY_OPPORTUNITY_TRIGGER_FILE ||
  join(stateRoot, "opportunity-trigger.json");
const workflowStateFile = process.env.BOUNTY_OPPORTUNITY_WORKFLOW_STATE_FILE ||
  join(stateRoot, "opportunity-workflow.json");
const lockFile = process.env.BOUNTY_OPPORTUNITY_LOCK_FILE ||
  join(stateRoot, "opportunity-workflow.lock");
const workspaceRoot = process.env.BOUNTY_OPPORTUNITY_WORKSPACE_ROOT ||
  `${homedir()}/Projects/sandbox`;
const outputRoot = process.env.BOUNTY_OPPORTUNITY_OUTPUT_ROOT ||
  join(stateRoot, "opportunity-workflows");
const maximumCompletedTriggers = 200;

type WorkflowState = {
  schema_version: 1;
  completed: Array<{
    trigger_id: string;
    completed_at: string;
    task_ids: string[];
    result_file: string;
  }>;
};

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function readWorkflowState(): Promise<WorkflowState> {
  try {
    const parsed = JSON.parse(await readFile(workflowStateFile, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Opportunity workflow state is malformed.");
    }
    const state = parsed as Record<string, unknown>;
    if (state.schema_version !== 1 || !Array.isArray(state.completed) ||
      state.completed.length > maximumCompletedTriggers) {
      throw new Error("Opportunity workflow state is incompatible.");
    }
    const completed = state.completed.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("Opportunity workflow completion is malformed.");
      }
      const record = item as Record<string, unknown>;
      if (typeof record.trigger_id !== "string" || !/^[a-f0-9]{64}$/.test(record.trigger_id) ||
        typeof record.completed_at !== "string" || !Number.isFinite(Date.parse(record.completed_at)) ||
        !Array.isArray(record.task_ids) || record.task_ids.some((id) => typeof id !== "string" || !/^0x[a-f0-9]{64}$/i.test(id)) ||
        typeof record.result_file !== "string" || !record.result_file.startsWith(`${outputRoot}/`)) {
        throw new Error("Opportunity workflow completion is invalid.");
      }
      return {
        trigger_id: record.trigger_id,
        completed_at: record.completed_at,
        task_ids: record.task_ids as string[],
        result_file: record.result_file,
      };
    });
    if (new Set(completed.map(({ trigger_id }) => trigger_id)).size !== completed.length) {
      throw new Error("Opportunity workflow completions are duplicated.");
    }
    return { schema_version: 1, completed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schema_version: 1, completed: [] };
    throw error;
  }
}

await mkdir(stateRoot, { recursive: true, mode: 0o700 });
let lock: Awaited<ReturnType<typeof open>> | null = null;
try {
  lock = await open(lockFile, "wx", 0o600);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "EEXIST") {
    console.log(JSON.stringify({ status: "skipped", reason: "workflow_already_running" }));
    process.exit(0);
  }
  throw error;
}

try {
  const trigger = parseOpportunityTrigger(JSON.parse(await readFile(triggerFile, "utf8")) as unknown);
  const state = await readWorkflowState();
  if (state.completed.some(({ trigger_id }) => trigger_id === trigger.trigger_id)) {
    console.log(JSON.stringify({ status: "skipped", reason: "trigger_already_completed", trigger_id: trigger.trigger_id }));
  } else {
    await mkdir(outputRoot, { recursive: true, mode: 0o700 });
    const resultFile = join(outputRoot, `${trigger.trigger_id}.md`);
    const logFile = join(outputRoot, `${trigger.trigger_id}.log`);
    const prompt = buildOpportunityAgentPrompt(trigger);
    const { stdout, stderr } = await execFileAsync("codex", [
      "exec",
      "--ephemeral",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "--cd",
      workspaceRoot,
      "--output-last-message",
      resultFile,
      prompt,
    ], {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 90 * 60 * 1_000,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });
    await atomicWrite(logFile, `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`);
    const completedAt = new Date().toISOString();
    const completed: WorkflowState["completed"] = [
      ...state.completed,
      {
        trigger_id: trigger.trigger_id,
        completed_at: completedAt,
        task_ids: trigger.candidates.map(({ task_id }) => task_id),
        result_file: resultFile,
      },
    ].slice(-maximumCompletedTriggers);
    await atomicWrite(workflowStateFile, `${JSON.stringify({ schema_version: 1, completed }, null, 2)}\n`);
    console.log(JSON.stringify({
      status: "completed",
      trigger_id: trigger.trigger_id,
      candidates: trigger.candidates.length,
      result_file: resultFile,
    }));
  }
} finally {
  await lock?.close();
  await unlink(lockFile).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
