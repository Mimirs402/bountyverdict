const MAINTAINER_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

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
  /spam(?:my|med|ming)?/i,
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

export function analyzeBounty({ issue, repository, comments = [], timeline = [], now = new Date() }) {
  const signals = [];
  const pulls = uniquePullRequests(timeline);
  const openPulls = pulls.filter((pull) => pull.state === "open");
  const closedPulls = pulls.filter((pull) => pull.state === "closed");
  const attempts = comments.filter((comment) => /^\s*\/(?:try|attempt|claim)\b/im.test(comment.body ?? ""));
  const attemptUsers = [...new Set(attempts.map((comment) => comment.user?.login).filter(Boolean))];
  const maintainerWarnings = matchingComments(comments, NEGATIVE_MAINTAINER_PATTERNS, true);
  const withdrawals = matchingComments(comments, WITHDRAWAL_PATTERNS, false);
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

  if (openPulls.length === 0) {
    score += 10;
    signals.push(signal("No linked open PR found", 10, "No open pull request appeared in the first 100 timeline events."));
  } else {
    const impact = -Math.min(50, openPulls.length * 25);
    score += impact;
    signals.push(signal("Competing open PR", impact, `${openPulls.length} linked pull request${openPulls.length === 1 ? " is" : "s are"} still open.`, openPulls[0].url));
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

  if ((issue.body ?? "").trim().length < 120) {
    score -= 10;
    signals.push(signal("Thin specification", -10, "The issue body is too short to provide strong acceptance criteria.", issue.html_url));
  }

  score = Math.max(0, Math.min(100, score));
  const hasHardStop = signals.some((item) => item.hardStop);
  const verdict = hasHardStop || score < 45 ? "AVOID" : score < 75 ? "CAUTION" : "VIABLE";

  return {
    verdict,
    score,
    issueAge,
    repoAge,
    attempts: attemptUsers,
    pullRequests: pulls,
    maintainerWarnings,
    withdrawals,
    signals: signals.sort((left, right) => left.impact - right.impact)
  };
}

