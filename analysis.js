const MAINTAINER_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const TRUSTED_BOUNTY_APPS = new Set(["algora-pbc"]);
const TRUSTED_OPIRE_APP = "opirebot";

const NEGATIVE_MAINTAINER_PATTERNS = [
  /ai[ -]slop/i,
  /low[ -]quality ai/i,
  /not interested/i,
  /won['’]?t (?:be )?review/i,
  /will (?:not|never) (?:be )?review/i,
  /will be closed/i,
  /do not (?:work|submit|open)/i,
  /don['’]?t (?:work|submit|open)/i,
  /stop (?:working|submitting)/i,
  /refrain from (?:submitting|opening).{0,30}(?:additional|new|further)?\s*(?:prs?|pull requests?)/i,
  /bounty hunters?.*(?:noise|slop|spam)/i
];

const WITHDRAWAL_PATTERNS = [
  /remov(?:e|ed|ing).{0,40}(?:reward|bounty)/i,
  /(?:reward|bounty).{0,40}remov(?:e|ed|ing)/i,
  /withdraw(?:n|ing)?.{0,40}(?:reward|bounty)/i,
  /(?:reward|bounty).{0,40}withdraw(?:n|ing)?/i,
  /no longer.{0,40}(?:reward|bounty)/i,
  /cancel(?:led|ing)?.{0,40}(?:reward|bounty)/i,
  /(?:reward|bounty).{0,40}(?:will not|won['’]?t|cannot|can['’]?t) be paid/i,
  /(?:will not|won['’]?t|cannot|can['’]?t) pay.{0,40}(?:reward|bounty)/i,
  /(?:reward|bounty).{0,40}(?:is not|isn['’]?t) (?:valid|funded|available)/i,
  /(?:reward|bounty).{0,60}(?:is not|isn['’]?t|not) (?:our|ours|authorized|approved)/i,
  /(?:reward|bounty).{0,80}(?:do not|don['’]?t|cannot|can['’]?t) (?:authorize|approve)/i,
  /(?:do not|don['’]?t|cannot|can['’]?t) (?:authorize|approve).{0,80}(?:reward|bounty)/i,
  /(?:will not|won['’]?t|cannot|can['’]?t|do not|don['’]?t) (?:restore|reinstate|reactivate).{0,60}(?:reward|bounty)/i,
  /(?:discussed|considered).{0,40}(?:restoring|reinstating|reactivating).{0,60}(?:reward|bounty).{0,50}(?:decided not|declined|not approved)/i,
  /(?:reward|bounty).{0,60}(?:has|is|was) not (?:been )?(?:restored|reinstated|reactivated)/i,
  /(?:reward|bounty).{0,80}(?:withdrew|withdraws?).{0,30}\bit\b/i,
  /(?:reward|bounty)[\s\S]{0,180}\b(?:but|then|later)\b[\s\S]{0,60}(?:(?:cancelled|canceled|removed|withdrew)\s+it|decided to (?:cancel|remove|withdraw)\s+it)/i,
  /(?:reward|bounty)[\s\S]{0,180}\b(?:but|then|later)\b[\s\S]{0,60}\bit\s+(?:is|was|remains?)\s+no longer\s+(?:available|funded|payable)/i,
];

const REWARD_PLATFORM_REJECTION_PATTERNS = [
  /cannot create (?:a )?reward/i,
  /could not create (?:a )?reward/i,
  /unable to create (?:a )?reward/i,
  /reward.{0,40}(?:must|needs?) to be at least/i,
];

const REWARD_DENIAL_PATTERNS = [
  ...WITHDRAWAL_PATTERNS,
  /(?:reward|bounty).{0,40}(?:not|never) (?:real|payable|available)/i,
  /(?:not|never) (?:a )?(?:real )?(?:reward|bounty)/i,
];

const REWARD_RESTORATION_PATTERNS = [
  /\b(?:we|maintainers?|the team)\s+(?:have\s+)?(?:now\s+)?(?:restored|reinstated|reactivated)\s+(?:the|this|our|it)\b/i,
  /\b(?:but|and)\s+(?:we\s+)?(?:have\s+)?(?:now\s+)?(?:restored|reinstated|reactivated)\s+(?:the|this|our|it)\b/i,
  /\b(?:the\s+)?(?:reward|bounty)\s+(?:has been|is|was)\s+(?:now\s+)?(?:restored|reinstated|reactivated)\b/i,
];

const AI_POLICY_BLOCK_PATTERNS = [
  /(?:we\s+)?(?:do not|don['’]?t|must not|may not)\s+(?:accept|allow|use|submit).{0,80}(?:ai|llm|chatgpt|generative)/i,
  /(?:ai|llm|chatgpt|generative ai).{0,80}(?:contributions?|pull requests?|patches?|code).{0,60}(?:not accepted|not allowed|prohibited|forbidden|will be (?:closed|rejected))/i,
  /(?:contributions?|pull requests?|patches?|code).{0,80}(?:generated|written|assisted) by (?:ai|an? llm|chatgpt).{0,60}(?:not accepted|not allowed|prohibited|forbidden|will be (?:closed|rejected))/i
];

const AI_POLICY_DISCLOSURE_PATTERNS = [
  /(?:must|required to|please)\s+(?:clearly\s+)?(?:disclose|declare|label).{0,60}(?:ai|llm|chatgpt|generative)/i,
  /(?:ai|llm|chatgpt|generative ai).{0,70}(?:must|required).{0,40}(?:disclos|declar|label)/i
];

const POLICY_REWARD_DISAVOWAL_PATTERNS = [
  /(?:bount(?:y|ies)|rewards?).{0,100}(?:symbolic|not paid|unpaid|academic study)/i,
  /(?:not|never)\s+(?:paid work|a paid bounty|a payable bounty)/i,
  /(?:paid bounty work|paid contribution work).{0,60}(?:not the right|not intended|not available)/i,
];

function policyRequestsSensitiveAgentContext(value) {
  const text = String(value ?? "");
  return /(?:init_context|initialization (?:text|context)|system prompt)/i.test(text) &&
    /(?:tool_access|session_config|tool access|session configuration)/i.test(text) &&
    /(?:do not truncate|exact content|full initialization|populate.{0,40}real values)/i.test(text);
}

const SENSITIVE_DISCLOSURE_ACTION = /\b(?:provide|publish|post|paste|include|copy|reveal|disclose|expose|print|dump|return|attach|commit|write|submit|share|send|upload|record|show)\b/i;
const SENSITIVE_DISCLOSURE_GUARD = /\b(?:(?:do not|don['’]?t|never|must not)\s+(?:provide|publish|post|paste|include|copy|reveal|disclose|expose|print|dump|return|attach|commit|write|submit|share|send|upload|record|show)|(?:redact|omit|mask)\b|(?:placeholder|names? only|not (?:the )?values?))[^.\n]{0,120}\b(?:secrets?|credentials?|passwords?|tokens?|keys?|prompts?|instructions?|context|environment variables?)\b/i;
const HIDDEN_AGENT_CONTEXT_PATTERNS = [
  /\b(?:verbatim|exact|full|complete|unabridged|unredacted)\s+(?:copy\s+of\s+)?(?:all\s+)?(?:system|developer|hidden|initialization|agent|model|session)?[ -]?(?:instructions?|guidelines?|prompts?|context|messages?)\b/i,
  /\b(?:instructions?|guidelines?|prompts?|context)\b[^.\n]{0,120}\b(?:before|prior to)\b[^.\n]{0,40}\b(?:first|initial)\b[^.\n]{0,24}\b(?:human|user)\s+message\b/i,
  /\b(?:system|developer|hidden)\s+(?:prompts?|messages?|instructions?|context)\b/i,
  /\b(?:init_context|initialization context|initialization text|tool_access|session_config|tool access|session configuration)\b/i,
];
const SECRET_VALUE_PATTERN = /\b(?:passwords?|secrets?|credentials?|api[ -]?keys?|access tokens?|private keys?|seed phrases?|environment variable values?)\b|(?:^|\s)\.env\s+(?:file|contents?)\b/i;
const SECRET_EXPOSURE_ACTION = /\b(?:publish|post|paste|reveal|disclose|expose|print|dump|return|attach|commit|share|send|upload|show)\b/i;
const EXPLICIT_SECRET_VALUE_PATTERN = /\b(?:raw|actual|real|exact|full|unredacted)\s+(?:passwords?|secrets?|credentials?|api[ -]?keys?|access tokens?|private keys?|seed phrases?)\b|\b(?:passwords?|secrets?|credentials?|api[ -]?keys?|access tokens?|private keys?|seed phrases?|environment variables?)\s+(?:values?|contents?|material)\b/i;
const PUBLIC_SECRET_DESTINATION = /\b(?:in|into|on|to)\s+(?:the\s+|an?\s+|your\s+)?(?:pull request|pr\b|issue comment|public (?:issue|comment|log|artifact)|repository|commit|build log|artifact)\b/i;
const PRIVATE_MACHINE_PATH_PATTERN = /\b(?:absolute|exact|full|unredacted)\b[^.\n]{0,80}\b(?:home (?:path|directory)|working (?:path|directory)|current working directory|shell history|hostname|machine username)\b/i;

function sensitiveTaskDisclosure(value) {
  const chunks = String(value ?? "")
    .split(/\r?\n|(?<=[.!?])\s+/u)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  for (const chunk of chunks) {
    if (SENSITIVE_DISCLOSURE_GUARD.test(chunk)) continue;
    const requestsDisclosure = SENSITIVE_DISCLOSURE_ACTION.test(chunk) || /\b(?:must|required to|required contributor comment)\b/i.test(chunk);
    if (requestsDisclosure && HIDDEN_AGENT_CONTEXT_PATTERNS.some((pattern) => pattern.test(chunk))) {
      return "hidden agent instructions or context";
    }
    if (requestsDisclosure && SECRET_VALUE_PATTERN.test(chunk) &&
        (SECRET_EXPOSURE_ACTION.test(chunk) || EXPLICIT_SECRET_VALUE_PATTERN.test(chunk) || PUBLIC_SECRET_DESTINATION.test(chunk))) {
      return "secret or credential values";
    }
    if (requestsDisclosure && PRIVATE_MACHINE_PATH_PATTERN.test(chunk)) {
      return "private machine paths or state";
    }
  }
  return null;
}

const EXTERNAL_PREREQUISITE_CATEGORIES = [
  {
    category: "account or registration",
    pattern: /\b(?:account|registration|register(?:ed|ing)?|sign[ -]?up|workspace id)\b/i,
  },
  {
    category: "API key or provider data",
    pattern: /\b(?:api[ -]?keys?|provider(?:-backed)? data|provider (?:credentials?|access)|real (?:provider|source) data|actual run of (?:the )?source tool|genuine exported archive)\b/i,
  },
  {
    category: "demo video",
    pattern: /\b(?:demo(?:nstration)? video|video (?:demo|walkthrough|showcase|showing|proof)|screen(?:cast| recording)|record(?:ed|ing)? (?:a |the )?(?:demo|video))\b/i,
  },
  {
    category: "public social posting or engagement",
    pattern: /\b(?:public(?:ly)? (?:post|share|publish)|social (?:post|showcase|engagement|amplification)|post (?:it|the result|about|on) (?:x|twitter|youtube|linkedin)|publish (?:it|the result|your demo|your showcase) on|tag (?:the )?(?:official|\@)|bookmarks?|retweets?|reposts?|linkedin reactions?|youtube views?)\b/i,
  },
  {
    category: "specialized hardware",
    pattern: /\b(?:(?:specialized|dedicated|qualifying|physical) hardware|nvidia|cuda|gpus?|tpus?|ledger device|esp32|raspberry pi|physical (?:phone|device)|test device)\b/i,
  },
];

const EXTERNAL_PREREQUISITE_REQUIREMENT = /\b(?:must|required|mandatory|prerequisites?|need(?:ed)? to|needs? (?:an?|the|your)|have to|has to|shall)\b/i;
const EXTERNAL_PREREQUISITE_DIRECTIVE = /^(?:grab|create|register|sign[ -]?up|obtain|get|configure|include|record|upload|publish|post|share|tag|run|use|provide|attach|submit|install|connect|test)\b|:\s*(?:grab|create|register|sign[ -]?up|obtain|get|configure|include|record|upload|publish|post|share|tag|run|use|provide|attach|submit|install|connect|test)\b/i;
const EXTERNAL_PREREQUISITE_OPT_OUT = /\b(?:optional(?:ly)?|not required|isn['’]?t required|aren['’]?t required|not mandatory|if (?:available|desired|helpful|you (?:want|wish|have))|nice to have|may (?:include|use|provide|record|post|publish|run)|can optionally)\b|\bno\b.{0,60}\b(?:required|mandatory)\b/i;
const EXTERNAL_PREREQUISITE_SECTION = /\b(?:prerequisites?|requirements?|implementation guidelines?|submission instructions?|steps? to participate)\b/i;
const EXTERNAL_PREREQUISITE_REFERENCE_ONLY = /^(?:see|read|reference|docs?|documentation|guide|example|learn more)\b/i;

function mandatoryExternalPrerequisites(value) {
  const categories = new Set();
  let requiredSection = false;
  for (const rawLine of String(value ?? "").split(/\r?\n/)) {
    const markdownHeading = rawLine.match(/^\s{0,3}#{1,6}\s+(.+)$/)?.[1];
    if (markdownHeading) {
      requiredSection = EXTERNAL_PREREQUISITE_SECTION.test(markdownHeading);
    }
    const line = rawLine
      .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/[*_`#]+/g, "")
      .trim();
    if (!line || EXTERNAL_PREREQUISITE_OPT_OUT.test(line)) continue;

    const matched = EXTERNAL_PREREQUISITE_CATEGORIES.filter(({ pattern }) => pattern.test(line));
    if (!matched.length) continue;
    const directive = EXTERNAL_PREREQUISITE_REQUIREMENT.test(line) ||
      EXTERNAL_PREREQUISITE_DIRECTIVE.test(line) ||
      (requiredSection && !EXTERNAL_PREREQUISITE_REFERENCE_ONLY.test(line));
    if (!directive) continue;
    for (const { category } of matched) categories.add(category);
  }
  return EXTERNAL_PREREQUISITE_CATEGORIES
    .map(({ category }) => category)
    .filter((category) => categories.has(category));
}

const CLAIM_INTENT_TTL_DAYS = 30;
const CLAIM_INTENT_COMMAND_PATTERN = /(?:^|\n)\s*\/(?:claim|attempt)\b/im;
const CLAIM_INTENT_PATTERNS = [
  CLAIM_INTENT_COMMAND_PATTERN,
  /\b(?:please|kindly)\s+assign\s+(?:(?:this issue|this|it|the issue)\s+)?to\s+me\b/i,
  /\b(?:can|could|would)\s+you\s+assign\s+(?:(?:this issue|this|it|the issue)\s+)?to\s+me\b/i,
  /\bassign\s+me\b/i,
  /\bi(?:['’]m|\s+am)\s+(?:now\s+)?(?:working|starting(?:\s+work)?)\s+on\s+(?:this|it|the issue)\b/i,
  /\bi\s+(?:claim|am taking|will take|['’]ll take)\s+(?:this|it|the issue|this bounty|the bounty)\b/i,
  /\b(?:(?:let|allow)\s+me|i(?:['’]d|\s+(?:would|will))\s+(?:like|love)\s+to)\s+(?:fix|handle|resolve|implement|take|work\s+on)\s+(?:this|it|the issue)\b/i,
  /\bi\s+can\s+(?:fix|handle|resolve|implement|take|work\s+on)\s+(?:this|it|the issue)\b/i,
  /\bi\s+(?:really\s+)?(?:want\s+to|wanna)\s+w(?:ork|ord)\s+on\s+(?:this|it|the issue)\b/i,
  /\bcan\s+i\s+be\s+assigned(?:\s+(?:to\s+)?(?:this|it|the issue))?\b/i,
  /\bi(?:['’]ll|\s+will)\s+(?:submit|open)\s+(?:a\s+)?(?:pr|pull request)\b/i,
  /\bi(?:['’]ll|\s+will|\s+am\s+going\s+to|\s+plan\s+to|\s+intend\s+to)\s+(?:start\s+)?(?:implement(?:ing)?|fix(?:ing)?|handle|resolve|address|work\s+on|take\s+on)\b/i,
  /\bi(?:['’]m|\s+am)\s+(?:(?:currently|already|now)\s+)?(?:implementing|fixing|handling|resolving|addressing|working\s+on)\b/i,
  /\bi\s+(?:can|will)\s+do\s+(?:this|it)\b/i,
  /(?:^|\n)\s*taking\s+(?:this|it|the issue)\b/im,
];
const CLAIM_INTENT_WITHDRAWAL_PATTERNS = [
  /\bwithdraw(?:ing)?\s+(?:(?:my|this|the)\s+)?(?:claim|interest|attempt)\b/i,
  /\bno longer\s+(?:working|claiming|interested)\b/i,
  /\b(?:can['’]?t|cannot|won['’]?t|will not)\s+(?:continue\s+)?work(?:ing)?\s+on\s+(?:this|it|the issue)\b/i,
  /\b(?:please\s+)?unassign\s+me\b/i,
  /\b(?:dropping|giving up)\s+(?:this|it|the issue|my claim)\b/i,
];

function unquotedClaimText(value) {
  const withoutHtmlQuotes = String(value ?? "")
    .replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, " ");
  const retained = [];
  let fence = null;
  for (const line of withoutHtmlQuotes.split(/\r?\n/)) {
    const marker = line.match(/^\s*(```|~~~)/)?.[1] ?? null;
    if (marker) {
      fence = fence === null ? marker : fence === marker ? null : fence;
      continue;
    }
    if (fence !== null || /^\s*>/.test(line)) continue;
    retained.push(line.replace(/`[^`\n]*`/g, " "));
  }
  return retained.join("\n");
}

const TERMINAL_MAINTAINER_PATTERNS = [
  /\b(?:we|i)\s+(?:have\s+)?paid\s+(?:the|an?|one|all)\s+(?:accepted\s+)?(?:claim|bounty|reward|payout)s?\b/i,
  /(?:^|[.!?]\s+|[\r\n])\p{Lu}[\p{L}\p{N}_.-]{1,40}\s+(?:has\s+)?paid\s+(?:the|an?|one|all)\s+(?:accepted\s+)?(?:claim|bounty|reward|payout)s?\b/u,
  /\b(?:bounty|reward|payout|claim)\s+(?:has been|was|is now)\s+(?:paid|settled|awarded|fulfilled|completed)\b/i,
  /\b(?:we|i)\s+(?:have\s+)?accepted\s+(?:the|an?)\s+(?:(?:first|one|final|latest)\s+)?(?:delivery|submission|solution|work)\b/i,
  /(?:^|[.!?]\s+|[\r\n])\p{Lu}[\p{L}\p{N}_.-]{1,40}\s+(?:has\s+)?accepted\s+(?:the|an?)\s+(?:(?:first|one|final|latest)\s+)?(?:delivery|submission|solution|work)\b/u,
  /(?:^|[.!?]\s+|[\r\n])accepted\s+(?:the|an?)\s+(?:(?:first|one|final|latest)\s+)?(?:delivery|submission|solution|work)\b/i,
  /\b(?:delivery|submission|solution|work)\s+(?:has been|was|is now)\s+(?:accepted|approved)\b/i,
];
const TERMINAL_MAINTAINER_NEGATION_PATTERNS = [
  /\b(?:no|neither)\s+(?:accepted\s+)?(?:claim|bounty|reward|payout)s?\s+(?:has been|was|is now)\s+(?:paid|settled|awarded|fulfilled|completed)\b/i,
  /\b(?:no|neither)\s+(?:delivery|submission|solution|work)\s+(?:has been|was|is now)\s+(?:accepted|approved)\b/i,
  /\bnot\s+(?:one|a|an|the|any)\s+(?:accepted\s+)?(?:claim|bounty|reward|payout)s?\s+(?:has been|was|is now)\s+(?:paid|settled|awarded|fulfilled|completed)\b/i,
  /\bnot\s+(?:one|a|an|the|any)\s+(?:delivery|submission|solution|work)\s+(?:has been|was|is now)\s+(?:accepted|approved)\b/i,
  /\bnone\s+of\s+the\s+(?:claims?|bount(?:y|ies)|rewards?|payouts?)\s+(?:have been|were|are now)\s+(?:paid|settled|awarded|fulfilled|completed)\b/i,
  /\bnone\s+of\s+the\s+(?:deliver(?:y|ies)|submissions?|solutions?|work)\s+(?:has been|have been|was|were|is now|are now)\s+(?:accepted|approved)\b/i,
  /\b(?:claim|bounty|reward|payout)s?\s+(?:has been|was|is now)\s+not\s+(?:paid|settled|awarded|fulfilled|completed)\b/i,
  /\b(?:delivery|submission|solution|work)\s+(?:has been|was|is now)\s+not\s+(?:accepted|approved)\b/i,
  /\bnobody\s+(?:has\s+)?(?:paid|accepted|approved|awarded|settled)\b/i,
];

const CLOSED_AVAILABILITY_PATTERNS = [
  /\bslots?\s*:\s*\d+\s*\(\s*(?:filled|closed)\s*\)/i,
  /\b(?:no|zero)\s+open\s+(?:claim\s+)?slots?\b/i,
  /\b(?:all|every)\s+(?:claim\s+)?slots?\s+(?:are|were|have been)\s+(?:filled|closed|claimed)\b/i,
  /\bclaim\s+gate\s*:?\s*closed\b/i,
  /\bstatus\s*:\s*(?:delivered|paid|settled|completed|fulfilled|awarded)\b/i,
];

const OPEN_AVAILABILITY_PATTERNS = [
  /\bslots?\s*:\s*\d+\s*\(\s*[1-9]\d*\s+open\s*\)/i,
  /\b(?:[1-9]\d*|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:separate\s+)?(?:claim\s+)?slots?\s+remain(?:s)?\s+open\b/i,
  /\b(?:claim\s+)?slots?\s+remaining\s*:\s*[1-9]\d*\b/i,
];

const EXTERNAL_SOURCE_LABEL_PATTERN = /(?:source\s+(?:url|issue)|original\s+(?:issue|link)|upstream(?:\s+issue)?|mirror(?:ed)?\s+(?:of|from)|原始链接)[^\n\r]{0,80}[\n\r\s:>*_-]*https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)/ig;

function externalSourceIssue(issue, repository) {
  const body = typeof issue?.body === "string" ? issue.body : "";
  const current = typeof repository?.full_name === "string" ? repository.full_name.toLowerCase() : "";
  for (const match of body.matchAll(EXTERNAL_SOURCE_LABEL_PATTERN)) {
    const owner = match[1];
    const repo = match[2];
    const number = Number(match[3]);
    if (!owner || !repo || !Number.isSafeInteger(number) || number < 1) continue;
    if (`${owner}/${repo}`.toLowerCase() === current) continue;
    return {
      url: `https://github.com/${owner}/${repo}/issues/${number}`,
      repository: `${owner}/${repo}`,
    };
  }
  return null;
}

function externalBountySource(issue) {
  const body = typeof issue?.body === "string" ? issue.body : "";
  if (!MAINTAINER_ASSOCIATIONS.has(issue?.author_association)) return null;
  if (!/\bsource of truth\b/i.test(body) || !/\bmirror(?:ed)?\b/i.test(body)) return null;
  const match = body.match(/^(?:claim|source(?:\s+of\s+truth)?|bounty)\s*:\s*(https:\/\/[^\s<>]+)/im);
  if (!match?.[1] || match[1].length > 2_048) return null;
  let url;
  try {
    url = new URL(match[1].replace(/[),.;]+$/, ""));
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (url.protocol !== "https:" || url.username || url.password ||
      hostname === "github.com" || hostname.endsWith(".github.com")) return null;
  return { url: url.href, host: url.hostname };
}

export function parseIssueUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid GitHub issue URL.");
  }
  if (url.hostname !== "github.com") throw new Error("Only github.com issue URLs are supported.");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts[2] !== "issues" || !/^\d+$/.test(parts[3])) {
    throw new Error("Use a URL like https://github.com/owner/repository/issues/123.");
  }
  return { owner: parts[0], repo: parts[1], number: Number(parts[3]) };
}

function daysSince(value, now) {
  return Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 86_400_000));
}

const EXACT_GITHUB_PULL_URL_PATTERN = /\bhttps:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)(?=$|[\s<>"'`()\[\]{},.!;:])/gi;

function canonicalPullRequestUrl(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)\/?$/i);
  return match ? `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}` : null;
}

function bodyPullRequests(issue, comments, repository) {
  const relevantRepository = typeof repository?.full_name === "string"
    ? repository.full_name.toLowerCase()
    : null;
  if (!relevantRepository) return [];
  const relevantOwner = relevantRepository.split("/")[0];
  const sources = [
    { body: issue?.body, evidenceUrl: issue?.html_url, author: issue?.user?.login ?? "issue-author", source: "issue body" },
    ...comments.map((comment) => ({
      body: comment?.body,
      evidenceUrl: comment?.html_url,
      author: comment?.user?.login ?? "unknown",
      source: "issue comment",
    })),
  ];
  const pulls = new Map();
  for (const source of sources) {
    if (typeof source.body !== "string") continue;
    for (const match of source.body.matchAll(EXACT_GITHUB_PULL_URL_PATTERN)) {
      const referencedRepository = `${match[1]}/${match[2]}`.toLowerCase();
      if (referencedRepository !== relevantRepository && match[1].toLowerCase() !== relevantOwner) continue;
      const url = `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
      pulls.set(url.toLowerCase(), {
        url,
        state: "referenced",
        title: `Pull request referenced in ${source.source}`,
        author: source.author,
        evidenceUrl: source.evidenceUrl ?? url,
      });
    }
  }
  return [...pulls.values()];
}

function uniquePullRequests(timeline = [], issue = null, comments = [], repository = null) {
  const pulls = new Map();
  for (const pull of bodyPullRequests(issue, comments, repository)) {
    pulls.set(pull.url.toLowerCase(), pull);
  }
  for (const event of timeline) {
    const item = event.event === "cross-referenced" ? event.source?.issue : null;
    const url = canonicalPullRequestUrl(item?.pull_request?.html_url);
    if (!url) continue;
    pulls.set(url.toLowerCase(), {
      url,
      state: item.pull_request.merged_at ? "merged" : item.state,
      title: item.title,
      author: item.user?.login ?? "unknown",
      evidenceUrl: url,
    });
  }
  return [...pulls.values()];
}

function matchingComments(comments, patterns, maintainersOnly = false) {
  return comments.filter((comment) => {
    if (maintainersOnly && !MAINTAINER_ASSOCIATIONS.has(comment.author_association)) return false;
    return patterns.some((pattern) => pattern.test(comment.body ?? ""));
  });
}

function signal(label, impact, detail, evidenceUrl = null, hardStop = false) {
  return { label, impact, detail, evidenceUrl, hardStop };
}

function issueLabelNames(issue) {
  return Array.isArray(issue.labels)
    ? issue.labels.map((label) => typeof label === "string" ? label : label?.name).filter(Boolean)
    : [];
}

function commentTime(comment) {
  const value = comment.updated_at ?? comment.created_at;
  const time = typeof value === "string" ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function authoredIssueRewardText(issue) {
  const title = String(issue?.title ?? "");
  let body = String(issue?.body ?? "");
  const opireBoilerplate = body.search(/This repo is using Opire\s*-\s*what does it mean\?/i);
  if (opireBoilerplate >= 0) body = body.slice(0, opireBoilerplate);
  body = body.replace(/\[!\[Opire Bounty\][^\n\r]*(?:\r?\n)?/gi, "");
  return `${title}\n${body}`;
}

function lastPatternMatchIndex(value, patterns) {
  const text = String(value ?? "");
  let latest = -1;
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
      latest = Math.max(latest, match.index ?? -1);
    }
  }
  return latest;
}

function hasCurrentRewardRestoration(value) {
  const text = String(value ?? "");
  const restorationIndex = lastPatternMatchIndex(value, REWARD_RESTORATION_PATTERNS);
  if (restorationIndex < 0 || restorationIndex <= lastPatternMatchIndex(value, WITHDRAWAL_PATTERNS)) return false;
  return /(?:\bwill pay\b|\bwill be paid\b|\bpaid after\b|\bpayment (?:will|shall) be\b|\breceive payment\b)/i
    .test(text.slice(restorationIndex));
}

function isPositiveMaintainerRewardText(value) {
  const text = String(value ?? "");
  const affirmativePayment = amountFromText(text).amount !== null ||
    /(?:\bwill pay\b|\bwill be paid\b|\bpaid after\b|\bpayment (?:will|shall) be\b|\breceive payment\b)/i.test(text);
  const explicitlyRestored = hasCurrentRewardRestoration(text);
  return /(?:bounty|reward)/i.test(text) &&
    affirmativePayment &&
    (explicitlyRestored || !REWARD_DENIAL_PATTERNS.some((pattern) => pattern.test(text)));
}

function isPositiveRewardRestorationText(value) {
  const text = String(value ?? "");
  return hasCurrentRewardRestoration(text) && isPositiveMaintainerRewardText(text);
}

function opireRewardState(comments) {
  const ordered = comments
    .filter((comment) => comment.performed_via_github_app?.slug === TRUSTED_OPIRE_APP)
    .sort((left, right) => commentTime(left) - commentTime(right));
  let listing = null;
  let claimed = null;
  let empty = null;
  const rejections = [];
  for (const comment of ordered) {
    const body = String(comment.body ?? "");
    if (/@[^\s]+ created a \$[\d,.]+ reward using \[Opire\]/i.test(body)) {
      listing = comment;
      claimed = null;
      empty = null;
      continue;
    }
    if (/claimed all rewards for this issue/i.test(body)) {
      listing = null;
      claimed = comment;
      empty = null;
      continue;
    }
    if (/this issue does not have any reward yet/i.test(body)) {
      listing = null;
      claimed = null;
      empty = comment;
      continue;
    }
    if (REWARD_PLATFORM_REJECTION_PATTERNS.some((pattern) => pattern.test(body))) {
      rejections.push(comment);
    }
  }
  return { listing, claimed, empty, rejections };
}

function platformClaimState(comments, openPulls, opire, reward, platformEvidence) {
  if (platformEvidence?.platform === "BountyHub") {
    if (platformEvidence.state === "SOLVED") {
      return {
        label: "Bounty platform reports reward awarded",
        detail: "BountyHub reports that this bounty has already been solved.",
        evidenceUrl: platformEvidence.evidence_url,
      };
    }
    if (platformEvidence.state === "RETRACTED") {
      return {
        label: "Bounty platform reports reward withdrawn",
        detail: "BountyHub reports that this bounty was retracted or deleted.",
        evidenceUrl: platformEvidence.evidence_url,
      };
    }
    if (platformEvidence.state === "FROZEN") {
      return {
        label: "Bounty platform reports reward frozen",
        detail: "BountyHub reports that this bounty is frozen; do not start work until the platform clears it.",
        evidenceUrl: platformEvidence.evidence_url,
      };
    }
    if (platformEvidence.state === "CLAIMED") {
      return {
        label: "Bounty platform reports active competition",
        detail: "BountyHub reports an existing claim for this bounty.",
        evidenceUrl: platformEvidence.evidence_url,
      };
    }
  }
  const official = comments.filter((comment) => TRUSTED_BOUNTY_APPS.has(comment.performed_via_github_app?.slug));
  const stateComments = official
    .filter((comment) => /(?:^|\n)\|\s*🟢\s+@[^|]+\|/m.test(comment.body ?? "") || /bounty is (?:now )?up for grabs/i.test(comment.body ?? ""))
    .sort((left, right) => commentTime(right) - commentTime(left));
  const current = stateComments[0];
  if (current && !/bounty is (?:now )?up for grabs/i.test(current.body ?? "") && /(?:^|\n)\|\s*🟢\s+@[^|]+\|/m.test(current.body ?? "")) {
    return {
      label: "Bounty platform reports active competition",
      detail: "The current Algora status table lists at least one active attempt or submitted solution.",
      evidenceUrl: current.html_url ?? null,
    };
  }

  for (const pull of openPulls) {
    const claim = official.find((comment) =>
      (comment.body ?? "").includes(pull.url) && /(?:claims? the bounty|submitted a pull request)/i.test(comment.body ?? "")
    );
    if (claim) {
      return {
        label: "Bounty platform reports active competition",
        detail: "Algora links an existing open pull request that claims this bounty.",
        evidenceUrl: claim.html_url ?? pull.url,
      };
    }
  }
  if (opire.claimed && reward.state === "PAID_OR_AWARDED" && reward.platform === "Opire") {
    return {
      label: "Bounty platform reports reward claimed",
      detail: "Opire reports that all rewards for this issue have already been claimed.",
      evidenceUrl: opire.claimed.html_url ?? null,
    };
  }
  return null;
}

function amountFromText(text) {
  const match = String(text ?? "").match(
    /\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*([kK])?(?:\s*(USDC|USD))?(?=\s|[.,;:)\]}]|$)/i,
  );
  if (!match) return { amount: null, currency: null };
  const multiplier = match[2] ? 1_000 : 1;
  const amount = Number(match[1].replaceAll(",", "")) * multiplier;
  return {
    amount: Number.isFinite(amount) ? amount : null,
    currency: String(match[3] || "USD").toUpperCase(),
  };
}

function amountFromAlgoraListing(text) {
  const listingHeaders = Array.from(String(text ?? "").matchAll(
    /^##\s*💎\s*\$\s*[\d][\d,]*(?:\.\d{1,2})?\s*[kK]?(?:\s*(?:USDC|USD))?\s+bounty\b.*$/gim,
  ));
  if (!listingHeaders.length) return amountFromText(text);

  const amounts = listingHeaders.map(([header]) => amountFromText(header));
  if (amounts.some(({ amount, currency }) => amount === null || currency === null)) {
    return { amount: null, currency: null };
  }
  const currencies = new Set(amounts.map(({ currency }) => currency));
  if (currencies.size !== 1) return { amount: null, currency: null };

  const total = amounts.reduce((sum, { amount }) => sum + amount, 0);
  return {
    amount: Number.isFinite(total) ? Math.round(total * 100) / 100 : null,
    currency: amounts[0].currency,
  };
}

function isAffirmativeRewardedLabel(value) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
  return /^(?:(?:bounty|reward)\s*[:=/_-]?\s*)?rewarded$/i.test(normalized);
}

function normalizedStatusLabel(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
}

function isTerminalBountyLabel(value) {
  const normalized = normalizedStatusLabel(value);
  if (isAffirmativeRewardedLabel(normalized)) return true;
  return /^(?:(?:bounty|reward)\s*[:=/_-]?\s*)?(?:paid|awarded|claimed|settled|fulfilled|delivered|completed)$/i
    .test(normalized);
}

function hasMaintainerTerminalStatement(value) {
  return String(value ?? "")
    .split(/(?<=[.!?;])\s+|[\r\n]+|\b(?:but|however|yet)\b/i)
    .some((clause) => !TERMINAL_MAINTAINER_NEGATION_PATTERNS.some((pattern) => pattern.test(clause)) &&
      TERMINAL_MAINTAINER_PATTERNS.some((pattern) => pattern.test(clause)));
}

function latestMaintainerTerminalState(comments) {
  return comments
    .filter((comment) => MAINTAINER_ASSOCIATIONS.has(comment.author_association) &&
      hasMaintainerTerminalStatement(comment.body))
    .sort((left, right) => commentTime(right) - commentTime(left))[0] ?? null;
}

function closedBountyAvailability(issue, comments) {
  const issueText = `${String(issue?.body ?? "")}\n${issueLabelNames(issue).join("\n")}`;
  if (MAINTAINER_ASSOCIATIONS.has(issue?.author_association) &&
      CLOSED_AVAILABILITY_PATTERNS.some((pattern) => pattern.test(issueText))) {
    return { source: "issue", evidenceUrl: issue.html_url, observedAt: null };
  }
  const comment = comments
    .filter((item) => MAINTAINER_ASSOCIATIONS.has(item.author_association) &&
      CLOSED_AVAILABILITY_PATTERNS.some((pattern) => pattern.test(item.body ?? "")))
    .sort((left, right) => commentTime(right) - commentTime(left))[0];
  return comment
    ? { source: "comment", evidenceUrl: comment.html_url ?? issue.html_url, observedAt: commentTime(comment) }
    : null;
}

function openBountyAvailability(issue, comments) {
  const issueText = String(issue?.body ?? "");
  if (MAINTAINER_ASSOCIATIONS.has(issue?.author_association) &&
      OPEN_AVAILABILITY_PATTERNS.some((pattern) => pattern.test(issueText))) {
    return { source: "issue", evidenceUrl: issue.html_url, observedAt: null };
  }
  const comment = comments
    .filter((item) => MAINTAINER_ASSOCIATIONS.has(item.author_association) &&
      OPEN_AVAILABILITY_PATTERNS.some((pattern) => pattern.test(item.body ?? "")))
    .sort((left, right) => commentTime(right) - commentTime(left))[0];
  return comment
    ? { source: "comment", evidenceUrl: comment.html_url ?? issue.html_url, observedAt: commentTime(comment) }
    : null;
}

function rewardEvidence(issue, comments, opire, platformEvidence) {
  if (platformEvidence?.platform === "BountyHub") {
    return {
      state: platformEvidence.state === "SOLVED"
        ? "PAID_OR_AWARDED"
        : platformEvidence.state === "RETRACTED"
          ? "WITHDRAWN"
          : platformEvidence.secured_amount > 0
            ? "LISTED"
            : "PROMISED",
      verification: platformEvidence.verification,
      platform: platformEvidence.platform,
      amount: platformEvidence.amount,
      currency: platformEvidence.currency,
      evidenceUrl: platformEvidence.evidence_url,
    };
  }
  const officialAlgora = comments
    .filter((comment) =>
    TRUSTED_BOUNTY_APPS.has(comment.performed_via_github_app?.slug) &&
    /##\s*💎\s*\$[\d,.]+\s+bounty\b/i.test(comment.body ?? "")
    )
    .sort((left, right) => commentTime(right) - commentTime(left))[0];
  const trustedListings = [
    officialAlgora ? { comment: officialAlgora, platform: "Algora" } : null,
    opire.listing ? { comment: opire.listing, platform: "Opire" } : null,
  ].filter(Boolean).sort((left, right) => commentTime(right.comment) - commentTime(left.comment));
  const trustedListing = trustedListings[0];
  if (trustedListing) {
    return {
      state: "LISTED",
      verification: "TRUSTED_PLATFORM_APP",
      platform: trustedListing.platform,
      ...(trustedListing.platform === "Algora"
        ? amountFromAlgoraListing(trustedListing.comment.body)
        : amountFromText(trustedListing.comment.body)),
      evidenceUrl: trustedListing.comment.html_url ?? issue.html_url,
    };
  }

  if (opire.claimed) {
    return {
      state: "PAID_OR_AWARDED",
      verification: "TRUSTED_PLATFORM_APP",
      platform: "Opire",
      amount: null,
      currency: null,
      evidenceUrl: opire.claimed.html_url ?? issue.html_url,
    };
  }

  const issueText = authoredIssueRewardText(issue);
  const maintainerIssue = MAINTAINER_ASSOCIATIONS.has(issue.author_association) && isPositiveMaintainerRewardText(issueText);
  const maintainerComment = comments
    .filter((comment) => MAINTAINER_ASSOCIATIONS.has(comment.author_association) && isPositiveMaintainerRewardText(comment.body))
    .sort((left, right) => commentTime(right) - commentTime(left))[0];
  if (maintainerIssue || maintainerComment) {
    const source = maintainerComment?.body ?? issueText;
    return {
      state: "PROMISED",
      verification: "MAINTAINER_STATEMENT",
      platform: null,
      ...amountFromText(source),
      evidenceUrl: maintainerComment?.html_url ?? issue.html_url,
    };
  }

  const labels = issueLabelNames(issue);
  if (/(?:bounty|reward)/i.test(issueText) || labels.some((label) => /(?:bounty|reward)/i.test(label))) {
    return {
      state: "UNVERIFIED",
      verification: "UNVERIFIED",
      platform: null,
      ...amountFromText(issueText),
      evidenceUrl: issue.html_url,
    };
  }
  return {
    state: "NOT_FOUND",
    verification: "NONE",
    platform: null,
    amount: null,
    currency: null,
    evidenceUrl: issue.html_url,
  };
}

function currentMaintainerWithdrawals(issue, comments) {
  const issueWithdrawal = MAINTAINER_ASSOCIATIONS.has(issue.author_association) &&
    WITHDRAWAL_PATTERNS.some((pattern) => pattern.test(authoredIssueRewardText(issue))) &&
    !isPositiveRewardRestorationText(authoredIssueRewardText(issue))
    ? [{
        body: authoredIssueRewardText(issue),
        author_association: issue.author_association,
        source: "issue_body",
        html_url: issue.html_url,
      }]
    : [];
  if (issueWithdrawal.length) return issueWithdrawal;
  const withdrawals = matchingComments(comments, WITHDRAWAL_PATTERNS, true)
    .filter((comment) => !isPositiveRewardRestorationText(comment.body))
    .sort((left, right) => commentTime(right) - commentTime(left));
  const confirmations = comments
    .filter((comment) => MAINTAINER_ASSOCIATIONS.has(comment.author_association) && isPositiveMaintainerRewardText(comment.body))
    .sort((left, right) => commentTime(right) - commentTime(left));
  if (!withdrawals.length) return [];
  if (confirmations.length && commentTime(confirmations[0]) > commentTime(withdrawals[0])) return [];
  return [withdrawals[0]];
}

function relevantOpireRejection(issue, opire, reward) {
  if (reward.state === "LISTED" || reward.state === "PAID_OR_AWARDED") return null;
  const labels = issueLabelNames(issue);
  const opireBound = /(?:This repo is using Opire|Opire Bounty)/i.test(issue.body ?? "") ||
    labels.some((label) => /^opire$/i.test(String(label)));
  if (!opireBound) return null;
  const advertisedAmounts = [...`${authoredIssueRewardText(issue)}\n${labels.join("\n")}`.matchAll(
    /\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*([kK])?(?:\s*(?:USDC|USD))?/g,
  )].map((match) => Number(match[1].replaceAll(",", "")) * (match[2] ? 1_000 : 1))
    .filter(Number.isFinite);
  if (!advertisedAmounts.length) return null;
  return [...opire.rejections]
    .sort((left, right) => commentTime(right) - commentTime(left))
    .find((comment) => {
      const rejected = amountFromText(comment.body).amount;
      return rejected !== null && advertisedAmounts.includes(rejected);
    }) ?? null;
}

function relevantOpireEmpty(issue, opire, reward) {
  if (!opire.empty || reward.state === "LISTED" || reward.state === "PAID_OR_AWARDED") return null;
  const labels = issueLabelNames(issue);
  const opireBound = /(?:This repo is using Opire|Opire Bounty)/i.test(issue.body ?? "") ||
    labels.some((label) => /^opire$/i.test(String(label)));
  return opireBound ? opire.empty : null;
}

function activeSoftLockClaims(issue, comments, now) {
  const ttlMatch = String(issue.body ?? "").match(/soft[ -]?lock.{0,40}?([1-9]\d?)\s*days?/i);
  if (!ttlMatch) return [];
  const ttlDays = Number(ttlMatch[1]);
  const states = new Map();
  const ordered = [...comments].sort((left, right) => commentTime(left) - commentTime(right));
  for (const comment of ordered) {
    const login = comment.user?.login;
    if (!login || MAINTAINER_ASSOCIATIONS.has(comment.author_association) ||
        TRUSTED_BOUNTY_APPS.has(comment.performed_via_github_app?.slug)) continue;
    const body = unquotedClaimText(comment.body);
    if (/(?:withdraw(?:ing)?|cancel(?:l?ing)?).{0,40}(?:attempt|claim)|no longer (?:working|claiming)/i.test(body)) {
      states.delete(login);
      continue;
    }
    if (/^\s*(?:\/(?:(?:try|attempt|claim)\b|opire\s+(?:try|claim)\b)|#{1,3}\s*claim\b|taking this\b)/im.test(body)) {
      states.set(login, comment);
    }
  }
  const cutoff = now.getTime() - ttlDays * 86_400_000;
  return [...states.entries()].flatMap(([login, comment]) =>
    commentTime(comment) >= cutoff ? [{ login, comment, ttlDays }] : []
  );
}

function activeClaimIntent(issue, comments, now) {
  const states = new Map();
  const softLockTtl = String(issue?.body ?? "").match(/soft[ -]?lock.{0,40}?([1-9]\d?)\s*days?/i);
  const ordered = [...comments].sort((left, right) => commentTime(left) - commentTime(right));
  for (const comment of ordered) {
    const login = comment.user?.login;
    if (!login || MAINTAINER_ASSOCIATIONS.has(comment.author_association) ||
        TRUSTED_BOUNTY_APPS.has(comment.performed_via_github_app?.slug)) continue;
    const body = unquotedClaimText(comment.body);
    if (CLAIM_INTENT_WITHDRAWAL_PATTERNS.some((pattern) => pattern.test(body))) {
      states.delete(login);
      continue;
    }
    if (CLAIM_INTENT_PATTERNS.some((pattern) => pattern.test(body))) {
      states.set(login, {
        comment,
        ttlDays: CLAIM_INTENT_COMMAND_PATTERN.test(body) && softLockTtl
          ? Number(softLockTtl[1])
          : CLAIM_INTENT_TTL_DAYS,
      });
    }
  }
  return [...states.entries()].flatMap(([login, { comment, ttlDays }]) =>
    commentTime(comment) >= now.getTime() - ttlDays * 86_400_000 ? [{ login, comment }] : []
  );
}

export function analyzeBounty({ issue, repository, comments = [], timeline = [], platformEvidence = null, policyDocuments = [], coverage = {}, now = new Date() }) {
  const signals = [];
  const assignees = Array.isArray(issue.assignees)
    ? issue.assignees.filter((assignee) => typeof assignee?.login === "string" && assignee.login.trim())
    : [];
  const pulls = uniquePullRequests(timeline, issue, comments, repository);
  const openPulls = pulls.filter((pull) => pull.state === "open");
  const mergedPulls = pulls.filter((pull) => pull.state === "merged");
  const closedPulls = pulls.filter((pull) => pull.state === "closed");
  const referencedPulls = pulls.filter((pull) => pull.state === "referenced");
  const rewardedLabels = issueLabelNames(issue).filter(isAffirmativeRewardedLabel);
  const terminalLabelCandidates = issueLabelNames(issue).filter(isTerminalBountyLabel);
  const opire = opireRewardState(comments);
  const activeClaims = activeSoftLockClaims(issue, comments, now);
  const claimantInterest = activeClaimIntent(issue, comments, now);
  const attempts = comments.filter((comment) =>
    !MAINTAINER_ASSOCIATIONS.has(comment.author_association) &&
    !TRUSTED_BOUNTY_APPS.has(comment.performed_via_github_app?.slug) &&
    /^\s*\/(?:(?:try|attempt|claim)\b|opire\s+(?:try|claim)\b)/im.test(unquotedClaimText(comment.body))
  );
  const attemptUsers = [...new Set(attempts.map((comment) => comment.user?.login).filter(Boolean))];
  const maintainerWarnings = matchingComments([issue, ...comments], NEGATIVE_MAINTAINER_PATTERNS, true);
  const withdrawals = currentMaintainerWithdrawals(issue, comments);
  const reward = rewardEvidence(issue, comments, opire, platformEvidence);
  const platformRejection = relevantOpireRejection(issue, opire, reward);
  const platformEmpty = relevantOpireEmpty(issue, opire, reward);
  const externalSource = externalSourceIssue(issue, repository);
  const externalPlatformSource = externalSource || platformEvidence ? null : externalBountySource(issue);
  const bountyContext = reward.state !== "NOT_FOUND" ||
    /(?:bounty|reward)/i.test(authoredIssueRewardText(issue)) ||
    issueLabelNames(issue).some((label) => /(?:bounty|reward)/i.test(label));
  const terminalLabels = bountyContext
    ? terminalLabelCandidates.filter((label) => !isAffirmativeRewardedLabel(label))
    : [];
  const maintainerTerminalState = bountyContext ? latestMaintainerTerminalState(comments) : null;
  const observedClosedAvailability = bountyContext ? closedBountyAvailability(issue, comments) : null;
  const observedOpenAvailability = bountyContext ? openBountyAvailability(issue, comments) : null;
  const newerOpenComment = observedOpenAvailability?.source === "comment" &&
    observedClosedAvailability?.source === "comment" &&
    observedOpenAvailability.observedAt > observedClosedAvailability.observedAt;
  const closedAvailability = newerOpenComment ? null : observedClosedAvailability;
  const openAvailability = observedOpenAvailability && !closedAvailability ? observedOpenAvailability : null;
  const openLifecycle = openAvailability && terminalLabels.length > 0;
  const terminalClosureLabels = openLifecycle ? [] : terminalLabels;
  if (rewardedLabels.length || terminalClosureLabels.length || (maintainerTerminalState && closedAvailability)) {
    reward.state = "PAID_OR_AWARDED";
    reward.verification = "MAINTAINER_STATEMENT";
    reward.evidenceUrl = maintainerTerminalState?.html_url ?? closedAvailability?.evidenceUrl ?? issue.html_url;
  } else if (platformRejection) {
    reward.state = "WITHDRAWN";
    reward.verification = "TRUSTED_PLATFORM_APP";
    reward.platform = "Opire";
    ({ amount: reward.amount, currency: reward.currency } = amountFromText(platformRejection.body));
    reward.evidenceUrl = platformRejection.html_url ?? issue.html_url;
  } else if (withdrawals.length) {
    reward.state = "WITHDRAWN";
    reward.verification = "MAINTAINER_STATEMENT";
    reward.platform = null;
    reward.evidenceUrl = withdrawals.at(-1)?.html_url ?? issue.html_url;
  } else if (platformEmpty) {
    reward.state = "NOT_FOUND";
    reward.verification = "TRUSTED_PLATFORM_APP";
    reward.platform = "Opire";
    reward.amount = null;
    reward.currency = null;
    reward.evidenceUrl = platformEmpty.html_url ?? issue.html_url;
  }
  const currentPlatformClaim = platformClaimState(comments, openPulls, opire, reward, platformEvidence);
  const aiPolicyBlocks = policyDocuments.filter((document) =>
    AI_POLICY_BLOCK_PATTERNS.some((pattern) => pattern.test(document.body ?? ""))
  );
  const aiPolicyRequirements = policyDocuments.filter((document) =>
    AI_POLICY_DISCLOSURE_PATTERNS.some((pattern) => pattern.test(document.body ?? ""))
  );
  const policyRewardDisavowals = policyDocuments.filter((document) =>
    POLICY_REWARD_DISAVOWAL_PATTERNS.some((pattern) => pattern.test(document.body ?? ""))
  );
  const sensitivePolicyRequests = policyDocuments.filter((document) =>
    policyRequestsSensitiveAgentContext(document.body)
  );
  const unsafeTaskInstructions = [
    { body: issue.body, html_url: issue.html_url, source: "issue body" },
    ...comments
      .filter((comment) => MAINTAINER_ASSOCIATIONS.has(comment.author_association))
      .map((comment) => ({ ...comment, source: "maintainer comment" })),
  ].flatMap((source) => {
    const category = sensitiveTaskDisclosure(source.body);
    return category ? [{ ...source, category }] : [];
  });
  const externalPrerequisites = mandatoryExternalPrerequisites(issue.body);
  const issueAge = daysSince(issue.updated_at, now);
  const repoAge = daysSince(repository.pushed_at, now);
  let score = 50;

  if (issue.state === "open") {
    score += 15;
    signals.push(signal("Issue is open", 15, "GitHub currently reports this issue as open.", issue.html_url));
  } else {
    score -= 100;
    signals.push(signal("Issue is closed", -100, "Closed issues are not safe targets even when a bounty board still lists them.", issue.html_url, true));
  }

  if (issue.locked) {
    score -= 55;
    signals.push(signal("Discussion is locked", -55, `The issue is locked${issue.active_lock_reason ? ` for ${issue.active_lock_reason}` : ""}.`, issue.html_url, true));
  }

  if (assignees.length) {
    score -= 70;
    signals.push(signal(
      "Issue is already assigned",
      -70,
      `GitHub currently lists ${assignees.length} assignee${assignees.length === 1 ? "" : "s"}; treat the work as unavailable unless a maintainer explicitly clears parallel work.`,
      issue.html_url,
      true,
    ));
  }

  if (rewardedLabels.length) {
    score -= 100;
    signals.push(signal(
      "Bounty is already rewarded",
      -100,
      `GitHub currently labels this issue ${JSON.stringify(rewardedLabels[0])}; do not treat an open issue as an unpaid opportunity.`,
      issue.html_url,
      true,
    ));
  } else if (terminalClosureLabels.length || closedAvailability) {
    score -= 100;
    const observed = terminalClosureLabels[0] ?? "closed availability";
    signals.push(signal(
      "Bounty has no open work slot",
      -100,
      `Maintainer-controlled GitHub evidence reports terminal bounty status ${JSON.stringify(observed)}; do not start work without a newer explicit reopening and available slot.`,
      maintainerTerminalState?.html_url ?? closedAvailability?.evidenceUrl ?? issue.html_url,
      true,
    ));
  } else if (openLifecycle) {
    score -= 40;
    signals.push(signal(
      "Bounty lifecycle label coexists with open slots",
      -40,
      `GitHub labels this bounty ${JSON.stringify(terminalLabels[0])}, while maintainer-controlled issue evidence still advertises open claim capacity. Confirm the remaining slot before starting.`,
      openAvailability.evidenceUrl ?? issue.html_url,
    ));
  } else if (maintainerTerminalState) {
    score -= 40;
    signals.push(signal(
      "Maintainer reports accepted or paid work",
      -40,
      "A maintainer reports accepted, approved, awarded, settled, or paid work. Confirm that a separate claim slot is still open before starting.",
      maintainerTerminalState.html_url ?? issue.html_url,
    ));
  }

  if (currentPlatformClaim) {
    score -= 70;
    signals.push(signal(
      currentPlatformClaim.label,
      -70,
      currentPlatformClaim.detail,
      currentPlatformClaim.evidenceUrl,
      true,
    ));
  }

  if (activeClaims.length) {
    score -= 70;
    const latest = activeClaims.sort((left, right) => commentTime(right.comment) - commentTime(left.comment))[0];
    signals.push(signal(
      "Active soft-lock claim",
      -70,
      `${activeClaims.length} claimant${activeClaims.length === 1 ? " is" : "s are"} still within the repository's ${latest.ttlDays}-day soft-lock window.`,
      latest.comment.html_url ?? issue.html_url,
      true,
    ));
  }

  if (claimantInterest.length) {
    const impact = -Math.min(30, claimantInterest.length * 10);
    score += impact;
    const latest = claimantInterest.sort((left, right) => commentTime(right.comment) - commentTime(left.comment))[0];
    signals.push(signal(
      "Unconfirmed claimant interest",
      impact,
      `${claimantInterest.length} distinct user${claimantInterest.length === 1 ? " has" : "s have"} explicitly indicated current intent to work on the issue within the last ${CLAIM_INTENT_TTL_DAYS} days; this is competition evidence, not a confirmed assignment.`,
      latest.comment.html_url ?? issue.html_url,
    ));
  }

  if (reward.state === "LISTED") {
    score += 5;
    signals.push(signal(
      "Trusted platform listing found",
      5,
      `${reward.platform} currently advertises${reward.amount === null ? "" : ` a $${reward.amount} USD`} reward${platformEvidence?.platform === "BountyHub" ? `; $${platformEvidence.secured_amount} is platform-held/prepaid and $${platformEvidence.promised_amount} remains pay-when-solved` : ""}, but creator approval and payout are still not guaranteed.`,
      reward.evidenceUrl,
    ));
  } else if (reward.state === "PROMISED") {
    signals.push(signal(
      platformEvidence?.platform === "BountyHub" ? "Platform pay-when-solved promise found" : "Maintainer reward promise found",
      0,
      platformEvidence?.platform === "BountyHub"
        ? `BountyHub records a $${platformEvidence.promised_amount} pay-when-solved reward, but no platform-held/prepaid amount; creator approval and payout are not guaranteed.`
        : "A repository maintainer advertises a reward, but no prepaid or escrowed settlement was independently verified.",
      reward.evidenceUrl,
    ));
  } else if (reward.state === "UNVERIFIED") {
    score -= 25;
    signals.push(signal(
      "Reward is unverified",
      -25,
      "The issue advertises a bounty or reward without a trusted platform record or maintainer-authored payment statement.",
      reward.evidenceUrl,
    ));
    if (!MAINTAINER_ASSOCIATIONS.has(issue.author_association)) {
      score -= 70;
      signals.push(signal(
        "Bounty issuer lacks repository authority",
        -70,
        "The advertised reward was posted by an issue author who is not a repository owner, member, or collaborator, and no trusted platform or maintainer confirms it.",
        reward.evidenceUrl,
        true,
      ));
    }
  } else if (reward.state === "NOT_FOUND") {
    score -= 25;
    signals.push(signal(
      "No reward evidence found",
      -25,
      "No trusted platform listing or maintainer-authored reward statement appeared in the bounded GitHub evidence.",
      reward.evidenceUrl,
    ));
  }

  if (externalSource) {
    score -= 40;
    signals.push(signal(
      "External source issue requires separate verification",
      -40,
      `This issue mirrors work from ${externalSource.repository}. Authority in the mirror does not prove that the target repository will accept the work; check the linked source issue before coding.`,
      externalSource.url,
    ));
  } else if (externalPlatformSource) {
    score -= 40;
    signals.push(signal(
      "External bounty platform requires separate verification",
      -40,
      `The maintainer-authored issue declares a mirrored board and names ${externalPlatformSource.host} as the source of truth. This check does not fetch that platform; verify claim capacity and current state there before coding.`,
      externalPlatformSource.url,
    ));
  }

  if (repository.archived) {
    score -= 100;
    signals.push(signal("Repository is archived", -100, "Archived repositories no longer accept normal development work.", repository.html_url, true));
  } else if (repoAge <= 30) {
    score += 10;
    signals.push(signal("Repository is active", 10, `The repository was pushed to ${repoAge} day${repoAge === 1 ? "" : "s"} ago.`, repository.html_url));
  } else if (repoAge > 180) {
    score -= 20;
    signals.push(signal("Repository appears stale", -20, `The last push was ${repoAge} days ago.`, repository.html_url));
  }

  if (issueAge <= 30) {
    score += 8;
    signals.push(signal("Issue is current", 8, `The issue changed ${issueAge} day${issueAge === 1 ? "" : "s"} ago.`, issue.html_url));
  } else if (issueAge > 180) {
    score -= 12;
    signals.push(signal("Issue is stale", -12, `The issue has not changed for ${issueAge} days.`, issue.html_url));
  }

  if (openPulls.length === 0 && mergedPulls.length === 0 && referencedPulls.length === 0 && !coverage.timelineTruncated) {
    score += 10;
    signals.push(signal("No linked open PR found", 10, "No open pull request appeared in the complete scanned timeline."));
  } else {
    if (openPulls.length) {
      const impact = -Math.min(50, openPulls.length * 25);
      score += impact;
      signals.push(signal("Competing open PR", impact, `${openPulls.length} linked pull request${openPulls.length === 1 ? " is" : "s are"} still open.`, openPulls[0].url));
    }
  }

  if (mergedPulls.length) {
    score -= 100;
    signals.push(signal(
      "Merged implementation PR",
      -100,
      `${mergedPulls.length} linked pull request${mergedPulls.length === 1 ? " has" : "s have"} already been merged, so the requested implementation appears delivered even if the issue remains open.`,
      mergedPulls[0].url,
      true,
    ));
  }

  if (referencedPulls.length) {
    const impact = -Math.min(30, referencedPulls.length * 15);
    score += impact;
    signals.push(signal(
      "Referenced competing PR",
      impact,
      `${referencedPulls.length} exact same-owner pull request URL${referencedPulls.length === 1 ? " appears" : "s appear"} in the issue discussion but not in the bounded timeline evidence; confirm relevance and current PR status before starting parallel work.`,
      referencedPulls[0].evidenceUrl ?? referencedPulls[0].url,
    ));
  }

  if (closedPulls.length >= 3) {
    const impact = -Math.min(35, closedPulls.length * 4);
    score += impact;
    signals.push(signal("Closed-PR swarm", impact, `${closedPulls.length} linked pull requests were closed without merging.`, closedPulls[0].url));
  }

  if (attemptUsers.length >= 3) {
    const impact = -Math.min(35, attemptUsers.length * 3);
    score += impact;
    signals.push(signal("Attempt swarm", impact, `${attemptUsers.length} distinct users posted try, attempt, or claim commands.`));
  }

  if (maintainerWarnings.length) {
    score -= 60;
    const comment = maintainerWarnings.at(-1);
    signals.push(signal("Maintainer rejection signal", -60, "A maintainer-authored issue or comment contains an explicit rejection, spam, or low-quality-contribution warning.", comment.html_url, true));
  }

  if (platformRejection) {
    score -= 70;
    signals.push(signal(
      "Reward platform rejected listing",
      -70,
      "An authenticated Opire application reports that the issue's advertised reward amount was not created.",
      platformRejection.html_url,
      true,
    ));
  } else if (platformEmpty) {
    score -= 70;
    signals.push(signal(
      "Reward platform reports no current reward",
      -70,
      "The authenticated Opire application reports that this Opire-bound issue currently has no reward.",
      platformEmpty.html_url,
      true,
    ));
  } else if (withdrawals.length) {
    score -= 70;
    const comment = withdrawals.at(-1);
    signals.push(signal(
      "Reward withdrawal signal",
      -70,
      comment.source === "issue_body"
        ? "The current maintainer-authored issue text says that the bounty or reward will not be paid; comment chronology cannot establish when that text was edited."
        : "A current maintainer comment indicates that a bounty or reward was removed, withdrawn, or cancelled.",
      comment.html_url,
      true,
    ));
  }

  if (aiPolicyBlocks.length) {
    score -= 70;
    const document = aiPolicyBlocks[0];
    signals.push(signal("Repository AI policy blocks the work", -70, "An official contribution document appears to prohibit AI-generated or AI-assisted contributions.", document.html_url, true));
  } else if (aiPolicyRequirements.length) {
    score -= 5;
    const document = aiPolicyRequirements[0];
    signals.push(signal("AI-use disclosure required", -5, "An official contribution document appears to require disclosure or labeling of AI assistance.", document.html_url));
  }

  if (policyRewardDisavowals.length) {
    score -= 100;
    const document = policyRewardDisavowals[0];
    signals.push(signal(
      "Repository policy disavows paid bounty",
      -100,
      "An official contribution document says repository bounties or rewards are symbolic, unpaid, or not paid work.",
      document.html_url,
      true,
    ));
  }

  if (sensitivePolicyRequests.length) {
    score -= 100;
    const document = sensitivePolicyRequests[0];
    signals.push(signal(
      "Repository policy requests sensitive agent context",
      -100,
      "An official contribution document requests full initialization context together with tool-access or session-configuration details. Do not disclose private agent context.",
      document.html_url,
      true,
    ));
  }

  if (externalPrerequisites.length) {
    const impact = -Math.min(15, externalPrerequisites.length * 3);
    score += impact;
    signals.push(signal(
      "Mandatory external prerequisites",
      impact,
      `The issue explicitly requires external execution prerequisites: ${externalPrerequisites.join(", ")}. Confirm access and willingness to complete them before investing implementation time.`,
      issue.html_url,
    ));
  }

  if (unsafeTaskInstructions.length) {
    score -= 100;
    const instruction = unsafeTaskInstructions[0];
    signals.push(signal(
      "Unsafe task instructions",
      -100,
      `The ${instruction.source} requests disclosure or publication of ${instruction.category}. Do not perform or reproduce that request.`,
      instruction.html_url,
      true,
    ));
  }

  if ((issue.body ?? "").trim().length < 120) {
    score -= 10;
    signals.push(signal("Thin specification", -10, "The issue body is too short to provide strong acceptance criteria.", issue.html_url));
  }

  if (coverage.commentsTruncated || coverage.timelineTruncated) {
    score -= 5;
    const truncated = [
      coverage.commentsTruncated ? "comments" : null,
      coverage.timelineTruncated ? "timeline" : null,
    ].filter(Boolean).join(" and ");
    signals.push(signal(
      "Evidence coverage is truncated",
      -5,
      `The bounded GitHub ${truncated} window is incomplete, so absence of competition cannot establish viability.`,
      issue.html_url,
    ));
  }

  score = Math.max(0, Math.min(100, score));
  const hasHardStop = signals.some((item) => item.hardStop);
  const incompleteCoverage = coverage.commentsTruncated || coverage.timelineTruncated;
  const verdict = hasHardStop || score < 45
    ? "AVOID"
    : claimantInterest.length || score < 75 || incompleteCoverage
    ? "CAUTION"
    : "VIABLE";

  return {
    verdict,
    score,
    issueAge,
    repoAge,
    attempts: attemptUsers,
    pullRequests: pulls,
    maintainerWarnings,
    withdrawals,
    aiPolicyBlocks,
    aiPolicyRequirements,
    externalPrerequisites,
    unsafeTaskInstructions,
    reward,
    activeClaims,
    claimantInterest,
    signals: signals.sort((left, right) => left.impact - right.impact)
  };
}
