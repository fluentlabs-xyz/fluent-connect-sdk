import {
  fluentTestnetTokenDefaults,
  fluentTokenIdentity,
  isFluentDefaultToken,
  type FluentTokenBalance,
} from "@fluent.xyz/connect-sdk";
import { describe, expect, it } from "vitest";

import {
  getFluentPriceableSymbols,
  mapFluentPricesToTokenIdentities,
} from "./tokenPrices";
import { sumFluentTokenBalancesUsd } from "../hooks/useFluentTokenBalances";

/** Claims Fluent's own stablecoin ticker from a different contract. */
const FAKE_USDNR = {
  chainId: 20994,
  address: "0x000000000000000000000000000000000000dEaD" as const,
  symbol: "USDnr",
  name: "Definitely USDnr",
  decimals: 18,
};

describe("isFluentDefaultToken", () => {
  it("matches on identity, not on symbol", () => {
    expect(isFluentDefaultToken(fluentTestnetTokenDefaults.USDnr)).toBe(true);
    expect(isFluentDefaultToken(fluentTestnetTokenDefaults.ETH)).toBe(true);
    expect(isFluentDefaultToken(FAKE_USDNR)).toBe(false);
  });

  it("does not let a token be one of ours on the wrong chain", () => {
    expect(
      isFluentDefaultToken({ ...fluentTestnetTokenDefaults.USDnr, chainId: 999 }),
    ).toBe(false);
  });
});

describe("pricing barrier", () => {
  const pricesBySymbol = { USDnr: 1, ETH: 2500, BLEND: 0.06 };

  it("only asks the price feeds about tokens we vouch for", () => {
    const symbols = getFluentPriceableSymbols([
      fluentTestnetTokenDefaults.ETH,
      FAKE_USDNR,
    ]);

    expect(symbols).toEqual(["ETH"]);
  });

  it("refuses to price an impostor even though its symbol is priced", () => {
    const byIdentity = mapFluentPricesToTokenIdentities(
      [fluentTestnetTokenDefaults.USDnr, FAKE_USDNR],
      pricesBySymbol,
    );

    expect(byIdentity[fluentTokenIdentity(fluentTestnetTokenDefaults.USDnr)]).toBe(1);
    expect(byIdentity[fluentTokenIdentity(FAKE_USDNR)]).toBeUndefined();
  });

  it("keeps an impostor's balance out of the portfolio total", () => {
    const balances: FluentTokenBalance[] = [
      {
        ...fluentTestnetTokenDefaults.USDnr,
        raw: 5_000_000n,
        formatted: "5",
        status: "ready",
      },
      // A million of these would read as $1,000,000 if pricing went by symbol.
      { ...FAKE_USDNR, raw: 10n ** 24n, formatted: "1000000", status: "ready" },
    ];
    const byIdentity = mapFluentPricesToTokenIdentities(balances, pricesBySymbol);

    expect(sumFluentTokenBalancesUsd(balances, byIdentity)).toBe(5);
  });

  it("returns null when nothing on the list can be priced", () => {
    const balances: FluentTokenBalance[] = [
      { ...FAKE_USDNR, raw: 1n, formatted: "1", status: "ready" },
    ];

    expect(
      sumFluentTokenBalancesUsd(balances, mapFluentPricesToTokenIdentities(balances, pricesBySymbol)),
    ).toBeNull();
  });
});
