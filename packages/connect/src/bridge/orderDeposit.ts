import { decodeFunctionData, erc20Abi, padHex, parseUnits, type Address, type Hash } from "viem";

import type { OrderDepositPayload, OrderDepositQuote } from "./orderDepositApi";

/**
 * Below this many tokens the API has no quote: the solver's flat fee, about one token, leaves
 * nothing to deliver. The form says so before asking.
 */
export const ORDER_DEPOSIT_MIN_TOKENS = "2";

/** Returns the smallest Order deposit, in the smallest unit of a token with `decimals`. */
export function getOrderDepositMinimum(decimals: number): bigint {
  return parseUnits(ORDER_DEPOSIT_MIN_TOKENS, decimals);
}

export type OrderDepositApproval = {
  token: Address;
  spender: Address;
  amount: bigint;
};

/** Returns the ERC-20 approval `payload` asks for, or `undefined` when it is any other call. */
export function readOrderDepositApproval(
  payload: OrderDepositPayload,
): OrderDepositApproval | undefined {
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: payload.data });
    if (decoded.functionName !== "approve") return undefined;
    const [spender, amount] = decoded.args;
    return { token: payload.to, spender, amount };
  } catch {
    // Calldata no ERC-20 function reads: the order itself, for one.
    return undefined;
  }
}

/** Reports whether one of the 32-byte words of `data`'s arguments is `address`, left-padded. */
function hasAddressWord(data: string, address: Address): boolean {
  const wanted = padHex(address, { size: 32 }).slice(2).toLowerCase();
  const words = data.slice(10).toLowerCase();
  for (let offset = 0; offset + 64 <= words.length; offset += 64) {
    if (words.slice(offset, offset + 64) === wanted) return true;
  }
  return false;
}

/**
 * Returns why `quote` is not one this widget signs, or `undefined` when it is.
 *
 * The transactions come from a service, and the External wallet is about to be asked for them,
 * so they are held to the one shape an Order deposit has: at most one approval, then one order.
 * The approval is for the token being sent, for no more than the amount typed, to the contract
 * the order goes to; the order names the recipient; nothing carries ETH and everything is on
 * the source chain. A quote of any other shape is refused rather than understood.
 */
export function findOrderDepositQuoteFault({
  quote,
  sourceChainId,
  tokenIn,
  amountIn,
  recipient,
}: {
  quote: OrderDepositQuote;
  sourceChainId: number;
  tokenIn: Address;
  amountIn: bigint;
  recipient: Address;
}): string | undefined {
  if (quote.amountIn !== amountIn) return "it is for another amount";
  if (quote.amountOut <= 0n) return "it delivers nothing";
  if (quote.payloads.some((payload) => payload.chainId !== sourceChainId)) {
    return "it has a transaction on another chain";
  }
  if (quote.payloads.some((payload) => payload.value !== 0n)) return "it spends ETH";

  const order = quote.payloads[quote.payloads.length - 1];
  const approvals = quote.payloads.slice(0, -1);
  if (!order || approvals.length > 1) return "it is not an approval and an order";
  if (readOrderDepositApproval(order) || order.to.toLowerCase() === tokenIn.toLowerCase()) {
    return "its last transaction is not an order";
  }
  if (!hasAddressWord(order.data, recipient)) return "its order does not name the recipient";

  for (const payload of approvals) {
    const approval = readOrderDepositApproval(payload);
    if (!approval) return "its first transaction is not an approval";
    if (approval.token.toLowerCase() !== tokenIn.toLowerCase()) {
      return "it approves another token";
    }
    if (approval.amount > amountIn) return "it approves more than the amount sent";
    if (approval.spender.toLowerCase() !== order.to.toLowerCase()) {
      return "it approves a contract the order does not go to";
    }
  }
  return undefined;
}

/** What `sendOrderDeposit` needs of the source chain and of the External wallet. */
export type OrderDepositSigner = {
  /** Reads the allowance `owner` has given `spender` on `token` on the source chain. */
  readAllowance: (token: Address, owner: Address, spender: Address) => Promise<bigint>;
  /** Hands one transaction to the External wallet and resolves with its hash once signed. */
  sendTransaction: (payload: OrderDepositPayload) => Promise<Hash>;
  /** Resolves once the transaction is mined, and rejects when no receipt comes in time. */
  waitForReceipt: (hash: Hash) => Promise<"success" | "reverted">;
};

/**
 * Signs `quote`'s transactions in order and resolves with the hash of the last one, the order,
 * as soon as the External wallet has signed it. Every transaction before it is mined first: the
 * order spends the allowance the approval grants.
 *
 * An approval the chain already holds is not asked for again, since a signature that changes
 * nothing is a prompt nobody should see. `onStep` fires right before each prompt.
 */
export async function sendOrderDeposit({
  quote,
  account,
  signer,
  onStep,
}: {
  quote: OrderDepositQuote;
  account: Address;
  signer: OrderDepositSigner;
  onStep?: (step: "approval" | "order") => void;
}): Promise<Hash> {
  const steps: Array<{ payload: OrderDepositPayload; approval: boolean }> = [];
  for (const payload of quote.payloads) {
    const approval = readOrderDepositApproval(payload);
    if (approval) {
      const allowance = await signer
        .readAllowance(approval.token, account, approval.spender)
        // An allowance that cannot be read is not known to be enough.
        .catch(() => undefined);
      if (allowance !== undefined && allowance >= approval.amount) continue;
    }
    steps.push({ payload, approval: Boolean(approval) });
  }

  let hash: Hash | undefined;
  for (const [index, step] of steps.entries()) {
    onStep?.(step.approval ? "approval" : "order");
    hash = await signer.sendTransaction(step.payload);
    if (index === steps.length - 1) break;
    if ((await signer.waitForReceipt(hash)) !== "success") {
      throw new Error("The approval transaction reverted");
    }
  }
  if (!hash) throw new Error("The quote has no transaction to sign");
  return hash;
}

/**
 * The gas an `openOrder` on the mainnet OrderBook takes, with headroom: what the network fee
 * is priced at while the order's dry run cannot run, which is whenever its approval is still
 * to be signed.
 */
export const ORDER_DEPOSIT_ORDER_GAS = 250_000n;

/**
 * Returns the gas `quote`'s transactions need from `account`, summed, through `estimateGas`.
 * An approval the chain already holds is left out, as `sendOrderDeposit` leaves it out. The
 * order's dry run reverts until that approval is mined, so when it fails the order counts as
 * `ORDER_DEPOSIT_ORDER_GAS`; an approval's dry run failing is an error, as nothing stands in
 * its way.
 */
export async function estimateOrderDepositGas({
  quote,
  account,
  allowance,
  estimateGas,
}: {
  quote: OrderDepositQuote;
  account: Address;
  /** What the chain holds for the approval's spender, or `undefined` when it is not known. */
  allowance?: bigint;
  estimateGas: (payload: OrderDepositPayload & { account: Address }) => Promise<bigint>;
}): Promise<bigint> {
  let total = 0n;
  for (const payload of quote.payloads) {
    const approval = readOrderDepositApproval(payload);
    if (approval) {
      if (allowance !== undefined && allowance >= approval.amount) continue;
      total += await estimateGas({ ...payload, account });
      continue;
    }
    total += await estimateGas({ ...payload, account }).catch(() => ORDER_DEPOSIT_ORDER_GAS);
  }
  return total;
}

/**
 * Returns what the solver keeps as a share of the amount sent, 0 to 1, or `undefined` when the
 * quote delivers more than it takes or takes nothing. Both amounts are in the same unit: the
 * caller checks that the sent and the Delivered token share their decimals.
 */
export function getOrderDepositFeeShare(quote: OrderDepositQuote): number | undefined {
  if (quote.amountIn <= 0n || quote.amountOut > quote.amountIn) return undefined;
  const bps = ((quote.amountIn - quote.amountOut) * 10_000n) / quote.amountIn;
  return Number(bps) / 10_000;
}

/**
 * Above this share of the amount sent the form warns about the solver fee: the fee is flat,
 * about one token, so a small deposit loses a large part of itself to it.
 */
export const ORDER_DEPOSIT_FEE_SHARE_WARNING = 0.05;

/**
 * Above this share of the amount sent, up to `ORDER_DEPOSIT_FEE_SHARE_WARNING`, the form only
 * hints that a larger deposit pays a smaller share; at or below it the fee goes unremarked.
 */
export const ORDER_DEPOSIT_FEE_SHARE_HINT = 0.02;

/** How the form flags the solver fee: a warning for a small deposit, a hint for a modest one. */
export type OrderDepositFeeNotice = "warning" | "hint";

/**
 * Returns how the form flags the solver fee for a share of the amount sent, or `undefined` when
 * the share is small enough to go unremarked. Decided by the share and not by the amount, so the
 * bands hold when the solver changes its fee.
 */
export function getOrderDepositFeeNotice(share: number): OrderDepositFeeNotice | undefined {
  if (share > ORDER_DEPOSIT_FEE_SHARE_WARNING) return "warning";
  if (share > ORDER_DEPOSIT_FEE_SHARE_HINT) return "hint";
  return undefined;
}
