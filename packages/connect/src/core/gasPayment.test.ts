import {
  fluentTestnetTokenDefaults,
  fluentTokenIdentity,
  getFluentDefaultWidgetGasTokens,
  isFluentNativeToken,
} from "@fluent.xyz/connect-sdk";
import { describe, expect, it } from "vitest";

import {
  deriveFluentGasEthRates,
  getFluentGasPaymentEthValue,
  getFluentGasPaymentTokens,
  getFluentGasTokenAddress,
  getFluentGasTokenApproval,
} from "./gasPayment";

describe("getFluentGasPaymentTokens", () => {
  it("orders the payable tokens by gasPriority", () => {
    const gas = getFluentGasPaymentTokens(Object.values(fluentTestnetTokenDefaults));

    expect(gas.map((token) => token.symbol)).toEqual(["BLEND", "USDnr", "ETH"]);
  });

  it("ignores a gasPriority on a token we do not ship", () => {
    // An integrator's tokens come straight off a prop, so the flag alone must
    // not be enough to have the widget pay fees in someone else's token.
    const integratorToken = {
      chainId: 20994,
      address: "0x000000000000000000000000000000000000dEaD" as const,
      symbol: "THEIRS",
      name: "A builder's token",
      decimals: 18,
      gasPriority: 0,
    };

    const gas = getFluentGasPaymentTokens([
      integratorToken,
      fluentTestnetTokenDefaults.USDnr,
    ]);

    expect(gas.map((token) => token.symbol)).toEqual(["USDnr"]);
  });

  it("leaves out a token we ship without a gasPriority", () => {
    const notPayable = { ...fluentTestnetTokenDefaults.USDnr, gasPriority: undefined };

    expect(getFluentGasPaymentTokens([notPayable])).toEqual([]);
  });
});

describe("getFluentGasTokenAddress", () => {
  it("returns the paymaster address for an ERC-20 fee token", () => {
    expect(getFluentGasTokenAddress("USDnr", "testnet")).toBe(
      fluentTestnetTokenDefaults.USDnr.address,
    );
  });

  it("returns nothing for the native currency and for unknown symbols", () => {
    // ETH pays gas directly, so there is no paymaster token to charge.
    expect(getFluentGasTokenAddress("ETH", "testnet")).toBeUndefined();
    expect(getFluentGasTokenAddress("THEIRS", "testnet")).toBeUndefined();
  });
});

describe("getFluentGasTokenApproval", () => {
  it.each(["testnet", "mainnet"] as const)(
    "gives every ERC-20 Gas token Fluent ships on %s an automatic approval",
    (network) => {
      const erc20 = getFluentDefaultWidgetGasTokens(network).filter(
        (token) => !isFluentNativeToken(token),
      );
      expect(erc20.length).toBeGreaterThan(0);
      for (const token of erc20) {
        expect(getFluentGasTokenApproval(token.address!, network), token.symbol).toBeDefined();
      }
    },
  );

  it.each(["testnet", "mainnet"] as const)(
    "approves 1 USDnr below 0.1 USDnr and 10 BLEND below 1 BLEND on %s",
    (network) => {
      expect(getFluentGasTokenApproval(getFluentGasTokenAddress("USDnr", network)!, network))
        .toEqual({ amount: 1_000_000n, refreshBelow: 100_000n });
      expect(getFluentGasTokenApproval(getFluentGasTokenAddress("BLEND", network)!, network))
        .toEqual({ amount: 10n * 10n ** 18n, refreshBelow: 10n ** 18n });
    },
  );

  it("gives nothing for an address that is no Gas token", () => {
    expect(
      getFluentGasTokenApproval("0x3333333333333333333333333333333333333333", "testnet"),
    ).toBeUndefined();
  });
});

describe("deriveFluentGasEthRates", () => {
  const withIdentity = <T extends { chainId: number; address?: string; native?: true }>(token: T) => ({
    ...token,
    identity: fluentTokenIdentity(token as Parameters<typeof fluentTokenIdentity>[0]),
  });
  const eth = withIdentity(fluentTestnetTokenDefaults.ETH);
  const blend = withIdentity(fluentTestnetTokenDefaults.BLEND);
  const tokens = [eth, blend];

  it("prices every gas token against the native one", () => {
    const rates = deriveFluentGasEthRates({
      tokens,
      usdPrices: { [eth.identity]: 2000, [blend.identity]: 2 },
    });

    expect(rates.ETH).toBe("1.000000000000000000");
    expect(rates.BLEND).toBe("0.001000000000000000");
  });

  it("turns a dust balance into the tier that calls it dust", () => {
    // The case this exists for: without rates a non-zero balance has no ETH
    // value, so nothing could ever call it too small to pay a fee.
    const rates = deriveFluentGasEthRates({
      tokens,
      usdPrices: { [eth.identity]: 2000, [blend.identity]: 2 },
    });
    const value = getFluentGasPaymentEthValue({
      balance: { ...blend, raw: 9_664_597_648n, formatted: "0", status: "ready" },
      ethValueByToken: rates,
    });

    expect(value.tier).toBe("red");
  });

  it("keeps a rate the App configured over the one derived here", () => {
    const rates = deriveFluentGasEthRates({
      tokens,
      usdPrices: { [eth.identity]: 2000, [blend.identity]: 2 },
      configured: { BLEND: "0.5" },
    });

    expect(rates.BLEND).toBe("0.5");
  });

  it("derives nothing without a native price, and skips tokens with no price", () => {
    expect(
      deriveFluentGasEthRates({ tokens, usdPrices: {}, configured: { BLEND: "0.5" } }),
    ).toEqual({ BLEND: "0.5" });
    expect(
      deriveFluentGasEthRates({ tokens, usdPrices: { [eth.identity]: 2000 } }),
    ).toEqual({ ETH: "1.000000000000000000" });
  });

  it("never writes a rate in exponential notation", () => {
    // parseUnits reads these back as decimal strings; "1e-7" would be garbage.
    const rates = deriveFluentGasEthRates({
      tokens,
      usdPrices: { [eth.identity]: 2000, [blend.identity]: 0.0000002 },
    });

    expect(rates.BLEND).not.toMatch(/e/i);
    // 0.0000002 / 2000 = 1e-10 ETH per BLEND, so one whole BLEND is 1e8 wei.
    // The point is that it is not 0: exponential notation would parse to that.
    expect(getFluentGasPaymentEthValue({
      balance: { ...blend, raw: 10n ** 18n, formatted: "1", status: "ready" },
      ethValueByToken: rates,
    }).ethValueWei).toBe(100_000_000n);
  });
});
