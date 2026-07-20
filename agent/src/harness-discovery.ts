import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { addHttpMethod } from "./bazaar.ts";
import { SERVICE_REUSE, serviceReuseSchema } from "./reuse.ts";

export const harnessExample = {
  product: "HarnessVerdict",
  version: "1.0",
  verdict: "REVIEW",
  score: 77,
  summary: "The instruction stack is usable but has portability, scope, or maintenance risks worth fixing before autonomous work.",
  service_reuse: SERVICE_REUSE.harness,
  repository: {
    url: "https://github.com/acme/widget",
    full_name: "acme/widget",
    default_branch: "main",
    commit_sha: "0123456789abcdef0123456789abcdef01234567",
  },
  surfaces: {
    instruction_files_found: 2,
    instruction_files_scanned: 1,
    skill_files_scanned: 1,
    files: ["AGENTS.md", ".agents/skills/release/SKILL.md"],
  },
  portability: {
    codex: true,
    claude_code: false,
    gemini_cli: false,
    github_copilot: false,
    cursor: false,
  },
  findings: [{
    severity: "warning",
    code: "STALE_PATH_REFERENCE",
    message: "Referenced repository path does not exist at the audited commit: docs/release.md",
    file: "AGENTS.md",
    line: 18,
    evidence_url: "https://github.com/acme/widget/blob/0123456789abcdef0123456789abcdef01234567/AGENTS.md",
  }],
  recommendations: [
    "Repair or remove stale repository-path references so agents do not navigate nonexistent files.",
    "Add small client-specific pointer files instead of duplicating the canonical guidance.",
  ],
  coverage: {
    tree_entries: 420,
    candidate_files: 2,
    files_scanned: 2,
    bytes_scanned: 8420,
    tree_truncated: false,
    file_selection_truncated: false,
    github_rate_limit_remaining: 4997,
  },
  checked_at: "2026-07-20T00:00:00.000Z",
  limitations: [
    "This deterministic audit checks repository structure and text patterns; it does not prove that a model will obey the instructions.",
  ],
};

const findingSchema = {
  type: "object",
  properties: {
    severity: { type: "string", enum: ["critical", "error", "warning", "info"] },
    code: { type: "string" },
    message: { type: "string" },
    file: { type: ["string", "null"] },
    line: { type: ["integer", "null"] },
    evidence_url: { type: ["string", "null"] },
  },
  required: ["severity", "code", "message", "file", "line", "evidence_url"],
};

export const harnessOutputSchema = {
  properties: {
    product: { type: "string", const: "HarnessVerdict" },
    version: { type: "string" },
    verdict: { type: "string", enum: ["READY", "REVIEW", "REPAIR"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    summary: { type: "string" },
    service_reuse: serviceReuseSchema,
    repository: {
      type: "object",
      properties: {
        url: { type: "string" },
        full_name: { type: "string" },
        default_branch: { type: "string" },
        commit_sha: { type: "string" },
      },
      required: ["url", "full_name", "default_branch", "commit_sha"],
    },
    surfaces: {
      type: "object",
      properties: {
        instruction_files_found: { type: "integer", minimum: 0 },
        instruction_files_scanned: { type: "integer", minimum: 0 },
        skill_files_scanned: { type: "integer", minimum: 0 },
        files: { type: "array", items: { type: "string" } },
      },
      required: ["instruction_files_found", "instruction_files_scanned", "skill_files_scanned", "files"],
    },
    portability: {
      type: "object",
      properties: {
        codex: { type: "boolean" },
        claude_code: { type: "boolean" },
        gemini_cli: { type: "boolean" },
        github_copilot: { type: "boolean" },
        cursor: { type: "boolean" },
      },
      required: ["codex", "claude_code", "gemini_cli", "github_copilot", "cursor"],
    },
    findings: { type: "array", items: findingSchema },
    recommendations: { type: "array", items: { type: "string" } },
    coverage: {
      type: "object",
      properties: {
        tree_entries: { type: "integer", minimum: 0 },
        candidate_files: { type: "integer", minimum: 0 },
        files_scanned: { type: "integer", minimum: 0 },
        bytes_scanned: { type: "integer", minimum: 0 },
        tree_truncated: { type: "boolean" },
        file_selection_truncated: { type: "boolean" },
        github_rate_limit_remaining: { type: ["integer", "null"] },
      },
      required: ["tree_entries", "candidate_files", "files_scanned", "bytes_scanned", "tree_truncated", "file_selection_truncated", "github_rate_limit_remaining"],
    },
    checked_at: { type: "string" },
    limitations: { type: "array", items: { type: "string" } },
  },
  required: ["product", "version", "verdict", "score", "summary", "service_reuse", "repository", "surfaces", "portability", "findings", "recommendations", "coverage", "checked_at", "limitations"],
};

export const harnessDiscoveryExtension = addHttpMethod(declareDiscoveryExtension({
  input: { repo_url: "https://github.com/openai/codex" },
  inputSchema: {
    properties: {
      repo_url: {
        type: "string",
        pattern: "^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+(?:\\.git)?$",
        description: "Canonical URL of a public GitHub repository whose coding-agent instruction stack should be audited.",
      },
    },
    required: ["repo_url"],
    additionalProperties: false,
  },
  output: { example: harnessExample, schema: harnessOutputSchema },
}), "GET");
