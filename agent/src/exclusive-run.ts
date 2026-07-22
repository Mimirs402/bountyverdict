import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type LockOptions = {
  now?: () => number;
  pid?: number;
  isProcessAlive?: (pid: number) => boolean;
  processIdentityForPid?: (pid: number) => Promise<ProcessIdentity | null>;
  staleAfterMs?: number;
};

type ProcessIdentity = { boot_id: string; start_ticks: string };
type LegacyOwner = { schema_version: 1; pid: number; started_at_ms: number; token: string };
type Owner = Omit<LegacyOwner, "schema_version"> & ProcessIdentity & { schema_version: 2 };

function liveProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function processIdentity(pid: number): Promise<ProcessIdentity | null> {
  try {
    const [bootId, statLine] = await Promise.all([
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      readFile(`/proc/${pid}/stat`, "utf8"),
    ]);
    const close = statLine.lastIndexOf(")");
    const fields = close >= 0 ? statLine.slice(close + 1).trim().split(/\s+/) : [];
    const startTicks = fields[19];
    const normalizedBootId = bootId.trim().toLowerCase();
    if (!/^[a-f0-9-]{36}$/.test(normalizedBootId) || !/^\d+$/.test(startTicks || "")) return null;
    return { boot_id: normalizedBootId, start_ticks: startTicks };
  } catch {
    return null;
  }
}

function parseOwner(value: unknown): Owner | LegacyOwner | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const owner = value as Record<string, unknown>;
  const common = (owner.schema_version === 1 || owner.schema_version === 2) &&
    Number.isSafeInteger(owner.pid) && Number(owner.pid) > 0 &&
    Number.isSafeInteger(owner.started_at_ms) && Number(owner.started_at_ms) >= 0 &&
    typeof owner.token === "string" && /^[a-f0-9-]{36}$/i.test(owner.token);
  if (!common) return null;
  if (owner.schema_version === 1) return owner as LegacyOwner;
  return typeof owner.boot_id === "string" && /^[a-f0-9-]{36}$/.test(owner.boot_id) &&
    typeof owner.start_ticks === "string" && /^\d+$/.test(owner.start_ticks)
    ? owner as Owner : null;
}

async function readOwner(path: string, expectedUid: number): Promise<Owner | LegacyOwner | null> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600 ||
        metadata.uid !== expectedUid || metadata.size < 2 || metadata.size > 1_024) return null;
    return parseOwner(JSON.parse(await handle.readFile("utf8")));
  } finally {
    await handle.close();
  }
}

export async function acquireExclusiveRun(path: string, options: LockOptions = {}): Promise<() => Promise<void>> {
  const now = options.now || Date.now;
  const pid = options.pid ?? process.pid;
  const isProcessAlive = options.isProcessAlive || liveProcess;
  const processIdentityForPid = options.processIdentityForPid || processIdentity;
  const staleAfterMs = options.staleAfterMs ?? 60_000;
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(staleAfterMs) || staleAfterMs < 1_000) {
    throw new Error("Exclusive-run lock options are invalid.");
  }
  const expectedUid = process.getuid?.() ?? -1;
  if (expectedUid < 0) throw new Error("Exclusive-run lock requires a local Unix owner identity.");
  const identity = await processIdentityForPid(pid);
  if (!identity || !/^[a-f0-9-]{36}$/.test(identity.boot_id) || !/^\d+$/.test(identity.start_ticks)) {
    throw new Error("Exclusive-run lock could not bind the current process identity.");
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const parentMetadata = await lstat(dirname(path));
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() ||
      (parentMetadata.mode & 0o777) !== 0o700 || parentMetadata.uid !== expectedUid) {
    throw new Error(`Exclusive-run lock parent ${dirname(path)} is not a private owner-owned directory.`);
  }
  const ownerPath = join(path, "owner.json");
  const owner: Owner = { schema_version: 2, pid, started_at_ms: now(), token: randomUUID(), ...identity };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(path, { mode: 0o700 });
      try {
        await writeFile(ownerPath, `${JSON.stringify(owner)}\n`, { mode: 0o600, flag: "wx" });
      } catch (error) {
        await rmdir(path).catch(() => undefined);
        throw error;
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lockMetadata = await lstat(path);
      if (!lockMetadata.isDirectory() || lockMetadata.isSymbolicLink() ||
          (lockMetadata.mode & 0o777) !== 0o700 || lockMetadata.uid !== expectedUid) {
        throw new Error(`Exclusive-run lock path ${path} is not a private owner-owned directory.`);
      }
      let existing: Owner | LegacyOwner | null = null;
      let ageMs = 0;
      try {
        existing = await readOwner(ownerPath, expectedUid);
        ageMs = now() - (existing?.started_at_ms ?? 0);
      } catch {
        ageMs = now() - lockMetadata.mtimeMs;
      }
      let ownerStillRunning = false;
      if (existing?.schema_version === 2) {
        const observedIdentity = await processIdentityForPid(existing.pid);
        ownerStillRunning = Boolean(observedIdentity && observedIdentity.boot_id === existing.boot_id &&
          observedIdentity.start_ticks === existing.start_ticks);
      } else if (existing) {
        ownerStillRunning = isProcessAlive(existing.pid);
      }
      const abandoned = ageMs >= staleAfterMs && !ownerStillRunning;
      if (!abandoned || attempt > 0) throw new Error(`Another bounded worker already holds ${path}.`);
      const quarantined = `${path}.abandoned-${randomUUID()}`;
      try {
        await rename(path, quarantined);
      } catch (renameError) {
        if ((renameError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw renameError;
      }
      await unlink(join(quarantined, "owner.json")).catch((unlinkError) => {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError;
      });
      await rmdir(quarantined);
    }
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const current = await readOwner(ownerPath, expectedUid);
    if (!current || current.token !== owner.token) throw new Error("Exclusive-run lock ownership changed before release.");
    await unlink(ownerPath);
    await rmdir(path);
  };
}
