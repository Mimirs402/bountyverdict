import test from "node:test";
import assert from "node:assert/strict";
import {
  HarnessError,
  analyzeHarnessSnapshot,
  checkGithubHarness,
  parseRepositoryUrl,
  selectHarnessFiles,
  type HarnessDocument,
  type TreeEntry,
} from "../src/harness.ts";

const commit = "0123456789abcdef0123456789abcdef01234567";

function document(path: string, body: string): HarnessDocument {
  return {
    path,
    body,
    size: new TextEncoder().encode(body).length,
    html_url: `https://github.com/acme/widget/blob/${commit}/${path}`,
  };
}

test("accepts only canonical public GitHub repository URLs", () => {
  assert.deepEqual(parseRepositoryUrl("https://github.com/acme/widget.git"), { owner: "acme", repo: "widget" });
  for (const value of [
    "http://github.com/acme/widget",
    "https://github.com/acme/widget/issues/1",
    "https://gitlab.com/acme/widget",
    "https://github.com/acme/widget?tab=readme",
  ]) {
    assert.throws(
      () => parseRepositoryUrl(value),
      (error: unknown) => error instanceof HarnessError && error.code === "INVALID_REPOSITORY_URL",
    );
  }
});

test("selects recognized instruction surfaces in bounded priority order", () => {
  const entries: TreeEntry[] = [
    { path: "src/index.ts", type: "blob", size: 10 },
    { path: ".agents/skills/release/SKILL.md", type: "blob", size: 40 },
    { path: "services/api/AGENTS.md", type: "blob", size: 30 },
    { path: "AGENTS.md", type: "blob", size: 20 },
    { path: "CLAUDE.md", type: "blob", size: 20 },
  ];
  const result = selectHarnessFiles(entries);
  assert.deepEqual(result.selected.map(({ path }) => path), [
    "AGENTS.md",
    "CLAUDE.md",
    "services/api/AGENTS.md",
    ".agents/skills/release/SKILL.md",
  ]);
  assert.equal(result.truncated, false);
});

test("returns READY for a compact portable instruction stack", () => {
  const entries: TreeEntry[] = [
    { path: "AGENTS.md", type: "blob" },
    { path: "CLAUDE.md", type: "blob" },
    { path: "docs/release.md", type: "blob" },
    { path: ".agents/skills/release/SKILL.md", type: "blob" },
  ];
  const audit = analyzeHarnessSnapshot({
    repositoryUrl: "https://github.com/acme/widget",
    fullName: "acme/widget",
    defaultBranch: "main",
    commitSha: commit,
    entries,
    documents: [
      document("AGENTS.md", "Run `npm test`. Read `docs/release.md` before deployment."),
      document("CLAUDE.md", "@AGENTS.md"),
      document(".agents/skills/release/SKILL.md", "---\nname: release\ndescription: Safely release this service.\n---\n\nFollow the release checklist."),
    ],
  }, new Date("2026-07-20T12:00:00Z"));

  assert.equal(audit.verdict, "READY");
  assert.equal(audit.score, 100);
  assert.equal(audit.repository.commit_sha, commit);
  assert.equal(audit.portability.codex, true);
  assert.equal(audit.portability.claude_code, true);
  assert.equal(audit.surfaces.skill_files_scanned, 1);
  assert.deepEqual(audit.findings, []);
});

test("fails closed on secret-like material and reports stale paths without leaking the secret", () => {
  const secret = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";
  const body = `Use \`docs/missing.md\`.\nLocal: \`/home/alice/project/config\`\nToken: ${secret}`;
  const audit = analyzeHarnessSnapshot({
    repositoryUrl: "https://github.com/acme/widget",
    fullName: "acme/widget",
    defaultBranch: "main",
    commitSha: commit,
    entries: [{ path: "AGENTS.md", type: "blob" }],
    documents: [document("AGENTS.md", body)],
  });

  assert.equal(audit.verdict, "REPAIR");
  assert.ok(audit.findings.some(({ code }) => code === "SECRET_LIKE_MATERIAL"));
  assert.ok(audit.findings.some(({ code }) => code === "STALE_PATH_REFERENCE"));
  assert.ok(audit.findings.some(({ code }) => code === "MACHINE_LOCAL_PATH"));
  assert.doesNotMatch(JSON.stringify(audit), new RegExp(secret));
});

test("remote audit pins the result to the fetched commit", async () => {
  const mock = (async (input: URL | RequestInfo) => {
    const url = String(input);
    const headers = { "x-ratelimit-remaining": "4997" };
    if (url.endsWith("/repos/acme/widget")) {
      return Response.json({ default_branch: "main", full_name: "acme/widget", html_url: "https://github.com/acme/widget" }, { headers });
    }
    if (url.endsWith("/repos/acme/widget/commits/main")) return Response.json({ sha: commit }, { headers });
    if (url.includes(`/repos/acme/widget/git/trees/${commit}?recursive=1`)) {
      return Response.json({ truncated: false, tree: [{ path: "AGENTS.md", type: "blob", size: 28 }] }, { headers });
    }
    if (url.includes(`raw.githubusercontent.com/acme/widget/${commit}/AGENTS.md`)) {
      return new Response("Run tests before finishing.");
    }
    return Response.json({ message: "not found" }, { status: 404, headers });
  }) as typeof fetch;

  const audit = await checkGithubHarness(
    "https://github.com/acme/widget",
    {},
    mock,
    new Date("2026-07-20T12:00:00Z"),
  );
  assert.equal(audit.repository.commit_sha, commit);
  assert.equal(audit.coverage.github_rate_limit_remaining, 4997);
  assert.equal(audit.surfaces.instruction_files_scanned, 1);
});

test("remote audit retries one transient raw-document failure", async () => {
  let rawAttempts = 0;
  const mock = (async (input: URL | RequestInfo) => {
    const url = String(input);
    const headers = { "x-ratelimit-remaining": "4997" };
    if (url.endsWith("/repos/acme/widget")) {
      return Response.json({ default_branch: "main", full_name: "acme/widget", html_url: "https://github.com/acme/widget" }, { headers });
    }
    if (url.endsWith("/repos/acme/widget/commits/main")) return Response.json({ sha: commit }, { headers });
    if (url.includes(`/repos/acme/widget/git/trees/${commit}?recursive=1`)) {
      return Response.json({ truncated: false, tree: [{ path: "AGENTS.md", type: "blob", size: 28 }] }, { headers });
    }
    if (url.includes(`raw.githubusercontent.com/acme/widget/${commit}/AGENTS.md`)) {
      rawAttempts += 1;
      if (rawAttempts === 1) throw new TypeError("transient connection reset");
      return new Response("Run tests before finishing.");
    }
    return Response.json({ message: "not found" }, { status: 404, headers });
  }) as typeof fetch;

  const audit = await checkGithubHarness("https://github.com/acme/widget", {}, mock);
  assert.equal(rawAttempts, 2);
  assert.equal(audit.coverage.files_scanned, 1);
});

test("remote audit reports a bounded upstream error after two raw-document failures", async () => {
  let rawAttempts = 0;
  const mock = (async (input: URL | RequestInfo) => {
    const url = String(input);
    const headers = { "x-ratelimit-remaining": "4997" };
    if (url.endsWith("/repos/acme/widget")) {
      return Response.json({ default_branch: "main", full_name: "acme/widget", html_url: "https://github.com/acme/widget" }, { headers });
    }
    if (url.endsWith("/repos/acme/widget/commits/main")) return Response.json({ sha: commit }, { headers });
    if (url.includes(`/repos/acme/widget/git/trees/${commit}?recursive=1`)) {
      return Response.json({ truncated: false, tree: [{ path: "AGENTS.md", type: "blob", size: 28 }] }, { headers });
    }
    if (url.includes(`raw.githubusercontent.com/acme/widget/${commit}/AGENTS.md`)) {
      rawAttempts += 1;
      throw new TypeError("connection reset");
    }
    return Response.json({ message: "not found" }, { status: 404, headers });
  }) as typeof fetch;

  await assert.rejects(
    () => checkGithubHarness("https://github.com/acme/widget", {}, mock),
    (error: unknown) => error instanceof HarnessError && error.code === "GITHUB_UPSTREAM_ERROR" && error.status === 502,
  );
  assert.equal(rawAttempts, 2);
});

test("does not expose private harness files through a server credential", async () => {
  const mock = (async (input: URL | RequestInfo) => {
    const url = String(input);
    if (url.endsWith("/repos/acme/widget")) return Response.json({ private: true });
    throw new Error(`Unexpected private-repository follow-up request: ${url}`);
  }) as typeof fetch;

  await assert.rejects(
    () => checkGithubHarness("https://github.com/acme/widget", { GITHUB_TOKEN: "server-token" }, mock),
    (error: unknown) => error instanceof HarnessError && error.code === "REPOSITORY_NOT_FOUND" && error.status === 404,
  );
});
