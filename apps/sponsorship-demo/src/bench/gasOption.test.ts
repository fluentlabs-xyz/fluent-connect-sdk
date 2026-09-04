import { describe, expect, it } from "vitest";

import type { Erc20PaymasterState } from "./erc20Paymaster";
import {
  describeApproval,
  describeGasPayer,
  dryRunAvailability,
  gasOptionAvailability,
} from "./gasOption";

const RESOLVED: Erc20PaymasterState = {
  status: "ready",
  address: "0x1111111111111111111111111111111111111111",
};
const RESOLVING: Erc20PaymasterState = { status: "resolving" };
const UNREACHABLE: Erc20PaymasterState = { status: "unreachable", error: "fetch failed" };

const READY_BALANCE = { status: "ready" as const, raw: 5n * 10n ** 18n };
const EMPTY_BALANCE = { status: "ready" as const, raw: 0n };

const TOKEN_ADDRESS = "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E" as const;

describe("gasOptionAvailability", () => {
  it("enables the sponsored option whenever the account can execute, without consulting the paymaster", () => {
    expect(
      gasOptionAvailability({
        symbol: "ETH",
        executionReady: true,
        erc20Gas: true,
        paymaster: UNREACHABLE,
        gasTokenAddress: undefined,
        balance: undefined,
      }),
    ).toEqual({ enabled: true });
  });

  it("disables every option while the account cannot execute", () => {
    const availability = gasOptionAvailability({
      symbol: "BLEND",
      executionReady: false,
      erc20Gas: true,
      paymaster: RESOLVED,
      gasTokenAddress: TOKEN_ADDRESS,
      balance: READY_BALANCE,
    });
    expect(availability.enabled).toBe(false);
    expect(availability.reason).toMatch(/smart account/i);
  });

  it("enables a token option once the paymaster answered and the balance is non-zero", () => {
    expect(
      gasOptionAvailability({
        symbol: "BLEND",
        executionReady: true,
        erc20Gas: true,
        paymaster: RESOLVED,
        gasTokenAddress: TOKEN_ADDRESS,
        balance: READY_BALANCE,
      }),
    ).toEqual({ enabled: true });
  });

  it("names the ERC-20 paymaster when it never answered", () => {
    const availability = gasOptionAvailability({
      symbol: "USDnr",
      executionReady: true,
      erc20Gas: true,
      paymaster: UNREACHABLE,
      gasTokenAddress: TOKEN_ADDRESS,
      balance: READY_BALANCE,
    });
    expect(availability.enabled).toBe(false);
    expect(availability.reason).toMatch(/ERC-20 paymaster/);
    expect(availability.reason).toContain("fetch failed");
  });

  it("waits rather than refusing while the paymaster is still being resolved", () => {
    const availability = gasOptionAvailability({
      symbol: "BLEND",
      executionReady: true,
      erc20Gas: true,
      paymaster: RESOLVING,
      gasTokenAddress: TOKEN_ADDRESS,
      balance: READY_BALANCE,
    });
    expect(availability.enabled).toBe(false);
    expect(availability.reason).toMatch(/asking/i);
  });

  /**
   * The send would otherwise settle as native gas with no warning: the widget drops the
   * approval and the paymaster when it cannot resolve the symbol's address.
   */
  it("refuses a token with no address on this network, which would settle as native gas", () => {
    const availability = gasOptionAvailability({
      symbol: "USDnr",
      executionReady: true,
      erc20Gas: true,
      paymaster: RESOLVED,
      gasTokenAddress: undefined,
      balance: READY_BALANCE,
    });
    expect(availability.enabled).toBe(false);
    expect(availability.reason).toContain("USDnr");
    expect(availability.reason).toMatch(/no token address/i);
  });

  it("states the precondition when the account holds none of the token", () => {
    const availability = gasOptionAvailability({
      symbol: "BLEND",
      executionReady: true,
      erc20Gas: true,
      paymaster: RESOLVED,
      gasTokenAddress: TOKEN_ADDRESS,
      balance: EMPTY_BALANCE,
    });
    expect(availability.enabled).toBe(false);
    expect(availability.reason).toContain("BLEND");
    expect(availability.reason).toMatch(/faucet/i);
  });

  it("refuses token gas on an external wallet, which has no paymaster to route through", () => {
    const availability = gasOptionAvailability({
      symbol: "BLEND",
      executionReady: true,
      erc20Gas: false,
      paymaster: RESOLVED,
      gasTokenAddress: TOKEN_ADDRESS,
      balance: READY_BALANCE,
    });
    expect(availability.enabled).toBe(false);
    expect(availability.reason).toMatch(/smart account/i);
  });

  it("does not claim an empty balance while the balance is still unread", () => {
    const availability = gasOptionAvailability({
      symbol: "BLEND",
      executionReady: true,
      erc20Gas: true,
      paymaster: RESOLVED,
      gasTokenAddress: TOKEN_ADDRESS,
      balance: undefined,
    });
    expect(availability.enabled).toBe(false);
    expect(availability.reason).toMatch(/balance/i);
    expect(availability.reason).not.toMatch(/faucet/i);
  });

  it("says so when the balance could not be read, rather than reading it as empty", () => {
    const availability = gasOptionAvailability({
      symbol: "BLEND",
      executionReady: true,
      erc20Gas: true,
      paymaster: RESOLVED,
      gasTokenAddress: TOKEN_ADDRESS,
      balance: { status: "error", raw: null },
    });
    expect(availability.enabled).toBe(false);
    expect(availability.reason).toMatch(/could not be read/i);
  });
});

describe("describeApproval", () => {
  it("names the spender and the cap as a call the visitor will sign", () => {
    const described = describeApproval({
      symbol: "BLEND",
      tokenAddress: TOKEN_ADDRESS,
      spender: RESOLVED.address,
      approveAmount: 100n * 10n ** 18n,
      decimals: 18,
    });
    expect(described?.call).toContain("approve");
    expect(described?.call).toContain("100");
    expect(described?.call).toContain(RESOLVED.address as string);
    expect(described?.reason).toMatch(/paymaster/i);
  });

  it("describes nothing for a sponsored send, which prepends no approval", () => {
    expect(
      describeApproval({
        symbol: "ETH",
        tokenAddress: undefined,
        spender: RESOLVED.address,
        approveAmount: 0n,
        decimals: 18,
      }),
    ).toBeNull();
  });

  it("describes nothing until the spender is known, rather than naming a placeholder", () => {
    expect(
      describeApproval({
        symbol: "BLEND",
        tokenAddress: TOKEN_ADDRESS,
        spender: undefined,
        approveAmount: 100n * 10n ** 18n,
        decimals: 18,
      }),
    ).toBeNull();
  });
});

describe("describeGasPayer", () => {
  it("names the kernel, not the signing wallet, for a token-paid send", () => {
    const text = describeGasPayer({ option: "BLEND", accountType: "smart" });

    expect(text).toContain("smart account pays in BLEND");
    expect(text).toContain("only signs");
  });

  it("says self pays from the kernel and never contacts the paymaster", () => {
    const text = describeGasPayer({ option: "self", accountType: "smart" });

    expect(text).toContain("its own ETH");
    expect(text).toContain("not contacted");
  });

  it("keeps the sponsored answer conditional, because the fallback is silent", () => {
    const text = describeGasPayer({ option: "sponsored", accountType: "smart" });

    expect(text).toContain("partner's budget");
    expect(text).toContain("falls back to its own ETH");
  });

  it("sends an external wallet to its own ETH whatever token is selected", () => {
    for (const option of ["sponsored", "self", "BLEND", "USDnr"] as const) {
      expect(describeGasPayer({ option, accountType: "eoa" })).toContain("external wallet");
    }
  });
});

describe("dryRunAvailability", () => {
  it("only applies to the sponsored way of paying", () => {
    expect(dryRunAvailability("sponsored")).toEqual({ enabled: true });
  });

  it("names the selection that switched it off, and how to get it back", () => {
    for (const option of ["self", "BLEND", "USDnr"] as const) {
      const verdict = dryRunAvailability(option);

      expect(verdict.enabled).toBe(false);
      expect(verdict.reason).toContain("switch to sponsored");
    }
  });

  it("says a self-paid send never asks the budget, rather than blaming a paymaster", () => {
    expect(dryRunAvailability("self").reason).toContain("never asks it");
    expect(dryRunAvailability("BLEND").reason).toContain("ERC-20 paymaster");
  });
});
