import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { addHttpMethod } from "./bazaar.ts";
import { SERVICE_REUSE, serviceReuseSchema } from "./reuse.ts";

export const BOUNTY_DISCOVERY_DESCRIPTION =
  "GitHub bounty eligibility, reward provenance, and claimability preflight for one public issue. Checks canonical open or deleted state, whether already assigned or claimed, soft locks, trusted bounty-app competition, referenced BountyHub pledge funding, withdrawn or unverified rewards, linked and failed PRs, attempt crowding, and repository AI-use rules. Returns AVOID, CAUTION, or VIABLE with public evidence, newest bounded evidence windows, and explicit truncation.";

export const exampleVerdict = {
  product: "BountyVerdict",
  version: "1.0",
  verdict: "AVOID",
  score: 0,
  summary: "A public hard stop or severe risk signal makes this issue an unsafe bounty target.",
  service_reuse: SERVICE_REUSE.single,
  issue: {
    url: "https://github.com/typeorm/typeorm/issues/3357",
    submitted_url: "https://github.com/typeorm/typeorm/issues/3357",
    transferred: false,
    title: "Migration generation drops and creates columns instead of altering resulting in data loss",
    state: "open",
    repository: "typeorm/typeorm",
  },
  signals: [
    {
      label: "Issue is already assigned",
      impact: -70,
      detail: "GitHub currently lists 1 assignee; treat the work as unavailable unless a maintainer explicitly clears parallel work.",
      evidence_url: "https://github.com/typeorm/typeorm/issues/3357",
      hard_stop: true,
    },
    {
      label: "Reward withdrawal signal",
      impact: -70,
      detail: "The discussion contains language indicating that a bounty or reward was removed, withdrawn, or cancelled.",
      evidence_url: "https://github.com/typeorm/typeorm/issues/3357#issuecomment-3845555437",
      hard_stop: true,
    },
    {
      label: "Maintainer rejection signal",
      impact: -60,
      detail: "A maintainer comment contains an explicit rejection, spam, or low-quality-contribution warning.",
      evidence_url: "https://github.com/typeorm/typeorm/issues/3357#issuecomment-4638034647",
      hard_stop: true,
    },
    {
      label: "Discussion is locked",
      impact: -55,
      detail: "The issue is locked for resolved.",
      evidence_url: "https://github.com/typeorm/typeorm/issues/3357",
      hard_stop: true,
    },
    {
      label: "Competing open PR",
      impact: -50,
      detail: "2 linked pull requests are still open.",
      evidence_url: "https://github.com/typeorm/typeorm/pull/11620",
      hard_stop: false,
    },
    {
      label: "Closed-PR swarm",
      impact: -35,
      detail: "35 linked pull requests were closed without merging.",
      evidence_url: "https://github.com/typeorm/typeorm/pull/4461",
      hard_stop: false,
    },
    {
      label: "Attempt swarm",
      impact: -12,
      detail: "4 distinct users posted try, attempt, or claim commands.",
      evidence_url: null,
      hard_stop: false,
    },
    {
      label: "Repository is active",
      impact: 10,
      detail: "The repository was pushed to 1 day ago.",
      evidence_url: "https://github.com/typeorm/typeorm",
      hard_stop: false,
    },
    {
      label: "Issue is open",
      impact: 15,
      detail: "GitHub currently reports this issue as open.",
      evidence_url: "https://github.com/typeorm/typeorm/issues/3357",
      hard_stop: false,
    },
  ],
  contribution_policy: {
    ai_use: "NO_EXPLICIT_RULE_FOUND",
    documents: [
      {
        path: "CONTRIBUTING.md",
        url: "https://github.com/typeorm/typeorm/blob/master/CONTRIBUTING.md",
      },
    ],
  },
  reward: {
    state: "WITHDRAWN",
    verification: "NONE",
    platform: null,
    amount: null,
    currency: null,
    evidence_url: "https://github.com/typeorm/typeorm/issues/3357#issuecomment-3845555437",
  },
  coverage: {
    comments_scanned: 96,
    comments_total: 96,
    comment_pages_scanned: 1,
    comments_truncated: false,
    timeline_events_scanned: 205,
    timeline_events_total: 205,
    timeline_pages_scanned: 3,
    timeline_truncated: false,
    linked_pull_requests_found: 37,
    policy_documents_scanned: 1,
    github_rate_limit_remaining: 38,
  },
  checked_at: "2026-07-21T20:19:51.393Z",
  limitations: [
    "A VIABLE verdict is permission to investigate, not a payout guarantee.",
    "Confirm current reward terms, payout eligibility, contribution policy, and acceptance criteria before coding.",
    "A trusted platform record proves platform-reported listing or funding state, not acceptance, merge, or payout.",
    "A marketplace listing can outlive its GitHub issue; deleted issues fail with ISSUE_DELETED instead of receiving a verdict.",
    "The check reads the first comment page plus up to two newest comment pages, and up to four bounded timeline pages; coverage reports any truncation.",
    "AI-policy detection checks four conventional contribution-document paths and may not find policies stored elsewhere.",
  ],
};

export const outputSchema = {
  properties: {
    product: { type: "string", const: "BountyVerdict" },
    version: { type: "string" },
    verdict: { type: "string", enum: ["AVOID", "CAUTION", "VIABLE"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    summary: { type: "string" },
    service_reuse: serviceReuseSchema,
    issue: {
      type: "object",
      properties: {
        url: { type: "string" },
        submitted_url: { type: "string" },
        transferred: { type: "boolean" },
        title: { type: "string" },
        state: { type: "string" },
        repository: { type: "string" },
      },
      required: ["url", "submitted_url", "transferred", "title", "state", "repository"],
    },
    signals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          impact: { type: "integer" },
          detail: { type: "string" },
          evidence_url: { type: ["string", "null"] },
          hard_stop: { type: "boolean" },
        },
        required: ["label", "impact", "detail", "evidence_url", "hard_stop"],
      },
    },
    contribution_policy: {
      type: "object",
      properties: {
        ai_use: {
          type: "string",
          enum: ["BLOCKED", "DISCLOSURE_REQUIRED", "NO_EXPLICIT_RULE_FOUND"],
        },
        documents: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              url: { type: "string" },
            },
            required: ["path", "url"],
          },
        },
      },
      required: ["ai_use", "documents"],
    },
    reward: {
      type: "object",
      properties: {
        state: { type: "string", enum: ["LISTED", "PROMISED", "UNVERIFIED", "NOT_FOUND", "WITHDRAWN", "PAID_OR_AWARDED"] },
        verification: { type: "string", enum: ["TRUSTED_PLATFORM_APP", "TRUSTED_PLATFORM_API", "MAINTAINER_STATEMENT", "UNVERIFIED", "NONE"] },
        platform: { type: ["string", "null"] },
        amount: { type: ["number", "null"], minimum: 0 },
        currency: { type: ["string", "null"] },
        evidence_url: { type: ["string", "null"] },
      },
      required: ["state", "verification", "platform", "amount", "currency", "evidence_url"],
    },
    coverage: {
      type: "object",
      properties: {
        comments_scanned: { type: "integer", minimum: 0 },
        comments_total: { type: "integer", minimum: 0 },
        comment_pages_scanned: { type: "integer", minimum: 1, maximum: 3 },
        comments_truncated: { type: "boolean" },
        timeline_events_scanned: { type: "integer", minimum: 0 },
        timeline_events_total: { type: "integer", minimum: 0 },
        timeline_pages_scanned: { type: "integer", minimum: 1, maximum: 4 },
        timeline_truncated: { type: "boolean" },
        linked_pull_requests_found: { type: "integer", minimum: 0 },
        policy_documents_scanned: { type: "integer", minimum: 0 },
        github_rate_limit_remaining: { type: ["integer", "null"] },
      },
      required: [
        "comments_scanned",
        "comments_total",
        "comment_pages_scanned",
        "comments_truncated",
        "timeline_events_scanned",
        "timeline_events_total",
        "timeline_pages_scanned",
        "timeline_truncated",
        "linked_pull_requests_found",
        "policy_documents_scanned",
        "github_rate_limit_remaining",
      ],
    },
    checked_at: { type: "string" },
    limitations: { type: "array", items: { type: "string" } },
  },
  required: [
    "product",
    "version",
    "verdict",
    "score",
    "summary",
    "service_reuse",
    "issue",
    "signals",
    "contribution_policy",
    "reward",
    "coverage",
    "checked_at",
    "limitations",
  ],
};

export const discoveryExtension = addHttpMethod(declareDiscoveryExtension({
  input: {
    issue_url: "https://github.com/typeorm/typeorm/issues/3357",
  },
  inputSchema: {
    properties: {
      issue_url: {
        type: "string",
        pattern: "^https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/issues/[1-9][0-9]*$",
        description: "Canonical URL of a public GitHub issue to preflight before an agent starts work.",
      },
    },
    required: ["issue_url"],
    additionalProperties: false,
  },
  output: {
    example: exampleVerdict,
    schema: outputSchema,
  },
  bodyType: "json",
}), "POST");

const portfolioAssignedVerdict = {
  product: "BountyVerdict",
  version: "1.0",
  verdict: "AVOID",
  score: 0,
  summary: "A public hard stop or severe risk signal makes this issue an unsafe bounty target.",
  service_reuse: SERVICE_REUSE.single,
  issue: {
    url: "https://github.com/tenstorrent/tt-metal/issues/50522",
    submitted_url: "https://github.com/tenstorrent/tt-metal/issues/50522",
    transferred: false,
    title: "[Bounty $1500] ModernBERT bring up using TTNN APIs",
    state: "open",
    repository: "tenstorrent/tt-metal",
  },
  signals: [
    {
      label: "Issue is already assigned",
      impact: -70,
      detail: "GitHub currently lists 1 assignee; treat the work as unavailable unless a maintainer explicitly clears parallel work.",
      evidence_url: "https://github.com/tenstorrent/tt-metal/issues/50522",
      hard_stop: true,
    },
    {
      label: "Issue is current",
      impact: 8,
      detail: "The issue changed 0 days ago.",
      evidence_url: "https://github.com/tenstorrent/tt-metal/issues/50522",
      hard_stop: false,
    },
    {
      label: "Reward is unverified",
      impact: -25,
      detail: "The issue advertises a bounty or reward without a trusted platform record or maintainer-authored payment statement.",
      evidence_url: "https://github.com/tenstorrent/tt-metal/issues/50522",
      hard_stop: false,
    },
    {
      label: "Repository is active",
      impact: 10,
      detail: "The repository was pushed to 0 days ago.",
      evidence_url: "https://github.com/tenstorrent/tt-metal",
      hard_stop: false,
    },
    {
      label: "No linked open PR found",
      impact: 10,
      detail: "No open pull request appeared in the complete scanned timeline.",
      evidence_url: null,
      hard_stop: false,
    },
    {
      label: "Issue is open",
      impact: 15,
      detail: "GitHub currently reports this issue as open.",
      evidence_url: "https://github.com/tenstorrent/tt-metal/issues/50522",
      hard_stop: false,
    },
  ],
  contribution_policy: {
    ai_use: "NO_EXPLICIT_RULE_FOUND",
    documents: [
      {
        path: "CONTRIBUTING.md",
        url: "https://github.com/tenstorrent/tt-metal/blob/main/CONTRIBUTING.md",
      },
      {
        path: ".github/pull_request_template.md",
        url: "https://github.com/tenstorrent/tt-metal/blob/main/.github/pull_request_template.md",
      },
    ],
  },
  reward: {
    state: "UNVERIFIED",
    verification: "UNVERIFIED",
    platform: null,
    amount: 1500,
    currency: "USD",
    evidence_url: "https://github.com/tenstorrent/tt-metal/issues/50522",
  },
  coverage: {
    comments_scanned: 3,
    comments_total: 3,
    comment_pages_scanned: 1,
    comments_truncated: false,
    timeline_events_scanned: 19,
    timeline_events_total: 19,
    timeline_pages_scanned: 1,
    timeline_truncated: false,
    linked_pull_requests_found: 0,
    policy_documents_scanned: 2,
    github_rate_limit_remaining: 40,
  },
  checked_at: "2026-07-21T20:19:51.393Z",
  limitations: [
    "A VIABLE verdict is permission to investigate, not a payout guarantee.",
    "Confirm current reward terms, payout eligibility, contribution policy, and acceptance criteria before coding.",
    "A trusted platform record proves platform-reported listing or funding state, not acceptance, merge, or payout.",
    "A marketplace listing can outlive its GitHub issue; deleted issues fail with ISSUE_DELETED instead of receiving a verdict.",
    "The check reads the first comment page plus up to two newest comment pages, and up to four bounded timeline pages; coverage reports any truncation.",
    "AI-policy detection checks four conventional contribution-document paths and may not find policies stored elsewhere.",
  ],
};

export const portfolioExample = {
  product: "BountyVerdict Portfolio",
  version: "1.0",
  recommendation: "Do not start any submitted bounty; every successfully checked candidate ranked AVOID.",
  service_reuse: SERVICE_REUSE.portfolio,
  best_candidate: null,
  counts: { submitted: 2, checked: 2, viable: 0, caution: 0, avoid: 2, failed: 0 },
  ranked: [portfolioAssignedVerdict, exampleVerdict],
  failures: [],
  checked_at: "2026-07-21T20:19:51.393Z",
};

// Keep the Bazaar example representative but compact. PAYMENT-REQUIRED is a
// single HTTP header, so embedding the full two-verdict public sample can make
// standard Node clients reject the response before an agent can pay. The full
// evidence-rich example remains available at /api/portfolio/sample.
export const portfolioDiscoveryExample = {
  product: "BountyVerdict Portfolio",
  version: "1.0",
  recommendation: "Do not start the checked candidate; one other issue could not be checked.",
  service_reuse: SERVICE_REUSE.portfolio,
  best_candidate: null,
  counts: { submitted: 2, checked: 1, viable: 0, caution: 0, avoid: 1, failed: 1 },
  ranked: [{
    product: "BountyVerdict",
    version: "1.0",
    verdict: "AVOID",
    score: 0,
    summary: "The issue is already assigned and its reward was withdrawn.",
    service_reuse: SERVICE_REUSE.single,
    issue: {
      url: "https://github.com/typeorm/typeorm/issues/3357",
      submitted_url: "https://github.com/typeorm/typeorm/issues/3357",
      transferred: false,
      title: "Migration generation drops and creates columns instead of altering resulting in data loss",
      state: "open",
      repository: "typeorm/typeorm",
    },
    signals: [{
      label: "Issue is already assigned",
      impact: -70,
      detail: "GitHub lists an assignee.",
      evidence_url: "https://github.com/typeorm/typeorm/issues/3357",
      hard_stop: true,
    }],
    contribution_policy: { ai_use: "NO_EXPLICIT_RULE_FOUND", documents: [] },
    reward: {
      state: "WITHDRAWN",
      verification: "NONE",
      platform: null,
      amount: null,
      currency: null,
      evidence_url: "https://github.com/typeorm/typeorm/issues/3357#issuecomment-3845555437",
    },
    coverage: {
      comments_scanned: 96,
      comments_total: 96,
      comment_pages_scanned: 1,
      comments_truncated: false,
      timeline_events_scanned: 205,
      timeline_events_total: 205,
      timeline_pages_scanned: 3,
      timeline_truncated: false,
      linked_pull_requests_found: 37,
      policy_documents_scanned: 1,
      github_rate_limit_remaining: 38,
    },
    checked_at: "2026-07-21T20:19:51.393Z",
    limitations: ["Confirm current reward terms and contribution policy before coding."],
  }],
  failures: [{
    issue_url: "https://github.com/acme/widget/issues/12",
    error: { code: "ISSUE_NOT_FOUND", message: "The issue could not be checked." },
  }],
  checked_at: "2026-07-21T20:19:51.393Z",
};

export const portfolioOutputSchema = {
  properties: {
    product: { type: "string", const: "BountyVerdict Portfolio" },
    version: { type: "string" },
    recommendation: { type: "string" },
    service_reuse: serviceReuseSchema,
    best_candidate: { type: ["string", "null"] },
    counts: {
      type: "object",
      properties: {
        submitted: { type: "integer", minimum: 2, maximum: 10 },
        checked: { type: "integer", minimum: 1, maximum: 10 },
        viable: { type: "integer", minimum: 0 },
        caution: { type: "integer", minimum: 0 },
        avoid: { type: "integer", minimum: 0 },
        failed: { type: "integer", minimum: 0 },
      },
      required: ["submitted", "checked", "viable", "caution", "avoid", "failed"],
    },
    ranked: {
      type: "array",
      minItems: 1,
      items: { type: "object", ...outputSchema },
    },
    failures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          issue_url: { type: "string" },
          error: {
            type: "object",
            properties: { code: { type: "string" }, message: { type: "string" } },
            required: ["code", "message"],
          },
        },
        required: ["issue_url", "error"],
      },
    },
    checked_at: { type: "string" },
  },
  required: [
    "product",
    "version",
    "recommendation",
    "service_reuse",
    "best_candidate",
    "counts",
    "ranked",
    "failures",
    "checked_at",
  ],
};

export const portfolioDiscoveryExtension = addHttpMethod(declareDiscoveryExtension({
  bodyType: "json",
  input: {
    issue_urls: [
      "https://github.com/acme/widget/issues/12",
      "https://github.com/typeorm/typeorm/issues/3357",
    ],
  },
  inputSchema: {
    properties: {
      issue_urls: {
        type: "array",
        minItems: 2,
        maxItems: 10,
        uniqueItems: true,
        description: "Two to ten canonical public GitHub issue URLs to compare and rank.",
        items: {
          type: "string",
          pattern: "^https://github\\.com/[^/]+/[^/]+/issues/[0-9]+([?#].*)?$",
        },
      },
    },
    required: ["issue_urls"],
    additionalProperties: false,
  },
  output: {
    example: portfolioDiscoveryExample,
    schema: portfolioOutputSchema,
  },
}), "POST");
