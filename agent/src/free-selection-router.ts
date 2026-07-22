import { PRODUCT_CATALOG, type ProductKey } from "./product-catalog.ts";
import { PRODUCT_SELECTION_PREVIEWS } from "./selection-preview.ts";

export const FREE_SELECTION_TOOL_NAME = "choose_github_agent_decision" as const;

export const FREE_SELECTION_TASKS = Object.freeze([
  "one_bounty",
  "bounty_portfolio",
  "repository_agent_instructions",
  "github_actions_root_cause",
  "github_actions_retry_decision",
  "mcp_tools_change",
] as const);

export type FreeSelectionTask = typeof FREE_SELECTION_TASKS[number];
export type FreeSelectionProduct = Exclude<ProductKey, "skill">;

type SelectionRoute = {
  product: FreeSelectionProduct;
  toolName: string;
  requiredInput: string;
};

const ROUTES = Object.freeze({
  one_bounty: { product: "single", toolName: "check_github_bounty", requiredInput: "issue_url" },
  bounty_portfolio: { product: "portfolio", toolName: "rank_github_bounties", requiredInput: "issue_urls" },
  repository_agent_instructions: { product: "harness", toolName: "audit_agent_harness", requiredInput: "repo_url" },
  github_actions_root_cause: { product: "run", toolName: "diagnose_github_actions_run", requiredInput: "run_url" },
  github_actions_retry_decision: { product: "flake", toolName: "classify_github_actions_flake", requiredInput: "run_url" },
  mcp_tools_change: { product: "mcpdrift", toolName: "check_mcp_tool_drift", requiredInput: "contract_version, subject, annotation_source_trust, baseline, current" },
} as const satisfies Record<FreeSelectionTask, SelectionRoute>);

export function freeSelectionRoute(task: FreeSelectionTask, origin: string) {
  const route = ROUTES[task];
  const catalog = PRODUCT_CATALOG[route.product];
  const preview = PRODUCT_SELECTION_PREVIEWS[route.product];
  return {
    task,
    product: preview.product,
    product_key: route.product,
    tool_name: route.toolName,
    price_usdc: catalog.priceUsd.slice(1),
    currency: "USDC" as const,
    use_when: preview.useWhen,
    not_for: preview.notFor,
    decision_returned: [...preview.decisionReturned],
    free_sample: `${origin}${preview.samplePath}`,
    required_input: route.requiredInput,
    payment_required: false as const,
    verdict_produced: false as const,
    next_step: `Call ${route.toolName} with real canonical ${route.requiredInput}. Its first unsigned call cannot charge and returns an exact payment quote; only an authorized signed retry can settle.`,
  };
}
