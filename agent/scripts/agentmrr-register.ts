import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import {
  AGENTMRR_AGENT_DESCRIPTION,
  AGENTMRR_AGENT_NAME,
  AGENTMRR_BASE_URL,
  type AgentMrrRegistration,
  parseAgentMrrChallenge,
  parseAgentMrrRegistration,
  parseAgentMrrSecret,
  readAgentMrrJsonResponse,
  solveAgentMrrChallenge,
} from "../src/agentmrr.ts";

const enabled = process.env.AGENTMRR_REGISTER === "YES";
const configDirectory = `${homedir()}/.config/bountyverdict`;
const secretFile = `${configDirectory}/agentmrr.env`;
const registrationLockFile = `${configDirectory}/agentmrr-registration.lock`;
const expectedUid = process.getuid?.() ?? -1;
if (!enabled) throw new Error("Set AGENTMRR_REGISTER=YES to register the AgentMRR identity.");
if (expectedUid < 0) throw new Error("AgentMRR registration requires a local Unix owner identity.");

await mkdir(configDirectory, { recursive: true, mode: 0o700 });
const directoryStat = await lstat(configDirectory);
if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || directoryStat.uid !== expectedUid ||
    (directoryStat.mode & 0o077) !== 0) {
  throw new Error("BountyVerdict configuration directory must be owner-owned and private.");
}

async function existingCredentials(): Promise<AgentMrrRegistration | null> {
  let secretHandle: Awaited<ReturnType<typeof open>>;
  try {
    secretHandle = await open(secretFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const secretStat = await secretHandle.stat();
    if (!secretStat.isFile() || (secretStat.mode & 0o777) !== 0o600 || secretStat.uid !== expectedUid) {
      throw new Error("Existing AgentMRR credential file must be a regular owner-owned file with mode 0600.");
    }
    return parseAgentMrrSecret(await secretHandle.readFile({ encoding: "utf8" }));
  } finally {
    await secretHandle.close();
  }
}

const existing = await existingCredentials();
if (existing) {
  console.log(JSON.stringify({ action: "existing", agent_id: existing.agentId, name: AGENTMRR_AGENT_NAME }, null, 2));
} else {
  const registrationLock = await open(registrationLockFile, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new Error("Another AgentMRR registration is already in progress.");
    throw error;
  });
  try {
    await registrationLock.writeFile(`${process.pid}\n`);
    await registrationLock.sync();
    const secretHandle = await open(secretFile, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") throw new Error("AgentMRR credential destination was concurrently reserved.");
      throw error;
    });
    let persisted = false;
    try {
      // Reserve and physically write more than the maximum bounded credential before
      // requesting the one-time remote key, so path, permissions, and basic storage
      // failures happen before registration.
      await secretHandle.write(Buffer.alloc(512), 0, 512, 0);
      await secretHandle.sync();

      const challengeResponse = await fetch(`${AGENTMRR_BASE_URL}/api/agents/register`, {
        headers: { Accept: "application/json", "User-Agent": "BountyVerdict-Distribution/1.0" },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      const challenge = parseAgentMrrChallenge(await readAgentMrrJsonResponse(challengeResponse, "challenge"));
      const solution = solveAgentMrrChallenge(challenge);
      const registerResponse = await fetch(`${AGENTMRR_BASE_URL}/api/agents/register`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "BountyVerdict-Distribution/1.0",
        },
        body: JSON.stringify({
          name: AGENTMRR_AGENT_NAME,
          description: AGENTMRR_AGENT_DESCRIPTION,
          nonce: challenge.nonce,
          solution,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      const registration = parseAgentMrrRegistration(
        await readAgentMrrJsonResponse(registerResponse, "registration"),
      );
      const contents = Buffer.from([
        `AGENTMRR_AGENT_ID=${registration.agentId}`,
        `AGENTMRR_API_KEY=${registration.apiKey}`,
        "",
      ].join("\n"));
      await secretHandle.write(contents, 0, contents.length, 0);
      await secretHandle.truncate(contents.length);
      await secretHandle.sync();
      persisted = true;
      console.log(JSON.stringify({ action: "registered", agent_id: registration.agentId, name: AGENTMRR_AGENT_NAME }, null, 2));
    } finally {
      await secretHandle.close();
      if (!persisted) await unlink(secretFile).catch(() => undefined);
    }
  } finally {
    await registrationLock.close();
    await unlink(registrationLockFile).catch(() => undefined);
  }
}
