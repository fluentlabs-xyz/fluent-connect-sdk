import {
  isFluentNativeToken,
  type FluentDisplayToken,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import { isAddress, parseAbi, parseUnits, type Address, type Hash } from "viem";

import type { FluentBatchCallInput } from "./batchOperation";

export type FluentTokenTransferRequest = {
  token: FluentDisplayToken;
  to: Address;
  /** In the token's base units, already checked against the balance. */
  amount: bigint;
};

export type FluentTokenTransferOutcome =
  | { status: "sent"; hash: Hash }
  /** The user dismissed the review. Not a failure, and nothing to report. */
  | { status: "rejected" }
  | { status: "failed"; message: string };

/** What the wallet menu hands a form to actually move the money. */
export type FluentTokenTransferSender = (
  request: FluentTokenTransferRequest,
) => Promise<FluentTokenTransferOutcome>;

/** Digits, then at most one dot, then digits. No sign, no exponent, no spaces. */
const AMOUNT_SHAPE = /^\d*(\.\d*)?$/;
/** Everything `isAddress` accepts before it looks at the checksum. */
const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/;

export const fluentTransferAbi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export type FluentTransferRecipient =
  | { status: "ok"; address: Address }
  | { status: "empty" }
  | { status: "rejected"; message: string };

/**
 * The address a transfer would pay. Rejected rather than merely unparsed for
 * the two destinations that look valid and still lose the money: the sending
 * account itself, and a token's own contract.
 */
export function parseFluentTransferRecipient(params: {
  input: string;
  /** The account the funds leave, which can never be where they arrive. */
  self?: string;
  /** Contract addresses of the listed tokens, lowercased. */
  contracts?: ReadonlySet<string>;
}): FluentTransferRecipient {
  const trimmed = params.input.trim();
  if (!trimmed) return { status: "empty" };

  if (!ADDRESS_SHAPE.test(trimmed)) {
    return { status: "rejected", message: "Enter an address: 0x followed by 40 characters." };
  }
  // The shape is already right, so the only thing `isAddress` can still object
  // to is the capitalisation — which is a checksum over the address. A single
  // mistyped character in a pasted address fails here instead of on-chain.
  if (!isAddress(trimmed)) {
    return {
      status: "rejected",
      message: "This address fails its checksum. Check it for a typo.",
    };
  }

  const lowercased = trimmed.toLowerCase();
  if (params.self && params.self.toLowerCase() === lowercased) {
    return { status: "rejected", message: "This is the address you are sending from." };
  }
  if (params.contracts?.has(lowercased)) {
    return {
      status: "rejected",
      message: "This is a token's contract address, not a wallet. Tokens sent there are lost.",
    };
  }

  return { status: "ok", address: trimmed as Address };
}

export type FluentTransferAmount =
  | { status: "ok"; raw: bigint }
  | { status: "empty" }
  | { status: "rejected"; message: string };

/**
 * The amount a transfer would move, in the token's own base units.
 *
 * `balance` is required and not nullable on purpose: every answer here is
 * checked against it, so a caller whose balance has not arrived yet has nothing
 * to validate against and must wait rather than pass a stand-in.
 */
export function parseFluentTransferAmount(params: {
  input: string;
  symbol: string;
  decimals: number;
  balance: bigint;
}): FluentTransferAmount {
  const trimmed = params.input.trim();
  if (!trimmed) return { status: "empty" };

  if (trimmed.includes(",")) {
    return { status: "rejected", message: "Use a dot for the decimal point." };
  }
  // `.` and `` both pass the shape but parse to nothing.
  if (!AMOUNT_SHAPE.test(trimmed) || !/\d/.test(trimmed)) {
    return { status: "rejected", message: "Enter the amount as a number, like 12.5." };
  }

  const fraction = trimmed.split(".")[1] ?? "";
  if (fraction.length > params.decimals) {
    // parseUnits would round this for us, silently sending an amount other than
    // the one on screen.
    return {
      status: "rejected",
      message:
        params.decimals === 0
          ? `${params.symbol} cannot be split — enter a whole number.`
          : `${params.symbol} has ${params.decimals} decimals. Use at most that many.`,
    };
  }

  const raw = parseUnits(trimmed, params.decimals);
  if (raw === 0n) {
    return { status: "rejected", message: "Enter an amount greater than 0." };
  }
  if (raw > params.balance) {
    return { status: "rejected", message: `That is more than your ${params.symbol} balance.` };
  }

  return { status: "ok", raw };
}

/**
 * The one call that moves `amount` of `token` to `to`: a plain value send for
 * the chain's own currency, an ERC-20 `transfer` for everything else.
 */
export function buildFluentTransferCall(params: {
  token: Pick<FluentTokenDefinition, "address" | "symbol" | "native">;
  to: Address;
  amount: bigint;
}): FluentBatchCallInput {
  const { token, to, amount } = params;
  const label = `Send ${token.symbol}`;

  if (isFluentNativeToken(token)) {
    return { id: "fluent-send-token", label, to, value: amount, data: "0x" };
  }
  if (!token.address) {
    throw new Error(`${token.symbol} has no contract address on this network`);
  }
  return {
    id: "fluent-send-token",
    label,
    to: token.address,
    abi: fluentTransferAbi,
    method: "transfer",
    args: [to, amount],
  };
}
