import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTaskmarket,
  parseTaskmarketPage,
  reconcileTaskmarketTracked,
  taskmarketAwardSettlementHashes,
  TASKMARKET_TRACKED_SUBMISSIONS,
  TASKMARKET_WORKER_ADDRESS,
  verifyTaskmarketSettlementReceipt,
  type TaskmarketTrackedSpecification,
} from "../src/taskmarket-demand.ts";

const taskId = `0x${"a".repeat(64)}`;
const escrowTx = `0x${"b".repeat(64)}`;
const submitTx = `0x${"c".repeat(64)}`;
const settlementTx = `0x${"d".repeat(64)}`;
const worker = "0xe5E0fe496B7283032d034Dc79C305b384Ad1ee67";
const requester = "0x1111111111111111111111111111111111111111";
const submissionId = "11592476-6f08-472f-908c-0d9531275757";
const now = Date.parse("2026-07-21T12:00:00.000Z");
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const taskmarketDiamond = "0xDDc6cC3e4D11c1f3527B867C7DAD4ED9869C33f7";
const taskCompletedTopic = "0x0c01e82f21f6dc480e3553e62cba7e6511685aa15d312f971ea64663bef07ecb";

function rawTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: taskId,
    requester,
    description: "Write a concise report.",
    reward: "150000",
    netReward: "138750",
    escrowTxHash: escrowTx,
    createdAt: "2026-07-21T00:00:00.000Z",
    expiryTime: "2026-07-23T00:00:00.000Z",
    status: "open",
    tags: ["research"],
    mode: "bounty",
    claimedBy: null,
    submissionWindowOpen: true,
    awardCount: 0,
    awards: [],
    ...overrides,
  };
}

function rawSubmission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: submissionId,
    taskId,
    workerAddress: worker,
    submitTxHash: submitTx,
    submittedAt: "2026-07-21T10:00:00.000Z",
    rejectedAt: null,
    signature: "must-not-be-persisted",
    artifacts: [{ fileName: "must-not-be-persisted.md" }],
    ...overrides,
  };
}

function rawStats(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    address: worker,
    agentId: "59501",
    completedTasks: 0,
    ratedTasks: 0,
    totalStars: 0,
    totalEarnings: "0",
    ...overrides,
  };
}

function successfulSettlementReceipt(
  overrides: Record<string, unknown> = {},
  eventRequester = requester,
): Record<string, unknown> {
  return {
    status: "0x1",
    transactionHash: settlementTx,
    blockNumber: "0x1234",
    logs: [
      {
        address: taskmarketDiamond,
        topics: [
          taskCompletedTopic,
          taskId,
          `0x${"0".repeat(24)}${eventRequester.slice(2).toLowerCase()}`,
          `0x${"0".repeat(24)}${worker.slice(2).toLowerCase()}`,
        ],
        data: `0x${BigInt(138750).toString(16).padStart(64, "0")}${BigInt(11250).toString(16).padStart(64, "0")}`,
        logIndex: "0x1",
      },
      {
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        topics: [
          transferTopic,
          `0x${"0".repeat(24)}${taskmarketDiamond.slice(2).toLowerCase()}`,
          `0x${"0".repeat(24)}${worker.slice(2).toLowerCase()}`,
        ],
        data: `0x${BigInt(138750).toString(16).padStart(64, "0")}`,
        logIndex: "0x2",
      },
    ],
    ...overrides,
  };
}

const tracked: readonly TaskmarketTrackedSpecification[] = [{
  task_id: taskId,
  submission_id: submissionId,
  submit_tx_hash: submitTx,
  reward_atomic: "150000",
  expected_net_atomic: "138750",
}];

test("Taskmarket production tracker pins the isolated worker and all nine public receipts", () => {
  assert.equal(TASKMARKET_WORKER_ADDRESS, "0xe5E0fe496B7283032d034Dc79C305b384Ad1ee67");
  assert.deepEqual(TASKMARKET_TRACKED_SUBMISSIONS, [
    {
      task_id: "0xcb67b0a48505c60ddba84023942a93c433bb0c31722028e0b62807074e0ccf0e",
      submission_id: "11592476-6f08-472f-908c-0d9531275757",
      submit_tx_hash: "0xd27042ad5b49f93c780b56cd0b06756e470b268e00fae32070c725b8e86220b3",
      reward_atomic: "150000",
      expected_net_atomic: "138750",
    },
    {
      task_id: "0xfeb98106531ea1bd30f727a0c458809e0c05159c5c6c4e65ca7d0245a3b16613",
      submission_id: "fdbc7781-5ec1-43cd-a370-0071f2d115c7",
      submit_tx_hash: "0x9e23e83d6933dd65e8ea54a5ca956257489da1629fa425b125d187b4305e76b5",
      reward_atomic: "20000",
      expected_net_atomic: "18500",
    },
    {
      task_id: "0x50d1dea29821649b87c2cb08558bd9cd984c9678d9f8d30ce608eef877ca5448",
      submission_id: "7315e22e-e703-4f37-9227-41ef69632d5b",
      submit_tx_hash: "0x02cff29efb7ea9bddd34203d01d956d953179a8e0bc029cc264bc0a01c082266",
      reward_atomic: "500000",
      expected_net_atomic: "462500",
      public_proof: {
        service_origin: "https://listening-heart.onrender.com",
        note_id: "4aaec988-26b3-481c-8bf0-eb5f76c71286",
        author_address: "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614",
        payment_atomic: "1000",
        network: "eip155:84532",
        asset: "Base Sepolia USDC",
      },
    },
    {
      task_id: "0xd4962d4534961d4e93f93848f552dd41d48e2091a9fbb36ecc9503a8621717d0",
      submission_id: "1471cfbd-e7a6-458e-9487-b41692a0113e",
      submit_tx_hash: "0x8f01a3232478025660b4ff82a284f5cb4e5f9bf3283a0ef09d8c9b1ea4bea83d",
      reward_atomic: "10000000",
      expected_net_atomic: "9250000",
    },
    {
      task_id: "0x100219baba1f9df11f7f15f226bbd9994c445060ca2bd2ac7ef820bd4f7759f7",
      submission_id: "7405cc23-ba8c-40d8-9b6d-c3647251d519",
      submit_tx_hash: "0xe70d286b0b6204bc1413534d9e9238e057e50828ce08d8b2a6cc658e650436eb",
      reward_atomic: "19000000",
      expected_net_atomic: "17575000",
      operator_estimated_net_atomic: "110000",
      terminal_reward_atomic: "1135136",
      terminal_net_reward_atomic: "1050000",
    },
    {
      task_id: "0xb572510c687f254cb763989553a74a9dff1c76687579f8507335c2461de1ab1a",
      submission_id: "fe459a0b-e2e8-429b-8080-9e776af10da1",
      submit_tx_hash: "0x19a717548d6931e6a620ca79f12c4a6ae0e81284739f428a1059d9c5c7220a0a",
      reward_atomic: "150000",
      expected_net_atomic: "138750",
      operator_estimated_net_atomic: "46250",
    },
    {
      task_id: "0xab6871942fb13f7cfdec23d73a32a230c8b6d2c3880b96bfb7c14844405502ca",
      submission_id: "6b84b931-bc73-4533-8084-c8f9bd324d14",
      submit_tx_hash: "0x82601eaab56162682ad5ef92461ce7796ff9e31ae4ccec0d726f337442fd42f2",
      reward_atomic: "5000000",
      expected_net_atomic: "4625000",
      artifact_manifest: [
        {
          file_name: "robobee-matchhead-landing.png",
          mime_type: "image/png",
          role: "attachment",
          size_bytes: 1_855_004,
          sha256_hash: "90b0e004992e8ed207d2d3948b000335c615968570f7f95d7d221eca9c7b6d83",
          keccak256_hash: "0xb3533eca145e23f54174da38a916b0b9fc4f4781181b636ddd232f346ca5c92d",
          display_order: 0,
        },
        {
          file_name: "concept-note.md",
          mime_type: "text/markdown",
          role: "attachment",
          size_bytes: 2_548,
          sha256_hash: "ce879434978ca446f613d00514506d931b8bca086b164c175d37bbf101586866",
          keccak256_hash: "0x040855123be0dc7ef327f0b55d89d9c9494c08704222005d0adf2b19792365c1",
          display_order: 1,
        },
        {
          file_name: "sources.md",
          mime_type: "text/markdown",
          role: "attachment",
          size_bytes: 1_211,
          sha256_hash: "50be3a172e36cae88d282d5b9d150da66df4db723af1ae267b0818e9b004d29c",
          keccak256_hash: "0x9177afe6caadd2ea3337237bd8164b6d764936a771cbfc15a1e1aec207cacd7b",
          display_order: 2,
        },
      ],
    },
    {
      task_id: "0x8188a375e07b0e0edd93c986142c7796b5a3014d213347e6fd0bd839bfdec48e",
      submission_id: "00a76ff7-b6b3-4751-a073-f166b901577f",
      submit_tx_hash: "0xf07c07383fb397017a7c3f00367b1c947e9e12c8ed81ed0e3e16601ef222d4fb",
      reward_atomic: "4000000",
      expected_net_atomic: "3700000",
      artifact_manifest: [
        {
          file_name: "ai-watches-the-bees-v2.png",
          mime_type: "image/png",
          role: "attachment",
          size_bytes: 2_999_368,
          sha256_hash: "3c063554ad68a2fe352e7a898d72b32d4702e9942b08917ff90d0af1b9dcac34",
          keccak256_hash: "0xc4e358249de28f564579682792f53572a42789f7b25826deda24504a31734858",
          display_order: 0,
        },
        {
          file_name: "concept-note.md",
          mime_type: "text/markdown",
          role: "attachment",
          size_bytes: 2_499,
          sha256_hash: "250aae59f43fbbc495a473ac484fcb71bc013eeb4a99b9000586338ad0e8fc0d",
          keccak256_hash: "0xc8ce6e4bb5287ab2e9a738ec19507fcdf6ed77d7c3eba79db58c00338662ca18",
          display_order: 1,
        },
        {
          file_name: "sources.md",
          mime_type: "text/markdown",
          role: "attachment",
          size_bytes: 2_346,
          sha256_hash: "b1d58ea152ede176d0bb98b93e4d2d59b0755fa9258e2ac7cab12255ec8b0a50",
          keccak256_hash: "0x793b1ebd0fabe55ce592e780a95743cff8689cc663ee9c3fc485d9f632a8f066",
          display_order: 2,
        },
      ],
    },
    {
      task_id: "0x37b75bf9c4f12262834c020710a723c218d727a22218413b849ba3ce247396c9",
      submission_id: "02946e41-5a06-4485-8b0b-82904e445054",
      submit_tx_hash: "0x9d0fb1e4b3f8d88d25cdeb9cf67f6eb35875ead9c49df38eedee9a3194906956",
      reward_atomic: "5000000",
      expected_net_atomic: "4625000",
      artifact_manifest: [
        {
          file_name: "bees-show-servers.png",
          mime_type: "image/png",
          role: "attachment",
          size_bytes: 2_100_056,
          sha256_hash: "075ef61308f472e74e789398479432de97071d9afe39ebf2238d811ae988a4fb",
          keccak256_hash: "0xbf2321e74ba1fa52784c44eaba0470d8273add4b71abb4aa4d8a605e5805670e",
          display_order: 0,
        },
        {
          file_name: "concept-note.md",
          mime_type: "text/markdown",
          role: "attachment",
          size_bytes: 2_892,
          sha256_hash: "741910aeeadf488969f6d75557258889cc5f97d70be8d5faae6b6a4b9f64c4e8",
          keccak256_hash: "0x603fa9700ace49a9fb2cca15cae92c399d00d5d373c470e19136708cb7176707",
          display_order: 1,
        },
        {
          file_name: "sources.md",
          mime_type: "text/markdown",
          role: "attachment",
          size_bytes: 1_842,
          sha256_hash: "5d3f189808b1c7687c45991ba1d0763b37e122d233f1e21d6b74d3317e56268b",
          keccak256_hash: "0xa9e1628059e590da834fef7f6428339d8c1f2198fbe0198e48664548d687087f",
          display_order: 2,
        },
      ],
    },
  ]);
});

test("Taskmarket verifies an exact tracked artifact manifest without persisting storage locations", () => {
  const artifact = {
    file_name: "hero.png",
    mime_type: "image/png",
    role: "attachment" as const,
    size_bytes: 123,
    sha256_hash: "1".repeat(64),
    keccak256_hash: `0x${"2".repeat(64)}`,
    display_order: 0,
  };
  const artifactTracked: readonly TaskmarketTrackedSpecification[] = [{
    ...tracked[0],
    artifact_manifest: [artifact],
  }];
  const artifactSubmission = rawSubmission({
    artifacts: [{
      fileName: artifact.file_name,
      mimeType: artifact.mime_type,
      role: artifact.role,
      sizeBytes: artifact.size_bytes,
      sha256Hash: artifact.sha256_hash,
      keccak256Hash: artifact.keccak256_hash,
      displayOrder: artifact.display_order,
      storageUri: "must-not-be-persisted",
    }],
  });
  const result = reconcileTaskmarketTracked({
    worker_address: worker,
    tracked: artifactTracked,
    payloads: [{ task_id: taskId, detail: rawTask(), submissions: [artifactSubmission] }],
    agent_stats: rawStats(),
  });
  assert.equal((result.submissions as Array<Record<string, unknown>>)[0].artifact_manifest_verified, true);
  assert.doesNotMatch(JSON.stringify(result), /must-not-be-persisted/);
  assert.throws(() => reconcileTaskmarketTracked({
    worker_address: worker,
    tracked: artifactTracked,
    payloads: [{
      task_id: taskId,
      detail: rawTask(),
      submissions: [rawSubmission({
        artifacts: [{
          fileName: artifact.file_name,
          mimeType: artifact.mime_type,
          role: artifact.role,
          sizeBytes: artifact.size_bytes,
          sha256Hash: "3".repeat(64),
          keccak256Hash: artifact.keccak256_hash,
          displayOrder: artifact.display_order,
        }],
      })],
    }],
    agent_stats: rawStats(),
  }), /artifact manifest drifted/);
});

test("Taskmarket pool submissions report bounded record value instead of the full escrow pool", () => {
  const poolTracked: readonly TaskmarketTrackedSpecification[] = [{
    task_id: taskId,
    submission_id: submissionId,
    submit_tx_hash: submitTx,
    reward_atomic: "19000000",
    expected_net_atomic: "17575000",
    operator_estimated_net_atomic: "110000",
  }];
  const result = reconcileTaskmarketTracked({
    worker_address: worker,
    tracked: poolTracked,
    payloads: [{
      task_id: taskId,
      detail: rawTask({ reward: "19000000", netReward: "17575000" }),
      submissions: [rawSubmission()],
    }],
    agent_stats: rawStats(),
  });
  assert.equal(result.pending_gross_potential_usdc, "0.118919");
  assert.equal(result.pending_net_potential_usdc, "0.11");
  assert.equal((result.submissions as Array<Record<string, unknown>>)[0].escrow_reward_usdc, "19");
  assert.equal((result.submissions as Array<Record<string, unknown>>)[0].potential_gross_usdc, "0.118919");
  assert.equal((result.submissions as Array<Record<string, unknown>>)[0].potential_basis, "operator_estimated_submitted_record_net_scaled_by_task_contract_not_award");
});

test("Taskmarket pool gross estimate derives the task-specific fee ratio", () => {
  const result = reconcileTaskmarketTracked({
    worker_address: worker,
    tracked: [{
      task_id: taskId,
      submission_id: submissionId,
      submit_tx_hash: submitTx,
      reward_atomic: "1000000",
      expected_net_atomic: "900000",
      operator_estimated_net_atomic: "450000",
    }],
    payloads: [{
      task_id: taskId,
      detail: rawTask({ reward: "1000000", netReward: "900000" }),
      submissions: [rawSubmission()],
    }],
    agent_stats: rawStats(),
  });
  assert.equal(result.pending_gross_potential_usdc, "0.5");
  assert.equal(result.pending_net_potential_usdc, "0.45");
});

test("Taskmarket preserves a pool's initial escrow while pinning its smaller terminal award aggregate", () => {
  const result = reconcileTaskmarketTracked({
    worker_address: worker,
    tracked: [{
      task_id: taskId,
      submission_id: submissionId,
      submit_tx_hash: submitTx,
      reward_atomic: "19000000",
      expected_net_atomic: "17575000",
      operator_estimated_net_atomic: "110000",
      terminal_reward_atomic: "1135136",
      terminal_net_reward_atomic: "1050000",
    }],
    payloads: [{
      task_id: taskId,
      detail: rawTask({
        status: "completed",
        submissionWindowOpen: false,
        reward: "1135136",
        netReward: "1050000",
      }),
      submissions: [rawSubmission()],
    }],
    agent_stats: rawStats(),
  });
  assert.equal(result.pending_submissions, 0);
  assert.equal(result.not_awarded_submissions, 1);
  assert.equal(result.pending_net_potential_usdc, "0");
  const submission = (result.submissions as Array<Record<string, unknown>>)[0];
  assert.equal(submission.escrow_reward_usdc, "19");
  assert.equal(submission.current_task_reward_usdc, "1.135136");
  assert.equal(submission.current_task_net_reward_usdc, "1.05");
  assert.equal(submission.reward_contract_state, "pinned_terminal_pool_award_aggregate_with_initial_escrow_preserved");
  assert.equal(submission.submission_state, "not_awarded");

  assert.throws(() => reconcileTaskmarketTracked({
    worker_address: worker,
    tracked: [{
      task_id: taskId,
      submission_id: submissionId,
      submit_tx_hash: submitTx,
      reward_atomic: "19000000",
      expected_net_atomic: "17575000",
      operator_estimated_net_atomic: "110000",
      terminal_reward_atomic: "1135135",
      terminal_net_reward_atomic: "1050000",
    }],
    payloads: [{
      task_id: taskId,
      detail: rawTask({ status: "completed", submissionWindowOpen: false, reward: "1135136", netReward: "1050000" }),
      submissions: [rawSubmission()],
    }],
    agent_stats: rawStats(),
  }), /reward contract drifted/);
});

test("Taskmarket fetches one settlement receipt when a pool pays several awards in one transaction", () => {
  const sharedAward = {
    workerAddress: worker,
    grossAmount: "150000",
    workerPayment: "138750",
    platformFee: "11250",
    settlementTxHash: settlementTx,
    settledAt: "2026-07-21T11:00:00.000Z",
  };
  assert.deepEqual(taskmarketAwardSettlementHashes(rawTask({
    status: "completed",
    submissionWindowOpen: false,
    awardCount: 2,
    awards: [
      sharedAward,
      { ...sharedAward, workerAddress: "0x2222222222222222222222222222222222222222" },
    ],
  })), [settlementTx]);
});

test("Taskmarket open feed validates escrow evidence and strict pagination bounds", () => {
  const page = parseTaskmarketPage({ tasks: [rawTask()], hasMore: true, nextCursor: "2026-07-20T00:00:00.000Z" });
  assert.equal(page.tasks[0].rewardAtomic, "150000");
  assert.equal(page.has_more, true);
  assert.throws(() => parseTaskmarketPage({ tasks: [rawTask()], hasMore: false, nextCursor: "2026-07-20T00:00:00.000Z" }), /flags disagree/);
  assert.throws(() => parseTaskmarketPage({ tasks: [rawTask({ escrowTxHash: "not-a-transaction" })], hasMore: false, nextCursor: null }), /escrow transaction is invalid/);
  assert.throws(() => parseTaskmarketPage({
    tasks: Array.from({ length: 101 }, (_, index) => rawTask({ id: `0x${index.toString(16).padStart(64, "0")}` })),
    hasMore: false,
    nextCursor: null,
  }), /100-task cap/);
});

test("Taskmarket keeps API escrow-backed inventory separate from exact existing-product fits", () => {
  const exact = parseTaskmarketPage({
    tasks: [rawTask({
      description: "Is this GitHub bounty still worth pursuing?\nhttps://github.com/example/project/issues/42",
      reward: "50000",
      netReward: "50000",
    })],
    hasMore: false,
    nextCursor: null,
  }).tasks[0];
  const expired = parseTaskmarketPage({
    tasks: [rawTask({
      id: `0x${"e".repeat(64)}`,
      description: "Another generic report.",
      expiryTime: "2026-07-20T00:00:00.000Z",
    })],
    hasMore: false,
    nextCursor: null,
  }).tasks[0];
  const result = analyzeTaskmarket([exact, expired], now);
  assert.equal(result.api_escrow_backed_open_tasks, 2);
  assert.equal(result.unassigned_unexpired_submission_open_tasks, 1);
  assert.equal(result.exact_candidate_count, 1);
  assert.equal((result.exact_candidates as Array<Record<string, unknown>>)[0].product, "single");
  assert.equal(result.excluded_expired_assigned_or_closed_window, 1);
  assert.throws(() => analyzeTaskmarket(Array.from({ length: 501 }, (_, index) => ({
    ...exact,
    id: `0x${index.toString(16).padStart(64, "0")}`,
  })), now), /five-page audit/);
});

test("Taskmarket submission and submit transaction remain zero revenue without a canonical award", () => {
  const result = reconcileTaskmarketTracked({
    worker_address: worker,
    tracked,
    payloads: [{ task_id: taskId, detail: rawTask(), submissions: [rawSubmission()] }],
    agent_stats: rawStats(),
  });
  assert.equal(result.tracked_submissions, 1);
  assert.equal(result.pending_submissions, 1);
  assert.equal(result.pending_gross_potential_usdc, "0.15");
  assert.equal(result.pending_net_potential_usdc, "0.13875");
  assert.equal(result.settled_submissions, 0);
  assert.equal(result.settled_worker_earnings_usdc, "0");
  assert.equal((result.submissions as Array<Record<string, unknown>>)[0].accounting_state, "submission_only_not_purchase_or_revenue");
  assert.doesNotMatch(JSON.stringify(result), /must-not-be-persisted/);
});

test("Taskmarket validates the third submission's public testnet proof without treating it as revenue", () => {
  const proofTracked: readonly TaskmarketTrackedSpecification[] = [{
    ...tracked[0],
    public_proof: {
      service_origin: "https://listening-heart.onrender.com",
      note_id: "4aaec988-26b3-481c-8bf0-eb5f76c71286",
      author_address: "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614",
      payment_atomic: "1000",
      network: "eip155:84532",
      asset: "Base Sepolia USDC",
    },
  }];
  const publicProof = {
    taskId,
    totalNotes: 2,
    notes: [{
      noteId: "4aaec988-26b3-481c-8bf0-eb5f76c71286",
      taskId,
      author: "0x4aa55988fa032fbbb8ddef496b0f194fec62d614",
      noteType: "general",
      paymentAmount: 1000,
      timestamp: "2026-07-21T07:41:50.638Z",
      content: "must-not-be-persisted",
    }],
  };
  const result = reconcileTaskmarketTracked({
    worker_address: worker,
    tracked: proofTracked,
    payloads: [{ task_id: taskId, detail: rawTask(), submissions: [rawSubmission()], public_proof_notes: publicProof }],
    agent_stats: rawStats(),
  });
  const record = (result.submissions as Array<Record<string, any>>)[0];
  assert.equal(result.pending_submissions, 1);
  assert.equal(result.settled_submissions, 0);
  assert.equal(result.settled_worker_earnings_usdc, "0");
  assert.equal(record.supporting_public_proof.note_id, "4aaec988-26b3-481c-8bf0-eb5f76c71286");
  assert.equal(record.supporting_public_proof.network, "eip155:84532");
  assert.match(record.supporting_public_proof.economic_treatment, /neither customer revenue nor a mainnet tracked cost/);
  assert.doesNotMatch(JSON.stringify(result), /must-not-be-persisted/);

  assert.throws(() => reconcileTaskmarketTracked({
    worker_address: worker,
    tracked: proofTracked,
    payloads: [{
      task_id: taskId,
      detail: rawTask(),
      submissions: [rawSubmission()],
      public_proof_notes: { ...publicProof, notes: [{ ...publicProof.notes[0], paymentAmount: 999 }] },
    }],
    agent_stats: rawStats(),
  }), /disagrees with its task, author, or payment amount/);
});

test("Taskmarket keeps an API award at zero until the Base receipt proves task and exact USDC transfer", () => {
  const award = {
    workerAddress: worker,
    grossAmount: "150000",
    workerPayment: "138750",
    platformFee: "11250",
    settlementTxHash: settlementTx,
    settledAt: "2026-07-21T11:00:00.000Z",
  };
  const unverified = reconcileTaskmarketTracked({
    worker_address: worker,
    tracked,
    payloads: [{
      task_id: taskId,
      detail: rawTask({ status: "completed", submissionWindowOpen: false, awardCount: 1, awards: [award] }),
      submissions: [rawSubmission()],
    }],
    agent_stats: rawStats({ completedTasks: 1, totalEarnings: "138750" }),
  });
  assert.equal(unverified.pending_submissions, 0);
  assert.equal(unverified.unverified_award_submissions, 1);
  assert.equal(unverified.settled_submissions, 0);
  assert.equal(unverified.settled_worker_earnings_usdc, "0");
  assert.equal((unverified.submissions as Array<Record<string, any>>)[0].submission_state, "award_unverified");
  assert.equal((unverified.submissions as Array<Record<string, any>>)[0].settlement, null);

  const result = reconcileTaskmarketTracked({
    worker_address: worker,
    tracked,
    payloads: [{
      task_id: taskId,
      detail: rawTask({ status: "completed", submissionWindowOpen: false, awardCount: 1, awards: [award] }),
      submissions: [rawSubmission()],
      settlement_receipts: [{ transaction_hash: settlementTx, receipt: successfulSettlementReceipt() }],
    }],
    agent_stats: rawStats({ completedTasks: 1, totalEarnings: "138750" }),
  });
  assert.equal(result.pending_submissions, 0);
  assert.equal(result.unverified_award_submissions, 0);
  assert.equal(result.settled_submissions, 1);
  assert.equal(result.settled_worker_earnings_usdc, "0.13875");
  assert.equal((result.submissions as Array<Record<string, any>>)[0].settlement.settlement_tx_hash, settlementTx);
  assert.equal((result.submissions as Array<Record<string, any>>)[0].settlement.onchain_evidence.verified, true);
  assert.equal(result.stats_correlate_with_tracked_settlements, true);

  assert.throws(() => reconcileTaskmarketTracked({
    worker_address: worker,
    tracked,
    payloads: [{ task_id: taskId, detail: rawTask({ awardCount: 1, awards: [award] }), submissions: [rawSubmission()] }],
    agent_stats: rawStats(),
  }), /before task completion/);
});

test("Taskmarket receipt verification fails closed on RPC, status, task, transfer, and owner-requester drift", () => {
  const base = {
    settlement_tx_hash: settlementTx,
    task_id: taskId,
    worker_address: worker,
    worker_payment_atomic: "138750",
    platform_fee_atomic: "11250",
    requester_address: requester,
  };
  assert.equal(verifyTaskmarketSettlementReceipt({ ...base, evidence: undefined }).verified, false);
  assert.equal(verifyTaskmarketSettlementReceipt({
    ...base,
    evidence: { transaction_hash: settlementTx, receipt: null, unavailable_reason: "rpc_unavailable" },
  }).reason, "rpc_unavailable");
  assert.equal(verifyTaskmarketSettlementReceipt({
    ...base,
    evidence: { transaction_hash: settlementTx, receipt: successfulSettlementReceipt({ status: "0x0" }) },
  }).reason, "receipt_not_successful");
  assert.equal(verifyTaskmarketSettlementReceipt({
    ...base,
    evidence: {
      transaction_hash: settlementTx,
      receipt: successfulSettlementReceipt({
        logs: (successfulSettlementReceipt().logs as Array<Record<string, unknown>>).slice(1),
      }),
    },
  }).reason, "canonical_task_completed_event_missing_or_ambiguous");

  const wrongDiamond = successfulSettlementReceipt();
  (wrongDiamond.logs as Array<Record<string, unknown>>)[0].address = "0x1111111111111111111111111111111111111111";
  assert.equal(verifyTaskmarketSettlementReceipt({
    ...base,
    evidence: { transaction_hash: settlementTx, receipt: wrongDiamond },
  }).reason, "canonical_task_completed_event_missing_or_ambiguous");

  const wrongEvent = successfulSettlementReceipt();
  ((wrongEvent.logs as Array<Record<string, unknown>>)[0].topics as string[])[0] = `0x${"f".repeat(64)}`;
  assert.equal(verifyTaskmarketSettlementReceipt({
    ...base,
    evidence: { transaction_hash: settlementTx, receipt: wrongEvent },
  }).reason, "canonical_task_completed_event_missing_or_ambiguous");

  assert.equal(verifyTaskmarketSettlementReceipt({
    ...base,
    requester_address: "0x2222222222222222222222222222222222222222",
    evidence: { transaction_hash: settlementTx, receipt: successfulSettlementReceipt() },
  }).reason, "canonical_task_completed_event_missing_or_ambiguous");

  assert.equal(verifyTaskmarketSettlementReceipt({
    ...base,
    platform_fee_atomic: "11249",
    evidence: { transaction_hash: settlementTx, receipt: successfulSettlementReceipt() },
  }).reason, "canonical_task_completed_event_missing_or_ambiguous");

  const wrongTransfer = successfulSettlementReceipt();
  (wrongTransfer.logs as Array<Record<string, unknown>>)[1].data = `0x${BigInt(138749).toString(16).padStart(64, "0")}`;
  assert.equal(verifyTaskmarketSettlementReceipt({
    ...base,
    evidence: { transaction_hash: settlementTx, receipt: wrongTransfer },
  }).reason, "exact_usdc_diamond_worker_transfer_missing_or_ambiguous");

  const wrongTransferSource = successfulSettlementReceipt();
  ((wrongTransferSource.logs as Array<Record<string, unknown>>)[1].topics as string[])[1] =
    `0x${"0".repeat(24)}${"3".repeat(40)}`;
  assert.equal(verifyTaskmarketSettlementReceipt({
    ...base,
    evidence: { transaction_hash: settlementTx, receipt: wrongTransferSource },
  }).reason, "exact_usdc_diamond_worker_transfer_missing_or_ambiguous");

  const award = {
    workerAddress: worker,
    grossAmount: "150000",
    workerPayment: "138750",
    platformFee: "11250",
    settlementTxHash: settlementTx,
    settledAt: "2026-07-21T11:00:00.000Z",
  };
  const ownerRequested = reconcileTaskmarketTracked({
    worker_address: worker,
    tracked,
    payloads: [{
      task_id: taskId,
      detail: rawTask({
        requester: "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614",
        status: "completed",
        submissionWindowOpen: false,
        awardCount: 1,
        awards: [award],
      }),
      submissions: [rawSubmission()],
      settlement_receipts: [{
        transaction_hash: settlementTx,
        receipt: successfulSettlementReceipt({}, "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614"),
      }],
    }],
    agent_stats: rawStats({ completedTasks: 1, totalEarnings: "138750" }),
  });
  assert.equal(ownerRequested.settled_submissions, 0);
  assert.equal(ownerRequested.unverified_award_submissions, 1);
  assert.equal((ownerRequested.submissions as Array<Record<string, any>>)[0].award_verification.reason,
    "task_requester_is_worker_or_owner_identity");
});

test("Taskmarket rejects a zero worker-payment award before purchase accounting", () => {
  assert.throws(() => reconcileTaskmarketTracked({
    worker_address: worker,
    tracked,
    payloads: [{
      task_id: taskId,
      detail: rawTask({
        status: "completed",
        submissionWindowOpen: false,
        awardCount: 1,
        awards: [{
          workerAddress: worker,
          grossAmount: "150000",
          workerPayment: "0",
          platformFee: "150000",
          settlementTxHash: settlementTx,
          settledAt: "2026-07-21T11:00:00.000Z",
        }],
      }),
      submissions: [rawSubmission()],
      settlement_receipts: [{ transaction_hash: settlementTx, receipt: successfulSettlementReceipt() }],
    }],
    agent_stats: rawStats(),
  }), /worker payment is outside bounds/);
});

test("Taskmarket cannot reuse one receipt transfer log for two tracked tasks", () => {
  const secondTaskId = `0x${"9".repeat(64)}`;
  const secondSubmissionId = "22592476-6f08-472f-908c-0d9531275757";
  const secondSubmitTx = `0x${"8".repeat(64)}`;
  const twoTracked: readonly TaskmarketTrackedSpecification[] = [
    tracked[0],
    {
      task_id: secondTaskId,
      submission_id: secondSubmissionId,
      submit_tx_hash: secondSubmitTx,
      reward_atomic: "150000",
      expected_net_atomic: "138750",
    },
  ];
  const award = {
    workerAddress: worker,
    grossAmount: "150000",
    workerPayment: "138750",
    platformFee: "11250",
    settlementTxHash: settlementTx,
    settledAt: "2026-07-21T11:00:00.000Z",
  };
  const receipt = successfulSettlementReceipt();
  receipt.logs = [
    {
      address: taskmarketDiamond,
      topics: [
        taskCompletedTopic,
        taskId,
        `0x${"0".repeat(24)}${requester.slice(2).toLowerCase()}`,
        `0x${"0".repeat(24)}${worker.slice(2).toLowerCase()}`,
      ],
      data: `0x${BigInt(138750).toString(16).padStart(64, "0")}${BigInt(11250).toString(16).padStart(64, "0")}`,
      logIndex: "0x1",
    },
    {
      address: taskmarketDiamond,
      topics: [
        taskCompletedTopic,
        secondTaskId,
        `0x${"0".repeat(24)}${requester.slice(2).toLowerCase()}`,
        `0x${"0".repeat(24)}${worker.slice(2).toLowerCase()}`,
      ],
      data: `0x${BigInt(138750).toString(16).padStart(64, "0")}${BigInt(11250).toString(16).padStart(64, "0")}`,
      logIndex: "0x2",
    },
    {
      ...(successfulSettlementReceipt().logs as Array<Record<string, unknown>>)[1],
      logIndex: "0x3",
    },
  ];
  assert.throws(() => reconcileTaskmarketTracked({
    worker_address: worker,
    tracked: twoTracked,
    payloads: [
      {
        task_id: taskId,
        detail: rawTask({ status: "completed", submissionWindowOpen: false, awardCount: 1, awards: [award] }),
        submissions: [rawSubmission()],
        settlement_receipts: [{ transaction_hash: settlementTx, receipt }],
      },
      {
        task_id: secondTaskId,
        detail: rawTask({
          id: secondTaskId,
          status: "completed",
          submissionWindowOpen: false,
          awardCount: 1,
          awards: [award],
        }),
        submissions: [rawSubmission({
          id: secondSubmissionId,
          taskId: secondTaskId,
          submitTxHash: secondSubmitTx,
        })],
        settlement_receipts: [{ transaction_hash: settlementTx, receipt }],
      },
    ],
    agent_stats: rawStats({ completedTasks: 2, totalEarnings: "277500" }),
  }), /transfer evidence was reused by multiple tracked tasks/);
});

test("Taskmarket rejects tracked identity drift and non-reconciling awards", () => {
  assert.throws(() => reconcileTaskmarketTracked({
    worker_address: worker,
    tracked,
    payloads: [{ task_id: taskId, detail: rawTask(), submissions: [rawSubmission({ submitTxHash: `0x${"f".repeat(64)}` })] }],
    agent_stats: rawStats(),
  }), /receipt is missing or disagrees/);
  assert.throws(() => reconcileTaskmarketTracked({
    worker_address: worker,
    tracked,
    payloads: [{
      task_id: taskId,
      detail: rawTask({
        status: "completed",
        submissionWindowOpen: false,
        awardCount: 1,
        awards: [{
          workerAddress: worker,
          grossAmount: "150000",
          workerPayment: "138750",
          platformFee: "1",
          settlementTxHash: settlementTx,
          settledAt: "2026-07-21T11:00:00.000Z",
        }],
      }),
      submissions: [rawSubmission()],
    }],
    agent_stats: rawStats(),
  }), /amounts do not reconcile/);
});
