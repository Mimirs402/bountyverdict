import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  classifyFunnelTailEvent,
  classifyDiscoveryTailEvent,
  classifyMcpTailEvents,
  createFunnelSnapshot,
  loadFunnelSnapshot,
  recordDiscoveryObservation,
  recordFunnelObservation,
  recordMcpObservation,
  type FunnelSnapshot,
} from "../src/funnel-telemetry.ts";

const stateFile = process.env.FUNNEL_STATE_FILE || `${homedir()}/.local/state/bountyverdict/funnel-telemetry.json`;
const token = process.env.CLOUDFLARE_API_TOKEN || "";
const invalidCollectorHeartbeat = "1970-01-01T00:00:00.000Z";
const readinessUrl = "https://bountyverdict-agent-production.mimirslab.workers.dev/api/sample";
if (!/^[A-Za-z0-9_-]{20,256}$/.test(token)) throw new Error("CLOUDFLARE_API_TOKEN is missing or malformed.");

let snapshot: FunnelSnapshot;
try {
  const existing = JSON.parse(await readFile(stateFile, "utf8"));
  const loaded = loadFunnelSnapshot(existing);
  if (!loaded) throw new Error("Existing funnel telemetry is malformed.");
  snapshot = loaded;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  snapshot = createFunnelSnapshot();
}
// A process starting is not evidence that Wrangler has connected to the
// Cloudflare tail. Keep the lease invalid until an owner readiness request is
// observed coming back through the tail itself.
snapshot.collector_heartbeat_at = invalidCollectorHeartbeat;

await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
let flushChain = Promise.resolve();
function flush(): Promise<void> {
  // A transient disk error must not permanently poison the serialized write
  // chain. The caller that observed the failed write still reports it, while
  // the next heartbeat or event gets a fresh chance to persist the snapshot.
  flushChain = flushChain.catch(() => undefined).then(async () => {
    const temporary = `${stateFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, stateFile);
  });
  return flushChain;
}
await flush();

class JsonObjectStream {
  private buffer = "";
  private depth = 0;
  private inString = false;
  private escaped = false;

  push(chunk: string): unknown[] {
    const values: unknown[] = [];
    for (const character of chunk) {
      if (this.depth === 0) {
        if (character !== "{") continue;
        this.buffer = "{";
        this.depth = 1;
        this.inString = false;
        this.escaped = false;
        continue;
      }
      this.buffer += character;
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (character === "\\") this.escaped = true;
        else if (character === '"') this.inString = false;
        continue;
      }
      if (character === '"') this.inString = true;
      else if (character === "{") this.depth += 1;
      else if (character === "}") this.depth -= 1;
      if (this.depth === 0) {
        try {
          values.push(JSON.parse(this.buffer));
        } catch {
          process.stderr.write("Discarded one malformed Cloudflare tail event without logging its contents.\n");
        }
        this.buffer = "";
      }
    }
    return values;
  }
}

const wrangler = join(process.cwd(), "node_modules", ".bin", "wrangler");
const child = spawn(wrangler, ["tail", "bountyverdict-agent-production", "--format", "json"], {
  cwd: process.cwd(),
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    CLOUDFLARE_API_TOKEN: token,
    NO_COLOR: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let readinessProbeInFlight = false;
let childFailure = false;
let shuttingDown = false;
async function sendReadinessProbe(): Promise<void> {
  if (readinessProbeInFlight) return;
  readinessProbeInFlight = true;
  try {
    const response = await fetch(readinessUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "bountyverdict-funnel-smoke/1.0",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    if (!response.ok) process.stderr.write(`Funnel collector readiness probe returned HTTP ${response.status}.\n`);
  } catch (error) {
    process.stderr.write(`Funnel collector readiness probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
  } finally {
    readinessProbeInFlight = false;
  }
}
const readinessProbe = setInterval(() => void sendReadinessProbe(), 30_000);
child.on("spawn", () => void sendReadinessProbe());
const parser = new JsonObjectStream();
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk: string) => {
  for (const value of parser.push(chunk)) {
    const observation = classifyFunnelTailEvent(value);
    const discovery = observation ? null : classifyDiscoveryTailEvent(value);
    const mcp = !observation && !discovery ? classifyMcpTailEvents(value) : [];
    if (!observation && !discovery && mcp.length === 0) continue;
    if (discovery?.surface === "sample_single" && discovery.source === "owner_automation") {
      snapshot.collector_heartbeat_at = new Date().toISOString();
    }
    if (observation) recordFunnelObservation(snapshot, observation);
    else if (discovery) recordDiscoveryObservation(snapshot, discovery);
    else for (const item of mcp) recordMcpObservation(snapshot, item);
    void flush().catch((error) => {
      process.stderr.write(`Funnel telemetry write failed: ${error instanceof Error ? error.message : String(error)}\n`);
    });
  }
});
child.stderr.pipe(process.stderr);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  childFailure = true;
  process.stderr.write(`Cloudflare tail process failed: ${error.message}\n`);
});
child.on("close", async (code, signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(readinessProbe);
  snapshot.collector_heartbeat_at = invalidCollectorHeartbeat;
  try {
    await flush();
  } catch (error) {
    process.stderr.write(`Funnel collector lease invalidation failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  if (signal) process.stderr.write(`Cloudflare tail stopped by ${signal}.\n`);
  const exitCode = childFailure ? 1 : (code === 0 || signal ? 0 : code || 1);
  process.exit(exitCode);
});
