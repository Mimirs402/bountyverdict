import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { freeSelectionRoute } from "../src/free-selection-router.ts";
import { mcpDriftExample } from "../src/mcp-drift-discovery.ts";
import {
  OWNER_BUYER_JOURNEY_AMOUNT_ATOMIC,
  OWNER_BUYER_JOURNEY_ASSET,
  OWNER_BUYER_JOURNEY_INPUT,
  OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH,
  OWNER_BUYER_JOURNEY_NETWORK,
  OWNER_BUYER_JOURNEY_ORIGIN,
  OWNER_BUYER_JOURNEY_PAY_TO,
  OWNER_BUYER_JOURNEY_RELEASE_COMMIT,
  OWNER_BUYER_JOURNEY_RESOURCE_URL,
  normalizedOwnerJourneyBodyHash,
  selectNaturalBazaarMatch,
  validateOwnerHttpChallenge,
  validateOwnerJourneyPrerequisite,
  validateOwnerMcpChallenge,
  validateOwnerPaymentResult,
  validateOwnerSelectorResult,
} from "../src/owner-buyer-journey.ts";
import { declareMcpHttpPaymentHandoff } from "../src/payment-handoff.ts";

const activation = {
  schema_version: 1,
  experiment_id: "mcp-free-selection-router-v1",
  release_commit: OWNER_BUYER_JOURNEY_RELEASE_COMMIT,
  production_activation_commit: "a".repeat(40),
  production_activated_at: "2026-07-27T17:00:00.000Z",
  drain_rotation_id: "post-release-free-router-epoch-57",
  measurement_epoch_id: OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH,
  epoch_activated_at: "2026-07-27T17:20:00.000Z",
  target_tools_list: 25,
};

function terminalReport(toolsList = 25) {
  return {
    checked_at: "2026-07-27T18:00:00.000Z",
    mode: "report_only_without_semantic_retrieval",
    funnel: {
      mcp_free_selection_router_experiment: {
        id: "mcp-free-selection-router-v1",
        status: "completed",
        activation_verified: true,
        activation,
        measurement_epoch_id: OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH,
        target_tools_list: 25,
        remaining_eligible_tools_list: 0,
        boundary: {
          observed_at: "2026-07-27T17:59:00.000Z",
          observation_rule:
            "first_monitor_report_at_or_above_25_eligible_free_selection_router_tools_list_events",
          measurement_epoch_id: OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH,
          eligible_delta: { tools_list: toolsList },
          causal_copy_claim: false,
        },
      },
    },
  };
}

const ledger = {
  schema_version: 2,
  active_epoch_id: OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH,
  epochs: [{
    id: OWNER_BUYER_JOURNEY_MEASUREMENT_EPOCH,
    status: "active",
    conversion_eligible: true,
  }],
};

function paymentChallenge(resourceUrl: string) {
  return {
    x402Version: 2,
    resource: {
      url: resourceUrl,
      serviceName: "MCPDriftVerdict",
      description: "MCP drift compatibility gate.",
    },
    accepts: [{
      scheme: "exact",
      network: OWNER_BUYER_JOURNEY_NETWORK,
      amount: OWNER_BUYER_JOURNEY_AMOUNT_ATOMIC,
      asset: OWNER_BUYER_JOURNEY_ASSET,
      payTo: OWNER_BUYER_JOURNEY_PAY_TO,
    }],
    extensions: {
      bazaar: {
        info: {
          input: resourceUrl.startsWith("mcp:")
            ? { type: "mcp", toolName: "check_mcp_tool_drift", transport: "streamable-http" }
            : { method: "POST", bodyType: "json" },
        },
      },
    },
  };
}

test("owner journey starts only after the exact frozen epoch-57 N=25 boundary", () => {
  const ready = validateOwnerJourneyPrerequisite(terminalReport(), ledger);
  assert.equal(ready.eligibleToolsList, 25);
  assert.equal(ready.productionActivationCommit, "a".repeat(40));

  assert.throws(
    () => validateOwnerJourneyPrerequisite(terminalReport(24), ledger),
    /has not frozen/,
  );
  assert.throws(
    () => validateOwnerJourneyPrerequisite(terminalReport(), {
      ...ledger,
      active_epoch_id: 58,
    }),
    /frozen measurement epoch/,
  );
});

test("natural Bazaar selection requires one exact unfiltered canonical match", () => {
  const result = {
    items: [
      {
        resource: "https://example.com/other",
        scheme: "exact",
        network: "base",
        maxAmountRequired: "10000",
      },
      {
        resource: OWNER_BUYER_JOURNEY_RESOURCE_URL,
        description: "MCP tools/list compatibility gate.",
        scheme: "exact",
        network: "base",
        maxAmountRequired: OWNER_BUYER_JOURNEY_AMOUNT_ATOMIC,
      },
    ],
  };
  assert.deepEqual(selectNaturalBazaarMatch(result), {
    item: result.items[1],
    rank: 2,
    resultCount: 2,
  });
  assert.equal(selectNaturalBazaarMatch({ items: [result.items[0]] }), null);
  assert.throws(
    () => selectNaturalBazaarMatch({ items: [result.items[1], result.items[1]] }),
    /more than one/,
  );
  assert.throws(
    () => selectNaturalBazaarMatch({
      items: [{ ...result.items[1], maxAmountRequired: "20001" }],
    }),
    /exact bounded Base price/,
  );
});

test("selector and MCP handoff preserve the exact one-call purchase", async () => {
  const route = freeSelectionRoute({ task: "mcp_tools_change" }, OWNER_BUYER_JOURNEY_ORIGIN);
  assert.equal(validateOwnerSelectorResult(route).next_call.tool_name, "check_mcp_tool_drift");

  const challenge = paymentChallenge("mcp://tool/check_mcp_tool_drift");
  Object.assign(
    challenge.extensions,
    await declareMcpHttpPaymentHandoff(
      OWNER_BUYER_JOURNEY_ORIGIN,
      "mcpdrift",
      OWNER_BUYER_JOURNEY_INPUT,
      OWNER_BUYER_JOURNEY_NETWORK,
    ),
  );
  const handoff = validateOwnerMcpChallenge(challenge);
  assert.equal(handoff.normalizedBodyHash, normalizedOwnerJourneyBodyHash());
  assert.deepEqual(handoff.walletArgv.slice(0, 4), [
    "awal@2.12.0",
    "x402",
    "pay",
    OWNER_BUYER_JOURNEY_RESOURCE_URL,
  ]);
});

test("HTTP quote and payment result must prove the exact bounded typed purchase", () => {
  validateOwnerHttpChallenge(paymentChallenge(OWNER_BUYER_JOURNEY_RESOURCE_URL));
  assert.throws(
    () => validateOwnerHttpChallenge({
      ...paymentChallenge(OWNER_BUYER_JOURNEY_RESOURCE_URL),
      accepts: [{
        ...paymentChallenge(OWNER_BUYER_JOURNEY_RESOURCE_URL).accepts[0],
        amount: "20001",
      }],
    }),
    /exceeds safety cap/,
  );

  const paid = validateOwnerPaymentResult({
    paymentMade: true,
    amountPaid: 20_000,
    status: 200,
    data: mcpDriftExample,
  });
  assert.equal(paid.verdict, "SAFE_ADDITIVE");
  assert.equal(paid.action, "ACCEPT_CURRENT");
  assert.throws(
    () => validateOwnerPaymentResult({
      paymentMade: false,
      amountPaid: 0,
      status: 200,
      data: mcpDriftExample,
    }),
    /did not prove/,
  );
});

test("runtime orchestration gates telemetry and persists authorization before wallet execution", async () => {
  const wrapper = await readFile(new URL("../scripts/run-audited-monitor.ts", import.meta.url), "utf8");
  const runner = await readFile(new URL("../scripts/owner-buyer-journey.ts", import.meta.url), "utf8");
  const service = await readFile(
    new URL("../../ops/systemd/bountyverdict-owner-buyer-journey.service", import.meta.url),
    "utf8",
  );
  const timer = await readFile(
    new URL("../../ops/systemd/bountyverdict-owner-buyer-journey.timer", import.meta.url),
    "utf8",
  );

  assert.ok(
    wrapper.indexOf("validateOwnerJourneyPrerequisite(") <
      wrapper.indexOf('START_FUNNEL_EPOCH: "YES"'),
  );
  assert.match(wrapper, /owner-buyer-journey-v2-epoch-/);
  assert.match(wrapper, /Another audited drain is active/);
  const authorizationIndex = runner.indexOf(
    'observation(state, "AUTHORIZATION_STARTED"',
  );
  assert.ok(authorizationIndex >= 0);
  assert.ok(
    authorizationIndex <
      runner.indexOf('"pay",\n      OWNER_BUYER_JOURNEY_RESOURCE_URL'),
  );
  assert.match(runner, /Never retry automatically/);
  assert.match(service, /AUDITED_MONITOR=owner-journey/);
  assert.match(service, /EXECUTE_OWNER_BUYER_JOURNEY=YES/);
  assert.match(timer, /OnUnitActiveSec=5min/);
});
