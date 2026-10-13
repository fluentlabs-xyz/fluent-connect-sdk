/**
 * The one call a Get USDnr press builds on testnet.
 *
 * Checked through the batch encoder rather than on the call object alone: what
 * reaches the chain is the encoded calldata, and a wrong selector or a wrong
 * argument order is invisible in `{ method, args }`.
 */
import { decodeFunctionData, encodeFunctionData, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { createFluentBatchOp } from "./batchOperation";
import {
  buildFluentUsdnrMintCall,
  FLUENT_USDNR_MINT_AMOUNT,
  fluentUsdnrMintAbi,
  getFluentUsdnrMintToken,
} from "./usdnrMint";

/** The contract the Issue names, written out rather than imported. */
const TESTNET_USDNR = "0x279a6DC6354374473f6f3CFB3999e6C2e146f8a1";
const RECIPIENT = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as Address;
/** 1000 USDnr in base units, at the contract's six decimals. */
const THOUSAND_USDNR = 1_000_000_000n;

describe("buildFluentUsdnrMintCall", () => {
  it("mints 1000 USDnr to the recipient on the testnet USDnr contract", () => {
    const { encodedCalls } = createFluentBatchOp({
      calls: [buildFluentUsdnrMintCall(RECIPIENT)],
    });

    expect(encodedCalls).toHaveLength(1);
    expect(encodedCalls[0]!.to).toBe(TESTNET_USDNR);
    expect(encodedCalls[0]!.value).toBe(0n);
    expect(encodedCalls[0]!.data).toBe(
      encodeFunctionData({
        abi: fluentUsdnrMintAbi,
        functionName: "mint",
        args: [RECIPIENT, THOUSAND_USDNR],
      }),
    );
    // And the same fact from the other side, independent of how it was built.
    expect(decodeFunctionData({ abi: fluentUsdnrMintAbi, data: encodedCalls[0]!.data })).toEqual({
      functionName: "mint",
      args: [RECIPIENT, THOUSAND_USDNR],
    });
  });

  it("counts the amount in the decimals the token set holds", () => {
    const token = getFluentUsdnrMintToken();

    // The guard on the constant: 1000 USDnr is 1000000000 only while USDnr has
    // six decimals, and this token has already been swapped once (FLU-1570).
    expect(token.address).toBe(TESTNET_USDNR);
    expect(token.decimals).toBe(6);
    expect(BigInt(FLUENT_USDNR_MINT_AMOUNT) * 10n ** BigInt(token.decimals)).toBe(THOUSAND_USDNR);
  });
});
