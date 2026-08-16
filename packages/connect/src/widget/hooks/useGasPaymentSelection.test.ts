import { describe, expect, it } from "vitest";
import type { FluentTokenDefinition } from "@fluent.xyz/connect-sdk";

import { resolveGasPaymentSelection } from "./useGasPaymentSelection";

const tokens = [
  { symbol: "USDnr", decimals: 6, address: "0x092AE7564C6611a114C20C6df766B5B35A52334A" },
  { symbol: "BLEND", decimals: 18, address: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E" },
  { symbol: "ETH", decimals: 18 },
] as unknown as FluentTokenDefinition[];

describe("resolveGasPaymentSelection", () => {
  it("resolves a known ERC-20 to its address and decimals", () => {
    expect(
      resolveGasPaymentSelection({ gasPaymentToken: "USDnr", availableTokens: tokens }),
    ).toEqual({
      symbol: "USDnr",
      token: "0x092AE7564C6611a114C20C6df766B5B35A52334A",
      decimals: 6,
    });
  });

  it("leaves native ETH without a token address, defaulting to 18 decimals", () => {
    expect(
      resolveGasPaymentSelection({ gasPaymentToken: "ETH", availableTokens: tokens }),
    ).toEqual({ symbol: "ETH", token: undefined, decimals: 18 });
  });

  it("falls back to 0 decimals for an unknown non-ETH symbol", () => {
    expect(
      resolveGasPaymentSelection({ gasPaymentToken: "BLEND", availableTokens: [] }),
    ).toEqual({ symbol: "BLEND", token: undefined, decimals: 0 });
  });
});
