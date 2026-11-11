/**
 * @vitest-environment jsdom
 *
 * How many decimals a Tokens row shows: six by default, two for USDnr, the rest cut rather
 * than rounded, and the exact amount only in the tooltip.
 */
import type { FluentDisplayToken, FluentTokenBalance } from "@fluent.xyz/connect-sdk";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WalletMenuTokenList } from "./WalletMenuTokenList";

const ACCOUNT = "0x00000000000000000000000000000000000000ab" as const;

const ETH: FluentDisplayToken = {
  chainId: 25363,
  symbol: "ETH",
  name: "Ether",
  decimals: 18,
  native: true,
  gasPriority: 3,
  source: "default",
  identity: "25363:native",
};

// Fluent's mainnet USDnr: a dollar each, so shown in cents.
const USDNR: FluentDisplayToken = {
  chainId: 25363,
  symbol: "USDnr",
  name: "USDnr",
  decimals: 6,
  address: "0xD48e565561416dE59DA1050ED70b8d75e8eF28f9",
  gasPriority: 2,
  source: "default",
  identity: "25363:0xd48e565561416de59da1050ed70b8d75e8ef28f9",
};

function ready(token: FluentDisplayToken, raw: bigint, formatted: string): FluentTokenBalance {
  const { source: _source, identity: _identity, ...definition } = token;
  return { ...definition, raw, formatted, status: "ready" };
}

function renderList(tokens: FluentDisplayToken[], balances: FluentTokenBalance[]) {
  render(
    <WalletMenuTokenList
      accountAddress={ACCOUNT}
      balances={balances}
      busy={false}
      tokens={tokens}
      selectedSymbol="ETH"
    />,
  );
}

afterEach(cleanup);

describe("WalletMenuTokenList balance precision", () => {
  it("shows six decimals of an ETH balance and the exact amount on hover", () => {
    renderList([ETH], [ready(ETH, 412345678901234n, "0.000412345678901234")]);

    expect(screen.getByText("0.000412")).toBeTruthy();
    expect(screen.getByLabelText("ETH balance: 0.000412345678901234")).toBeTruthy();
  });

  it("shows USDnr in cents, cut rather than rounded", () => {
    renderList([USDNR], [ready(USDNR, 447937n, "0.447937")]);

    expect(screen.getByText("0.44")).toBeTruthy();
  });
});
