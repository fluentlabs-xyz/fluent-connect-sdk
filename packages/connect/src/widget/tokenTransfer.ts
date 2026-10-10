import {
  isFluentNativeToken,
  type FluentDisplayToken,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import { isAddress, parseAbi, parseUnits, type Address, type Hash } from "viem";

import type { FluentGasTokenSymbol } from "../core/gasPayment";
import type { FluentTransactionHistoryEntry } from "../core/transactionHistory";
import { getFluentGasPaymentValueTier } from "../core/gasPayment";
import type { FluentBatchCallInput } from "./batchOperation";

export type FluentTokenTransferRequest = {
  token: FluentDisplayToken;
  to: Address;
  /** In the token's base units, already checked against the balance. */
  amount: bigint;
  /**
   * What the fee is charged in, for this one transfer. Overrides the gas token
   * stored in User settings without changing it: a withdrawal is exactly the
   * moment the usual choice may be the wrong one.
   */
  gasSymbol: FluentGasTokenSymbol;
};

export type FluentTokenTransferOutcome =
  | { status: "sent"; hash: Hash }
  /** The user dismissed the review. Not a failure, and nothing to report. */
  | { status: "rejected" }
  | { status: "failed"; message: string };

/**
 * Names the batch operation a Send builds. The widget reads it back off a
 * review to tell its own transfer from a host app's: both go through
 * `createBatchOp`, and only this one may put the account drawer back up.
 */
export const FLUENT_SEND_TOKEN_OP_ID = "fluent-send-token";

/**
 * A transfer the widget has sent and is still waiting on. It has no hash yet —
 * `execute` resolves with one only after the receipt — so it cannot be a
 * `FluentTransactionHistoryEntry`, every one of which describes something
 * already mined. Activity lists these above the mined rows until the real one
 * takes over.
 */
export type FluentPendingTransfer = {
  id: string;
  /** `fluentTokenIdentity` of the token, so the row it fills in prices and filters like any other. */
  tokenIdentity: string;
  symbol: string;
  /** Decimal, unsigned: a pending transfer is always outgoing. */
  amount: string;
  to: Address;
  /** Unix milliseconds, so it sorts into the list beside the mined rows. */
  startedAt: number;
  /**
   * Set once the transfer settles. The row stays until the history has caught
   * up and lists this hash: FluentScan indexes a little behind the receipt, so
   * dropping the row the moment `execute` resolves makes the transfer vanish
   * from the list for as long as the next refetch takes.
   */
  hash?: Hash;
  /**
   * The stand-in row has given up waiting for the history to list this hash.
   * The details stay: the history may yet list the operation before the
   * transfer it carried, and they are what fills that row in.
   */
  expired?: boolean;
};

/**
 * Fills in what the history does not know yet. FluentScan lists a user
 * operation and the token transfer it carried from two endpoints, and the
 * operation can land first — as a bare "Operation" that moved nothing, for a
 * send the widget itself just made. Where a settled transfer's hash matches
 * such an entry, its movement is written from the transfer, so the row reads
 * as the send it is until the explorer catches up and the real one takes over.
 */
export function attachFluentPendingTransfers(
  entries: readonly FluentTransactionHistoryEntry[],
  transfers: readonly FluentPendingTransfer[],
): readonly FluentTransactionHistoryEntry[] {
  const settled = new Map<string, FluentPendingTransfer>();
  for (const transfer of transfers) {
    if (transfer.hash) settled.set(transfer.hash.toLowerCase(), transfer);
  }
  if (settled.size === 0) return entries;

  return entries.map((entry) => {
    if (entry.kind !== "operation" || entry.movements.length > 0) return entry;
    const transfer =
      settled.get(entry.hash.toLowerCase()) ?? settled.get(entry.transactionHash.toLowerCase());
    if (!transfer) return entry;
    return {
      ...entry,
      movements: [
        {
          kind: "movement",
          id: `${entry.id}:${transfer.id}`,
          status: entry.status,
          timestamp: entry.timestamp,
          hash: entry.transactionHash,
          direction: "sent",
          tokenIdentity: transfer.tokenIdentity,
          symbol: transfer.symbol,
          amount: transfer.amount,
          counterparty: transfer.to,
        },
      ],
    };
  });
}

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

export type FluentTransferGasContext = {
  /** The fee can be charged to an ERC-20, so there is a fee token to choose. */
  erc20Gas: boolean;
  /** The App's paymaster may cover a native-gas operation. */
  sponsorshipAvailable: boolean;
};

/**
 * What pays a transfer's fee, for the Send form's selector and its warnings.
 *
 * Deliberately not `FluentWidgetAccount.capabilities.erc20Gas`. That reports
 * whether the smart account can execute *this instant*, which in hosted mode is
 * never true until something asks it to — the ZeroDev initializer needs a local
 * Privy signer and only direct mode has one — so reading it here hid the fee
 * selector from every hosted App. The question the form is really asking is the
 * slower-moving one of which account will pay: a Fluent ID can be charged an
 * ERC-20 by the paymaster, an External wallet has none and always pays its own
 * native gas, and where both are connected the widget shows the wallet's
 * balances and routes to it, so the conservative answer is the wallet's.
 */
export function resolveFluentTransferGasContext(params: {
  /** The Fluent ID's address, when this widget has one. */
  fluentAccountAddress?: string;
  /** An External wallet is connected and fronting the account. */
  walletConnected: boolean;
  sponsorshipUrl?: string;
  appId?: string;
}): FluentTransferGasContext {
  return {
    erc20Gas: Boolean(params.fluentAccountAddress) && !params.walletConnected,
    sponsorshipAvailable: Boolean(params.sponsorshipUrl && params.appId),
  };
}

export type FluentTransferFee =
  | { status: "ok" }
  /** Worth saying, but the send may still succeed. */
  | { status: "warning"; message: string }
  /** This send cannot pay its fee. Nothing to do but change something first. */
  | { status: "blocked"; message: string };

/**
 * Whether the account can pay for this transfer's fee.
 *
 * Not a gas estimate — nothing here knows what the operation will cost. It
 * answers the one question that needs no estimate to answer: whether there is
 * any of the fee token at all. A send that empties the fee token's own balance
 * is left to the review and the chain, as any other operation is.
 *
 * "Blocked" and "warning" are the same facts under different gas paths.
 * Sponsorship covers native gas only — an ERC-20 fee is charged by that token's
 * own paymaster, which the App's paymaster never stands in for — so an empty
 * balance is certain failure there and merely likely failure on the native
 * path of a sponsoring App.
 */
export function checkFluentTransferFee(params: {
  /** The token the fee will be charged in, already resolved for this account. */
  feeToken: FluentDisplayToken;
  /** Its balance, or null while it is unread. */
  feeBalance: bigint | null;
  /**
   * Roughly what that balance is worth in wei, where the App configured
   * `gasPayment.ethValueByToken`. Without rates there is no way to call a
   * non-zero balance too small, and this stays undefined.
   */
  feeBalanceEthValue?: bigint | null;
  /** True where the App's paymaster may cover a native-gas operation. */
  sponsorshipAvailable: boolean;
}): FluentTransferFee {
  const { feeToken, feeBalance, feeBalanceEthValue, sponsorshipAvailable } = params;
  if (feeBalance === null) return { status: "ok" };

  const symbol = feeToken.symbol;
  const mustPay = !isFluentNativeToken(feeToken) || !sponsorshipAvailable;
  const verdict = (message: string, sponsorable: string): FluentTransferFee =>
    mustPay ? { status: "blocked", message } : { status: "warning", message: sponsorable };

  if (feeBalance === 0n) {
    return verdict(
      `You don't have enough ${symbol} to cover the fee. Select another token you hold.`,
      `You have no ${symbol}. This will only go through if the app covers the fee.`,
    );
  }

  if (
    feeBalanceEthValue !== null &&
    feeBalanceEthValue !== undefined &&
    getFluentGasPaymentValueTier(feeBalanceEthValue) === "red"
  ) {
    // Dust by the widget's own measure. Whether it covers this operation needs
    // a price for it, so this stays a warning on every path.
    return { status: "warning", message: `Your ${symbol} balance may be too small for the fee.` };
  }

  return { status: "ok" };
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
