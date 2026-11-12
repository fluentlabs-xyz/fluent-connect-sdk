/**
 * Fluent testnet as the chess demo reads it, faked behind `fetch` for its component tests: the
 * chess contract's game counter, game, `GameCreated` and `MoveSubmitted` logs, BLEND allowances,
 * the block number and transaction receipts, answered the way `viem@2.52.0` `http()` asks for
 * them. A case scripts `chain` and reads back the receipts the code waited for.
 */
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  getAddress,
  numberToHex,
  toEventSelector,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import { vi } from "vitest";

import { SMART_ACCOUNT } from "../../../packages/connect/test/fakes/fluentId";
import { chessAbi, erc20Abi } from "../src/contracts";

/** As `VITE_CHESS_CONTRACT_ADDRESS` holds it: the demo passes the variable on as written. */
export const CHESS_CONTRACT = "0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0" as Address;
export const BOT_PLAYER = getAddress("0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0");
export const EXTERNAL_WALLET = getAddress("0xe0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0");
/** The hash of the `createGame` the Fluent ID sends; its receipt carries the `GameCreated`. */
export const CREATE_HASH = `0x${"c1".repeat(32)}` as Hash;

const BLOCK = 100n;
const BLOCK_HASH = `0x${"bb".repeat(32)}` as Hash;
const GAME_CREATED = toEventSelector("GameCreated(uint256,address,address)");
const MOVE_SUBMITTED = toEventSelector(
  "MoveSubmitted(uint256,uint256,address,address,string,string)",
);

type ChainMove = { moveNumber: bigint; player: Address; moveUci: string; fen: string };

type Chain = {
  /** Whether game 1 exists: set by the receipt of `CREATE_HASH`. */
  created: boolean;
  white: Address;
  black: Address;
  turn: Address;
  /** BLEND allowance per lowercase owner; an owner not listed has 1 BLEND. */
  allowances: Map<string, bigint>;
  moves: ChainMove[];
  /** The hashes whose receipts were asked for, in order. */
  receiptRequests: Hash[];
};

export const chain: Chain = freshChain();

function freshChain(): Chain {
  return {
    created: false,
    white: SMART_ACCOUNT,
    black: BOT_PLAYER,
    turn: SMART_ACCOUNT,
    allowances: new Map(),
    moves: [],
    receiptRequests: [],
  };
}

/** Every case starts before game 1, which the Fluent ID creates and plays white against the bot. */
export function resetChain(): void {
  Object.assign(chain, freshChain());
}

function call(to: Address, data: `0x${string}`): `0x${string}` {
  if (to.toLowerCase() === CHESS_CONTRACT.toLowerCase()) {
    const { functionName, args } = decodeFunctionData({ abi: chessAbi, data });
    if (functionName === "nextGameId") {
      return encodeFunctionResult({
        abi: chessAbi,
        functionName,
        result: chain.created ? 2n : 1n,
      });
    }
    if (functionName === "games") {
      const live = chain.created && args[0] === 1n;
      return encodeFunctionResult({
        abi: chessAbi,
        functionName,
        result: live
          ? [chain.white, chain.black, chain.turn, true, BigInt(chain.moves.length), 0]
          : [zeroAddress, zeroAddress, zeroAddress, false, 0n, 0],
      });
    }
    throw new Error(`the chess contract has no read ${functionName}`);
  }
  const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data });
  if (functionName !== "allowance") throw new Error(`BLEND has no read ${functionName}`);
  const owner = String(args[0]).toLowerCase();
  return encodeFunctionResult({
    abi: erc20Abi,
    functionName,
    result: chain.allowances.get(owner) ?? 10n ** 18n,
  });
}

function log(
  topics: readonly unknown[],
  data: `0x${string}`,
  transactionHash: Hash,
  index: number,
) {
  return {
    address: CHESS_CONTRACT,
    topics,
    data,
    blockNumber: numberToHex(BLOCK),
    blockHash: BLOCK_HASH,
    transactionHash,
    transactionIndex: "0x0",
    logIndex: numberToHex(index),
    removed: false,
  };
}

function logs(topic0: string | undefined) {
  if (topic0 === GAME_CREATED && chain.created) {
    const topics = encodeEventTopics({
      abi: chessAbi,
      eventName: "GameCreated",
      args: { gameId: 1n, white: chain.white, black: chain.black },
    });
    return [log(topics, "0x", CREATE_HASH, 0)];
  }
  if (topic0 === MOVE_SUBMITTED) {
    return chain.moves.map((move, index) =>
      log(
        encodeEventTopics({
          abi: chessAbi,
          eventName: "MoveSubmitted",
          args: { gameId: 1n, moveNumber: move.moveNumber, player: move.player },
        }),
        encodeAbiParameters(
          [{ type: "address" }, { type: "string" }, { type: "string" }],
          [move.player, move.moveUci, move.fen],
        ),
        `0x${(index + 1).toString(16).padStart(64, "0")}` as Hash,
        index,
      ),
    );
  }
  return [];
}

function receipt(hash: Hash) {
  chain.receiptRequests.push(hash);
  if (hash === CREATE_HASH) chain.created = true;
  return {
    blockHash: BLOCK_HASH,
    blockNumber: numberToHex(BLOCK),
    contractAddress: null,
    cumulativeGasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    from: zeroAddress,
    gasUsed: "0x5208",
    logs: [],
    logsBloom: `0x${"00".repeat(256)}`,
    status: "0x1",
    to: CHESS_CONTRACT,
    transactionHash: hash,
    transactionIndex: "0x0",
    type: "0x2",
  };
}

function answer(method: string, params: unknown[]): unknown {
  switch (method) {
    case "eth_chainId":
      return numberToHex(20994);
    case "eth_blockNumber":
      return numberToHex(BLOCK);
    case "eth_call": {
      const { to, data } = params[0] as { to: Address; data: `0x${string}` };
      return call(to, data);
    }
    case "eth_getLogs": {
      const { topics } = params[0] as { topics?: string[] };
      return logs(topics?.[0]);
    }
    case "eth_getTransactionReceipt":
      return receipt(params[0] as Hash);
    default:
      throw new Error(`the fake chain has no method ${method}`);
  }
}

/** Node's `Request` refuses jsdom's `AbortSignal`, which viem's `http()` passes on every call. */
const NodeRequest = globalThis.Request;
class RequestWithoutSignal extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, { ...init, signal: undefined });
  }
}

/** Answers every JSON-RPC request the demo's public client sends through `fetch`. */
export function stubChain(): void {
  vi.stubGlobal("Request", RequestWithoutSignal);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const { id, method, params } = JSON.parse(String(init?.body));
      try {
        return Response.json({ jsonrpc: "2.0", id, result: answer(method, params ?? []) });
      } catch (error) {
        return Response.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: (error as Error).message },
        });
      }
    }),
  );
}
