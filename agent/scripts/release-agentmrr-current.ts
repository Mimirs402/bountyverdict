import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  parseAgentMrrPublicationCommandResult,
  parseAgentMrrReconciliationCommandResult,
} from "../src/agentmrr-reconciliation.ts";

const execFileAsync = promisify(execFile);
const enabled = process.env.RELEASE_AGENTMRR_CURRENT === "YES";
const agentDirectory = fileURLToPath(new URL("..", import.meta.url));

async function invoke(script: string, flag: string): Promise<unknown> {
  const result = await execFileAsync(process.execPath, ["--experimental-strip-types", script], {
    cwd: agentDirectory,
    env: { ...process.env, [flag]: "YES" },
    timeout: 90_000,
    maxBuffer: 2_000_000,
    encoding: "utf8",
  });
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`AgentMRR ${script} returned malformed output.`);
  }
}

if (!enabled) {
  console.log(JSON.stringify({ status: "armed_not_released" }, null, 2));
} else {
  const reconciliation = parseAgentMrrReconciliationCommandResult(
    await invoke("scripts/reconcile-agentmrr-code-release.ts", "RECONCILE_AGENTMRR_CODE_RELEASE"),
  );
  const publication = parseAgentMrrPublicationCommandResult(
    await invoke("scripts/agentmrr-publish.ts", "AGENTMRR_PUBLISH"),
  );
  console.log(JSON.stringify({
    status: "complete",
    reconciliation: reconciliation.status,
    release_commit: reconciliation.releaseCommit,
    action: publication.action,
    product_id: publication.productId,
    name: "RunVerdict",
  }, null, 2));
}
