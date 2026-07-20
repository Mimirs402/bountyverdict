import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type {
  SpendLedgerEntry,
  SpendStore,
} from "@coinbase/cdp-sdk/x402";
import type { Network } from "@x402/core/types";

interface StoredEntry {
  atomic_amount: string;
  asset: string;
  network: string;
  pay_to: string;
  at: number;
}

interface StoredLedger {
  ledger: "BountyVerdict settlement spend";
  version: "1.0";
  entries: StoredEntry[];
}

const MAX_LEDGER_BYTES = 64 * 1024;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CAIP_2 = /^[a-z0-9-]{3,8}:[A-Za-z0-9-]{1,32}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeEntry(value: unknown): SpendLedgerEntry {
  if (!isRecord(value)) throw new Error("Settlement spend ledger entry is invalid.");
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "asset,at,atomic_amount,network,pay_to") {
    throw new Error("Settlement spend ledger entry has unexpected fields.");
  }
  if (typeof value.atomic_amount !== "string" || !/^\d+$/.test(value.atomic_amount)) {
    throw new Error("Settlement spend ledger amount is invalid.");
  }
  if (typeof value.asset !== "string" || !EVM_ADDRESS.test(value.asset)) {
    throw new Error("Settlement spend ledger asset is invalid.");
  }
  if (typeof value.pay_to !== "string" || !EVM_ADDRESS.test(value.pay_to)) {
    throw new Error("Settlement spend ledger payee is invalid.");
  }
  if (typeof value.network !== "string" || !CAIP_2.test(value.network)) {
    throw new Error("Settlement spend ledger network is invalid.");
  }
  if (!Number.isSafeInteger(value.at) || Number(value.at) < 0) {
    throw new Error("Settlement spend ledger timestamp is invalid.");
  }
  return {
    atomicAmount: BigInt(value.atomic_amount),
    asset: value.asset,
    network: value.network as Network,
    payTo: value.pay_to,
    at: Number(value.at),
  };
}

function encodeEntry(entry: SpendLedgerEntry): StoredEntry {
  if (entry.atomicAmount < 0n) throw new Error("Settlement spend cannot be negative.");
  if (!EVM_ADDRESS.test(entry.asset) || !EVM_ADDRESS.test(entry.payTo)) {
    throw new Error("Settlement spend must use EVM asset and payee addresses.");
  }
  if (!CAIP_2.test(entry.network)) throw new Error("Settlement spend network is invalid.");
  if (!Number.isSafeInteger(entry.at) || entry.at < 0) {
    throw new Error("Settlement spend timestamp is invalid.");
  }
  return {
    atomic_amount: entry.atomicAmount.toString(),
    asset: entry.asset,
    network: entry.network,
    pay_to: entry.payTo,
    at: entry.at,
  };
}

function sameEntry(left: SpendLedgerEntry, right: SpendLedgerEntry): boolean {
  return left.atomicAmount === right.atomicAmount &&
    left.asset === right.asset &&
    left.network === right.network &&
    left.payTo === right.payTo &&
    left.at === right.at;
}

/**
 * Private, atomic, fail-closed spend persistence for the single-host canary.
 * The caller must hold a process-wide exclusive lock while using this store.
 */
export class PrivateFileSpendStore implements SpendStore {
  readonly path: string;
  readonly maximumEntries: number;

  constructor(
    path: string,
    maximumEntries = 64,
  ) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries <= 0) {
      throw new Error("Settlement spend ledger maximum must be positive.");
    }
    this.path = path;
    this.maximumEntries = maximumEntries;
  }

  private async readEntries(): Promise<SpendLedgerEntry[]> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("Settlement spend ledger could not be read safely.");
    }
    if (Buffer.byteLength(text) > MAX_LEDGER_BYTES) {
      throw new Error("Settlement spend ledger is too large.");
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("Settlement spend ledger JSON is invalid.");
    }
    if (
      !isRecord(value) ||
      value.ledger !== "BountyVerdict settlement spend" ||
      value.version !== "1.0" ||
      !Array.isArray(value.entries) ||
      value.entries.length > this.maximumEntries ||
      Object.keys(value).sort().join(",") !== "entries,ledger,version"
    ) {
      throw new Error("Settlement spend ledger envelope is invalid.");
    }
    return value.entries.map(decodeEntry);
  }

  private async writeEntries(entries: SpendLedgerEntry[]): Promise<void> {
    if (entries.length > this.maximumEntries) {
      throw new Error("Settlement spend ledger capacity would be exceeded.");
    }
    const document: StoredLedger = {
      ledger: "BountyVerdict settlement spend",
      version: "1.0",
      entries: entries.map(encodeEntry),
    };
    const contents = `${JSON.stringify(document, null, 2)}\n`;
    if (Buffer.byteLength(contents) > MAX_LEDGER_BYTES) {
      throw new Error("Settlement spend ledger would exceed its size limit.");
    }
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(contents, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.path);
      await chmod(this.path, 0o600);
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async size(): Promise<number> {
    return (await this.readEntries()).length;
  }

  async load(): Promise<SpendLedgerEntry[]> {
    return this.readEntries();
  }

  async append(entry: SpendLedgerEntry): Promise<void> {
    const entries = await this.readEntries();
    entries.push(entry);
    await this.writeEntries(entries);
  }

  async prune(olderThanMs: number): Promise<void> {
    if (!Number.isSafeInteger(olderThanMs) || olderThanMs < 0) {
      throw new Error("Settlement spend prune cutoff is invalid.");
    }
    const entries = (await this.readEntries()).filter(entry => entry.at >= olderThanMs);
    await this.writeEntries(entries);
  }

  async dropOldest(count: number): Promise<void> {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("Settlement spend drop count is invalid.");
    }
    const entries = await this.readEntries();
    await this.writeEntries(entries.slice(count));
  }

  async removeEntry(entry: SpendLedgerEntry): Promise<void> {
    const entries = await this.readEntries();
    let index = -1;
    for (let candidate = entries.length - 1; candidate >= 0; candidate -= 1) {
      if (sameEntry(entries[candidate], entry)) {
        index = candidate;
        break;
      }
    }
    if (index >= 0) entries.splice(index, 1);
    await this.writeEntries(entries);
  }
}
