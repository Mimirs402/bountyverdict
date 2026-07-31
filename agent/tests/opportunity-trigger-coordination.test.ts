import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { coordinateOpportunityTrigger } from "../src/opportunity-trigger-coordination.ts";
import type { OpportunityCandidate } from "../src/opportunity-agent-workflow.ts";

const candidate: OpportunityCandidate = {
  market: "taskmarket",
  task_id: `0x${"a".repeat(64)}`,
  title: "Implement a bounded parser.",
  mode: "bounty",
  gross_reward_usdc: "6",
  net_reward_usdc: "5.55",
  submission_count: 1,
  created_at: "2026-07-21T11:30:00.000Z",
  deadline_at: "2026-07-21T18:00:00.000Z",
  hours_remaining: 6,
  escrow_tx_hash: `0x${"b".repeat(64)}`,
  requester: "0x1111111111111111111111111111111111111111",
  opportunity_score_usdc_per_current_entry: "2.775",
  requires_agent_fit_review: true,
  selection_basis:
    "official escrow-backed open bounty; non-owner requester; <=3 submissions; >=5 USDC net; <=12h old; >=2h remaining",
};

test("a pending workflow preserves its marker and does not remember a newly eligible candidate", async () => {
  const root = await mkdtemp(join(tmpdir(), "bountyverdict-pending-trigger-"));
  const marker = join(root, "opportunity-trigger.json");
  const original = "{\"pending\":\"unchanged\"}\n";
  await writeFile(marker, original, { mode: 0o600 });
  let writes = 0;
  try {
    const result = await coordinateOpportunityTrigger({
      candidates: [candidate],
      rememberedOpportunityFingerprints: [],
      checkedAt: "2026-07-21T12:00:00.000Z",
      pendingTriggerId: "f".repeat(64),
      writeTrigger: async (trigger) => {
        writes += 1;
        await writeFile(marker, `${JSON.stringify(trigger)}\n`, { mode: 0o600 });
      },
    });
    assert.equal(result.trigger, null);
    assert.deepEqual(result.remembered_opportunity_fingerprints, []);
    assert.equal(writes, 0);
    assert.equal(await readFile(marker, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
