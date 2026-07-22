# BountyVerdict field test — 2026-07-22

This is an owner-run product evaluation, not organic demand, a customer purchase, or revenue. GitHub and marketplace state can change after the capture time.

## Question

Could BountyVerdict find a public software bounty that an autonomous coding agent should start immediately, while avoiding duplicate work, stale marketplace listings, unsafe instructions, and unverifiable rewards?

## Method

- Search current GitHub and public bounty-platform inventory for apparently open software work.
- Run the production-equivalent local `checkGithubIssue` implementation against each canonical GitHub issue with authenticated GitHub API capacity.
- Inspect the highest-scoring candidates' issue bodies, complete bounded comments and timelines, platform evidence, linked pull requests, contribution rules, and execution prerequisites.
- Start no work unless the current evidence supports a `VIABLE` verdict and the task is executable without missing accounts, hardware, inputs, or authorization.

## Result

Twenty-four distinct candidates were checked. The initial run produced 21 AVOID, 3 CAUTION, and 0 VIABLE. After the missed slash-claim and comment-linked-PR signals were fixed and the affected candidates were rerun, the final result was **23 AVOID**, **1 CAUTION**, and **0 VIABLE**. No claim, pull request, or payment was made. The correct business decision was to preserve engineering time and keep watching for a safer opening.

| Candidate | Advertised reward | Result | Decisive current evidence |
| --- | ---: | --- | --- |
| [Memanto memory migration](https://github.com/moorcheh-ai/memanto/issues/1609) | $200 | CAUTION | Platform-held listing, but a claimant is active and the submission requires an external account, real provider data, a demo video, and public social distribution. |
| [Fluxer events/calendar](https://github.com/fluxerapp/fluxer-meta/issues/3) | $500 | CAUTION before fix → AVOID | Several closed attempts plus explicit `/claim` comments and PR URLs pasted into comments; those last two signals exposed a detector gap fixed by this field test. |
| [Fluxer advanced calendar](https://github.com/fluxerapp/fluxer-meta/issues/22) | Title $125; historical bot comment $10 | CAUTION before fix → AVOID | Thin specification, multiple explicit claims, PR URLs in comments, and conflicting historical reward text. |
| [Nirium Express x402 middleware](https://github.com/nirium-protocol/nirium-sdk/issues/9) | 25 USDC | AVOID | A live pull request already implements the task and several agents have declared intent. |
| [Nirium Python x402 decorator](https://github.com/nirium-protocol/nirium-sdk/issues/10) | 25 USDC | AVOID | A live pull request already implements the task and several agents have declared intent. |
| [Tari CPU mining over 64 threads](https://github.com/tari-project/universe/issues/3299) | 60,000 XTM | AVOID | Competing PR and claimant; acceptance requires Windows hardware with more than 64 logical cores. |
| [Tari wallet performance harness](https://github.com/tari-project/wallet-benchmarks/issues/1) | 150,000 XTM | AVOID | Three open PRs, four closed attempts, and reward-authority ambiguity. |
| [Tenstorrent ModernBERT bring-up](https://github.com/tenstorrent/tt-metal/issues/50522) | $1,500 | AVOID | Assigned and marked worked on. |
| [Cognitive-OS architecture research](https://github.com/aLexzzz430/Cognitive-OS/issues/5) | $3,000 | AVOID | Unsafe request for hidden agent context, 21 open PRs, and an attempt swarm. |
| [Fluxer threads](https://github.com/fluxerapp/fluxer-meta/issues/5) | $800 platform total | AVOID | Active platform claims, maintainer rejection signal, and repeated failed attempts. |
| [Fluxer polls](https://github.com/fluxerapp/fluxer-meta/issues/2) | $500 | AVOID | Active platform claim and open implementation PR. |
| [Fluxer activity detection](https://github.com/fluxerapp/fluxer-meta/issues/8) | $250 | AVOID | Active platform claim. |
| [Freelens custom themes](https://github.com/freelensapp/freelens/issues/1280) | $50 prepaid | AVOID | Assigned, claimed, two open PRs, 12 closed PRs, and a maintainer rejection warning. |
| [microG remote DroidGuard](https://github.com/microg/GmsCore/issues/2851) | $35 prepaid | AVOID | Five open PRs, nine closed PRs, and current claimant interest. |
| [InvenTree repair orders](https://github.com/inventree/InvenTree/issues/12064) | $15 promised | AVOID | Assigned, claimed, and four open PRs. |
| [Hydroxide CalDAV](https://github.com/emersion/hydroxide/issues/207) | $250 prepaid | AVOID | Canonical issue closed while the platform still listed it; an open PR remains. |
| [Iamgoofball SDQL2 parser](https://github.com/Iamgoofball/-tg-station/issues/214) | $20 | AVOID | Reward issuer lacks repository authority and a competing PR is open. |
| [Iamgoofball bounty-label action](https://github.com/Iamgoofball/-tg-station/issues/174) | $20 | AVOID | Reward issuer lacks authority, three competing PRs, and claimant interest. |
| [Hash Report SHA-3](https://github.com/amithmandassociates-oss/hash-report-tool/issues/2) | Historical Algora $50 | AVOID | One open PR, many failed attempts, stale repository, and no currently verified reward in the GitHub evidence contract. |
| [Elysia JSON errors](https://github.com/elysiajs/elysia/issues/313) | Historical Algora $100 | AVOID | Assigned and has a competing open PR. |
| [pgstrap PGlite](https://github.com/seveibar/pgstrap/issues/2) | Historical Algora listing | AVOID | Open and closed PR swarm, attempt swarm, and stale repository. |
| [markdown-oxide workspace aliases](https://github.com/Feel-ix-343/markdown-oxide/issues/263) | Historical Algora listing | AVOID | Competing open PR and repeated attempts. |
| [markdown-oxide bracket references](https://github.com/Feel-ix-343/markdown-oxide/issues/269) | Historical Algora listing | AVOID | Competing open PR and repeated attempts. |
| [graphql-php return validation](https://github.com/webonyx/graphql-php/issues/1493) | Historical BountyHub comment | AVOID | Two open PRs and no current trusted reward evidence. |

## What the product learned

1. Canonical GitHub state must outrank a marketplace's “open” label. Several paid listings pointed at closed, assigned, or already-implemented issues.
2. Competition is not confined to GitHub timeline cross-references. Agents paste exact pull-request URLs and explicit `/claim` or `/attempt` commands into comments; those must be deduplicated with timeline PRs.
3. A financially credible bounty can still be operationally unsuitable. Required accounts, private API keys, real hardware, demo videos, public promotion, or missing inputs should be surfaced as execution prerequisites rather than silently absorbed into a high score.
4. A positive `VIABLE → accepted → paid` case is still unproven. BountyVerdict should not claim positive selection efficacy until that complete outcome exists.

The field test therefore produced a concrete detector improvement and a truthful negative result: the tool prevented duplicate or non-executable work, but it has not yet earned a positive-outcome case study.
