import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { acquireExclusiveRun } from "../src/exclusive-run.ts";
import { validateOpportunityArtifacts } from "../src/opportunity-artifact-safety.ts";
import {
  buildOpportunityAgentPrompt,
  buildOpportunityPreparationPrompt,
  OPPORTUNITY_ASSESSMENT_SCHEMA,
  OPPORTUNITY_PREPARATION_SCHEMA,
  parseOpportunityAssessment,
  parseOpportunityPreparationResult,
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
  stateRoot;
const outputRoot = process.env.BOUNTY_OPPORTUNITY_OUTPUT_ROOT ||
  join(stateRoot, "opportunity-workflows");
const maximumCompletedTriggers = 200;
const maximumResultBytes = 256 * 1024;
const opportunityIdPattern =
  /^(?:0x[a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i;
const networkDomainPolicy =
  'features.network_proxy.domains={"api.taskmarket.dev"="allow","taskmarket.dev"="allow","api.moltjobs.io"="allow","moltjobs.io"="allow","github.com"="allow","api.github.com"="allow","raw.githubusercontent.com"="allow","codeload.github.com"="allow","objects.githubusercontent.com"="allow","basescan.org"="allow","api.basescan.org"="allow","base.blockscout.com"="allow","base-sepolia.blockscout.com"="allow","registry.npmjs.org"="allow","pypi.org"="allow","files.pythonhosted.org"="allow","proxy.golang.org"="allow","sum.golang.org"="allow","crates.io"="allow","static.crates.io"="allow"}';

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
        !Array.isArray(record.task_ids) ||
        record.task_ids.some((id) => typeof id !== "string" || !opportunityIdPattern.test(id)) ||
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

function codexEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "HOME", "CODEX_HOME", "LANG", "LC_ALL", "TERM", "TMPDIR"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GCM_INTERACTIVE = "Never";
  return env;
}

async function boundedJson(path: string, label: string): Promise<unknown> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximumResultBytes) {
    throw new Error(`${label} is not a bounded regular file.`);
  }
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function consumeTrigger(triggerId: string): Promise<void> {
  const current = parseOpportunityTrigger(JSON.parse(await readFile(triggerFile, "utf8")) as unknown);
  if (current.trigger_id !== triggerId) {
    throw new Error("Opportunity trigger changed before durable acknowledgement.");
  }
  await unlink(triggerFile);
}

async function runCodex(
  sandbox: "read-only" | "workspace-write",
  cwd: string,
  schemaFile: string,
  resultFile: string,
  prompt: string,
): Promise<string> {
  const { stdout, stderr } = await execFileAsync("codex", [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "-c",
    'shell_environment_policy={inherit="none",set={GIT_CONFIG_GLOBAL="/dev/null",GIT_TERMINAL_PROMPT="0",GCM_INTERACTIVE="Never"}}',
    "-c",
    "sandbox_workspace_write.network_access=true",
    "-c",
    "features.network_proxy.enabled=true",
    "-c",
    networkDomainPolicy,
    "--sandbox",
    sandbox,
    "--skip-git-repo-check",
    "--cd",
    cwd,
    "--output-schema",
    schemaFile,
    "--output-last-message",
    resultFile,
    prompt,
  ], {
    cwd,
    encoding: "utf8",
    timeout: 90 * 60 * 1_000,
    maxBuffer: 10 * 1024 * 1024,
    env: codexEnvironment(),
  });
  return `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`;
}

await mkdir(stateRoot, { recursive: true, mode: 0o700 });
const releaseLock = await acquireExclusiveRun(lockFile, { staleAfterMs: 2 * 60 * 60 * 1_000 });

try {
  const trigger = parseOpportunityTrigger(JSON.parse(await readFile(triggerFile, "utf8")) as unknown);
  const state = await readWorkflowState();
  if (state.completed.some(({ trigger_id }) => trigger_id === trigger.trigger_id)) {
    await consumeTrigger(trigger.trigger_id);
    console.log(JSON.stringify({ status: "skipped", reason: "trigger_already_completed", trigger_id: trigger.trigger_id }));
  } else {
    await mkdir(outputRoot, { recursive: true, mode: 0o700 });
    const assessmentWorkspace = join(outputRoot, "assessment-workspaces", trigger.trigger_id);
    const assessmentFile = join(outputRoot, `${trigger.trigger_id}.assessment.json`);
    const assessmentSchemaFile = join(outputRoot, `${trigger.trigger_id}.assessment.schema.json`);
    const assessmentLogFile = join(outputRoot, `${trigger.trigger_id}.assessment.log`);
    await mkdir(assessmentWorkspace, { recursive: true, mode: 0o700 });
    await atomicWrite(assessmentSchemaFile, `${JSON.stringify(OPPORTUNITY_ASSESSMENT_SCHEMA, null, 2)}\n`);
    const assessmentLog = await runCodex(
      "workspace-write",
      assessmentWorkspace,
      assessmentSchemaFile,
      assessmentFile,
      buildOpportunityAgentPrompt(trigger),
    );
    await atomicWrite(assessmentLogFile, assessmentLog);
    const assessment = parseOpportunityAssessment(
      await boundedJson(assessmentFile, "Opportunity assessment"),
      trigger,
    );

    const receiptFile = join(outputRoot, `${trigger.trigger_id}.result.json`);
    let preparation: ReturnType<typeof parseOpportunityPreparationResult> | null = null;
    let outcome: string = assessment.decision;
    const ready = assessment.candidates.find(({ decision }) => decision === "READY_FOR_LOCAL_PREPARATION");
    if (ready) {
      const preparationRoot = join(workspaceRoot, "bounty-opportunities", trigger.trigger_id);
      const preparationFile = join(outputRoot, `${trigger.trigger_id}.preparation.json`);
      const preparationSchemaFile = join(outputRoot, `${trigger.trigger_id}.preparation.schema.json`);
      const preparationLogFile = join(outputRoot, `${trigger.trigger_id}.preparation.log`);
      await mkdir(preparationRoot, { recursive: true, mode: 0o700 });
      await atomicWrite(preparationSchemaFile, `${JSON.stringify(OPPORTUNITY_PREPARATION_SCHEMA, null, 2)}\n`);
      const preparationLog = await runCodex(
        "workspace-write",
        preparationRoot,
        preparationSchemaFile,
        preparationFile,
        buildOpportunityPreparationPrompt(trigger, assessment, ready.task_id, preparationRoot),
      );
      await atomicWrite(preparationLogFile, preparationLog);
      preparation = parseOpportunityPreparationResult(
        await boundedJson(preparationFile, "Opportunity preparation result"),
        trigger,
        ready.task_id,
      );
      await validateOpportunityArtifacts(preparationRoot, preparation.artifact_paths);
      outcome = preparation.status;
    }
    await atomicWrite(receiptFile, `${JSON.stringify({
      schema_version: 1,
      trigger_id: trigger.trigger_id,
      outcome,
      assessment,
      preparation,
    }, null, 2)}\n`);

    const completedAt = new Date().toISOString();
    const completed: WorkflowState["completed"] = [
      ...state.completed,
      {
        trigger_id: trigger.trigger_id,
        completed_at: completedAt,
        task_ids: trigger.candidates.map(({ task_id }) => task_id),
        result_file: receiptFile,
      },
    ].slice(-maximumCompletedTriggers);
    await atomicWrite(workflowStateFile, `${JSON.stringify({ schema_version: 1, completed }, null, 2)}\n`);
    await consumeTrigger(trigger.trigger_id);
    console.log(JSON.stringify({
      status: "completed",
      trigger_id: trigger.trigger_id,
      candidates: trigger.candidates.length,
      outcome,
      result_file: receiptFile,
    }));
  }
} finally {
  await releaseLock();
}
