import type { ProductKey } from "./product-catalog.ts";

export type ProductSelectionPreview = {
  product: string;
  description: string;
  useWhen: string;
  notFor: string;
  decisionReturned: string[];
  whyPay: string;
  samplePath: string;
  skillName: string;
};

export const PRODUCT_SELECTION_PREVIEWS = Object.freeze({
  single: Object.freeze({
    product: "BountyVerdict",
    description: "Pay once to receive a fresh evidence-linked bounty risk verdict.",
    useWhen: "Before coding one public GitHub bounty issue.",
    notFor: "Private repositories or payout guarantees.",
    decisionReturned: ["AVOID", "CAUTION", "VIABLE"],
    whyPay: "Checks withdrawn rewards, maintainer rejection, competing pull requests, failed-attempt saturation, and repository AI-contribution policy in one bounded pass.",
    samplePath: "/api/sample",
    skillName: "preflight-github-bounties",
  }),
  portfolio: Object.freeze({
    product: "BountyVerdict Portfolio",
    description: "Pay once to rank up to ten bounty candidates with full evidence-linked verdicts.",
    useWhen: "When choosing among two to ten public GitHub bounty candidates.",
    notFor: "One candidate, duplicate issue URLs, or private issues.",
    decisionReturned: ["ranked_verdicts", "best_candidate", "counts", "partial_failures"],
    whyPay: "One call performs two to ten full audits; at ten candidates the fixed price is $0.04 per candidate.",
    samplePath: "/api/portfolio/sample",
    skillName: "preflight-github-bounties",
  }),
  harness: Object.freeze({
    product: "HarnessVerdict",
    description: "Pay once for a commit-pinned, evidence-linked repository instruction audit.",
    useWhen: "Before autonomous coding in a public GitHub repository.",
    notFor: "Generic code quality review or private repositories.",
    decisionReturned: ["READY", "REVIEW", "REPAIR"],
    whyPay: "Maps AGENTS.md, CLAUDE.md, GEMINI.md, Copilot, Cursor, and SKILL.md coverage at an immutable commit and returns evidence-linked fixes.",
    samplePath: "/api/harness/sample",
    skillName: "audit-agent-harness",
  }),
  skill: Object.freeze({
    product: "SkillVerdict",
    description: "Pay once for a commit-pinned, non-executing security audit before installing a public agent skill.",
    useWhen: "Before installing or running a third-party public SKILL.md bundle.",
    notFor: "Runtime sandboxing, private skills, or a guarantee that code is safe.",
    decisionReturned: ["LOW_RISK", "REVIEW", "BLOCK"],
    whyPay: "Scans the whole pinned skill directory for credential theft, remote execution, destructive actions, persistence, privilege escalation, hidden files, and undeclared capabilities without executing it.",
    samplePath: "/api/skill/sample",
    skillName: "preflight-agent-skills",
  }),
  run: Object.freeze({
    product: "RunVerdict",
    description: "Pay once to learn why a public GitHub Actions run failed and what to do next.",
    useWhen: "After a failed run when the agent needs root cause and next action.",
    notFor: "The narrower retry-once-versus-fix flake decision.",
    decisionReturned: ["PASS", "WAIT", "RETRY", "FIX", "INVESTIGATE"],
    whyPay: "Reads exact-attempt jobs and bounded failed-job logs, separates primary failures from downstream summaries, and returns redacted evidence without rerunning code.",
    samplePath: "/api/run/sample",
    skillName: "diagnose-github-actions",
  }),
  flake: Object.freeze({
    product: "FlakeVerdict",
    description: "Pay once to decide whether one public GitHub Actions failure merits exactly one retry or needs a fix.",
    useWhen: "After a completed failed run when the decision is retry once versus fix.",
    notFor: "Root-cause diagnosis; use RunVerdict when the question is why the run failed.",
    decisionReturned: ["CONFIRMED_FLAKE", "LIKELY_FLAKE", "RECURRING_FAILURE", "NEW_FAILURE", "INCONCLUSIVE", "NOT_FAILED"],
    whyPay: "Compares exact attempts, same-commit outcomes, failed-step fingerprints, and bounded historical runs to avoid a wasted CI rerun.",
    samplePath: "/api/flake/sample",
    skillName: "classify-github-flakes",
  }),
  mcpdrift: Object.freeze({
    product: "MCPDriftVerdict",
    description: "Pay once to receive the already-computed compatibility verdict for this exact MCP tools/list snapshot pair.",
    useWhen: "After a complete MCP tools/list change and before an agent accepts the server upgrade.",
    notFor: "Malware or prompt-injection scanning, private catalogs, or invoking MCP tools.",
    decisionReturned: ["UNCHANGED", "SAFE_ADDITIVE", "REVIEW", "INCONCLUSIVE", "BREAKING", "SECURITY_REGRESSION"],
    whyPay: "Provides an exact-hash structural compatibility gate for removed tools, new required arguments, incompatible schemas, and model-facing safety regressions.",
    samplePath: "/api/mcp-drift/sample",
    skillName: "check-mcp-tool-drift",
  }),
} satisfies Record<ProductKey, ProductSelectionPreview>);
