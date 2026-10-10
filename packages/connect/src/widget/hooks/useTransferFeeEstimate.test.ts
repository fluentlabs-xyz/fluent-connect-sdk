import { describe, expect, it } from "vitest";
import { fluentTokenIdentity, type FluentDisplayToken } from "@fluent.xyz/connect-sdk";

import { convertFluentFeeToGasToken } from "./useTransferFeeEstimate";

const BLEND = {
  chainId: 20994,
  symbol: "BLEND",
  name: "Mock Blend",
  decimals: 18,
  address: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
} as const;
const ETH = {
  chainId: 20994,
  symbol: "ETH",
  name: "Ether",
  decimals: 18,
  native: true,
} as const;

const blend: FluentDisplayToken = { ...BLEND, source: "default", identity: fluentTokenIdentity(BLEND) };
const eth: FluentDisplayToken = { ...ETH, source: "default", identity: fluentTokenIdentity(ETH) };

describe("convertFluentFeeToGasToken", () => {
  it("leaves a native fee as it is", () => {
    expect(convertFluentFeeToGasToken({ wei: 1_000n, feeToken: eth })).toBe(1_000n);
  });

  it("restates the fee in an ERC-20 by its ETH rate", () => {
    // 1 BLEND = 0.001 ETH, so 0.002 ETH of fee is 2 BLEND.
    const wei = 2n * 10n ** 15n;
    expect(
      convertFluentFeeToGasToken({ wei, feeToken: blend, ethValueByToken: { BLEND: "0.001" } }),
    ).toBe(2n * 10n ** 18n);
  });

  it("gives up without a rate for the fee token", () => {
    expect(convertFluentFeeToGasToken({ wei: 1_000n, feeToken: blend })).toBeUndefined();
  });
});
