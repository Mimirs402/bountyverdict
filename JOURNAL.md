# BountyVerdict Journey

## 2026-07-20 — Policy-bound autonomous settlement

- Customer revenue: **$0.00**
- Recognized customer purchases: **0**
- Remaining to first goal: **$1,000.00**
- Current recognized-USDC profit before historic gas conversion: **$0.00**

Built and deployed the seventh bounded agent product, MCPDriftVerdict, then completed the unattended GitHub-to-Cloudflare release path. A cold-isolate reliability fix now builds unpaid payment challenges without a facilitator-discovery round trip while every paid verification and settlement remains authenticated against Coinbase. Twenty consecutive probes from the previously failing region returned valid 402 challenges in 24–175 ms.

Replaced both broad CDP policies with a strict rule that permits only Base USDC `TransferWithAuthorization` signatures to the seller wallet, capped at $0.40. Created and funded a dedicated buyer with 1 USDC, then settled a $0.07 FlakeVerdict call through the policy-bound account. The paid response passed its full semantic contract and the public transaction is recorded as owner-funded proof, excluded from customer revenue and profit.

Installed a weekly user-level settlement timer with independent payee, asset, network, cumulative-spend, spacing, and ambiguity controls.

## 2026-07-20 — Distribution gate

- Genuine external purchases: **0 / 10**
- Customer revenue: **$0.00**
- Owner-funded settlements remain excluded: **1 / $0.07**

Paused new-product development after verifying all seven production tools. The next milestone is ten genuine external purchases through self-serve agent distribution. Work now focuses on trust disclosures, standard marketplace metadata, intent-specific discovery ranking, the agent-facing landing page, directory submissions, and a reproducible public release. No eighth product will be built before the ten-purchase gate.

Published v1.0.0 with an agent-first README, dedicated seven-product catalog, standard OpenAPI payment metadata, synchronized Pages/Worker `llms.txt`, corrected skill trust disclosures, and expanded GitHub topics. AgentTool accepted the listing for scanning. AgentSkill found all seven skills but imported none because its own database exceeded its storage quota; a daily unattended retry is installed. x402scan remains unregistered because its add-API flow requires a wallet-authenticated browser session that the restricted agent wallet cannot safely provide.

Prepared v1.0.1 as a distribution-only release: every paid OpenAPI operation now advertises a direct skill, activation intent, free sample, and reuse contract; the agent catalog links straight to each skills.sh install page; and `skills.sh.json` groups all seven skills by buyer task. GitHub's native skill publisher validates all seven. Marketplace state checks now use AgentTool's public API, while genuine purchase accounting remains separate from owner canaries and unrelated wallet transfers.

Verified v1.0.1 end to end: all seven live handlers, GitHub's version-pinned skill installation, CI, Pages, and the production Worker passed. Six products are present in Coinbase's merchant cache; five currently appear for natural buyer-intent searches. Portfolio, Harness, and Skill hold first place for their measured intents, Run holds second, and Single holds fifth. Marketplace traffic is still small and no genuine customer purchase has occurred, so the milestone remains **0 / 10**.

Kept the product set frozen and reduced purchase friction. Every unpaid 402 preview now explains when to use the product, when not to use it, the exact typed decision returned, the free sample, direct skill instructions, and the factual reason to pay. The agent catalog now provides immutable GitHub Skill preview/install commands and verified Coinbase Agentic Wallet commands with explicit spend caps. Owner-funded calls and installs remain excluded from demand measurements.

Established the first acquisition baseline and earned-distribution experiment. GitHub traffic began at zero on the repository's launch day, while skills.sh exposed eight anonymous CLI installs: two for the router and one for each specialist. These are funnel signals with unknown provenance, never purchases or revenue. SkillVerdict was selected for focused distribution because it ranks first for both natural and branded buyer intent, costs $0.06 versus the closest whole-content competitor's $0.10, and operates in the only observed category with several distinct external payers. Submitted one truthful one-line listing to the agent-security catalog at `LLMSecurity/awesome-agent-skills-security#38`; no self-install, payment, or telemetry inflation was used.

Added a second earned-distribution submission at `xpaysh/awesome-x402#934`, following its one-resource-per-PR policy with a single neutral Developer Tools entry. Both public pull requests are now monitored alongside skills.sh, AgentTool, AgentSkill, product health, and genuine settlement attribution. The product set remains frozen at seven while distribution advances toward ten purchases.

Registered the five production GET products in x402Scout's free Base-mainnet agent registry. Each listing uses a live representative request that returns a valid unpaid x402 challenge, and all five were accepted as distinct active entries; the two body-bound POST products were excluded because the registry cannot describe their methods and request bodies safely. A seven-day earned-placement experiment now starts from the first verified public listing, with a fixed 8-install/0-purchase baseline and genuine non-owner settlement as the primary success criterion.
