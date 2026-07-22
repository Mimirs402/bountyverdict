const MAINTAINER_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const TRUSTED_BOUNTY_APPS = new Set(["algora-pbc"]);

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
  /bounty hunters?.*(?:noise|slop|spam)/i
];

const WITHDRAWAL_PATTERNS = [
  /remov(?:e|ed|ing).{0,40}(?:reward|bounty)/i,
  /(?:reward|bounty).{0,40}remov(?:e|ed|ing)/i,
  /withdraw(?:n|ing)?.{0,40}(?:reward|bounty)/i,
  /(?:reward|bounty).{0,40}withdraw(?:n|ing)?/i,
  /no longer.{0,40}(?:reward|bounty)/i,
  /cancel(?:led|ing)?.{0,40}(?:reward|bounty)/i
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

const CLAIM_INTENT_TTL_DAYS = 30;
const CLAIM_INTENT_PATTERNS = [
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
  /(?:^|\n)\s*taking\s+(?:this|it|the issue)\b/im,
];
const CLAIM_INTENT_WITHDRAWAL_PATTERNS = [
  /\bwithdraw(?:ing)?\s+(?:my\s+)?(?:claim|interest|attempt)\b/i,
  /\bno longer\s+(?:working|claiming|interested)\b/i,
  /\b(?:can['’]?t|cannot|won['’]?t|will not)\s+(?:continue\s+)?work(?:ing)?\s+on\s+(?:this|it|the issue)\b/i,
  /\b(?:please\s+)?unassign\s+me\b/i,
  /\b(?:dropping|giving up)\s+(?:this|it|the issue|my claim)\b/i,
];

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

function uniquePullRequests(timeline = []) {
  const pulls = new Map();
  for (const event of timeline) {
    const item = event.event === "cross-referenced" ? event.source?.issue : null;
    const url = item?.pull_request?.html_url;
    if (!url) continue;
    pulls.set(url, {
      url,
      state: item.state,
      title: item.title,
      author: item.user?.login ?? "unknown"
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

function platformClaimState(comments, openPulls) {
  const official = comments.filter((comment) => TRUSTED_BOUNTY_APPS.has(comment.performed_via_github_app?.slug));
  const stateComments = official
    .filter((comment) => /(?:^|\n)\|\s*🟢\s+@[^|]+\|/m.test(comment.body ?? "") || /bounty is (?:now )?up for grabs/i.test(comment.body ?? ""))
    .sort((left, right) => commentTime(right) - commentTime(left));
  const current = stateComments[0];
  if (current && !/bounty is (?:now )?up for grabs/i.test(current.body ?? "") && /(?:^|\n)\|\s*🟢\s+@[^|]+\|/m.test(current.body ?? "")) {
    return {
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
        detail: "Algora links an existing open pull request that claims this bounty.",
        evidenceUrl: claim.html_url ?? pull.url,
      };
    }
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

function isAffirmativeRewardedLabel(value) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
  return /^(?:(?:bounty|reward)\s*[:=/_-]?\s*)?rewarded$/i.test(normalized);
}

function rewardEvidence(issue, comments) {
  const officialAlgora = comments.find((comment) =>
    TRUSTED_BOUNTY_APPS.has(comment.performed_via_github_app?.slug) &&
    /##\s*💎\s*\$[\d,.]+\s+bounty\b/i.test(comment.body ?? "")
  );
  if (officialAlgora) {
    return {
      state: "LISTED",
      verification: "TRUSTED_PLATFORM_APP",
      platform: "Algora",
      ...amountFromText(officialAlgora.body),
      evidenceUrl: officialAlgora.html_url ?? issue.html_url,
    };
  }

  const issueText = `${issue.title ?? ""}\n${issue.body ?? ""}`;
  const maintainerIssue = MAINTAINER_ASSOCIATIONS.has(issue.author_association) && /(?:bounty|reward)/i.test(issueText);
  const maintainerComment = comments.find((comment) =>
    MAINTAINER_ASSOCIATIONS.has(comment.author_association) && /(?:bounty|reward)/i.test(comment.body ?? "") &&
    /(?:\$\s*[\d]|\bpaid?\b|\breceive\b)/i.test(comment.body ?? "")
  );
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

function activeSoftLockClaims(issue, comments, now) {
  const ttlMatch = String(issue.body ?? "").match(/soft[ -]?lock.{0,40}?([1-9]\d?)\s*days?/i);
  if (!ttlMatch) return [];
  const ttlDays = Number(ttlMatch[1]);
  const states = new Map();
  const ordered = [...comments].sort((left, right) => commentTime(left) - commentTime(right));
  for (const comment of ordered) {
    const login = comment.user?.login;
    if (!login) continue;
    const body = comment.body ?? "";
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

function activeClaimIntent(comments, now) {
  const states = new Map();
  const ordered = [...comments].sort((left, right) => commentTime(left) - commentTime(right));
  for (const comment of ordered) {
    const login = comment.user?.login;
    if (!login || TRUSTED_BOUNTY_APPS.has(comment.performed_via_github_app?.slug)) continue;
    const body = comment.body ?? "";
    if (CLAIM_INTENT_WITHDRAWAL_PATTERNS.some((pattern) => pattern.test(body))) {
      states.delete(login);
      continue;
    }
    if (CLAIM_INTENT_PATTERNS.some((pattern) => pattern.test(body))) states.set(login, comment);
  }
  const cutoff = now.getTime() - CLAIM_INTENT_TTL_DAYS * 86_400_000;
  return [...states.entries()].flatMap(([login, comment]) =>
    commentTime(comment) >= cutoff ? [{ login, comment }] : []
  );
}

export function analyzeBounty({ issue, repository, comments = [], timeline = [], policyDocuments = [], coverage = {}, now = new Date() }) {
  const signals = [];
  const assignees = Array.isArray(issue.assignees)
    ? issue.assignees.filter((assignee) => typeof assignee?.login === "string" && assignee.login.trim())
    : [];
  const pulls = uniquePullRequests(timeline);
  const openPulls = pulls.filter((pull) => pull.state === "open");
  const closedPulls = pulls.filter((pull) => pull.state === "closed");
  const rewardedLabels = issueLabelNames(issue).filter(isAffirmativeRewardedLabel);
  const currentPlatformClaim = platformClaimState(comments, openPulls);
  const activeClaims = activeSoftLockClaims(issue, comments, now);
  const claimantInterest = activeClaimIntent(comments, now);
  const attempts = comments.filter((comment) => /^\s*\/(?:(?:try|attempt|claim)\b|opire\s+(?:try|claim)\b)/im.test(comment.body ?? ""));
  const attemptUsers = [...new Set(attempts.map((comment) => comment.user?.login).filter(Boolean))];
  const maintainerWarnings = matchingComments(comments, NEGATIVE_MAINTAINER_PATTERNS, true);
  const withdrawals = matchingComments(comments, WITHDRAWAL_PATTERNS, false);
  const reward = rewardEvidence(issue, comments);
  if (rewardedLabels.length) {
    reward.state = "PAID_OR_AWARDED";
    reward.evidenceUrl = issue.html_url;
  } else if (withdrawals.length) {
    reward.state = "WITHDRAWN";
    reward.evidenceUrl = withdrawals.at(-1)?.html_url ?? issue.html_url;
  }
  const aiPolicyBlocks = policyDocuments.filter((document) =>
    AI_POLICY_BLOCK_PATTERNS.some((pattern) => pattern.test(document.body ?? ""))
  );
  const aiPolicyRequirements = policyDocuments.filter((document) =>
    AI_POLICY_DISCLOSURE_PATTERNS.some((pattern) => pattern.test(document.body ?? ""))
  );
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
  }

  if (currentPlatformClaim) {
    score -= 70;
    signals.push(signal(
      "Bounty platform reports active competition",
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
      `${reward.platform} currently advertises${reward.amount === null ? "" : ` a $${reward.amount} USD`} reward, but acceptance and payout are still not guaranteed.`,
      reward.evidenceUrl,
    ));
  } else if (reward.state === "PROMISED") {
    signals.push(signal(
      "Maintainer reward promise found",
      0,
      "A repository maintainer advertises a reward, but no prepaid or escrowed settlement was independently verified.",
      reward.evidenceUrl,
    ));
  } else if (reward.state === "UNVERIFIED") {
    score -= 25;
    signals.push(signal(
      "Reward is unverified",
      -25,
      "The issue advertises a bounty or reward without a trusted platform-app record or maintainer-authored payment statement.",
      reward.evidenceUrl,
    ));
  } else if (reward.state === "NOT_FOUND") {
    score -= 25;
    signals.push(signal(
      "No reward evidence found",
      -25,
      "No trusted platform listing or maintainer-authored reward statement appeared in the bounded GitHub evidence.",
      reward.evidenceUrl,
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

  if (openPulls.length === 0 && !coverage.timelineTruncated) {
    score += 10;
    signals.push(signal("No linked open PR found", 10, "No open pull request appeared in the complete scanned timeline."));
  } else {
    if (openPulls.length) {
      const impact = -Math.min(50, openPulls.length * 25);
      score += impact;
      signals.push(signal("Competing open PR", impact, `${openPulls.length} linked pull request${openPulls.length === 1 ? " is" : "s are"} still open.`, openPulls[0].url));
    }
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
    signals.push(signal("Maintainer rejection signal", -60, "A maintainer comment contains an explicit rejection, spam, or low-quality-contribution warning.", comment.html_url, true));
  }

  if (withdrawals.length) {
    score -= 70;
    const comment = withdrawals.at(-1);
    signals.push(signal("Reward withdrawal signal", -70, "The discussion contains language indicating that a bounty or reward was removed, withdrawn, or cancelled.", comment.html_url, true));
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
    reward,
    activeClaims,
    claimantInterest,
    signals: signals.sort((left, right) => left.impact - right.impact)
  };
}
