import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";

const enabled = process.env.NEAR_MARKET_REGISTER === "YES";
const secretFile = process.env.NEAR_MARKET_SECRET_FILE || `${homedir()}/.config/bountyverdict/near-market.env`;
if (!enabled) throw new Error("Set NEAR_MARKET_REGISTER=YES to register the provider identity.");

async function existingKey(): Promise<string | null> {
  try {
    const raw = await readFile(secretFile, "utf8");
    return raw.match(/^NEAR_MARKET_API_KEY=(sk_live_[A-Za-z0-9_-]+)$/m)?.[1] || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

const previous = await existingKey();
if (previous) {
  const response = await fetch("https://market.near.ai/v1/agents/me", {
    headers: { Authorization: `Bearer ${previous}` },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Existing NEAR Market identity returned HTTP ${response.status}.`);
  const me = await response.json() as Record<string, unknown>;
  console.log(JSON.stringify({ action: "existing", agent_id: me.agent_id || me.id, handle: me.handle }, null, 2));
} else {
  const response = await fetch("https://market.near.ai/v1/agents/register", {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle: "bountyverdict",
      tags: ["developer-tools", "github", "ci-cd", "code-review", "mcp"],
      capabilities: {
        summary: "Automated evidence-linked GitHub and MCP decision checks with exact typed outputs.",
        documentation: "https://mimirs402.github.io/bountyverdict/agents.html",
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`NEAR Market registration returned HTTP ${response.status}.`);
  const agentId = payload.agent_id;
  const apiKey = payload.api_key;
  const nearAccount = payload.near_account_id;
  if (
    typeof agentId !== "string" || !/^[a-f0-9-]{36}$/.test(agentId) ||
    typeof apiKey !== "string" || !/^sk_live_[A-Za-z0-9_-]+$/.test(apiKey) ||
    typeof nearAccount !== "string" || !/^[a-z0-9._-]+$/.test(nearAccount)
  ) throw new Error("NEAR Market returned an invalid registration.");
  await mkdir(dirname(secretFile), { recursive: true, mode: 0o700 });
  const temporary = `${secretFile}.${process.pid}.tmp`;
  await writeFile(temporary, [
    `NEAR_MARKET_AGENT_ID=${agentId}`,
    `NEAR_MARKET_API_KEY=${apiKey}`,
    `NEAR_MARKET_ACCOUNT_ID=${nearAccount}`,
    "",
  ].join("\n"), { mode: 0o600 });
  await rename(temporary, secretFile);
  console.log(JSON.stringify({ action: "registered", agent_id: agentId, handle: payload.handle, near_account_id: nearAccount }, null, 2));
}

export {};
