import { describe, expect, it } from "vitest";
import {
  fluentTestnetTokenDefaults,
  getFluentDefaultWidgetGasTokens,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";

import { getFluentGasPaymentTokens } from "../../core/gasPayment";

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
    expect(resolveGasPaymentSelection({ gasPaymentToken: "ETH", availableTokens: tokens })).toEqual(
      { symbol: "ETH", token: undefined, decimals: 18 },
    );
  });

  it("falls back to 0 decimals for an unknown non-ETH symbol", () => {
    expect(resolveGasPaymentSelection({ gasPaymentToken: "BLEND", availableTokens: [] })).toEqual({
      symbol: "BLEND",
      token: undefined,
      decimals: 0,
    });
  });
});

describe("narrowing the candidate list before resolving", () => {
  it("resolves the Default token, not an Integrator token that claims its symbol", () => {
    // The resolved address is what the paymaster is asked to charge, so an Integrator token
    // that claims a Gas token's symbol must not win the symbol match against the real one.
    const impostor = {
      chainId: 20994,
      address: "0x000000000000000000000000000000000000dEaD" as const,
      symbol: "BLEND",
      name: "Not BLEND",
      decimals: 18,
      gasPriority: 0,
    };
    const integratorTokens = [impostor, fluentTestnetTokenDefaults.BLEND];

    const naive = resolveGasPaymentSelection({
      gasPaymentToken: "BLEND",
      availableTokens: integratorTokens,
    });
    const narrowed = resolveGasPaymentSelection({
      gasPaymentToken: "BLEND",
      availableTokens: getFluentGasPaymentTokens(integratorTokens),
    });

    expect(naive.token).toBe(impostor.address);
    expect(narrowed.token).toBe(fluentTestnetTokenDefaults.BLEND.address);
  });
});

describe("the candidate list is the network's Gas tokens, not the `tokens` prop", () => {
  it("resolves a Gas token when the `tokens` prop holds only Integrator tokens", () => {
    // The `tokens` prop only adds Display tokens and usually holds no Gas token: narrowed, it
    // would leave no candidate and resolve every Gas payment to `decimals: 0` with no token.
    const extraOnly = [
      {
        chainId: 20994,
        address: "0x00000000000000000000000000000000000BEEF1" as const,
        symbol: "THEIRS",
        name: "A builder's token",
        decimals: 6,
      },
    ];

    expect(getFluentGasPaymentTokens(extraOnly)).toEqual([]);
    expect(
      resolveGasPaymentSelection({
        gasPaymentToken: "BLEND",
        availableTokens: getFluentDefaultWidgetGasTokens("testnet"),
      }),
    ).toEqual({
      symbol: "BLEND",
      token: fluentTestnetTokenDefaults.BLEND.address,
      decimals: 18,
    });
  });
});
