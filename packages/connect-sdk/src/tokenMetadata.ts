import { isAddress, getAddress, type Address, type Chain, type PublicClient, type Transport } from "viem";

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

/** Longest symbol we will render. Anything beyond this is a UI-spoofing attempt. */
const MAX_SYMBOL_LENGTH = 16;
const MAX_NAME_LENGTH = 64;

/**
 * Read a token's own account of itself from its contract.
 *
 * Never trust user-typed metadata: the address is the only input, everything
 * else comes from the chain. `decimals` is mandatory — without it every balance
 * we render would be off by an unknown power of ten — so a contract that fails
 * to answer it is rejected rather than defaulted to 18.
 *
 * Reads are issued individually rather than batched: the Fluent chains have no
 * Multicall3 deployment configured, so `client.multicall` would throw.
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
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    return { status: "unreadable", reason: "Contract reports invalid decimals" };
  }

  return {
    status: "ok",
    token: {
      chainId: params.chainId,
      address,
      symbol: symbol.slice(0, MAX_SYMBOL_LENGTH),
      name: (name || symbol).slice(0, MAX_NAME_LENGTH),
      decimals,
    },
  };
}
