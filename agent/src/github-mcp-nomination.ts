import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

export const GITHUB_MCP_NOMINATION = Object.freeze({
  recipient: "partnerships@github.com",
  sender: "admin@mimirslab.com",
  smtpHost: "smtp.protonmail.ch",
  smtpPort: 587,
  subject: "Nomination: io.github.Mimirs402/bountyverdict for GitHub MCP Registry",
  body: [
    "Please consider io.github.Mimirs402/bountyverdict@1.1.10 for inclusion in the public GitHub MCP Registry.",
    "",
    "OSS Registry: https://registry.modelcontextprotocol.io/v0/servers?search=io.github.Mimirs402%2Fbountyverdict",
    "Source: https://github.com/Mimirs402/bountyverdict",
    "",
    "BountyVerdict Agent Decision Tools — Read-only GitHub bounty, agent harness, Actions failure, flake, and MCP tool-drift decisions. It is a no-secret remote Streamable HTTP server. Connection and tool discovery are free; successful paid results require explicit per-call x402 Base USDC authorization, disclosed before payment.",
    "",
    "This is a nomination for the public GitHub MCP Registry only; it is not an application to the Technology Partner Program or acceptance of additional terms. If inclusion requires a separate agreement, please reply with its terms for review.",
    "",
    "Regards,",
    "Mimir's Lab",
  ].join("\n"),
});

export type NominationConfiguration = {
  username: string;
  token: string;
  releaseCommit: string;
};

export function nominationConfiguration(env: NodeJS.ProcessEnv): NominationConfiguration {
  if (env.SMTP_HOST && env.SMTP_HOST !== GITHUB_MCP_NOMINATION.smtpHost) {
    throw new Error(`SMTP_HOST must be ${GITHUB_MCP_NOMINATION.smtpHost}.`);
  }
  if (env.SMTP_PORT && env.SMTP_PORT !== String(GITHUB_MCP_NOMINATION.smtpPort)) {
    throw new Error(`SMTP_PORT must be ${GITHUB_MCP_NOMINATION.smtpPort}.`);
  }
  const username = env.SMTP_USERNAME || "";
  if (username !== GITHUB_MCP_NOMINATION.sender) {
    throw new Error(`SMTP_USERNAME must be ${GITHUB_MCP_NOMINATION.sender}.`);
  }
  const token = env.SMTP_TOKEN || "";
  if (token.length < 12 || token.length > 512 || /[\r\n\0]/.test(token)) {
    throw new Error("SMTP_TOKEN is missing or malformed.");
  }
  const releaseCommit = env.NOMINATION_RELEASE_COMMIT || "";
  if (!/^[a-f0-9]{40}$/.test(releaseCommit)) {
    throw new Error("NOMINATION_RELEASE_COMMIT is missing or malformed.");
  }
  return { username, token, releaseCommit };
}

export function nominationContractSha256(): string {
  return createHash("sha256").update([
    GITHUB_MCP_NOMINATION.recipient,
    GITHUB_MCP_NOMINATION.sender,
    GITHUB_MCP_NOMINATION.smtpHost,
    String(GITHUB_MCP_NOMINATION.smtpPort),
    GITHUB_MCP_NOMINATION.subject,
    GITHUB_MCP_NOMINATION.body,
  ].join("\0")).digest("hex");
}

function headerDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error("Nomination date is invalid.");
  return date.toUTCString();
}

export function buildNominationMessage(date = new Date(), nonce = randomBytes(16).toString("hex")): string {
  if (!/^[a-f0-9]{32}$/.test(nonce)) throw new Error("Nomination message nonce is invalid.");
  return [
    `Date: ${headerDate(date)}`,
    `Message-ID: <bountyverdict-github-registry-${nonce}@mimirslab.com>`,
    `From: Mimir's Lab <${GITHUB_MCP_NOMINATION.sender}>`,
    `To: ${GITHUB_MCP_NOMINATION.recipient}`,
    `Subject: ${GITHUB_MCP_NOMINATION.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    GITHUB_MCP_NOMINATION.body,
    "",
  ].join("\r\n");
}

function curlQuoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function smtpCredentialConfig(configuration: NominationConfiguration): string {
  return `user = ${curlQuoted(`${configuration.username}:${configuration.token}`)}\n`;
}

export function nominationCurlArguments(): string[] {
  return [
    "--disable",
    "--silent",
    "--show-error",
    "--fail-with-body",
    "--proto",
    "=smtp",
    "--url",
    `smtp://${GITHUB_MCP_NOMINATION.smtpHost}:${GITHUB_MCP_NOMINATION.smtpPort}`,
    "--ssl-reqd",
    "--tlsv1.2",
    "--connect-timeout",
    "20",
    "--max-time",
    "60",
    "--mail-from",
    GITHUB_MCP_NOMINATION.sender,
    "--mail-rcpt",
    GITHUB_MCP_NOMINATION.recipient,
    "--upload-file",
    "-",
    "--config",
    "/dev/fd/3",
    "--write-out",
    "%{response_code}",
  ];
}

export function nominationChildEnvironment(_source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
  };
}

type NominationReceipt = {
  schema_version: 1;
  status: "prepared" | "accepted_by_smtp" | "ambiguous_transport_failure";
  prepared_at: string;
  sender: string;
  recipient: string;
  subject: string;
  release_commit: string;
  nomination_contract_sha256: string;
  message_sha256: string;
  accepted_at?: string;
  smtp_response_code?: string;
  failed_at?: string;
  transport_exit_code?: number | null;
};

const receiptPath = `${homedir()}/.local/state/bountyverdict/github-mcp-nomination.json`;

async function atomicWrite(path: string, value: NominationReceipt): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function existingReceipt(): Promise<NominationReceipt | null> {
  try {
    return JSON.parse(await readFile(receiptPath, "utf8")) as NominationReceipt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function deliver(message: string, credentials: string): Promise<{ exitCode: number | null; responseCode: string }> {
  const child = spawn("curl", nominationCurlArguments(), {
    env: nominationChildEnvironment(),
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.resume();
  child.stdin.end(message);
  const configPipe = child.stdio[3];
  if (!configPipe || !("end" in configPipe)) throw new Error("Credential pipe is unavailable.");
  configPipe.end(credentials);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (exitCode !== 0) {
    throw Object.assign(new Error(`SMTP transport failed with curl exit code ${exitCode}.`), { exitCode });
  }
  const responseCode = stdout.trim();
  if (!/^2\d\d$/.test(responseCode)) {
    throw Object.assign(new Error("SMTP transport returned an unexpected response code."), { exitCode });
  }
  return { exitCode, responseCode };
}

export async function sendGitHubMcpNomination(env: NodeJS.ProcessEnv = process.env): Promise<Record<string, unknown>> {
  const previous = await existingReceipt();
  if (previous) {
    return {
      status: previous.status === "accepted_by_smtp" ? "already_accepted" : "manual_reconciliation_required",
      receipt: receiptPath,
      prepared_at: previous.prepared_at,
      accepted_at: previous.accepted_at || null,
    };
  }
  if (env.SEND_GITHUB_MCP_NOMINATION !== "YES") {
    return {
      status: "armed_not_sent",
      recipient: GITHUB_MCP_NOMINATION.recipient,
      sender: GITHUB_MCP_NOMINATION.sender,
      requirement: "Set SEND_GITHUB_MCP_NOMINATION=YES with a dedicated Proton SMTP token.",
    };
  }
  const configuration = nominationConfiguration(env);
  const message = buildNominationMessage();
  const preparedAt = new Date().toISOString();
  const prepared: NominationReceipt = {
    schema_version: 1,
    status: "prepared",
    prepared_at: preparedAt,
    sender: GITHUB_MCP_NOMINATION.sender,
    recipient: GITHUB_MCP_NOMINATION.recipient,
    subject: GITHUB_MCP_NOMINATION.subject,
    release_commit: configuration.releaseCommit,
    nomination_contract_sha256: nominationContractSha256(),
    message_sha256: createHash("sha256").update(message).digest("hex"),
  };

  await mkdir(dirname(receiptPath), { recursive: true, mode: 0o700 });
  const lock = await open(`${receiptPath}.lock`, "wx", 0o600).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("A nomination attempt is already in progress; refusing a concurrent send.");
    }
    throw error;
  });
  try {
    await atomicWrite(receiptPath, prepared);
    try {
      const result = await deliver(message, smtpCredentialConfig(configuration));
      const accepted: NominationReceipt = {
        ...prepared,
        status: "accepted_by_smtp",
        accepted_at: new Date().toISOString(),
        smtp_response_code: result.responseCode,
      };
      await atomicWrite(receiptPath, accepted);
      return {
        status: "accepted_by_smtp",
        recipient: accepted.recipient,
        accepted_at: accepted.accepted_at,
        smtp_response_code: accepted.smtp_response_code,
        receipt: receiptPath,
      };
    } catch (error) {
      const failed: NominationReceipt = {
        ...prepared,
        status: "ambiguous_transport_failure",
        failed_at: new Date().toISOString(),
        transport_exit_code: typeof (error as { exitCode?: unknown }).exitCode === "number"
          ? (error as { exitCode: number }).exitCode
          : null,
      };
      await atomicWrite(receiptPath, failed);
      throw error;
    }
  } finally {
    await lock.close();
  }
}
