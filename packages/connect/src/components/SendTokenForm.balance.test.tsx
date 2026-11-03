/**
 * @vitest-environment jsdom
 *
 * The balance beside Max on Send's amount card: the exact amount, every decimal the token has,
 * so it is the same figure Max fills in.
 */
import type { FluentDisplayToken, FluentTokenBalance } from "@fluent.xyz/connect-sdk";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SendTokenForm } from "./SendTokenForm";

const ETH: FluentDisplayToken = {
  chainId: 20994,
  symbol: "ETH",
  name: "Ether",
  decimals: 18,
  native: true,
  source: "default",
  identity: "20994:native",
};

const ETH_BALANCE: FluentTokenBalance = {
  chainId: 20994,
  symbol: "ETH",
  name: "Ether",
  decimals: 18,
  native: true,
  raw: 412345678901234n,
  formatted: "0.000412345678901234",
  status: "ready",
};

function renderForm() {
  render(
    <SendTokenForm
      tokens={[ETH]}
      balances={[ETH_BALANCE]}
      balancesBusy={false}
      gasTokens={[]}
      defaultGasSymbol="ETH"
      onSend={vi.fn()}
      onSent={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe("SendTokenForm balance", () => {
  it("shows every decimal of the balance, and Max fills in the same figure", () => {
    renderForm();

    expect(screen.getByText("0.000412345678901234 ETH")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Max" }));

    expect(screen.getByRole("textbox", { name: /amount/i }).getAttribute("value")).toBe(
      "0.000412345678901234",
    );
  });
});
