import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import {
  OWNER_CONTROLLED_CANARY_PAYER,
  summarizeRevenue,
  type SettlementTransfer,
} from "../src/revenue.ts";

const USDC = {
  mainnet: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  sepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const;
const network = process.env.NETWORK === "sepolia" ? "sepolia" : "mainnet";
const chain = network === "sepolia" ? baseSepolia : base;
const wallet = process.env.REVENUE_WALLET;
const startBlockInput = process.env.START_BLOCK;
const settlementBuyer = process.env.SETTLEMENT_BUYER_ADDRESS;

if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  throw new Error("REVENUE_WALLET must be the public EVM address receiving x402 payments.");
}
if (!startBlockInput || !/^[0-9]+$/.test(startBlockInput)) {
  throw new Error("START_BLOCK must be the deployment block number; this keeps scans bounded.");
}
if (settlementBuyer && !/^0x[a-fA-F0-9]{40}$/.test(settlementBuyer)) {
  throw new Error("SETTLEMENT_BUYER_ADDRESS must be an EVM address when configured.");
}

const client = createPublicClient({ chain, transport: http(process.env.RPC_URL) });
const latestBlock = await client.getBlockNumber();
const startBlock = BigInt(startBlockInput);
if (startBlock > latestBlock) {
  throw new Error(`START_BLOCK ${startBlock} is ahead of latest block ${latestBlock}.`);
}

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
const chunkSize = BigInt(process.env.BLOCK_CHUNK_SIZE || "10000");
if (chunkSize < 1n || chunkSize > 100_000n) {
  throw new Error("BLOCK_CHUNK_SIZE must be between 1 and 100000.");
}

const transfers: SettlementTransfer[] = [];
for (let fromBlock = startBlock; fromBlock <= latestBlock; fromBlock += chunkSize) {
  const toBlock = fromBlock + chunkSize - 1n > latestBlock
    ? latestBlock
    : fromBlock + chunkSize - 1n;
  const logs = await client.getLogs({
    address: USDC[network],
    event: transferEvent,
    args: { to: wallet as Address },
    fromBlock,
    toBlock,
  });
  for (const log of logs) {
    if (log.args.from === undefined || log.args.value === undefined || !log.transactionHash || log.logIndex === null) continue;
    transfers.push({
      from: log.args.from,
      amount: log.args.value,
      transaction_hash: log.transactionHash,
      log_index: log.logIndex,
    });
  }
}

const summary = summarizeRevenue(
  transfers,
  undefined,
  settlementBuyer
    ? [OWNER_CONTROLLED_CANARY_PAYER, settlementBuyer]
    : [OWNER_CONTROLLED_CANARY_PAYER],
);
console.log(JSON.stringify({
  product: "BountyVerdict",
  network: chain.name,
  wallet,
  usdc_contract: USDC[network],
  scanned_blocks: { from: startBlock.toString(), to: latestBlock.toString() },
  ...summary,
  recognized_transfers: summary.recognized_transfers.map((transfer) => ({
    ...transfer,
    amount_atomic: transfer.amount.toString(),
    amount: undefined,
  })),
  canary_transfer_count: summary.canary_transfers.length,
  canary_transfers: summary.canary_transfers.map((transfer) => ({
    ...transfer,
    amount_atomic: transfer.amount.toString(),
    amount: undefined,
  })),
  unrecognized_transfers: summary.unrecognized_transfers.map((transfer) => ({
    ...transfer,
    amount_atomic: transfer.amount.toString(),
    amount: undefined,
  })),
  excluded_non_revenue_transfers: summary.excluded_transfers.map((transfer) => ({
    ...transfer,
    amount_atomic: transfer.amount.toString(),
    amount: undefined,
  })),
}, null, 2));
