import { HarnessError, parseRepositoryUrl } from "./harness.ts";
import { SERVICE_REUSE, type ServiceReuseGuidance } from "./reuse.ts";

export interface SkillEnvironment {
  GITHUB_TOKEN?: string;
}

export interface SkillSourceFile {
  path: string;
  body: string;
  size: number;
  mode: string;
  html_url: string;
}

export interface SkillTreeEntry {
  path: string;
  type: string;
  mode: string;
  size?: number;
}

export interface SkillFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  code: string;
  message: string;
  file: string | null;
  line: number | null;
  evidence_url: string | null;
}

export interface SkillAudit {
  product: "SkillVerdict";
  version: "1.0";
  verdict: "LOW_RISK" | "REVIEW" | "BLOCK";
  risk_score: number;
  summary: string;
  service_reuse: ServiceReuseGuidance;
  repository: {
    url: string;
    full_name: string;
    archived: boolean;
    default_branch: string;
    commit_sha: string;
  };
  skill: {
    path: string;
    name: string | null;
    description: string | null;
    files: string[];
  };
  capabilities: {
    declared: string[];
    observed: string[];
    external_domains: string[];
  };
  findings: SkillFinding[];
  recommendations: string[];
  coverage: {
    entries_in_skill: number;
    files_scanned: number;
    bytes_scanned: number;
    skipped_binary: number;
    skipped_oversized: number;
    selection_truncated: boolean;
    github_rate_limit_remaining: number | null;
  };
  checked_at: string;
  limitations: string[];
}

export class SkillError extends HarnessError {}

const MAX_FILES = 30;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024;
const TEXT_FILE = /(?:^|\/)(?:SKILL\.md|[^/]+\.(?:md|txt|json|jsonc|toml|ya?ml|sh|bash|zsh|fish|py|js|mjs|cjs|ts|tsx|ps1|rb|go|rs))$/i;
const SCRIPT_FILE = /\.(?:sh|bash|zsh|fish|py|js|mjs|cjs|ts|tsx|ps1|rb|go|rs)$/i;

export function normalizeSkillPath(value: string): { directory: string; entry: string } {
  let path = value.trim().replace(/^\.\//, "").replace(/\/$/, "");
  if (path && !path.endsWith("/SKILL.md") && path !== "SKILL.md") path += "/SKILL.md";
  if (
    !path || path.length > 300 || path.startsWith("/") || path.includes("\\") ||
    path.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    !/^[A-Za-z0-9._/-]+$/.test(path) || !/(^|\/)SKILL\.md$/.test(path)
  ) {
    throw new SkillError("skill_path must be a repository-relative directory or exact SKILL.md path.", 400, "INVALID_SKILL_PATH");
  }
  return { directory: path === "SKILL.md" ? "" : path.slice(0, -"/SKILL.md".length), entry: path };
}

export function selectSkillFiles(entries: SkillTreeEntry[], directory: string): {
  scoped: SkillTreeEntry[];
  selected: SkillTreeEntry[];
  skippedBinary: number;
  skippedOversized: number;
  truncated: boolean;
} {
  const prefix = directory ? `${directory}/` : "";
  const scoped = entries.filter(({ path }) => path === `${prefix}SKILL.md` || path.startsWith(prefix));
  const text = scoped.filter(({ type, path }) => type === "blob" && TEXT_FILE.test(path));
  const skippedBinary = scoped.filter(({ type, path }) => type === "blob" && !TEXT_FILE.test(path)).length;
  const skippedOversized = text.filter(({ size = 0 }) => size > MAX_FILE_BYTES).length;
  const eligible = text
    .filter(({ size = 0 }) => size <= MAX_FILE_BYTES)
    .sort((a, b) => Number(!a.path.endsWith("/SKILL.md") && a.path !== "SKILL.md") - Number(!b.path.endsWith("/SKILL.md") && b.path !== "SKILL.md") || a.path.localeCompare(b.path));
  const selected: SkillTreeEntry[] = [];
  let total = 0;
  for (const entry of eligible) {
    const size = entry.size || 0;
    if (selected.length >= MAX_FILES || total + size > MAX_TOTAL_BYTES) continue;
    selected.push(entry);
    total += size;
  }
  return {
    scoped,
    selected,
    skippedBinary,
    skippedOversized,
    truncated: selected.length < eligible.length || skippedOversized > 0,
  };
}

function parseFrontmatter(body: string): { name: string | null; description: string | null } {
  const match = body.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  if (!match) return { name: null, description: null };
  const name = match[1].match(/^name:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim() || null;
  const description = match[1].match(/^description:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim() || null;
  return { name, description };
}

function lineNumber(body: string, offset: number): number {
  return body.slice(0, offset).split("\n").length;
}

function evidence(file: SkillSourceFile): Pick<SkillFinding, "file" | "evidence_url"> {
  return { file: file.path, evidence_url: file.html_url };
}

function capabilitySet(text: string): Set<string> {
  const result = new Set<string>();
  if (/(?:https?:\/\/|\bcurl\b|\bwget\b|\bfetch\b|\bapi\b|network)/i.test(text)) result.add("network");
  if (/(?:file system|filesystem|read (?:a )?file|write (?:a )?file|directory|\bpath\b|fs\.)/i.test(text)) result.add("filesystem");
  if (/(?:terminal|shell|command line|execute|run (?:the )?(?:command|script)|child_process|subprocess)/i.test(text)) result.add("shell");
  if (/(?:credential|api[_ -]?key|access[_ -]?token|secret|private key|seed phrase|wallet)/i.test(text)) result.add("credentials");
  if (/(?:systemd|launchctl|crontab|startup|autorun|\/etc\/|registry)/i.test(text)) result.add("system_configuration");
  if (/(?:cron|persistence|login item|shell profile|\.bashrc|\.zshrc)/i.test(text)) result.add("persistence");
  if (/(?:sudo|doas|administrator|root privileges|elevated privileges)/i.test(text)) result.add("privilege_escalation");
  return result;
}

function externalDomains(text: string): string[] {
  const domains = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)(?::\d+)?(?:[/?#]|$)/g)) {
    const domain = match[1].toLowerCase().replace(/\.$/, "");
    if (domain && domain !== "example.com" && domain !== "localhost") domains.add(domain);
  }
  return [...domains].sort();
}

export function analyzeSkillSnapshot(input: {
  repositoryUrl: string;
  fullName: string;
  archived: boolean;
  defaultBranch: string;
  commitSha: string;
  skillPath: string;
  entries: SkillTreeEntry[];
  scopedEntries: SkillTreeEntry[];
  files: SkillSourceFile[];
  skippedBinary?: number;
  skippedOversized?: number;
  selectionTruncated?: boolean;
  rateRemaining?: number | null;
}, now = new Date()): SkillAudit {
  const entry = input.files.find(({ path }) => path === input.skillPath);
  if (!entry) throw new SkillError("The requested SKILL.md could not be read at the pinned commit.", 404, "SKILL_NOT_FOUND");
  const metadata = parseFrontmatter(entry.body);
  const findings: SkillFinding[] = [];
  let risk = 0;
  const add = (finding: SkillFinding, points: number) => {
    if (findings.some((existing) => existing.code === finding.code && existing.file === finding.file && existing.line === finding.line)) return;
    findings.push(finding);
    risk += points;
  };

  if (!metadata.name || !metadata.description) {
    add({ severity: "high", code: "INVALID_SKILL_FRONTMATTER", message: "SKILL.md must declare non-empty name and description frontmatter before installation.", ...evidence(entry), line: 1 }, 25);
  }
  const directoryName = input.skillPath.includes("/") ? input.skillPath.split("/").at(-2)! : "";
  if (metadata.name && directoryName && metadata.name !== directoryName) {
    add({ severity: "low", code: "SKILL_NAME_PATH_MISMATCH", message: "The frontmatter name does not match the skill directory, which can cause ambiguous installation or discovery.", ...evidence(entry), line: 1 }, 5);
  }
  if (input.archived) {
    add({ severity: "medium", code: "ARCHIVED_REPOSITORY", message: "The containing repository is archived; abandoned-skill takeover and stale dependency risk require manual review.", file: null, line: null, evidence_url: input.repositoryUrl }, 12);
  }

  const combined = input.files.map(({ body }) => body).join("\n");
  const declared = capabilitySet(`${metadata.description || ""}\n${entry.body}`);
  const observed = capabilitySet(combined);
  const skillReferences = new Set([...entry.body.matchAll(/`([^`\n]+)`/g)].map((match) => match[1].replace(/^\.\//, "")));
  const prefix = input.skillPath.includes("/") ? input.skillPath.slice(0, input.skillPath.lastIndexOf("/") + 1) : "";
  const sensitiveFile = input.files.find(({ body }) => /(?:~\/\.(?:ssh|aws|gnupg|config\/gcloud)|\/home\/[^/]+\/\.(?:ssh|aws|gnupg)|id_(?:rsa|ed25519)|credentials\.json|wallet\.dat|seed phrase)/i.test(body));
  const uploadFile = input.files.find(({ body }) => /(?:curl\b[^\n]*(?:-d\b|--data(?:-binary)?\b|-F\b|--form\b|-T\b|--upload-file\b)|requests\.post\s*\(|fetch\s*\([^\n]+method\s*:\s*["']POST["'])/i.test(body));
  if (sensitiveFile && uploadFile) {
    const match = sensitiveFile.body.match(/(?:~\/\.(?:ssh|aws|gnupg|config\/gcloud)|\/home\/[^/]+\/\.(?:ssh|aws|gnupg)|id_(?:rsa|ed25519)|credentials\.json|wallet\.dat|seed phrase)/i);
    add({ severity: "critical", code: "CREDENTIAL_EXFILTRATION_CHAIN", message: "The skill combines sensitive credential access with an outbound upload path.", ...evidence(sensitiveFile), line: lineNumber(sensitiveFile.body, match?.index || 0) }, 65);
  }

  for (const scoped of input.scopedEntries) {
    if (scoped.type === "commit" || scoped.mode === "160000") {
      add({ severity: "high", code: "SKILL_SUBMODULE", message: "The skill directory contains a Git submodule whose contents are not pinned by this repository tree audit.", file: scoped.path, line: null, evidence_url: `${input.repositoryUrl}/tree/${input.commitSha}/${scoped.path}` }, 25);
    }
    if (scoped.mode === "120000") {
      add({ severity: "high", code: "SKILL_SYMLINK", message: "The skill directory contains a symbolic link that may escape the reviewed directory after installation.", file: scoped.path, line: null, evidence_url: `${input.repositoryUrl}/blob/${input.commitSha}/${scoped.path}` }, 25);
    }
  }

  for (const file of input.files) {
    const common = evidence(file);
    const patterns: Array<{ pattern: RegExp; severity: SkillFinding["severity"]; code: string; message: string; points: number }> = [
      { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bghp_[A-Za-z0-9]{20,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/, severity: "critical", code: "HARDCODED_SECRET", message: "A secret-like value is embedded in the skill bundle. Rotate it and remove it from history; the value is intentionally redacted.", points: 60 },
      { pattern: /(?:curl|wget)[^\n|]{0,300}\|\s*(?:ba)?sh\b|Invoke-(?:WebRequest|RestMethod)[^\n]{0,300}\|\s*(?:iex|Invoke-Expression)/i, severity: "critical", code: "REMOTE_CODE_EXECUTION", message: "The skill downloads remote content and pipes it directly into an interpreter.", points: 55 },
      { pattern: /(?:base64\s+(?:-d|--decode)|frombase64string)[^\n]{0,200}(?:\|\s*(?:ba)?sh|eval|exec|Invoke-Expression)/i, severity: "critical", code: "ENCODED_CODE_EXECUTION", message: "The skill decodes and executes an opaque payload.", points: 55 },
      { pattern: /\brm\s+-[A-Za-z]*r[A-Za-z]*f\b[^\n]*(?:\/|~)|\bmkfs(?:\.|\s)|\bdd\s+if=|Remove-Item[^\n]+-Recurse[^\n]+-Force/i, severity: "critical", code: "DESTRUCTIVE_SYSTEM_COMMAND", message: "The skill contains a broadly destructive filesystem or disk command.", points: 55 },
      { pattern: /(?:~\/\.(?:ssh|aws|gnupg|config\/gcloud)|\/home\/[^/]+\/\.(?:ssh|aws|gnupg)|id_(?:rsa|ed25519)|credentials\.json|wallet\.dat|seed phrase)/i, severity: "high", code: "SENSITIVE_CREDENTIAL_ACCESS", message: "The skill references sensitive credential or wallet storage outside its own directory.", points: 30 },
      { pattern: /(?:crontab\s+-|systemctl\s+(?:enable|edit)|launchctl\s+(?:load|bootstrap)|\.bashrc|\.zshrc|Startup\\|CurrentVersion\\Run)/i, severity: "high", code: "PERSISTENCE_MECHANISM", message: "The skill can establish persistence or modify login/startup behavior.", points: 28 },
      { pattern: /(?:^|[;&|\s])(?:sudo|doas)\s|Start-Process[^\n]+-Verb\s+RunAs/i, severity: "high", code: "PRIVILEGE_ESCALATION", message: "The skill requests elevated operating-system privileges.", points: 24 },
      { pattern: /(?:ignore|override|disregard) (?:all )?(?:previous|prior|system|developer) instructions|do not (?:tell|inform|warn|show) (?:the )?user|hide (?:this|these) (?:steps|actions|commands)/i, severity: "high", code: "INSTRUCTION_EVASION", message: "The skill contains instructions associated with authority override or concealment from the user.", points: 30 },
      { pattern: /(?:disable|bypass|turn off) (?:security|antivirus|firewall|sandbox|approval|safety|logging)/i, severity: "high", code: "SECURITY_CONTROL_BYPASS", message: "The skill instructs the agent to weaken a security, approval, sandbox, or logging control.", points: 30 },
      { pattern: /\bnpx\s+(?![^\s@]+@(?:\d|sha|[a-f0-9]{7,40}\b))[^\s;&|]+|\buvx\s+(?![^\s@]+@(?:\d|sha|[a-f0-9]{7,40}\b))[^\s;&|]+/i, severity: "medium", code: "UNPINNED_PACKAGE_EXECUTION", message: "The skill executes a registry package without an explicit version or immutable revision.", points: 12 },
    ];
    for (const rule of patterns) {
      const match = file.body.match(rule.pattern);
      if (match) add({ severity: rule.severity, code: rule.code, message: rule.message, ...common, line: lineNumber(file.body, match.index || 0) }, rule.points);
    }
    if (SCRIPT_FILE.test(file.path)) {
      const relative = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path;
      const referenced = [...skillReferences].some((reference) => reference === relative || reference.endsWith(`/${relative}`) || reference === file.path);
      if (!referenced) {
        add({ severity: "medium", code: "UNDOCUMENTED_SCRIPT", message: "Executable source exists in the skill directory but is not referenced by SKILL.md.", ...common, line: 1 }, 10);
      }
    }
  }

  for (const capability of observed) {
    if (declared.has(capability)) continue;
    const consequential = ["credentials", "system_configuration", "persistence", "privilege_escalation"].includes(capability);
    add({
      severity: consequential ? "high" : "medium",
      code: "UNDECLARED_CAPABILITY",
      message: `Observed ${capability.replace(/_/g, " ")} behavior is not disclosed by the skill description or instructions.`,
      file: null,
      line: null,
      evidence_url: entry.html_url,
    }, consequential ? 22 : 8);
  }

  const riskScore = Math.min(100, risk);
  const hasCritical = findings.some(({ severity }) => severity === "critical");
  const hasHigh = findings.some(({ severity }) => severity === "high");
  const hasMedium = findings.some(({ severity }) => severity === "medium");
  const verdict: SkillAudit["verdict"] = hasCritical || riskScore >= 70
    ? "BLOCK"
    : hasHigh || hasMedium || riskScore >= 25
      ? "REVIEW"
      : "LOW_RISK";
  const recommendations = [...new Set(findings.map(({ code }) => {
    if (code === "HARDCODED_SECRET") return "Rotate the credential, remove it from repository history, and reference only an environment-variable name.";
    if (["REMOTE_CODE_EXECUTION", "ENCODED_CODE_EXECUTION"].includes(code)) return "Replace opaque or piped execution with a pinned artifact, published checksum, and explicit review step.";
    if (code === "DESTRUCTIVE_SYSTEM_COMMAND") return "Remove broad destructive commands or constrain them to a validated, recoverable target with explicit approval.";
    if (code === "SENSITIVE_CREDENTIAL_ACCESS") return "Remove ambient credential reads and request only narrowly scoped, documented inputs.";
    if (code === "CREDENTIAL_EXFILTRATION_CHAIN") return "Block installation, rotate any exposed credentials, and remove all ambient secret reads and outbound upload behavior.";
    if (code === "PERSISTENCE_MECHANISM") return "Require explicit user authorization for persistence and document exact files, units, or tasks modified.";
    if (code === "PRIVILEGE_ESCALATION") return "Eliminate elevation or isolate the exact privileged step behind explicit user approval.";
    if (["INSTRUCTION_EVASION", "SECURITY_CONTROL_BYPASS"].includes(code)) return "Remove concealment, authority-override, or security-bypass instructions before installation.";
    if (code === "UNDECLARED_CAPABILITY") return "Disclose every consequential capability in the skill description and least-privilege workflow.";
    if (code === "UNDOCUMENTED_SCRIPT") return "Reference every executable source file from SKILL.md and explain when and why it runs.";
    if (code === "UNPINNED_PACKAGE_EXECUTION") return "Pin every directly executed registry package to an audited immutable version or revision.";
    if (code === "SKILL_SYMLINK" || code === "SKILL_SUBMODULE") return "Vendor or pin reviewed contents inside the skill directory instead of following external indirection.";
    if (code === "ARCHIVED_REPOSITORY") return "Confirm maintainer identity and use a commit-pinned fork before relying on an abandoned skill.";
    return "Repair skill frontmatter and naming before installation.";
  }))];

  return {
    product: "SkillVerdict",
    version: "1.0",
    verdict,
    risk_score: riskScore,
    summary: verdict === "LOW_RISK"
      ? "No high-confidence dangerous behavior was found in the bounded static review; retain least privilege and inspect the cited commit before installation."
      : verdict === "REVIEW"
        ? "The skill has consequential behavior or structural ambiguity that requires manual review before installation."
        : "The skill contains a high-confidence dangerous pattern or accumulated risk that should block installation.",
    service_reuse: SERVICE_REUSE.skill,
    repository: {
      url: input.repositoryUrl,
      full_name: input.fullName,
      archived: input.archived,
      default_branch: input.defaultBranch,
      commit_sha: input.commitSha,
    },
    skill: {
      path: input.skillPath,
      name: metadata.name,
      description: metadata.description,
      files: input.files.map(({ path }) => path).sort(),
    },
    capabilities: {
      declared: [...declared].sort(),
      observed: [...observed].sort(),
      external_domains: externalDomains(combined),
    },
    findings: findings.sort((a, b) => ["critical", "high", "medium", "low", "info"].indexOf(a.severity) - ["critical", "high", "medium", "low", "info"].indexOf(b.severity)),
    recommendations,
    coverage: {
      entries_in_skill: input.scopedEntries.length,
      files_scanned: input.files.length,
      bytes_scanned: input.files.reduce((sum, file) => sum + file.size, 0),
      skipped_binary: input.skippedBinary || 0,
      skipped_oversized: input.skippedOversized || 0,
      selection_truncated: Boolean(input.selectionTruncated),
      github_rate_limit_remaining: input.rateRemaining ?? null,
    },
    checked_at: now.toISOString(),
    limitations: [
      "This static audit never executes the skill and cannot prove that a low-risk result is safe.",
      "Detections favor high-confidence patterns; obfuscated, semantic, dependency, or runtime-only behavior may be missed.",
      "Repository context reduces false positives but maintainer identity, account compromise, and future commits remain outside this snapshot.",
      "At most 30 recognized text files, 128 KiB per file, and 512 KiB total are scanned; coverage discloses omissions.",
    ],
  };
}

type FetchLike = typeof fetch;

function githubHeaders(env: SkillEnvironment): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "SkillVerdict-Agent/1.0",
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

async function githubJson(path: string, env: SkillEnvironment, fetchImpl: FetchLike): Promise<{ data: any; remaining: number | null }> {
  const response = await fetchImpl(`https://api.github.com${path}`, { headers: githubHeaders(env) });
  const value = Number(response.headers.get("x-ratelimit-remaining"));
  const remaining = Number.isFinite(value) ? value : null;
  if (!response.ok) {
    if (response.status === 404) throw new SkillError("GitHub could not find that public repository, commit, or skill.", 404, "SKILL_NOT_FOUND");
    if (response.status === 403 && remaining === 0) throw new SkillError("GitHub API capacity is temporarily exhausted.", 503, "GITHUB_RATE_LIMITED");
    throw new SkillError(`GitHub returned HTTP ${response.status}.`, 502, "GITHUB_UPSTREAM_ERROR");
  }
  return { data: await response.json(), remaining };
}

export async function checkGithubSkill(
  repositoryUrl: string,
  skillPathInput: string,
  env: SkillEnvironment = {},
  fetchImpl: FetchLike = fetch,
  now = new Date(),
): Promise<SkillAudit> {
  const { owner, repo } = parseRepositoryUrl(repositoryUrl);
  const skillPath = normalizeSkillPath(skillPathInput);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const repository = await githubJson(base, env, fetchImpl);
  if (repository.data.private === true) {
    throw new SkillError("GitHub could not find that public repository, commit, or skill.", 404, "SKILL_NOT_FOUND");
  }
  const branch = String(repository.data.default_branch || "");
  const commit = await githubJson(`${base}/commits/${encodeURIComponent(branch)}`, env, fetchImpl);
  const sha = String(commit.data.sha || "");
  const tree = await githubJson(`${base}/git/trees/${encodeURIComponent(sha)}?recursive=1`, env, fetchImpl);
  const entries: SkillTreeEntry[] = (Array.isArray(tree.data.tree) ? tree.data.tree : []).map((item: any) => ({
    path: String(item.path || ""),
    type: String(item.type || ""),
    mode: String(item.mode || ""),
    size: typeof item.size === "number" ? item.size : undefined,
  })).filter(({ path }: SkillTreeEntry) => path);
  if (!entries.some(({ path, type }) => path === skillPath.entry && type === "blob")) {
    throw new SkillError("The requested SKILL.md does not exist on the repository default branch.", 404, "SKILL_NOT_FOUND");
  }
  const selection = selectSkillFiles(entries, skillPath.directory);
  const rawBase = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${sha}`;
  const files = (await Promise.all(selection.selected.map(async (item): Promise<SkillSourceFile | null> => {
    const encoded = item.path.split("/").map(encodeURIComponent).join("/");
    const response = await fetchImpl(`${rawBase}/${encoded}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const body = await response.text();
    return {
      path: item.path,
      body,
      size: new TextEncoder().encode(body).length,
      mode: item.mode,
      html_url: `${repository.data.html_url}/blob/${sha}/${item.path}`,
    };
  }))).filter((file): file is SkillSourceFile => file !== null);
  const remaining = [repository.remaining, commit.remaining, tree.remaining].filter((item): item is number => item !== null);
  return analyzeSkillSnapshot({
    repositoryUrl: String(repository.data.html_url),
    fullName: String(repository.data.full_name),
    archived: Boolean(repository.data.archived),
    defaultBranch: branch,
    commitSha: sha,
    skillPath: skillPath.entry,
    entries,
    scopedEntries: selection.scoped,
    files,
    skippedBinary: selection.skippedBinary,
    skippedOversized: selection.skippedOversized,
    selectionTruncated: Boolean(tree.data.truncated) || selection.truncated || files.length < selection.selected.length,
    rateRemaining: remaining.length ? Math.min(...remaining) : null,
  }, now);
}
