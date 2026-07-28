import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  buildGithubDigest,
  preserveLatestNonEmptyGithubDigest,
} from "../src/github-digest.ts";

const execFileAsync = promisify(execFile);
const stateRoot = resolve(process.env.BOUNTYVERDICT_STATE_ROOT || `${homedir()}/.local/state/bountyverdict`);
const digestPath = `${stateRoot}/github-digest.json`;
const checkpointPath = `${stateRoot}/github-digest-checkpoint.json`;
const maximumLookbackMs = 48 * 60 * 60 * 1_000;

async function gh(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync("gh", args, {
    timeout: 60_000,
    maxBuffer: 2_000_000,
    encoding: "utf8",
  });
  return JSON.parse(stdout);
}

async function readCheckpoint(): Promise<string | null> {
  try {
    const metadata = await lstat(checkpointPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 16_384) {
      throw new Error("GitHub digest checkpoint is not a bounded regular file.");
    }
    const value = JSON.parse(await readFile(checkpointPath, "utf8")) as Record<string, unknown>;
    return typeof value.checked_at === "string" && Number.isFinite(Date.parse(value.checked_at))
      ? value.checked_at
      : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readPreviousDigest(): Promise<unknown> {
  try {
    const metadata = await lstat(digestPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 256_000) return null;
    return JSON.parse(await readFile(digestPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

const identity = await gh(["api", "user"]);
if ((identity as Record<string, unknown>).login !== "Mimirs402") {
  throw new Error("GitHub digest requires the active Mimir's Lab account.");
}
const checkedAt = new Date().toISOString();
const checkpoint = await readCheckpoint();
const previousDigest = await readPreviousDigest();
const floor = Date.now() - maximumLookbackMs;
const since = new Date(Math.max(checkpoint ? Date.parse(checkpoint) : floor, floor)).toISOString();
const notifications = await gh([
  "api", "--method", "GET", "notifications",
  "-f", "all=true",
  "-f", "participating=true",
  "-f", `since=${since}`,
  "-f", "per_page=100",
]);
if (!Array.isArray(notifications)) throw new Error("GitHub notifications response is malformed.");
const detailUrls = [...new Set(notifications
  .map((entry) => (entry as any)?.subject?.latest_comment_url)
  .filter((value): value is string => typeof value === "string" &&
    /^https:\/\/api\.github\.com\/repos\/[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+\//.test(value)))]
  .slice(0, 50);
const details = new Map<string, unknown>();
for (let index = 0; index < detailUrls.length; index += 5) {
  const batch = detailUrls.slice(index, index + 5);
  const values = await Promise.all(batch.map(async (url) => {
    try {
      return [url, await gh(["api", url])] as const;
    } catch {
      return [url, null] as const;
    }
  }));
  for (const [url, value] of values) if (value) details.set(url, value);
}
const currentDigest = buildGithubDigest(notifications, details, since, checkedAt);
const digest = preserveLatestNonEmptyGithubDigest(currentDigest, previousDigest);
await atomicWrite(digestPath, digest);
await atomicWrite(checkpointPath, { schema_version: 1, checked_at: checkedAt, account: "Mimirs402" });
console.log(JSON.stringify({
  product: "BountyVerdict GitHub digest",
  checked_at: digest.checked_at,
  since: digest.since,
  new_events: currentDigest.event_count,
  retained_events: digest.event_count,
  actionable: digest.actionable_count,
  digest_fingerprint: digest.digest_fingerprint,
}, null, 2));
