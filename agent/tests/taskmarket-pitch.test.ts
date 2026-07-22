import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AGENTWORK_TASKMARKET_PITCH,
  parseAgentWorkTaskmarketPitch,
} from "../src/taskmarket-pitch.ts";

const pitchText = (await readFile(new URL("../config/taskmarket-agentwork-flowise-pitch.md", import.meta.url), "utf8")).trimEnd();
const task = (overrides: Record<string, unknown> = {}) => ({
  id: AGENTWORK_TASKMARKET_PITCH.taskId,
  mode: "pitch",
  status: "open",
  requester: AGENTWORK_TASKMARKET_PITCH.requesterAddress,
  requesterAgentId: AGENTWORK_TASKMARKET_PITCH.requesterAgentId,
  reward: AGENTWORK_TASKMARKET_PITCH.rewardAtomic,
  netReward: AGENTWORK_TASKMARKET_PITCH.netRewardAtomic,
  pitchDeadline: "2026-07-24T05:38:39.155Z",
  expiryTime: "2026-07-29T05:38:39.148Z",
  claimedBy: null,
  workerAgentId: null,
  ...overrides,
});
const pitch = (overrides: Record<string, unknown> = {}) => ({
  id: AGENTWORK_TASKMARKET_PITCH.pitchId,
  taskId: AGENTWORK_TASKMARKET_PITCH.taskId,
  workerAddress: AGENTWORK_TASKMARKET_PITCH.workerAddress,
  workerAgentId: AGENTWORK_TASKMARKET_PITCH.workerAgentId,
  pitchText,
  estimatedDuration: 48,
  status: "pending",
  submittedAt: "2026-07-22T17:01:45.896Z",
  ...overrides,
});

test("tracks the exact pending Flowise pitch without claiming revenue", () => {
  const result = parseAgentWorkTaskmarketPitch(task(), [pitch()], pitchText);
  assert.equal(result.state, "pending_selection");
  assert.equal(result.action, "wait_for_requester_selection");
  assert.equal(result.net_reward_usdc, "1.999999");
  assert.match(String(result.accounting), /not_purchase_award_settlement_or_revenue/);
});

test("selection triggers implementation only for the exact worker", () => {
  const selected = parseAgentWorkTaskmarketPitch(task({
    claimedBy: AGENTWORK_TASKMARKET_PITCH.workerAddress,
    workerAgentId: AGENTWORK_TASKMARKET_PITCH.workerAgentId,
  }), [pitch({ status: "selected" })], pitchText);
  assert.equal(selected.state, "selected");
  assert.equal(selected.action, "implement_flowise_integration");

  const lost = parseAgentWorkTaskmarketPitch(task({ claimedBy: "0x1111111111111111111111111111111111111111" }), [pitch()], pitchText);
  assert.equal(lost.state, "not_selected");
  assert.equal(lost.action, "stop_without_contacting_flowise");
});

test("rejects identity, artifact, duplicate, and economic drift", () => {
  assert.throws(() => parseAgentWorkTaskmarketPitch(task({ reward: "1" }), [pitch()], pitchText), /economics drifted/);
  assert.throws(() => parseAgentWorkTaskmarketPitch(task(), [pitch({ pitchText: "changed" })], pitchText), /artifact drifted/);
  assert.throws(() => parseAgentWorkTaskmarketPitch(task(), [pitch(), pitch()], pitchText), /duplicate ID/);
  assert.throws(() => parseAgentWorkTaskmarketPitch(task(), [], pitchText), /missing or ambiguous/);
});
