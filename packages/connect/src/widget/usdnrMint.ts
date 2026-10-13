import { getFluentTokenDefaultsForNetwork } from "@fluent.xyz/connect-sdk";
import { parseAbi, parseUnits, type Address, type Hash } from "viem";

import type { FluentBatchCallInput } from "./batchOperation";

/**
 * Names the batch operation a testnet USDnr mint builds, the way
 * `FLUENT_SEND_TOKEN_OP_ID` names a Send: every widget operation reaches the
 * chain through the same `createBatchOp`, and the id is how one of them can be
 * told from a host app's afterwards.
 */
export const FLUENT_USDNR_MINT_OP_ID = "fluent-mint-usdnr";

/**
 * The heading the review modal shows. The button's own label, so what the
 * person is asked to confirm is named after what they pressed.
 */
export const FLUENT_USDNR_MINT_REVIEW_TITLE = "Get USDnr";

/**
 * How much one press hands out, in whole USDnr. A constant rather than a
 * setting: the contract's `mint` is open to any sender with no cap, so there is
 * nothing to ration, and this is testnet money in any case.
 */
export const FLUENT_USDNR_MINT_AMOUNT = 1000;

/**
 * `mint(address,uint256)` on the testnet USDnr contract — callable by anyone,
 * with no cap. Not an ERC-20 function: it exists on that one mock contract, and
 * nothing outside the testnet faucet path may assume a token has it.
 */
export const fluentUsdnrMintAbi = parseAbi(["function mint(address to, uint256 amount)"]);

/**
 * The contract a mint goes to, and the decimals its amount is counted in. Read
 * off the Default token set rather than written down a second time here: that
 * set is where "which contract testnet USDnr is" is decided, and it has already
 * moved once (FLU-1570 switched it, decimals and all).
 */
export function getFluentUsdnrMintToken() {
  return getFluentTokenDefaultsForNetwork("testnet").USDnr;
}

/**
 * The one call that mints {@link FLUENT_USDNR_MINT_AMOUNT} USDnr to
 * `recipient`. The recipient is the Widget account — the address the wallet
 * menu shows balances for and Send sends from — not the Fluent smart account
 * behind it: an External wallet has no smart account and still needs the money
 * where its balances are read.
 */
export function buildFluentUsdnrMintCall(recipient: Address): FluentBatchCallInput {
  const token = getFluentUsdnrMintToken();
  return {
    id: FLUENT_USDNR_MINT_OP_ID,
    label: `Mint ${FLUENT_USDNR_MINT_AMOUNT} ${token.symbol}`,
    to: token.address,
    abi: fluentUsdnrMintAbi,
    method: "mint",
    args: [recipient, parseUnits(String(FLUENT_USDNR_MINT_AMOUNT), token.decimals)],
  };
}

export type FluentUsdnrMintOutcome =
  | { status: "minted"; hash: Hash }
  /** The person dismissed the review. Not a failure, and nothing to report. */
  | { status: "rejected" }
  | { status: "failed"; message: string }
  /**
   * The press built nothing, because a mint was already in flight. Its own
   * status rather than a silent `undefined`: a caller counting operations — the
   * double-press this guards against — needs to see that one was refused.
   */
  | { status: "skipped" };

/**
 * What the wallet menu's Get USDnr button runs on testnet. The widget hands one
 * in; the card holds no execution of its own.
 */
export type FluentUsdnrMinter = (recipient: Address) => Promise<FluentUsdnrMintOutcome>;
