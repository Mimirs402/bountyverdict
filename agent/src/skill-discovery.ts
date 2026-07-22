import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { addHttpMethod } from "./bazaar.ts";
import { SERVICE_REUSE, serviceReuseSchema } from "./reuse.ts";

export const SKILL_DISCOVERY_DESCRIPTION =
  "Is this agent skill safe to install? Pre-install security audit for a public agent SKILL.md bundle. Pins the repository to a commit, scans the whole skill directory without executing it, uses repository context to reduce false positives, and flags credential exfiltration, remote or encoded execution, destructive commands, persistence, privilege escalation, instruction evasion, hidden scripts, symlinks, submodules, hardcoded secrets, and undeclared capabilities.";

export const skillExample = {
  product: "SkillVerdict",
  version: "1.0",
  verdict: "REVIEW",
  risk_score: 30,
  summary: "The skill has consequential behavior or structural ambiguity that requires manual review before installation.",
  service_reuse: SERVICE_REUSE.skill,
  repository: {
    url: "https://github.com/acme/agent-skills",
    full_name: "acme/agent-skills",
    archived: false,
    default_branch: "main",
    commit_sha: "0123456789abcdef0123456789abcdef01234567",
  },
  skill: {
    path: "skills/release/SKILL.md",
    name: "release",
    description: "Deploy the service using the repository release script.",
    files: ["skills/release/SKILL.md", "skills/release/scripts/deploy.sh"],
  },
  capabilities: {
    declared: ["network", "shell"],
    observed: ["network", "shell", "system_configuration"],
    external_domains: ["api.cloudflare.com"],
  },
  findings: [{
    severity: "high",
    code: "UNDECLARED_CAPABILITY",
    message: "Observed system configuration behavior is not disclosed by the skill description or instructions.",
    file: null,
    line: null,
    evidence_url: "https://github.com/acme/agent-skills/blob/0123456789abcdef0123456789abcdef01234567/skills/release/SKILL.md",
  }],
  recommendations: [
    "Disclose every consequential capability in the skill description and least-privilege workflow.",
  ],
  coverage: {
    entries_in_skill: 3,
    files_scanned: 2,
    bytes_scanned: 4820,
    skipped_binary: 1,
    skipped_oversized: 0,
    selection_truncated: false,
    github_rate_limit_remaining: 4997,
  },
  checked_at: "2026-07-20T00:00:00.000Z",
  limitations: [
    "This static audit never executes the skill and cannot prove that a low-risk result is safe.",
  ],
};

const findingSchema = {
  type: "object",
  properties: {
    severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
    code: { type: "string" },
    message: { type: "string" },
    file: { type: ["string", "null"] },
    line: { type: ["integer", "null"] },
    evidence_url: { type: ["string", "null"] },
  },
  required: ["severity", "code", "message", "file", "line", "evidence_url"],
};

export const skillOutputSchema = {
  properties: {
    product: { type: "string", const: "SkillVerdict" },
    version: { type: "string" },
    verdict: { type: "string", enum: ["LOW_RISK", "REVIEW", "BLOCK"] },
    risk_score: { type: "integer", minimum: 0, maximum: 100 },
    summary: { type: "string" },
    service_reuse: serviceReuseSchema,
    repository: {
      type: "object",
      properties: {
        url: { type: "string" },
        full_name: { type: "string" },
        archived: { type: "boolean" },
        default_branch: { type: "string" },
        commit_sha: { type: "string" },
      },
      required: ["url", "full_name", "archived", "default_branch", "commit_sha"],
    },
    skill: {
      type: "object",
      properties: {
        path: { type: "string" },
        name: { type: ["string", "null"] },
        description: { type: ["string", "null"] },
        files: { type: "array", items: { type: "string" } },
      },
      required: ["path", "name", "description", "files"],
    },
    capabilities: {
      type: "object",
      properties: {
        declared: { type: "array", items: { type: "string" } },
        observed: { type: "array", items: { type: "string" } },
        external_domains: { type: "array", items: { type: "string" } },
      },
      required: ["declared", "observed", "external_domains"],
    },
    findings: { type: "array", items: findingSchema },
    recommendations: { type: "array", items: { type: "string" } },
    coverage: {
      type: "object",
      properties: {
        entries_in_skill: { type: "integer", minimum: 1 },
        files_scanned: { type: "integer", minimum: 1 },
        bytes_scanned: { type: "integer", minimum: 0 },
        skipped_binary: { type: "integer", minimum: 0 },
        skipped_oversized: { type: "integer", minimum: 0 },
        selection_truncated: { type: "boolean" },
        github_rate_limit_remaining: { type: ["integer", "null"] },
      },
      required: ["entries_in_skill", "files_scanned", "bytes_scanned", "skipped_binary", "skipped_oversized", "selection_truncated", "github_rate_limit_remaining"],
    },
    checked_at: { type: "string" },
    limitations: { type: "array", items: { type: "string" } },
  },
  required: ["product", "version", "verdict", "risk_score", "summary", "service_reuse", "repository", "skill", "capabilities", "findings", "recommendations", "coverage", "checked_at", "limitations"],
};

export const skillDiscoveryExtension = addHttpMethod(declareDiscoveryExtension({
  input: {
    repo_url: "https://github.com/coinbase/agentic-wallet-skills",
    skill_path: "skills/agentic-wallet",
  },
  inputSchema: {
    properties: {
      repo_url: {
        type: "string",
        pattern: "^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+(\\.git)?$",
        description: "Canonical URL of the public GitHub repository containing the skill.",
      },
      skill_path: {
        type: "string",
        pattern: "^[A-Za-z0-9._/-]+$",
        description: "Repository-relative skill directory or exact case-sensitive SKILL.md path.",
      },
    },
    required: ["repo_url", "skill_path"],
    additionalProperties: false,
  },
  output: { example: skillExample, schema: skillOutputSchema },
}), "GET");
