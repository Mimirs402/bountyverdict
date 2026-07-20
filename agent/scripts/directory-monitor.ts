import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { parseSkillsShInstallCounts, PUBLISHED_SKILLS } from "../src/acquisition.ts";

const repository = "https://github.com/cristianmoroaica/bountyverdict";
const agentToolUrl = "https://agenttool.sh/tools/bountyverdict-agent-decision-apis";
const skillsUrl = "https://skills.sh/cristianmoroaica/bountyverdict";
const securityDirectoryPrUrl = "https://github.com/LLMSecurity/awesome-agent-skills-security/pull/38";
const x402DirectoryPrUrl = "https://github.com/xpaysh/awesome-x402/pull/934";
const x402ScoutUrl = "https://x402scout.com/catalog";
const agent402Api = "https://agent402.tools/api";
const productionOrigin = "https://bountyverdict-agent-production.mimirslab.workers.dev";
const x402ScanUrl = "https://www.x402scan.com";
const x402gleHostUrl = "https://x402gle.com/servers/bountyverdict-agent-production.mimirslab.workers.dev";
const monetizeYourAgentApi = "https://monetizeyouragent.fun/api/v1";
const monetizeYourAgentSubmissionId = 234;
const directory402Api = "https://402directory.com/api";
const directory402SubmissionIds = Object.freeze([50, 51, 52, 53, 54, 55, 56]);
const index402Api = "https://402index.io/api/v1/services";
const index402Listings = Object.freeze([
  { product: "single", id: "82c992cc-1a4f-44ea-b742-e798784b6a14", path: "/api/verdict", method: "GET" },
  { product: "portfolio", id: "057ea175-ec64-4c2e-8553-1f747455e6bf", path: "/api/portfolio", method: "POST" },
  { product: "harness", id: "b64d1c67-a5d9-43f1-b226-79886f425f99", path: "/api/harness", method: "GET" },
  { product: "skill", id: "f7ae83f3-cef1-4d9e-ae80-327b07d4f674", path: "/api/skill", method: "GET" },
  { product: "run", id: "19eada5c-4d79-4868-8183-745aab875cbb", path: "/api/run", method: "GET" },
  { product: "flake", id: "2d2fb88a-7402-4d1a-ab66-63d4e9ba1031", path: "/api/flake", method: "GET" },
]);
const x402ScanResources = Object.freeze([
  { url: `${productionOrigin}/api/verdict`, method: "GET" },
  { url: `${productionOrigin}/api/portfolio`, method: "POST" },
  { url: `${productionOrigin}/api/harness`, method: "GET" },
  { url: `${productionOrigin}/api/skill`, method: "GET" },
  { url: `${productionOrigin}/api/run`, method: "GET" },
  { url: `${productionOrigin}/api/flake`, method: "GET" },
  { url: `${productionOrigin}/api/mcp-drift`, method: "POST" },
]);
const x402ScoutIds = Object.freeze([
  "be000191-00e6-41d6-aed5-da35c6123e52",
  "f2ae9481-cfb9-4bbc-bf7c-9c1fb32523e4",
  "dfc4f4e3-b1ea-440d-b9c1-a416296e4fdd",
  "10bf30eb-c3f7-4231-ab23-fc16d02a0e7c",
  "98fed8fa-da74-436d-9fbe-22a500abf298",
]);
const agent402BuyerQueries = Object.freeze([
  { product: "single", path: "/api/verdict", query: "check whether github bounty issue is still open claimed or worth coding" },
  { product: "portfolio", path: "/api/portfolio", query: "compare and rank github bounty issues to choose the best candidate" },
  { product: "harness", path: "/api/harness", query: "audit repository coding agent instructions AGENTS.md CLAUDE.md" },
  { product: "skill", path: "/api/skill", query: "security audit an agent skill before installation" },
  { product: "run", path: "/api/run", query: "diagnose failed github actions workflow run root cause" },
  { product: "flake", path: "/api/flake", query: "decide whether failed github actions run is flaky and should retry" },
  { product: "mcpdrift", path: "/api/mcp-drift", query: "check MCP tools list schema drift compatibility breaking change" },
]);
const skillsShBuyerQueries = Object.freeze([
  { skill: "route-github-agent-checks", query: "route github agent checks" },
  { skill: "audit-agent-harness", query: "audit coding agent repository instructions" },
  { skill: "check-mcp-tool-drift", query: "check MCP tool schema compatibility" },
  { skill: "classify-github-flakes", query: "decide whether github actions failure is flaky" },
  { skill: "diagnose-github-actions", query: "diagnose github actions failure" },
  { skill: "preflight-agent-skills", query: "security audit agent skill before install" },
  { skill: "preflight-github-bounties", query: "check github bounty before coding" },
]);
const stateFile = process.env.DIRECTORY_STATE_FILE || `${homedir()}/.local/state/bountyverdict/directories.json`;
const timeoutMs = 30_000;
const agentSkillRetryMs = 20 * 60 * 60 * 1000;

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function skillsShStatus(): Promise<Record<string, unknown>> {
  try {
    const searchQueries = [
      { type: "branded", skill: null, query: "bountyverdict" },
      ...PUBLISHED_SKILLS.map((skill) => ({ type: "exact", skill, query: skill })),
      ...skillsShBuyerQueries.map(({ skill, query }) => ({ type: "natural", skill, query })),
    ];
    const [response, ...searchResponses] = await Promise.all([
      fetch(skillsUrl, { signal: AbortSignal.timeout(timeoutMs) }),
      ...searchQueries.map(({ query }) => {
        const url = new URL("https://skills.sh/api/search");
        url.searchParams.set("q", query);
        url.searchParams.set("limit", "100");
        url.searchParams.set("owner", "cristianmoroaica");
        return fetch(url, {
          headers: { "User-Agent": "bountyverdict-directory-monitor/1.0" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      }),
    ]);
    const body = await response.text();
    const listed = response.ok && body.includes("bountyverdict") && !body.toLowerCase().includes("not found");
    if (!listed) return { url: skillsUrl, http_status: response.status, listed };
    if (searchResponses.some((searchResponse) => !searchResponse.ok)) {
      throw new Error("skills.sh search returned an unsuccessful response.");
    }
    const searchResults = await Promise.all(searchResponses.map(async (searchResponse, index) => {
      const payload = await searchResponse.json() as Record<string, unknown>;
      if (!Array.isArray(payload.skills) || !Number.isSafeInteger(payload.count)) {
        throw new Error("skills.sh search returned malformed telemetry.");
      }
      const query = searchQueries[index];
      const expectedId = query.skill ? `cristianmoroaica/bountyverdict/${query.skill}` : null;
      const rank = expectedId === null
        ? (payload.skills as Array<Record<string, unknown>>).findIndex(({ source }) => source === "cristianmoroaica/bountyverdict")
        : (payload.skills as Array<Record<string, unknown>>).findIndex(({ id }) => id === expectedId);
      return { ...query, found: rank >= 0, rank: rank >= 0 ? rank + 1 : null, returned_results: payload.skills.length };
    }));
    try {
      const installs = parseSkillsShInstallCounts(body);
      return {
        url: skillsUrl,
        http_status: response.status,
        listed: true,
        total_installs: installs.total,
        install_counts: installs.by_skill,
        search_index: {
          branded_found: searchResults[0].found,
          exact_found: searchResults.filter(({ type, found }) => type === "exact" && found).length,
          exact_expected: PUBLISHED_SKILLS.length,
          natural_found: searchResults.filter(({ type, found }) => type === "natural" && found).length,
          natural_expected: skillsShBuyerQueries.length,
          queries: searchResults,
          measurement: "owner_run_search_corpus_and_retrieval_check_not_impressions_or_purchases",
        },
        measurement: "anonymous_cli_install_telemetry_not_customer_purchases",
      };
    } catch (error) {
      return {
        url: skillsUrl,
        http_status: response.status,
        listed: true,
        measurement: "unavailable",
        measurement_error: error instanceof Error ? error.message : String(error),
      };
    }
  } catch (error) {
    return {
      url: skillsUrl,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function agentToolStatus(): Promise<Record<string, unknown>> {
  const apiUrl = "https://agenttool.sh/api/tools/bountyverdict-agent-decision-apis";
  try {
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(timeoutMs) });
    return {
      url: agentToolUrl,
      api_url: apiUrl,
      http_status: response.status,
      listed: response.ok,
      status: response.ok ? "listed" : response.status === 404 ? "scanning" : "unexpected_response",
    };
  } catch (error) {
    return {
      url: agentToolUrl,
      api_url: apiUrl,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function agent402Status(): Promise<Record<string, unknown>> {
  try {
    const [indexResponse, ...routeResponses] = await Promise.all([
      fetch(`${agent402Api}/index`, {
        headers: { "User-Agent": "bountyverdict-directory-monitor" },
        signal: AbortSignal.timeout(timeoutMs),
      }),
      ...agent402BuyerQueries.map(({ query }) => fetch(`${agent402Api}/route`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "bountyverdict-directory-monitor",
        },
        body: JSON.stringify({ query, top: 25, include: "external" }),
        signal: AbortSignal.timeout(timeoutMs),
      })),
    ]);
    if (!indexResponse.ok) {
      return { url: "https://agent402.tools/marketplace", http_status: indexResponse.status, listed: false, status: "unexpected_response" };
    }
    const index = await indexResponse.json() as {
      totals?: Record<string, unknown>;
      sellers?: Array<Record<string, unknown>>;
    };
    const seller = (index.sellers || []).find((entry) => entry.origin === productionOrigin);
    const queries = await Promise.all(routeResponses.map(async (response, queryIndex) => {
      const expected = agent402BuyerQueries[queryIndex];
      if (!response.ok) {
        return { ...expected, found: false, rank: null, http_status: response.status, status: "unexpected_response" };
      }
      const payload = await response.json() as { results?: Array<Record<string, unknown>> };
      const results = Array.isArray(payload.results) ? payload.results : [];
      const rankIndex = results.findIndex((entry) =>
        entry.seller === productionOrigin && entry.route === expected.path
      );
      const match = rankIndex >= 0 ? results[rankIndex] : null;
      return {
        ...expected,
        found: rankIndex >= 0,
        rank: rankIndex >= 0 ? rankIndex + 1 : null,
        score: match && typeof match.score === "number" ? match.score : null,
        price_usd: match && (typeof match.priceUsd === "number" || typeof match.priceUsd === "string")
          ? match.priceUsd
          : null,
        returned_results: results.length,
      };
    }));
    const foundQueries = queries.filter(({ found }) => found).length;
    const topThreeQueries = queries.filter(({ rank }) => typeof rank === "number" && rank <= 3).length;
    return {
      url: "https://agent402.tools/marketplace",
      api_url: `${agent402Api}/index`,
      http_status: indexResponse.status,
      listed: Boolean(seller),
      status: seller ? "listed" : "missing",
      routable: seller?.routable === true,
      health: typeof seller?.health === "number" ? seller.health : null,
      listing_source: seller?.source || null,
      native_manifest: seller?.source === "manifest",
      observed_tool_count: typeof seller?.toolCount === "number" ? seller.toolCount : null,
      ecosystem_sellers: index.totals?.sellers ?? null,
      query_count: queries.length,
      found_queries: foundQueries,
      top_three_queries: topThreeQueries,
      query_benchmark: queries,
      measurement: "owner_run_unbranded_retrieval_benchmark_not_search_impressions_or_customer_purchases",
    };
  } catch (error) {
    return {
      url: "https://agent402.tools/marketplace",
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function githubPrStatus(
  owner: string,
  repo: string,
  pull: number,
  url: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pull}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "bountyverdict-directory-monitor",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { url, http_status: response.status, status: "unexpected_response" };
    }
    const payload = await response.json() as {
      state?: string;
      merged_at?: string | null;
      draft?: boolean;
      mergeable?: boolean | null;
    };
    return {
      url,
      http_status: response.status,
      status: payload.merged_at ? "merged" : payload.state || "unknown",
      merged_at: payload.merged_at || null,
      draft: payload.draft === true,
      mergeable: payload.mergeable,
    };
  } catch (error) {
    return {
      url,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function x402ScoutStatus(): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`${x402ScoutUrl}?limit=500&offset=0`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { url: x402ScoutUrl, http_status: response.status, listed: false, status: "unexpected_response" };
    }
    const payload = await response.json() as { count?: number; endpoints?: Array<Record<string, unknown>> };
    const expected = new Set(x402ScoutIds);
    const catalog = payload.endpoints || [];
    const entries = catalog
      .map((entry, index) => ({ entry, position: index + 1 }))
      .filter(({ entry }) => expected.has(String(entry.id)))
      .map(({ entry, position }) => ({
        id: entry.id,
        name: entry.name,
        url: entry.url,
        catalog_position: position,
        registered_at: entry.registered_at,
        status: entry.status,
        health_status: entry.health_status,
        uptime_pct: entry.uptime_pct,
        avg_latency_ms: entry.avg_latency_ms,
        query_count: entry.query_count,
        tags: entry.tags,
        capability_tags: entry.capability_tags,
        trust_score: entry.trust_score,
      }));
    const exposedAt = entries
      .map((entry) => String(entry.registered_at || ""))
      .filter((value) => Number.isFinite(Date.parse(value)))
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0] || null;
    const uniqueEntryIds = new Set(entries.map((entry) => String(entry.id)));
    const listed = entries.length === x402ScoutIds.length &&
      uniqueEntryIds.size === x402ScoutIds.length &&
      entries.every((entry) => entry.status === "active");
    const queryCounts = entries.map((entry) =>
      typeof entry.query_count === "number" && Number.isSafeInteger(entry.query_count) && entry.query_count >= 0
        ? entry.query_count
        : null
    );
    const queryTelemetryAvailable = queryCounts.length === x402ScoutIds.length &&
      queryCounts.every((value): value is number => value !== null);
    const skillEntry = entries.find((entry) => entry.id === "dfc4f4e3-b1ea-440d-b9c1-a416296e4fdd");
    const skillQueryCount = skillEntry && typeof skillEntry.query_count === "number" &&
      Number.isSafeInteger(skillEntry.query_count) && skillEntry.query_count >= 0
      ? skillEntry.query_count
      : null;
    const totalQueryCount = queryTelemetryAvailable
      ? queryCounts.reduce((total, value) => total + (value ?? 0), 0)
      : null;
    return {
      url: x402ScoutUrl,
      http_status: response.status,
      listed,
      status: listed ? "listed" : entries.length ? "partial" : "missing",
      exposed_at: exposedAt,
      expected_entries: x402ScoutIds.length,
      listed_entries: entries.length,
      unique_entry_ids: uniqueEntryIds.size,
      catalog_entries: Number(payload.count || catalog.length),
      catalog_positions: entries.map((entry) => entry.catalog_position),
      query_telemetry_available: queryTelemetryAvailable,
      total_query_count: totalQueryCount,
      skillverdict_query_count: skillQueryCount,
      non_target_query_count: totalQueryCount === null || skillQueryCount === null
        ? null
        : totalQueryCount - skillQueryCount,
      entries,
    };
  } catch (error) {
    return {
      url: x402ScoutUrl,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function x402ScanStatus(): Promise<Record<string, unknown>> {
  const input = encodeURIComponent(JSON.stringify({ json: { resources: x402ScanResources } }));
  const apiUrl = `${x402ScanUrl}/api/trpc/public.resources.checkRegistered?input=${input}`;
  try {
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return { url: x402ScanUrl, http_status: response.status, listed: false, status: "unexpected_response" };
    }
    const payload = await response.json() as {
      result?: { data?: { json?: { registered?: unknown; unregistered?: unknown } } };
    };
    const result = payload.result?.data?.json;
    const registered = Array.isArray(result?.registered)
      ? result.registered.filter((value): value is string => typeof value === "string")
      : [];
    const unregistered = Array.isArray(result?.unregistered)
      ? result.unregistered.filter((value): value is string => typeof value === "string")
      : [];
    const expected = new Set(x402ScanResources.map(({ url }) => url));
    const exact = registered.length === expected.size &&
      new Set(registered).size === expected.size && registered.every((url) => expected.has(url));
    return {
      url: `${x402ScanUrl}/resources`,
      api_url: apiUrl,
      http_status: response.status,
      listed: exact,
      status: exact ? "listed" : registered.length ? "partial" : "missing",
      expected_resources: expected.size,
      listed_resources: registered.length,
      registered,
      unregistered,
      measurement: "public_registry_presence_not_customer_purchases",
    };
  } catch (error) {
    return {
      url: x402ScanUrl,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function x402gleStatus(): Promise<Record<string, unknown>> {
  const skillsUrl = `${x402gleHostUrl}/skills.json`;
  try {
    const response = await fetch(skillsUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return { url: x402gleHostUrl, skills_url: skillsUrl, http_status: response.status, listed: false, status: "unexpected_response" };
    }
    const payload = await response.json() as {
      ok?: unknown;
      host?: unknown;
      skill_count?: unknown;
      skills?: Array<Record<string, unknown>>;
    };
    const skills = Array.isArray(payload.skills) ? payload.skills : [];
    const names = skills.map(({ skill_name }) => skill_name).filter((value): value is string => typeof value === "string");
    const valid = payload.ok === true && payload.host === new URL(productionOrigin).host &&
      Number(payload.skill_count) === skills.length && new Set(names).size === names.length;
    if (!valid) throw new Error("x402gle returned malformed or mismatched skill telemetry.");
    return {
      url: x402gleHostUrl,
      skills_url: skillsUrl,
      skill_url: `${x402gleHostUrl}/SKILL.md`,
      agent_card_url: `${x402gleHostUrl}/.well-known/agent.json`,
      http_status: response.status,
      listed: skills.length > 0,
      status: skills.length >= 7 ? "listed" : skills.length ? "listed_partial" : "missing",
      expected_products: 7,
      synthesized_skills: skills.length,
      skill_names: names,
      measurement: "public_agent_skill_listing_not_customer_purchase",
    };
  } catch (error) {
    return {
      url: x402gleHostUrl,
      skills_url: skillsUrl,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function monetizeYourAgentStatus(): Promise<Record<string, unknown>> {
  const apiUrl = `${monetizeYourAgentApi}/entries?limit=250`;
  try {
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return { url: "https://monetizeyouragent.fun/", api_url: apiUrl, http_status: response.status, listed: false, status: "unexpected_response" };
    }
    const payload = await response.json() as { data?: Array<Record<string, unknown>> };
    if (!Array.isArray(payload.data)) throw new Error("Monetize Your Agent returned malformed directory telemetry.");
    const entry = payload.data.find(({ name, url }) =>
      name === "BountyVerdict Agent Decision APIs" && url === productionOrigin
    );
    return {
      url: "https://monetizeyouragent.fun/",
      api_url: apiUrl,
      http_status: response.status,
      listed: Boolean(entry),
      status: entry ? String(entry.status || "listed") : "pending_review",
      submission_id: monetizeYourAgentSubmissionId,
      entry: entry || null,
      measurement: "public_directory_listing_not_customer_purchase",
    };
  } catch (error) {
    return {
      url: "https://monetizeyouragent.fun/",
      api_url: apiUrl,
      listed: false,
      status: "request_failed",
      submission_id: monetizeYourAgentSubmissionId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function directory402Status(): Promise<Record<string, unknown>> {
  const apiUrl = `${directory402Api}/directory`;
  try {
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return { url: "https://www.402directory.com/", api_url: apiUrl, http_status: response.status, listed: false, status: "unexpected_response" };
    }
    const payload = await response.json() as { entries?: Array<Record<string, unknown>> };
    if (!Array.isArray(payload.entries)) throw new Error("402directory returned malformed directory telemetry.");
    const expected = new Set(x402ScanResources.map(({ url }) => url));
    const entries = payload.entries.filter(({ endpoint }) => expected.has(String(endpoint)));
    const exact = entries.length === expected.size && new Set(entries.map(({ endpoint }) => endpoint)).size === expected.size;
    return {
      url: "https://www.402directory.com/",
      api_url: apiUrl,
      http_status: response.status,
      listed: exact,
      status: exact ? "listed" : entries.length ? "partial" : "pending_review",
      expected_endpoints: expected.size,
      listed_endpoints: entries.length,
      submission_ids: directory402SubmissionIds,
      entries,
      measurement: "public_directory_listing_not_customer_purchase",
    };
  } catch (error) {
    return {
      url: "https://www.402directory.com/",
      api_url: apiUrl,
      listed: false,
      status: "request_failed",
      expected_endpoints: x402ScanResources.length,
      submission_ids: directory402SubmissionIds,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function index402Status(): Promise<Record<string, unknown>> {
  try {
    const resources = await Promise.all(index402Listings.map(async ({ product, id, path, method }) => {
      const response = await fetch(`${index402Api}/${id}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`402 Index ${product} returned HTTP ${response.status}.`);
      const entry = await response.json() as Record<string, unknown>;
      const expected = x402ScanResources.find((resource) => resource.url === `${productionOrigin}${path}`);
      if (!expected || expected.method !== method || entry.id !== id || entry.url !== expected.url || entry.protocol !== "x402" ||
        entry.payment_network !== "eip155:8453" || entry.http_method !== method) {
        throw new Error(`402 Index ${product} contract telemetry drifted.`);
      }
      return {
        product,
        id,
        url: `https://402index.io/service/${id}`,
        status: entry.status,
        health_status: entry.health_status,
        probe_status: entry.probe_status,
        provider_display: entry.provider,
      };
    }));
    const active = resources.filter(({ status, health_status, probe_status }) =>
      status === "active" && health_status === "healthy" && probe_status === "probeable"
    );
    return {
      url: "https://402index.io/",
      listed: active.length === index402Listings.length,
      status: active.length === index402Listings.length ? "listed" : active.length ? "partial" : "unavailable",
      expected_resources: index402Listings.length,
      active_resources: active.length,
      missing_product: "mcpdrift",
      resources,
      measurement: "public_directory_listing_not_customer_purchase",
    };
  } catch (error) {
    return {
      url: "https://402index.io/",
      listed: false,
      status: "request_failed",
      expected_resources: index402Listings.length,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function submitAgentSkill(): Promise<Record<string, unknown>> {
  try {
    const response = await fetch("https://agentskill.sh/api/skills/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: repository }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json() as {
      success?: boolean;
      data?: { summary?: { found?: number; imported?: number; updated?: number; failed?: number } };
    };
    const summary = payload.data?.summary || {};
    const listed = response.ok && payload.success === true && summary.found === 7 && summary.failed === 0;
    return {
      url: "https://agentskill.sh/submit",
      attempted_at: new Date().toISOString(),
      http_status: response.status,
      listed,
      status: listed ? "accepted" : "upstream_blocked",
      summary,
    };
  } catch (error) {
    return {
      url: "https://agentskill.sh/submit",
      attempted_at: new Date().toISOString(),
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

let previous: Record<string, any> = {};
try {
  previous = JSON.parse(await readFile(stateFile, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const [
  skills,
  agenttool,
  securityDirectoryPr,
  x402DirectoryPr,
  agent402,
  x402scout,
  x402scan,
  x402gle,
  monetizeYourAgent,
  directory402,
  index402,
] = await Promise.all([
  skillsShStatus(),
  agentToolStatus(),
  githubPrStatus("LLMSecurity", "awesome-agent-skills-security", 38, securityDirectoryPrUrl),
  githubPrStatus("xpaysh", "awesome-x402", 934, x402DirectoryPrUrl),
  agent402Status(),
  x402ScoutStatus(),
  x402ScanStatus(),
  x402gleStatus(),
  monetizeYourAgentStatus(),
  directory402Status(),
  index402Status(),
]);
if (Number(x402scan.listed_resources || 0) > 0) {
  x402scan.exposed_at = previous.x402scan?.exposed_at || new Date().toISOString();
}
const previousAttempt = Date.parse(String(previous.agentskill?.attempted_at || previous.checked_at || ""));
const agentSkillRetryDue = !Number.isFinite(previousAttempt) || Date.now() - previousAttempt >= agentSkillRetryMs;
const agentskill = previous.agentskill?.listed === true
  ? previous.agentskill
  : agentSkillRetryDue
    ? await submitAgentSkill()
    : {
        ...previous.agentskill,
        retry_deferred: true,
        retry_after: new Date(previousAttempt + agentSkillRetryMs).toISOString(),
      };
const state = {
  checked_at: new Date().toISOString(),
  repository,
  skills_sh: skills,
  agenttool,
  agentskill,
  security_directory_pr: securityDirectoryPr,
  x402_directory_pr: x402DirectoryPr,
  agent402,
  x402scout,
  x402scan,
  x402gle,
  monetize_your_agent: monetizeYourAgent,
  directory_402: directory402,
  index_402: index402,
};
await atomicWrite(stateFile, `${JSON.stringify(state, null, 2)}\n`);
console.log(JSON.stringify(state, null, 2));
