import {
  isAddress,
  getAddress,
  type Address,
  type Chain,
  type PublicClient,
  type Transport,
} from "viem";

import type { FluentTokenDefinition } from "./balances.js";

const erc20MetadataAbi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export type FluentTokenMetadataResult =
  | { status: "ok"; token: FluentTokenDefinition }
  | { status: "invalid-address" }
  | { status: "unreadable"; reason: string };

/** The longest symbol `readFluentTokenMetadata` returns; a longer one is cut to this length. */
export const FLUENT_MAX_TOKEN_SYMBOL_LENGTH = 16;
export const FLUENT_MAX_TOKEN_NAME_LENGTH = 64;

/**
 * The largest `decimals` a token may declare. A contract read and the User token store check
 * the same bound, so the two cannot disagree on what counts as a token.
 */
export const FLUENT_MAX_TOKEN_DECIMALS = 36;

export function isFluentTokenDecimals(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= FLUENT_MAX_TOKEN_DECIMALS
  );
}

/**
 * Reads a token's symbol, decimals and name from its contract at `address`, so nothing a user
 * types reaches the result but the address. Returns `invalid-address` for a string that is not
 * an address, and `unreadable` when the contract reports no symbol or no valid `decimals`: a
 * guessed `decimals` would misstate every balance by a power of ten. A missing name falls back
 * to the symbol.
 */
export async function readFluentTokenMetadata<
  TTransport extends Transport = Transport,
  TChain extends Chain = Chain,
>(params: {
  client: PublicClient<TTransport, TChain>;
  address: string;
  chainId: number;
}): Promise<FluentTokenMetadataResult> {
  const trimmed = params.address.trim();
  if (!isAddress(trimmed)) return { status: "invalid-address" };
  const address = getAddress(trimmed) as Address;

  const read = <TName extends "name" | "symbol" | "decimals">(functionName: TName) =>
    params.client.readContract({
      address,
      abi: erc20MetadataAbi,
      functionName,
    });

  let symbol: string;
  let decimals: number;
  let name: string | undefined;
  try {
    // One read per field, not `client.multicall`: the Fluent chains configure no Multicall3.
    const [symbolResult, decimalsResult, nameResult] = await Promise.all([
      read("symbol"),
      read("decimals"),
      read("name").catch(() => undefined),
    ]);
    symbol = String(symbolResult).trim();
    decimals = Number(decimalsResult);
    name = nameResult === undefined ? undefined : String(nameResult).trim();
  } catch (error) {
    return {
      status: "unreadable",
      reason: error instanceof Error ? error.message : "Could not read the contract",
    };
  }

  if (!symbol) return { status: "unreadable", reason: "Contract reports no symbol" };
  if (!isFluentTokenDecimals(decimals)) {
    return { status: "unreadable", reason: "Contract reports invalid decimals" };
  }

  return {
    status: "ok",
    token: {
      chainId: params.chainId,
      address,
      symbol: symbol.slice(0, FLUENT_MAX_TOKEN_SYMBOL_LENGTH),
      name: (name || symbol).slice(0, FLUENT_MAX_TOKEN_NAME_LENGTH),
      decimals,
    },
  };
}
