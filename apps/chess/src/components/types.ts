import type { Address, Hash } from "viem";

export type ChessBotLevel = "easy" | "medium" | "hard";
export type ChessPlayMode = "bot" | "manual";

export type ChessGameMeta = {
  white?: string;
  black?: string;
  turn?: string;
  moveCount?: bigint;
  active?: boolean;
};

export type ChessActivityItem = {
  moveNumber: bigint;
  moveUci: string;
  player?: Address;
  txHash?: Hash;
  blockNumber?: bigint;
};

export type ChessActivityRow = {
  white?: ChessActivityItem;
  black?: ChessActivityItem;
};

export type ChessPermissionSession = {
  serializedPermissionAccount: string;
  sessionSignerAddress: Address;
  smartAccountAddress: Address;
  createdAt: number;
};
