/**
 * @vitest-environment jsdom
 *
 * The balance beside Max on Send's amount card: cut to the digits the Tokens tab shows, the
 * exact amount on hover, while Max fills in the exact amount.
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
  it("cuts the balance to six decimals, exact on hover, and Max fills in the exact figure", () => {
    renderForm();

    const note = screen.getByText("0.000412 ETH");
    expect(note.getAttribute("title")).toBe("0.000412345678901234");

    fireEvent.click(screen.getByRole("button", { name: "Max" }));

    expect(screen.getByRole("textbox", { name: /amount/i }).getAttribute("value")).toBe(
      "0.000412345678901234",
    );
  });
});
