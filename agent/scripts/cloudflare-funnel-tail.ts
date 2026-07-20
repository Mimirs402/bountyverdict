import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  classifyFunnelTailEvent,
  createFunnelSnapshot,
  isFunnelSnapshot,
  recordFunnelObservation,
  type FunnelSnapshot,
} from "../src/funnel-telemetry.ts";

const stateFile = process.env.FUNNEL_STATE_FILE || `${homedir()}/.local/state/bountyverdict/funnel-telemetry.json`;
const token = process.env.CLOUDFLARE_API_TOKEN || "";
if (!/^[A-Za-z0-9_-]{20,256}$/.test(token)) throw new Error("CLOUDFLARE_API_TOKEN is missing or malformed.");

let snapshot: FunnelSnapshot;
try {
  const existing = JSON.parse(await readFile(stateFile, "utf8"));
  if (!isFunnelSnapshot(existing)) throw new Error("Existing funnel telemetry is malformed.");
  snapshot = existing;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  snapshot = createFunnelSnapshot();
}

await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
let flushChain = Promise.resolve();
function flush(): Promise<void> {
  flushChain = flushChain.then(async () => {
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
const parser = new JsonObjectStream();
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk: string) => {
  for (const value of parser.push(chunk)) {
    const observation = classifyFunnelTailEvent(value);
    if (!observation) continue;
    recordFunnelObservation(snapshot, observation);
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
  process.stderr.write(`Cloudflare tail process failed: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", async (code, signal) => {
  await flush();
  if (signal) process.stderr.write(`Cloudflare tail stopped by ${signal}.\n`);
  process.exit(code === 0 || signal ? 0 : code || 1);
});
