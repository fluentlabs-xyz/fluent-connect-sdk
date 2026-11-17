import { BaseError } from "viem";

/**
 * Returns the sentence the Bridge page shows for a deposit the External wallet or the source
 * chain refused. A refusal for want of ETH is named as such, whatever wording the wallet's RPC
 * gives it; any other viem error keeps its `shortMessage`, the one line viem means for people,
 * and leaves the request dump to the console; an `Error` of any other kind keeps its message;
 * anything else reads as `fallback`.
 */
export function describeDepositError({
  error,
  chainName,
  fallback,
}: {
  error: unknown;
  /** The source chain, named in the sentence about ETH. */
  chainName: string;
  fallback: string;
}): string {
  if (isInsufficientFunds(error)) {
    return (
      `Not enough ETH on ${chainName} to pay the network fee. ` +
      "Add ETH to your wallet, or let the wallet pay gas another way, and try again."
    );
  }
  if (error instanceof BaseError) return error.shortMessage;
  if (error instanceof Error) return error.message;
  return fallback;
}

/**
 * The wordings a node or a wallet refuses an unaffordable transaction with: viem's
 * `InsufficientFundsError` and the geth text behind it, which MetaMask's RPC passes on.
 */
const INSUFFICIENT_FUNDS_TEXTS = ["insufficient funds", "exceeds the balance of the account"];

/** Reports whether any sentence of `error`'s chain says the account cannot pay for the call. */
function isInsufficientFunds(error: unknown): boolean {
  return errorTexts(error).some((text) => {
    const lowered = text.toLowerCase();
    return INSUFFICIENT_FUNDS_TEXTS.some((needle) => lowered.includes(needle));
  });
}

/** Returns every sentence an error chain carries, viem's `details` and `shortMessage` included. */
function errorTexts(error: unknown): string[] {
  const texts: string[] = [];
  let current: unknown = error;
  // Bounded: a `cause` cycle must not hang the page over a failed deposit.
  for (let depth = 0; depth < 10 && current !== undefined && current !== null; depth += 1) {
    if (current instanceof BaseError) {
      texts.push(current.shortMessage, current.details, ...(current.metaMessages ?? []));
    }
    if (current instanceof Error) {
      texts.push(current.message);
      current = current.cause;
      continue;
    }
    if (typeof current === "string") texts.push(current);
    break;
  }
  return texts.filter((text): text is string => typeof text === "string" && text.length > 0);
}
