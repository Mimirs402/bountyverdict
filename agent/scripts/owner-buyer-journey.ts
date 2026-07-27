import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { acquireExclusiveRun } from "../src/exclusive-run.ts";
import {
  OWNER_BUYER_JOURNEY_AMOUNT_ATOMIC,
  OWNER_BUYER_JOURNEY_INPUT,
  OWNER_BUYER_JOURNEY_MCP_URL,
  OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH,
  OWNER_BUYER_JOURNEY_NETWORK,
  OWNER_BUYER_JOURNEY_ORIGIN,
  OWNER_BUYER_JOURNEY_QUERY,
  OWNER_BUYER_JOURNEY_RESOURCE_URL,
  OWNER_BUYER_JOURNEY_SCHEMA_VERSION,
  OWNER_BUYER_JOURNEY_USER_AGENT,
  selectNaturalBazaarMatch,
  validateOwnerHttpChallenge,
  validateOwnerJourneyPrerequisite,
  validateOwnerMcpChallenge,
  validateOwnerPaymentResult,
  validateOwnerSelectorResult,
} from "../src/owner-buyer-journey.ts";

const execFileAsync = promisify(execFile);
const stateRoot = `${homedir()}/.local/state/bountyverdict`;
const distributionFile = process.env.STATE_FILE ||
  `${stateRoot}/distribution-status.json`;
const ledgerFile = process.env.TRUSTED_FUNNEL_HISTORY_FILE ||
  `${stateRoot}/funnel-trusted-epochs.json`;
const journeyFile = process.env.OWNER_BUYER_JOURNEY_STATE_FILE ||
  `${stateRoot}/owner-buyer-journey-v2.json`;
const lockFile = `${journeyFile}.lock`;
const expectedUid = process.getuid?.() ?? -1;
const expectedRotationId =
  `owner-buyer-journey-v2-epoch-${OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH + 1}`;
const rotationId = process.env.BOUNTYVERDICT_AUDITED_ROTATION_ID;

type JourneyState = Record<string, any> & {
  schema_version: typeof OWNER_BUYER_JOURNEY_SCHEMA_VERSION;
  journey_id: string;
  status: string;
  owner_audit: true;
  genuine_purchase: false;
  customer_revenue_usdc: "0";
};

if (process.env.BOUNTYVERDICT_AUDITED_ROTATION_ACTIVE !== "owner-journey") {
  throw new Error("Owner buyer journey must run through run-audited-monitor.ts.");
}
if (rotationId !== expectedRotationId) {
  throw new Error("Owner buyer journey is not inside its exact audited drain rotation.");
}

async function secureRead(path: string, label: string, maximumBytes = 4 * 1024 * 1024): Promise<string> {
  if (expectedUid < 0) throw new Error(`${label} requires a local Unix owner identity.`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== expectedUid ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.size < 2 ||
      metadata.size > maximumBytes
    ) {
      throw new Error(`${label} must be a bounded owner-owned regular file with mode 0600.`);
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function readOptionalJourney(): Promise<JourneyState | null> {
  try {
    const value = JSON.parse(await secureRead(journeyFile, "Owner journey state")) as JourneyState;
    if (
      value.schema_version !== OWNER_BUYER_JOURNEY_SCHEMA_VERSION ||
      typeof value.journey_id !== "string" ||
      !/^owner-buyer-journey-v2-[0-9a-f-]{36}$/.test(value.journey_id) ||
      typeof value.status !== "string" ||
      value.owner_audit !== true ||
      value.genuine_purchase !== false ||
      value.customer_revenue_usdc !== "0"
    ) {
      throw new Error("Owner journey state identity is invalid.");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWriteState(value: JourneyState): Promise<void> {
  await mkdir(dirname(journeyFile), { recursive: true, mode: 0o700 });
  const parent = await lstat(dirname(journeyFile));
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    parent.uid !== expectedUid ||
    (parent.mode & 0o777) !== 0o700
  ) {
    throw new Error("Owner journey state directory must be private and owner-owned.");
  }
  const temporary = `${journeyFile}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, journeyFile);
}

function observation(state: JourneyState, status: string, details: Record<string, unknown> = {}): JourneyState {
  const observedAt = new Date().toISOString();
  return {
    ...state,
    ...details,
    status,
    updated_at: observedAt,
    history: [
      ...(Array.isArray(state.history) ? state.history : []),
      { status, observed_at: observedAt },
    ].slice(-30),
  };
}

function parseJsonOutput(value: string, label: string): Record<string, any> {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} returned no JSON.`);
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} JSON is not an object.`);
    }
    return parsed as Record<string, any>;
  } catch (error) {
    throw new Error(`${label} returned malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function decodePaymentRequired(value: string): Record<string, unknown> {
  const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PAYMENT-REQUIRED did not decode to an object.");
  }
  return parsed as Record<string, unknown>;
}

function contentJson(value: any, label: string): Record<string, unknown> {
  if (value?.structuredContent && typeof value.structuredContent === "object") {
    return value.structuredContent as Record<string, unknown>;
  }
  const text = value?.content?.find((item: any) => item?.type === "text")?.text;
  if (typeof text !== "string") throw new Error(`${label} omitted JSON content.`);
  return parseJsonOutput(text, label);
}

async function run(): Promise<void> {
  let state = await readOptionalJourney();
  if (state) {
    if (
      state.status === "COMPLETED" ||
      state.status === "STOPPED_NO_NATURAL_MATCH"
    ) {
      console.log(JSON.stringify({
        status: "already_terminal",
        journey_status: state.status,
        journey_id: state.journey_id,
      }, null, 2));
      return;
    }
    if (state.status === "AUTHORIZATION_STARTED") {
      console.log(JSON.stringify({
        status: "manual_reconciliation_required",
        reason: "Payment authorization began but no validated terminal result was persisted. Never retry automatically.",
        journey_id: state.journey_id,
      }, null, 2));
      return;
    }
    if (state.status !== "READY_FOR_AUTHORIZATION") {
      console.log(JSON.stringify({
        status: "interrupted_journey_requires_review",
        interrupted_at: state.status,
        journey_id: state.journey_id,
      }, null, 2));
      return;
    }
  }

  const report = JSON.parse(await secureRead(distributionFile, "Distribution report"));
  const ledger = JSON.parse(await secureRead(ledgerFile, "Trusted funnel ledger", 64 * 1024 * 1024));
  const prerequisite = validateOwnerJourneyPrerequisite(report, ledger);
  const rotation = ledger.rotation;
  if (
    !rotation ||
    typeof rotation !== "object" ||
    Array.isArray(rotation) ||
    rotation.id !== expectedRotationId ||
    rotation.status !== "draining" ||
    rotation.target_epoch_id !== OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH + 1
  ) {
    throw new Error("Owner buyer journey requires its exact active draining rotation.");
  }

  if (!state) {
    const createdAt = new Date().toISOString();
    state = {
      schema_version: OWNER_BUYER_JOURNEY_SCHEMA_VERSION,
      journey_id: `owner-buyer-journey-v2-${randomUUID()}`,
      status: "DRAINING_ACTIVE",
      owner_audit: true,
      genuine_purchase: false,
      customer_revenue_usdc: "0",
      created_at: createdAt,
      updated_at: createdAt,
      history: [{ status: "DRAINING_ACTIVE", observed_at: createdAt }],
      rotation_id: expectedRotationId,
      natural_query: OWNER_BUYER_JOURNEY_QUERY,
      search_filters: {
        top: 10,
        network: "base",
        scheme: "exact",
        max_price_usdc: "0.02",
        pay_to_filter: null,
        brand_filter: null,
      },
      prerequisite,
      accounting: {
        owner_audit: true,
        genuine_purchase: false,
        customer_revenue_usdc: "0",
        owner_cost_usdc: "0",
      },
    };
    await atomicWriteState(state);

    state = observation(state, "SEARCH_STARTED");
    await atomicWriteState(state);
    const search = await execFileAsync("npx", [
      "awal@2.12.0",
      "x402",
      "bazaar",
      "search",
      OWNER_BUYER_JOURNEY_QUERY,
      "-k",
      "10",
      "--network",
      "base",
      "--scheme",
      "exact",
      "--max-price",
      "0.02",
      "--json",
    ], {
      timeout: 120_000,
      maxBuffer: 1_000_000,
      encoding: "utf8",
    });
    const searchOutput = search.stdout.trim() === "No matching resources found"
      ? { items: [] }
      : parseJsonOutput(search.stdout, "Agentic Wallet Bazaar search");
    const match = selectNaturalBazaarMatch(searchOutput);
    state = observation(state, "SEARCH_COMPLETED", {
      bazaar_search: {
        query: OWNER_BUYER_JOURNEY_QUERY,
        result: searchOutput,
        canonical_match: match
          ? { rank: match.rank, result_count: match.resultCount, item: match.item }
          : null,
      },
    });
    await atomicWriteState(state);
    if (!match) {
      state = observation(state, "STOPPED_NO_NATURAL_MATCH", {
        stopped_reason:
          "The canonical MCP drift endpoint was not the unique natural Bazaar result; no selector call or payment was made.",
      });
      await atomicWriteState(state);
      console.log(JSON.stringify({
        status: state.status,
        query: OWNER_BUYER_JOURNEY_QUERY,
        result_count: searchOutput.items.length,
        payment_made: false,
      }, null, 2));
      return;
    }

    state = observation(state, "SELECTOR_STARTED");
    await atomicWriteState(state);
    const client = new Client({
      name: "bountyverdict-owner-buyer-journey",
      version: "2.0.0",
    });
    const transport = new StreamableHTTPClientTransport(new URL(OWNER_BUYER_JOURNEY_MCP_URL), {
      requestInit: { headers: { "User-Agent": OWNER_BUYER_JOURNEY_USER_AGENT } },
    });
    let route: Record<string, any>;
    let challenge: Record<string, unknown>;
    try {
      await client.connect(transport);
      const selected = await client.callTool({
        name: "choose_github_agent_decision",
        arguments: { task: "mcp_tools_change" },
      });
      route = validateOwnerSelectorResult(contentJson(selected, "Free selector"));
      const unsigned = await client.callTool({
        name: route.next_call.tool_name,
        arguments: OWNER_BUYER_JOURNEY_INPUT,
      });
      if (unsigned.isError !== true) {
        throw new Error("Unsigned paid MCP call did not return a payment requirement.");
      }
      challenge = contentJson(unsigned, "Unsigned paid MCP call");
    } finally {
      await client.close();
    }
    const handoff = validateOwnerMcpChallenge(challenge);
    state = observation(state, "SELECTOR_AND_MCP_CHALLENGE_VERIFIED", {
      selector: route,
      mcp_challenge: {
        x402_version: challenge.x402Version,
        resource: challenge.resource,
        accepts: challenge.accepts,
        normalized_body_sha256: handoff.normalizedBodyHash,
        wallet_argv: handoff.walletArgv,
      },
    });
    await atomicWriteState(state);

    state = observation(state, "HTTP_CHALLENGE_STARTED");
    await atomicWriteState(state);
    const unsignedHttp = await fetch(OWNER_BUYER_JOURNEY_RESOURCE_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": OWNER_BUYER_JOURNEY_USER_AGENT,
      },
      body: JSON.stringify(OWNER_BUYER_JOURNEY_INPUT),
      redirect: "error",
    });
    if (unsignedHttp.status !== 402) {
      throw new Error(`Expected HTTP 402 before payment, received ${unsignedHttp.status}.`);
    }
    const paymentRequired = unsignedHttp.headers.get("payment-required");
    if (!paymentRequired) throw new Error("Unsigned HTTP response omitted PAYMENT-REQUIRED.");
    const httpChallenge = decodePaymentRequired(paymentRequired);
    validateOwnerHttpChallenge(httpChallenge);
    state = observation(state, "READY_FOR_AUTHORIZATION", {
      http_challenge: {
        x402_version: httpChallenge.x402Version,
        resource: httpChallenge.resource,
        accepts: httpChallenge.accepts,
        normalized_body_sha256: handoff.normalizedBodyHash,
      },
      authorization: {
        exact_resource: OWNER_BUYER_JOURNEY_RESOURCE_URL,
        exact_network: OWNER_BUYER_JOURNEY_NETWORK,
        maximum_amount_atomic: OWNER_BUYER_JOURNEY_AMOUNT_ATOMIC,
        exact_method: "POST",
        owner_user_agent: OWNER_BUYER_JOURNEY_USER_AGENT,
      },
    });
    await atomicWriteState(state);
  }

  if (process.env.EXECUTE_OWNER_BUYER_JOURNEY !== "YES") {
    console.log(JSON.stringify({
      status: "READY_FOR_AUTHORIZATION",
      journey_id: state.journey_id,
      maximum_amount_atomic: OWNER_BUYER_JOURNEY_AMOUNT_ATOMIC,
      payment_made: false,
    }, null, 2));
    return;
  }

  const correlationId = state.journey_id;
  state = observation(state, "AUTHORIZATION_STARTED", {
    authorization_started_at: new Date().toISOString(),
    correlation_id: correlationId,
  });
  await atomicWriteState(state);

  const headers = JSON.stringify({
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": OWNER_BUYER_JOURNEY_USER_AGENT,
  });
  let paidStdout: string;
  try {
    const paid = await execFileAsync("npx", [
      "awal@2.12.0",
      "x402",
      "pay",
      OWNER_BUYER_JOURNEY_RESOURCE_URL,
      "-X",
      "POST",
      "-d",
      JSON.stringify(OWNER_BUYER_JOURNEY_INPUT),
      "-h",
      headers,
      "--max-amount",
      OWNER_BUYER_JOURNEY_AMOUNT_ATOMIC,
      "--correlation-id",
      correlationId,
      "--json",
    ], {
      timeout: 180_000,
      maxBuffer: 1_000_000,
      encoding: "utf8",
    });
    paidStdout = paid.stdout;
  } catch (error) {
    state = {
      ...state,
      authorization_observation: {
        status: "ambiguous_or_failed",
        observed_at: new Date().toISOString(),
        error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
        retry_automatically: false,
      },
    };
    await atomicWriteState(state);
    throw error;
  }
  const result = validateOwnerPaymentResult(
    parseJsonOutput(paidStdout, "Agentic Wallet paid request"),
  );
  state = observation(state, "COMPLETED", {
    completed_at: new Date().toISOString(),
    payment: {
      status: result.status,
      amount_paid_atomic: result.amountPaidAtomic,
      amount_paid_usdc: "0.02",
      verdict: result.verdict,
      action: result.action,
      ruleset_version: result.rulesetVersion,
      response: result.data,
    },
    accounting: {
      owner_audit: true,
      genuine_purchase: false,
      customer_revenue_usdc: "0",
      owner_cost_usdc: "0.02",
    },
  });
  await atomicWriteState(state);
  console.log(JSON.stringify({
    status: "COMPLETED",
    journey_id: state.journey_id,
    natural_query: OWNER_BUYER_JOURNEY_QUERY,
    bazaar_rank: state.bazaar_search?.canonical_match?.rank,
    amount_paid_usdc: "0.02",
    verdict: result.verdict,
    action: result.action,
    owner_audit: true,
    genuine_purchase: false,
    customer_revenue_usdc: "0",
  }, null, 2));
}

const release = await acquireExclusiveRun(lockFile);
try {
  await run();
} finally {
  await release();
}
