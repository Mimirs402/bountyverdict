import { analyzeBounty, parseIssueUrl } from "./analysis.js";

const form = document.querySelector("#check-form");
const input = document.querySelector("#issue-url");
const submit = document.querySelector("#submit-check");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const template = document.querySelector("#result-template");

document.querySelector("#year").textContent = new Date().getFullYear();

for (const example of document.querySelectorAll("[data-example]")) {
  example.addEventListener("click", () => {
    input.value = example.dataset.example;
    form.requestSubmit();
  });
}

function apiHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function githubJson(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers: apiHeaders() });
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (!response.ok) {
    if (response.status === 404) throw new Error("GitHub could not find that public issue.");
    if (response.status === 403 && remaining === "0") throw new Error("GitHub's anonymous rate limit is exhausted for this network. Try again later.");
    throw new Error(`GitHub returned HTTP ${response.status}.`);
  }
  return { data: await response.json(), remaining, link: response.headers.get("link") };
}

function lastPageFromLink(link) {
  if (!link) return 1;
  const last = link.split(",").find((part) => /rel="last"/.test(part));
  const match = last?.match(/[?&]page=(\d+)/);
  return match ? Number(match[1]) : 1;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render({ issue, repository, analysis, remaining }) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector(".verdict-card");
  card.dataset.verdict = analysis.verdict.toLowerCase();
  fragment.querySelector(".verdict-label").textContent = analysis.verdict;
  fragment.querySelector(".score-value").textContent = analysis.score;
  fragment.querySelector(".issue-title").textContent = issue.title;
  fragment.querySelector(".repo-name").textContent = repository.full_name;
  fragment.querySelector(".issue-link").href = issue.html_url;

  const summary = analysis.verdict === "VIABLE"
    ? "The public evidence does not show an obvious stop signal. Reproduce the issue and confirm the reward terms before starting."
    : analysis.verdict === "CAUTION"
      ? "The issue has meaningful competition, staleness, or ambiguity. Investigate before investing implementation time."
      : "Public evidence contains a hard stop or severe risk. Do not treat the listed bounty as a reliable opportunity.";
  fragment.querySelector(".verdict-summary").textContent = summary;

  const list = fragment.querySelector(".signals");
  for (const item of analysis.signals) {
    const row = element("li", "signal");
    row.dataset.kind = item.impact < 0 ? "risk" : "positive";
    const copy = element("div", "signal-copy");
    copy.append(element("strong", null, item.label), element("p", null, item.detail));
    row.append(element("span", "impact", `${item.impact > 0 ? "+" : ""}${item.impact}`), copy);
    if (item.evidenceUrl) {
      const link = element("a", "evidence-link", "Evidence ↗");
      link.href = item.evidenceUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      row.append(link);
    }
    list.append(row);
  }

  fragment.querySelector(".scan-meta").textContent = `Checked ${new Date().toLocaleString()} · GitHub requests remaining: ${remaining ?? "unknown"}`;
  result.replaceChildren(fragment);
  result.hidden = false;
  result.scrollIntoView({ behavior: "smooth", block: "start" });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  result.hidden = true;
  status.textContent = "Checking GitHub state, discussion, and linked work…";
  status.dataset.kind = "loading";
  submit.disabled = true;

  try {
    const { owner, repo, number } = parseIssueUrl(input.value);
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const [issueResponse, repoResponse] = await Promise.all([
      githubJson(`${base}/issues/${number}`),
      githubJson(base)
    ]);
    const commentPageCount = Math.max(1, Math.ceil(issueResponse.data.comments / 100));
    const commentPages = Array.from({ length: Math.min(3, commentPageCount) }, (_, index) => index + 1);
    const [commentResponses, firstTimeline] = await Promise.all([
      Promise.all(commentPages.map((page) => githubJson(`${base}/issues/${number}/comments?per_page=100&page=${page}`))),
      githubJson(`${base}/issues/${number}/timeline?per_page=100&page=1`)
    ]);
    const timelineLastPage = lastPageFromLink(firstTimeline.link);
    const lastTimeline = timelineLastPage > 1
      ? await githubJson(`${base}/issues/${number}/timeline?per_page=100&page=${timelineLastPage}`)
      : null;
    const comments = commentResponses.flatMap((page) => page.data);
    const timeline = lastTimeline ? [...firstTimeline.data, ...lastTimeline.data] : firstTimeline.data;
    const remainingValues = [issueResponse, repoResponse, ...commentResponses, firstTimeline, lastTimeline]
      .filter(Boolean)
      .map((response) => Number(response.remaining))
      .filter(Number.isFinite);
    const analysis = analyzeBounty({
      issue: issueResponse.data,
      repository: repoResponse.data,
      comments,
      timeline
    });
    render({
      issue: issueResponse.data,
      repository: repoResponse.data,
      analysis,
      remaining: remainingValues.length ? Math.min(...remainingValues) : null
    });
    const share = new URL(window.location.href);
    share.searchParams.set("issue", input.value);
    history.replaceState(null, "", share);
    status.textContent = "Check complete. Results are evidence-based, not a payout guarantee.";
    status.dataset.kind = "done";
  } catch (error) {
    status.textContent = error.message;
    status.dataset.kind = "error";
  } finally {
    submit.disabled = false;
  }
});

const initialIssue = new URLSearchParams(window.location.search).get("issue");
if (initialIssue) {
  input.value = initialIssue;
  form.requestSubmit();
}
