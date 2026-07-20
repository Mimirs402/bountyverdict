import { SERVICE_REUSE, type ServiceReuseGuidance } from "./reuse.ts";

export interface HarnessEnvironment {
  GITHUB_TOKEN?: string;
}

export interface TreeEntry {
  path: string;
  type: string;
  size?: number;
}

export interface HarnessDocument {
  path: string;
  body: string;
  html_url: string;
  size: number;
}

export interface HarnessFinding {
  severity: "critical" | "error" | "warning" | "info";
  code: string;
  message: string;
  file: string | null;
  line: number | null;
  evidence_url: string | null;
}

export interface HarnessAudit {
  product: "HarnessVerdict";
  version: "1.0";
  verdict: "READY" | "REVIEW" | "REPAIR";
  score: number;
  summary: string;
  service_reuse: ServiceReuseGuidance;
  repository: {
    url: string;
    full_name: string;
    default_branch: string;
    commit_sha: string;
  };
  surfaces: {
    instruction_files_found: number;
    instruction_files_scanned: number;
    skill_files_scanned: number;
    files: string[];
  };
  portability: Record<"codex" | "claude_code" | "gemini_cli" | "github_copilot" | "cursor", boolean>;
  findings: HarnessFinding[];
  recommendations: string[];
  coverage: {
    tree_entries: number;
    candidate_files: number;
    files_scanned: number;
    bytes_scanned: number;
    tree_truncated: boolean;
    file_selection_truncated: boolean;
    github_rate_limit_remaining: number | null;
  };
  checked_at: string;
  limitations: string[];
}

export class HarnessError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MAX_FILES = 20;
const MAX_FILE_BYTES = 128 * 1024;
const LARGE_FILE_BYTES = 32 * 1024;
const LARGE_TOTAL_BYTES = 64 * 1024;

export function parseRepositoryUrl(value: string): { owner: string; repo: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HarnessError("repo_url must be a canonical public GitHub repository URL.", 400, "INVALID_REPOSITORY_URL");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    parts.length !== 2
  ) {
    throw new HarnessError("repo_url must be a canonical public GitHub repository URL.", 400, "INVALID_REPOSITORY_URL");
  }
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(repo)) {
    throw new HarnessError("repo_url contains an invalid GitHub owner or repository name.", 400, "INVALID_REPOSITORY_URL");
  }
  return { owner, repo };
}

function isSkill(path: string): boolean {
  return /(^|\/)\.(?:agents|codex|claude)\/skills\/[^/]+\/SKILL\.md$/.test(path);
}

function isInstruction(path: string): boolean {
  return (
    /(^|\/)AGENTS(?:\.override)?\.md$/.test(path) ||
    /(^|\/)CLAUDE\.md$/.test(path) ||
    /(^|\/)GEMINI\.md$/.test(path) ||
    path === ".github/copilot-instructions.md" ||
    /^\.github\/instructions\/[^/]+\.instructions\.md$/.test(path) ||
    /^\.cursor\/rules\/[^/]+\.mdc$/.test(path) ||
    path === ".cursorrules" ||
    path === ".windsurfrules" ||
    path === ".clinerules" ||
    /^\.roo\/rules\/[^/]+\.md$/.test(path) ||
    isSkill(path)
  );
}

function priority(path: string): number {
  if (path === "AGENTS.override.md") return 0;
  if (path === "AGENTS.md") return 1;
  if (path === "CLAUDE.md") return 2;
  if (path === "GEMINI.md") return 3;
  if (path === ".github/copilot-instructions.md") return 4;
  if (path === ".cursorrules" || path.startsWith(".cursor/rules/")) return 5;
  if (isSkill(path)) return 20 + path.split("/").length;
  return 10 + path.split("/").length;
}

export function selectHarnessFiles(entries: TreeEntry[]): {
  candidates: TreeEntry[];
  selected: TreeEntry[];
  truncated: boolean;
} {
  const candidates = entries
    .filter((entry) => entry.type === "blob" && isInstruction(entry.path))
    .sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path));
  const selected = candidates
    .filter((entry) => (entry.size ?? 0) <= MAX_FILE_BYTES)
    .slice(0, MAX_FILES);
  return { candidates, selected, truncated: selected.length < candidates.length };
}

function lineNumber(body: string, offset: number): number {
  return body.slice(0, offset).split("\n").length;
}

function evidence(document: HarnessDocument): Pick<HarnessFinding, "file" | "evidence_url"> {
  return { file: document.path, evidence_url: document.html_url };
}

function normalizeReference(documentPath: string, token: string, paths: Set<string>): string | null {
  let value = token.trim().replace(/[,:;]$/, "").replace(/:(\d+)(?::\d+)?$/, "");
  if (
    !value || value.length > 180 || value.includes(" ") || value.includes("*") ||
    value.includes("<") || value.includes(">") || value.includes("$") ||
    value.includes("…") ||
    /^(?:https?:|[a-z]+:|--|npm |pnpm |yarn |git |npx |~\/|\.git\/|github\.com\/)/i.test(value)
  ) return null;
  if (!value.includes("/") && !/\.(?:md|json|toml|ya?ml|ts|js|py|go|rs|sh)$/.test(value)) return null;
  if (value.startsWith("/") || /^[A-Za-z]:\\/.test(value)) return null;
  value = value.replace(/^\.\//, "");
  const base = documentPath.includes("/") ? documentPath.slice(0, documentPath.lastIndexOf("/")) : "";
  const components = (token.startsWith("../") ? `${base}/${value}` : value).split("/");
  const normalized: string[] = [];
  for (const component of components) {
    if (!component || component === ".") continue;
    if (component === "..") normalized.pop();
    else normalized.push(component);
  }
  const result = normalized.join("/");
  if (!result) return null;
  const first = result.split("/")[0];
  const fileLike = /\.(?:md|json|toml|ya?ml|ts|tsx|js|jsx|mjs|cjs|py|go|rs|sh|bash|zsh|css|scss|html|sql|proto|lock)$/.test(result);
  const rootedInRepository = [...paths].some((path) => path === first || path.startsWith(`${first}/`));
  return fileLike || rootedInRepository ? result : null;
}

function hasPath(paths: Set<string>, reference: string): boolean {
  return paths.has(reference) || [...paths].some((path) =>
    path.startsWith(`${reference}/`) || path.endsWith(`/${reference}`)
  );
}

function skillFrontmatter(body: string): { name: boolean; description: boolean } {
  const match = body.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  if (!match) return { name: false, description: false };
  return {
    name: /^name:\s*\S.+$/m.test(match[1]),
    description: /^description:\s*\S.+$/m.test(match[1]),
  };
}

export function analyzeHarnessSnapshot(input: {
  repositoryUrl: string;
  fullName: string;
  defaultBranch: string;
  commitSha: string;
  entries: TreeEntry[];
  documents: HarnessDocument[];
  treeTruncated?: boolean;
  fileSelectionTruncated?: boolean;
  candidateCount?: number;
  rateRemaining?: number | null;
}, now = new Date()): HarnessAudit {
  const paths = new Set(input.entries.map(({ path }) => path));
  const documents = [...input.documents].sort((a, b) => a.path.localeCompare(b.path));
  const findings: HarnessFinding[] = [];
  let penalty = 0;

  const add = (finding: HarnessFinding, points: number) => {
    findings.push(finding);
    penalty += points;
  };
  const rootAgents = documents.find(({ path }) => path === "AGENTS.md" || path === "AGENTS.override.md");
  if (!documents.length) {
    add({ severity: "error", code: "NO_AGENT_INSTRUCTIONS", message: "No recognized repository instruction or skill files were found.", file: null, line: null, evidence_url: null }, 65);
  } else if (!rootAgents) {
    add({ severity: "warning", code: "ROOT_AGENTS_MISSING", message: "No root AGENTS.md or AGENTS.override.md gives Codex-compatible agents a repository-wide baseline.", file: null, line: null, evidence_url: null }, 15);
  }

  const singular = input.entries.find(({ path }) => /(^|\/)AGENT\.md$/i.test(path));
  if (singular) {
    add({ severity: "warning", code: "NONSTANDARD_AGENT_FILENAME", message: "AGENT.md is not the standard plural AGENTS.md filename and may be ignored.", file: singular.path, line: null, evidence_url: `${input.repositoryUrl}/blob/${input.commitSha}/${singular.path}` }, 8);
  }

  const totalBytes = documents.reduce((sum, document) => sum + document.size, 0);
  if (totalBytes > LARGE_TOTAL_BYTES) {
    add({ severity: "warning", code: "CONTEXT_BUDGET_HIGH", message: `Recognized instruction files total ${totalBytes} bytes, increasing context cost and truncation risk.`, file: null, line: null, evidence_url: null }, 10);
  }

  const seenStale = new Set<string>();
  for (const document of documents) {
    const common = evidence(document);
    if (!document.body.trim()) {
      add({ severity: "error", code: "EMPTY_INSTRUCTION_FILE", message: "Instruction file is empty.", ...common, line: 1 }, 20);
      continue;
    }
    if (document.size > LARGE_FILE_BYTES) {
      add({ severity: "warning", code: "INSTRUCTION_FILE_LARGE", message: `Instruction file is ${document.size} bytes; split or route detailed guidance to reduce always-loaded context.`, ...common, line: 1 }, 8);
    }
    const localPath = document.body.match(/(?:\/home\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\|~\/)/i);
    if (localPath) {
      add({ severity: "warning", code: "MACHINE_LOCAL_PATH", message: "Instruction file contains a machine-local absolute path that will not be portable to other agents.", ...common, line: lineNumber(document.body, localPath.index || 0) }, 8);
    }
    const secret = document.body.match(/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bghp_[A-Za-z0-9]{20,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,})/);
    if (secret) {
      add({ severity: "critical", code: "SECRET_LIKE_MATERIAL", message: "Instruction file contains secret-like material; rotate it and remove it from repository history.", ...common, line: lineNumber(document.body, secret.index || 0) }, 50);
    }
    if (isSkill(document.path)) {
      const frontmatter = skillFrontmatter(document.body);
      if (!frontmatter.name || !frontmatter.description) {
        add({ severity: "warning", code: "SKILL_FRONTMATTER_INCOMPLETE", message: "SKILL.md frontmatter must declare non-empty name and description fields.", ...common, line: 1 }, 8);
      }
    }
    for (const match of document.body.matchAll(/`([^`\n]+)`/g)) {
      const reference = normalizeReference(document.path, match[1], paths);
      if (!reference || hasPath(paths, reference)) continue;
      const key = `${document.path}:${reference}`;
      if (seenStale.has(key) || seenStale.size >= 10) continue;
      seenStale.add(key);
      add({ severity: "warning", code: "STALE_PATH_REFERENCE", message: `Referenced repository path does not exist at the audited commit: ${reference}`, ...common, line: lineNumber(document.body, match.index || 0) }, 3);
    }
  }

  const portability = {
    codex: Boolean(rootAgents),
    claude_code: documents.some(({ path }) => path === "CLAUDE.md"),
    gemini_cli: documents.some(({ path }) => path === "GEMINI.md"),
    github_copilot: documents.some(({ path }) => path === ".github/copilot-instructions.md" || path.startsWith(".github/instructions/")),
    cursor: documents.some(({ path }) => path === ".cursorrules" || path.startsWith(".cursor/rules/")),
  };
  const portableCount = Object.values(portability).filter(Boolean).length;
  if (documents.length && portableCount < 2) {
    add({ severity: "info", code: "SINGLE_CLIENT_SURFACE", message: "Only one or no major coding-agent instruction surface is present; add thin pointers for the clients your team uses.", file: null, line: null, evidence_url: null }, 5);
  }

  const score = Math.max(0, Math.min(100, 100 - penalty));
  const hasCritical = findings.some(({ severity }) => severity === "critical");
  const hasError = findings.some(({ severity }) => severity === "error");
  const verdict: HarnessAudit["verdict"] = hasCritical || !documents.length || score < 50
    ? "REPAIR"
    : hasError || score < 80
      ? "REVIEW"
      : "READY";
  const recommendations = [...new Set(findings.map(({ code }) => {
    if (code === "NO_AGENT_INSTRUCTIONS" || code === "ROOT_AGENTS_MISSING") return "Add a concise root AGENTS.md with build, test, safety, ownership, and done-when guidance.";
    if (code === "SECRET_LIKE_MATERIAL") return "Rotate exposed credentials, purge them from history, and reference environment-variable names only.";
    if (code === "STALE_PATH_REFERENCE") return "Repair or remove stale repository-path references so agents do not navigate nonexistent files.";
    if (code === "CONTEXT_BUDGET_HIGH" || code === "INSTRUCTION_FILE_LARGE") return "Keep the root instructions small and route specialized guidance to scoped files or skills.";
    if (code === "MACHINE_LOCAL_PATH") return "Replace machine-specific absolute paths with repository-relative paths or portable environment variables.";
    if (code === "SKILL_FRONTMATTER_INCOMPLETE") return "Add valid name and description frontmatter to every discovered SKILL.md.";
    if (code === "SINGLE_CLIENT_SURFACE") return "Add small client-specific pointer files instead of duplicating the canonical guidance.";
    return "Rename nonstandard instruction files to a documented filename supported by the target agent.";
  }))];

  return {
    product: "HarnessVerdict",
    version: "1.0",
    verdict,
    score,
    summary: verdict === "READY"
      ? "The repository exposes a compact, structurally sound instruction stack for autonomous coding agents."
      : verdict === "REVIEW"
        ? "The instruction stack is usable but has portability, scope, or maintenance risks worth fixing before autonomous work."
        : "The repository instruction stack has a hard reliability or safety gap that should be repaired before autonomous work.",
    service_reuse: SERVICE_REUSE.harness,
    repository: {
      url: input.repositoryUrl,
      full_name: input.fullName,
      default_branch: input.defaultBranch,
      commit_sha: input.commitSha,
    },
    surfaces: {
      instruction_files_found: input.candidateCount ?? documents.length,
      instruction_files_scanned: documents.filter(({ path }) => !isSkill(path)).length,
      skill_files_scanned: documents.filter(({ path }) => isSkill(path)).length,
      files: documents.map(({ path }) => path),
    },
    portability,
    findings: findings.sort((a, b) => ["critical", "error", "warning", "info"].indexOf(a.severity) - ["critical", "error", "warning", "info"].indexOf(b.severity)),
    recommendations,
    coverage: {
      tree_entries: input.entries.length,
      candidate_files: input.candidateCount ?? documents.length,
      files_scanned: documents.length,
      bytes_scanned: totalBytes,
      tree_truncated: Boolean(input.treeTruncated),
      file_selection_truncated: Boolean(input.fileSelectionTruncated),
      github_rate_limit_remaining: input.rateRemaining ?? null,
    },
    checked_at: now.toISOString(),
    limitations: [
      "This deterministic audit checks repository structure and text patterns; it does not prove that a model will obey the instructions.",
      "Git does not store empty nested .git directories, so remote audits cannot detect that local project-root failure mode.",
      "At most 20 recognized files and 128 KiB per file are scanned; coverage fields disclose truncation.",
      "Secret detection is defensive pattern matching and may miss nonstandard credentials.",
    ],
  };
}

type FetchLike = typeof fetch;

function headers(env: HarnessEnvironment): HeadersInit {
  const value: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "HarnessVerdict-Agent/1.0",
  };
  if (env.GITHUB_TOKEN) value.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return value;
}

async function githubJson(path: string, env: HarnessEnvironment, fetchImpl: FetchLike): Promise<{ data: any; remaining: number | null }> {
  const response = await fetchImpl(`https://api.github.com${path}`, { headers: headers(env) });
  const parsedRemaining = Number(response.headers.get("x-ratelimit-remaining"));
  const remaining = Number.isFinite(parsedRemaining) ? parsedRemaining : null;
  if (!response.ok) {
    if (response.status === 404) throw new HarnessError("GitHub could not find that public repository or commit.", 404, "REPOSITORY_NOT_FOUND");
    if (response.status === 403 && remaining === 0) throw new HarnessError("GitHub API capacity is temporarily exhausted.", 503, "GITHUB_RATE_LIMITED");
    throw new HarnessError(`GitHub returned HTTP ${response.status}.`, 502, "GITHUB_UPSTREAM_ERROR");
  }
  return { data: await response.json(), remaining };
}

export async function checkGithubHarness(
  repositoryUrl: string,
  env: HarnessEnvironment = {},
  fetchImpl: FetchLike = fetch,
  now = new Date(),
): Promise<HarnessAudit> {
  const { owner, repo } = parseRepositoryUrl(repositoryUrl);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const repository = await githubJson(base, env, fetchImpl);
  if (repository.data.private === true) {
    throw new HarnessError("GitHub could not find that public repository or commit.", 404, "REPOSITORY_NOT_FOUND");
  }
  const branch = String(repository.data.default_branch || "");
  const commit = await githubJson(`${base}/commits/${encodeURIComponent(branch)}`, env, fetchImpl);
  const sha = String(commit.data.sha || "");
  const tree = await githubJson(`${base}/git/trees/${encodeURIComponent(sha)}?recursive=1`, env, fetchImpl);
  const entries = (Array.isArray(tree.data.tree) ? tree.data.tree : []).map((entry: any) => ({
    path: String(entry.path || ""),
    type: String(entry.type || ""),
    size: typeof entry.size === "number" ? entry.size : undefined,
  })).filter((entry: TreeEntry) => entry.path);
  const selection = selectHarnessFiles(entries);
  const rawBase = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${sha}`;
  const documents = (await Promise.all(selection.selected.map(async (entry): Promise<HarnessDocument | null> => {
    const path = entry.path.split("/").map(encodeURIComponent).join("/");
    const response = await fetchImpl(`${rawBase}/${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const body = await response.text();
    return {
      path: entry.path,
      body,
      size: new TextEncoder().encode(body).length,
      html_url: `${repository.data.html_url}/blob/${sha}/${entry.path}`,
    };
  }))).filter((document): document is HarnessDocument => document !== null);
  const remaining = [repository.remaining, commit.remaining, tree.remaining]
    .filter((value): value is number => value !== null);

  return analyzeHarnessSnapshot({
    repositoryUrl: String(repository.data.html_url),
    fullName: String(repository.data.full_name),
    defaultBranch: branch,
    commitSha: sha,
    entries,
    documents,
    treeTruncated: Boolean(tree.data.truncated),
    fileSelectionTruncated: selection.truncated || documents.length < selection.selected.length,
    candidateCount: selection.candidates.length,
    rateRemaining: remaining.length ? Math.min(...remaining) : null,
  }, now);
}
