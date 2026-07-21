import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import {
  analyzeMoltJobs,
  analyzeOpenJobs,
  parseMoltJobsPage,
  parseOpenJobs,
  type MoltJob,
} from "../src/demand-watch.ts";

const MOLTJOBS_API = "https://api.moltjobs.io/v1/jobs";
const OPENJOBS_API = "https://openjobs.bot/api/v1/jobs";
const stateFile = process.env.DEMAND_WATCH_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/demand-watch.json`;
const timeoutMs = 20_000;
const maximumResponseBytes = 2_000_000;

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function publicJson(url: URL, market: string): Promise<unknown> {
  const response = await fetch(url, {
    redirect: "error",
    headers: { "User-Agent": "bountyverdict-read-only-demand-watch/1.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${market} returned HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`${market} returned a non-JSON response.`);
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumResponseBytes) {
    throw new Error(`${market} response exceeded the byte cap.`);
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).length > maximumResponseBytes) {
    throw new Error(`${market} response exceeded the byte cap.`);
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`${market} returned malformed JSON.`);
  }
}

async function fetchMoltJobs(funded: boolean): Promise<MoltJob[]> {
  const jobs: MoltJob[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
    const url = new URL(MOLTJOBS_API);
    url.searchParams.set("status", "OPEN");
    url.searchParams.set("limit", "100");
    if (funded) url.searchParams.set("funded", "true");
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = parseMoltJobsPage(await publicJson(url, "MoltJobs"));
    jobs.push(...page.data);
    if (!page.next_cursor) return jobs;
    if (seenCursors.has(page.next_cursor)) throw new Error("MoltJobs repeated a pagination cursor.");
    seenCursors.add(page.next_cursor);
    cursor = page.next_cursor;
  }
  throw new Error("MoltJobs pagination exceeded the bounded five-page audit.");
}

const checkedAt = new Date().toISOString();
const [moltOpen, moltFunded, openJobsPayload] = await Promise.all([
  fetchMoltJobs(false),
  fetchMoltJobs(true),
  publicJson(new URL(`${OPENJOBS_API}?status=open&limit=100`), "OpenJobs"),
]);
const openJobs = parseOpenJobs(openJobsPayload);
if (openJobs.length === 100) {
  throw new Error("OpenJobs reached its public cap while exposing no usable pagination; inventory is incomplete.");
}
const state = {
  schema_version: 1,
  checked_at: checkedAt,
  read_only: true,
  actions_enabled: false,
  errors: 0,
  sources: {
    moltjobs: analyzeMoltJobs({ open_jobs: moltOpen, funded_jobs: moltFunded }),
    openjobs: analyzeOpenJobs(openJobs),
    excluded: {
      lobster_jobs: "excluded: official documentation requires bearer authentication and its unauthenticated surface exposed sensitive-looking auth metadata",
    },
  },
  accounting_note: "Public demand inventory and exact-match candidates are acquisition evidence only; they are never purchases, settlements, or revenue.",
};
await atomicWrite(stateFile, `${JSON.stringify(state, null, 2)}\n`);
console.log(JSON.stringify(state, null, 2));
