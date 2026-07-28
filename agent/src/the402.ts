import { checkGithubIssue } from "./check.ts";
import { checkBountyPortfolio } from "./portfolio.ts";
import { checkGithubHarness } from "./harness.ts";
import { diagnoseGithubRun } from "./run.ts";
import { diagnoseGithubFlake } from "./flake.ts";
import { parseAndAnalyzeMcpDrift } from "./mcp-drift.ts";
import { checkGithubSkill } from "./skill.ts";

export const THE402_PRODUCTS = Object.freeze([
  "single",
  "portfolio",
  "harness",
  "run",
  "flake",
  "mcpdrift",
] as const);

export type The402Product = typeof THE402_PRODUCTS[number];
export const MARKETPLACE_PRODUCTS = Object.freeze([...THE402_PRODUCTS, "skill"] as const);
export type MarketplaceProduct = typeof MARKETPLACE_PRODUCTS[number];

export interface The402Environment {
  GITHUB_TOKEN?: string;
  FLAKE_RATE_LIMITER?: RateLimit;
}

export type The402JobDispatch = {
  type: "job_dispatch";
  job_id: string;
  service_id: string;
  callback_url: string;
  brief: Record<string, unknown>;
  product: MarketplaceProduct;
};

const MAX_WEBHOOK_BYTES = 64 * 1024;
const MAX_WEBHOOK_AGE_SECONDS = 300;
const CALLBACK_ORIGIN = "https://api.the402.ai";
const serviceIdPattern = /^svc_[A-Za-z0-9_-]{1,120}$/;
const callbackPathPattern = /^\/v1\/(?:jobs|threads)\/[A-Za-z0-9_-]{1,160}\/update$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, maximum = 500): string {
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw new Error(`the402 ${field} is invalid.`);
  }
  return value;
}

function parseCallbackUrl(value: unknown): string {
  const input = requiredString(value, "callback_url", 500);
  const url = new URL(input);
  if (
    url.origin !== CALLBACK_ORIGIN || url.username || url.password ||
    url.search || url.hash || !callbackPathPattern.test(url.pathname)
  ) {
    throw new Error("the402 callback_url is outside the allowed API callback surface.");
  }
  return url.href;
}

function parseProduct(value: unknown): MarketplaceProduct {
  if (!MARKETPLACE_PRODUCTS.includes(value as MarketplaceProduct)) {
    throw new Error("the402 service map contains an unsupported product.");
  }
  return value as MarketplaceProduct;
}

export function parseThe402ServiceMap(input: string | undefined): ReadonlyMap<string, MarketplaceProduct> {
  if (!input) throw new Error("THE402_SERVICE_MAP is not configured.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("THE402_SERVICE_MAP must be valid JSON.");
  }
  if (!isObject(parsed) || !Object.keys(parsed).length) {
    throw new Error("THE402_SERVICE_MAP must contain at least one service.");
  }
  const result = new Map<string, MarketplaceProduct>();
  const products = new Set<MarketplaceProduct>();
  for (const [serviceId, value] of Object.entries(parsed)) {
    if (!serviceIdPattern.test(serviceId)) throw new Error("THE402_SERVICE_MAP contains an invalid service ID.");
    const product = parseProduct(value);
    if (products.has(product)) throw new Error("THE402_SERVICE_MAP contains a duplicate product.");
    result.set(serviceId, product);
    products.add(product);
  }
  return result;
}

function hexBytes(value: string): Uint8Array | null {
  if (!/^[a-f0-9]{64}$/.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g) || [], (pair) => Number.parseInt(pair, 16));
}

async function constantTimeTextEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < Math.max(leftBytes.length, rightBytes.length); index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

export async function verifyThe402Webhook(input: {
  raw_body: string;
  api_key_header: string | undefined;
  signature_header: string | undefined;
  timestamp_header: string | undefined;
  api_key: string | undefined;
  webhook_secret: string | undefined;
  now_ms?: number;
}): Promise<boolean> {
  const bytes = new TextEncoder().encode(input.raw_body);
  if (bytes.length === 0 || bytes.length > MAX_WEBHOOK_BYTES) return false;
  if (!input.api_key || input.api_key.length < 16 || !input.webhook_secret || input.webhook_secret.length < 16) {
    return false;
  }
  if (!input.api_key_header || !await constantTimeTextEqual(input.api_key_header, input.api_key)) return false;
  if (!input.timestamp_header || !/^\d{10}$/.test(input.timestamp_header)) return false;
  const timestamp = Number(input.timestamp_header);
  const nowSeconds = Math.floor((input.now_ms ?? Date.now()) / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > MAX_WEBHOOK_AGE_SECONDS) return false;
  const signature = input.signature_header?.match(/^sha256=([a-f0-9]{64})$/)?.[1];
  const signatureBytes = signature ? hexBytes(signature) : null;
  if (!signatureBytes) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.webhook_secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureBuffer = new Uint8Array(signatureBytes.length);
  signatureBuffer.set(signatureBytes);
  return crypto.subtle.verify(
    "HMAC",
    key,
    signatureBuffer.buffer,
    new TextEncoder().encode(`${input.timestamp_header}.${input.raw_body}`),
  );
}

export async function diagnoseThe402PlatformWebhookEnvelope(input: {
  raw_body: string;
  api_key_header: string | undefined;
  cloudflare_worker_header: string | undefined;
  signature_header: string | undefined;
  timestamp_header: string | undefined;
  api_key: string | undefined;
  now_ms?: number;
}): Promise<{
  body_valid: boolean;
  api_key_configured: boolean;
  api_key_header_present: boolean;
  api_key_matches: boolean;
  cloudflare_worker_header_present: boolean;
  cloudflare_worker_matches: boolean;
  timestamp_format_valid: boolean;
  timestamp_fresh: boolean;
  signature_format_valid: boolean;
}> {
  const bytes = new TextEncoder().encode(input.raw_body);
  const bodyValid = bytes.length > 0 && bytes.length <= MAX_WEBHOOK_BYTES;
  const apiKeyConfigured = Boolean(input.api_key && input.api_key.length >= 16);
  const apiKeyHeaderPresent = Boolean(input.api_key_header);
  const apiKeyMatches = Boolean(
    apiKeyConfigured && input.api_key_header &&
    await constantTimeTextEqual(input.api_key_header, input.api_key!),
  );
  const cloudflareWorkerHeaderPresent = Boolean(input.cloudflare_worker_header);
  const cloudflareWorkerMatches = input.cloudflare_worker_header === "the402.ai";
  const timestampFormatValid = Boolean(input.timestamp_header && /^\d{10}$/.test(input.timestamp_header));
  const timestamp = timestampFormatValid ? Number(input.timestamp_header) : Number.NaN;
  const nowSeconds = Math.floor((input.now_ms ?? Date.now()) / 1000);
  return {
    body_valid: bodyValid,
    api_key_configured: apiKeyConfigured,
    api_key_header_present: apiKeyHeaderPresent,
    api_key_matches: apiKeyMatches,
    cloudflare_worker_header_present: cloudflareWorkerHeaderPresent,
    cloudflare_worker_matches: cloudflareWorkerMatches,
    timestamp_format_valid: timestampFormatValid,
    timestamp_fresh: Number.isSafeInteger(timestamp) && Math.abs(nowSeconds - timestamp) <= MAX_WEBHOOK_AGE_SECONDS,
    signature_format_valid: /^sha256=[a-f0-9]{64}$/.test(input.signature_header || ""),
  };
}

export async function verifyThe402PlatformWebhookEnvelope(
  input: Parameters<typeof diagnoseThe402PlatformWebhookEnvelope>[0],
): Promise<boolean> {
  const diagnostics = await diagnoseThe402PlatformWebhookEnvelope(input);
  return diagnostics.body_valid && diagnostics.api_key_configured &&
    (diagnostics.api_key_matches || diagnostics.cloudflare_worker_matches) &&
    diagnostics.timestamp_format_valid && diagnostics.timestamp_fresh &&
    diagnostics.signature_format_valid;
}

export function parseThe402JobDispatch(
  rawBody: string,
  serviceMap: ReadonlyMap<string, MarketplaceProduct>,
): The402JobDispatch | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error("the402 webhook body must be valid JSON.");
  }
  if (!isObject(parsed)) throw new Error("the402 webhook body must be an object.");
  if (parsed.type !== "job_dispatch") return null;
  const serviceId = requiredString(parsed.service_id, "service_id", 160);
  const product = serviceMap.get(serviceId);
  if (!product) throw new Error("the402 job references an unknown service.");
  if (!isObject(parsed.brief)) throw new Error("the402 job brief must be an object.");
  return {
    type: "job_dispatch",
    job_id: requiredString(parsed.job_id, "job_id", 160),
    service_id: serviceId,
    callback_url: parseCallbackUrl(parsed.callback_url),
    brief: parsed.brief,
    product,
  };
}

function briefString(brief: Record<string, unknown>, field: string): string {
  const value = brief[field];
  if (typeof value !== "string") throw new Error(`the402 brief ${field} must be a string.`);
  return value;
}

export async function fulfillThe402Product(
  job: The402JobDispatch,
  env: The402Environment,
): Promise<unknown> {
  return fulfillProduct(job.product, job.brief, env);
}

export async function fulfillProduct(
  product: MarketplaceProduct,
  brief: Record<string, unknown>,
  env: The402Environment,
): Promise<unknown> {
  if (product === "single") {
    return checkGithubIssue(briefString(brief, "issue_url"), { GITHUB_TOKEN: env.GITHUB_TOKEN });
  }
  if (product === "portfolio") {
    return checkBountyPortfolio(brief.issue_urls, { GITHUB_TOKEN: env.GITHUB_TOKEN });
  }
  if (product === "harness") {
    return checkGithubHarness(briefString(brief, "repo_url"), { GITHUB_TOKEN: env.GITHUB_TOKEN });
  }
  if (product === "skill") {
    return checkGithubSkill(
      briefString(brief, "repo_url"),
      briefString(brief, "skill_path"),
      { GITHUB_TOKEN: env.GITHUB_TOKEN },
    );
  }
  if (product === "run") {
    return diagnoseGithubRun(briefString(brief, "run_url"), { GITHUB_TOKEN: env.GITHUB_TOKEN });
  }
  if (product === "flake") {
    if (!env.FLAKE_RATE_LIMITER) throw new Error("FlakeVerdict capacity protection is unavailable.");
    const rateLimit = await env.FLAKE_RATE_LIMITER.limit({ key: "flake:verified-global" });
    if (!rateLimit.success) throw new Error("FlakeVerdict is temporarily at its bounded upstream capacity.");
    return diagnoseGithubFlake(
      briefString(brief, "run_url"),
      brief.attempt as string | number | null | undefined,
      { GITHUB_TOKEN: env.GITHUB_TOKEN },
    );
  }
  return parseAndAnalyzeMcpDrift(JSON.stringify(brief));
}

export async function reportThe402Result(input: {
  callback_url: string;
  api_key: string;
  status: "completed" | "failed";
  deliverables?: unknown;
  notes: string;
  fetch_impl?: typeof fetch;
}): Promise<void> {
  const callbackUrl = parseCallbackUrl(input.callback_url);
  const response = await (input.fetch_impl || fetch)(callbackUrl, {
    method: "POST",
    redirect: "error",
    headers: {
      "X-API-Key": input.api_key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status: input.status,
      ...(input.deliverables === undefined ? {} : { deliverables: input.deliverables }),
      notes: input.notes,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`the402 callback returned HTTP ${response.status}.`);
}
