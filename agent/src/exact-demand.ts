import { createHash } from "node:crypto";
import { PRODUCT_CATALOG } from "./product-catalog.ts";
import type { The402Product } from "./the402.ts";

const githubIssuePattern = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/issues\/[1-9][0-9]*$/;
const githubRepoPattern = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+(?:\.git)?$/;
const githubRunPattern = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/actions\/runs\/[1-9][0-9]*$/;

export type ExactDemandProduct = Exclude<The402Product, "mcpdrift">;

export type ExactDemandDecision = {
  product: ExactDemandProduct;
  input: Record<string, unknown>;
  input_sha256: string;
  price_cents: number;
  estimated_duration_seconds: number;
  message: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function stableDemandInput(input: Record<string, unknown>): string {
  return JSON.stringify(stableValue(input));
}

function inputHash(input: Record<string, unknown>): string {
  return createHash("sha256").update(stableDemandInput(input)).digest("hex");
}

function publicGithubUrls(text: string): string[] {
  const values = text.match(/https:\/\/github\.com\/[^\s<>"'`]+/gi) || [];
  return [...new Set(values.map((value) => value.replace(/[),.;:!?\]}]+$/g, "")))];
}

function exactPriceCents(product: ExactDemandProduct): number {
  const atomic = PRODUCT_CATALOG[product].amountAtomic;
  if (atomic % 10_000n !== 0n) throw new Error(`Product ${product} does not have a whole-cent price.`);
  const cents = Number(atomic / 10_000n);
  if (!Number.isSafeInteger(cents) || cents < 1) throw new Error(`Product ${product} price is invalid.`);
  return cents;
}

function decision(product: ExactDemandProduct, input: Record<string, unknown>): ExactDemandDecision {
  const inputSha256 = inputHash(input);
  return {
    product,
    input,
    input_sha256: inputSha256,
    price_cents: exactPriceCents(product),
    estimated_duration_seconds: 180,
    message: `${PRODUCT_CATALOG[product].service} can fulfill only the complete public JSON input identified by SHA-256 ${inputSha256}. It is an existing automated, read-only service with the published exact output contract; any hidden input drift will be rejected rather than substituted. Typical delivery is under three minutes after acceptance.`,
  };
}

export function selectExactPublicDemand(input: {
  title: string;
  description: string;
  budget_cents: number;
  buyer_id?: string;
  provider_id?: string;
}): ExactDemandDecision | null {
  if (!Number.isSafeInteger(input.budget_cents) || input.budget_cents < 1 ||
    typeof input.title !== "string" || !input.title || input.title.length > 500 ||
    typeof input.description !== "string" || input.description.length > 20_000 ||
    (input.buyer_id !== undefined && input.buyer_id === input.provider_id)) return null;
  const text = `${input.title}\n${input.description}`;
  const intent = text.toLowerCase();
  const urls = publicGithubUrls(text);
  let selected: ExactDemandDecision | null = null;
  if (
    urls.length >= 2 && urls.length <= 10 && urls.every((url) => githubIssuePattern.test(url)) &&
    /rank|compare|portfolio|best.{0,20}bount|which.{0,20}bount/.test(intent)
  ) selected = decision("portfolio", { issue_urls: urls });
  else if (
    urls.length === 1 && githubIssuePattern.test(urls[0]) &&
    /bount|reward|worth.{0,20}(pursu|work)|eligib|claim/.test(intent)
  ) selected = decision("single", { issue_url: urls[0] });
  else if (
    urls.length === 1 && githubRepoPattern.test(urls[0]) &&
    /agents?\.md|claude\.md|gemini\.md|coding.agent|agent instruction|agent harness|repository instruction/.test(intent)
  ) selected = decision("harness", { repo_url: urls[0] });
  else if (
    urls.length === 1 && githubRunPattern.test(urls[0]) &&
    /flak|retry|intermittent|nondetermin/.test(intent)
  ) selected = decision("flake", { run_url: urls[0] });
  else if (
    urls.length === 1 && githubRunPattern.test(urls[0]) &&
    /diagnos|root cause|why.{0,20}fail|failure.{0,20}cause|failed.{0,20}workflow|actions.{0,20}fail/.test(intent)
  ) selected = decision("run", { run_url: urls[0] });
  return selected && selected.price_cents <= input.budget_cents ? selected : null;
}
