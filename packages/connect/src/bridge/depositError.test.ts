/**
 * The sentence the Bridge page shows for a refused deposit: a refusal for want of ETH is named,
 * a viem error keeps its one-line `shortMessage`, and the rest fall through.
 */
import { BaseError, InsufficientFundsError, TransactionExecutionError } from "viem";
import { describe, expect, it } from "vitest";

import { describeDepositError } from "./depositError";

const describe_ = (error: unknown) =>
  describeDepositError({ error, chainName: "Ethereum", fallback: "The deposit could not be sent" });

describe("describeDepositError", () => {
  it("names the missing ETH for viem's InsufficientFundsError, however deeply it is wrapped", () => {
    const rpc = new BaseError("Insufficient funds to pay for gas fees and value for a transaction");
    const wrapped = new TransactionExecutionError(new InsufficientFundsError({ cause: rpc }), {
      account: null,
    });
    expect(describe_(wrapped)).toBe(
      "Not enough ETH on Ethereum to pay the network fee. " +
        "Add ETH to your wallet, or let the wallet pay gas another way, and try again.",
    );
  });

  it("names the missing ETH for a wallet's own wording of it", () => {
    expect(describe_(new Error("RPC 0x1: insufficient funds for gas * price + value"))).toMatch(
      /^Not enough ETH on Ethereum/,
    );
  });

  it("keeps the one-line shortMessage of any other viem error", () => {
    const error = new BaseError("Nonce too low.", { details: "nonce too low: next nonce 171" });
    expect(describe_(error)).toBe("Nonce too low.");
  });

  it("keeps the message of a plain Error and falls back for anything else", () => {
    expect(describe_(new Error("The approval transaction reverted"))).toBe(
      "The approval transaction reverted",
    );
    expect(describe_("timeout")).toBe("The deposit could not be sent");
    expect(describe_(undefined)).toBe("The deposit could not be sent");
  });
});
