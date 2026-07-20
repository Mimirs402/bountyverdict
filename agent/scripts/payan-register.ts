import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";

const enabled = process.env.PAYAN_REGISTER === "YES";
const secretFile = process.env.PAYAN_SECRET_FILE || `${homedir()}/.config/bountyverdict/payan.env`;
const walletAddress = "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614";
if (!enabled) throw new Error("Set PAYAN_REGISTER=YES to register the provider identity.");

try {
  const raw = await readFile(secretFile, "utf8");
  const apiKey = raw.match(/^PAYAN_API_KEY=(pk_live_[A-Za-z0-9_-]+)$/m)?.[1];
  const agentId = raw.match(/^PAYAN_AGENT_ID=([A-Za-z0-9_-]+)$/m)?.[1];
  if (!apiKey || !agentId) throw new Error("Existing PayanAgent credential file is invalid.");
  const response = await fetch(`https://payanagent.com/api/v1/agents/${agentId}`, {
    headers: { Authorization: `Bearer ${apiKey}` }, redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Existing PayanAgent identity returned HTTP ${response.status}.`);
  const agent = await response.json() as Record<string, unknown>;
  console.log(JSON.stringify({ action: "existing", agent_id: agent._id || agent.id || agent.agentId, name: agent.name }, null, 2));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  const response = await fetch("https://payanagent.com/api/v1/agents", {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "BountyVerdict",
      description: "Automated evidence-linked GitHub and MCP decision checks with exact typed JSON outputs.",
      walletAddress,
      chain: "base",
      providerType: "agent",
      discoverySource: "another_agent",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`PayanAgent registration returned HTTP ${response.status}.`);
  const agentId = payload.agentId;
  const apiKey = payload.apiKey;
  if (typeof agentId !== "string" || !agentId || typeof apiKey !== "string" || !/^pk_live_[A-Za-z0-9_-]+$/.test(apiKey)) {
    throw new Error("PayanAgent returned an invalid registration.");
  }
  await mkdir(dirname(secretFile), { recursive: true, mode: 0o700 });
  const temporary = `${secretFile}.${process.pid}.tmp`;
  await writeFile(temporary, `PAYAN_AGENT_ID=${agentId}\nPAYAN_API_KEY=${apiKey}\n`, { mode: 0o600 });
  await rename(temporary, secretFile);
  console.log(JSON.stringify({ action: "registered", agent_id: agentId, name: payload.name || "BountyVerdict", wallet_address: walletAddress }, null, 2));
}
