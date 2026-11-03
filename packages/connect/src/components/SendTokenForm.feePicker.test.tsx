/**
 * @vitest-environment jsdom
 *
 * Send's "Fee paid in" picker: each gas token's row carries how much of it there is to pay
 * with, and a stablecoin's balance reads in cents where a volatile token's keeps six digits.
 */
import type { FluentDisplayToken, FluentTokenBalance } from "@fluent.xyz/connect-sdk";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

const USDNR: FluentDisplayToken = {
  chainId: 20994,
  symbol: "USDnr",
  name: "USDnr",
  decimals: 6,
  address: "0x279a6DC6354374473f6f3CFB3999e6C2e146f8a1",
  source: "default",
  identity: "20994:0x279a6dc6354374473f6f3cfb3999e6c2e146f8a1",
};

const balances: FluentTokenBalance[] = [
  { ...ETH, raw: 7_100_000_000_000_000n, formatted: "0.0071", status: "ready" },
  { ...USDNR, raw: 22_270_018n, formatted: "22.270018", status: "ready" },
];

function renderForm() {
  render(
    <SendTokenForm
      tokens={[ETH, USDNR]}
      balances={balances}
      balancesBusy={false}
      gasTokens={[USDNR, ETH]}
      defaultGasSymbol="USDnr"
      onSend={vi.fn()}
      onSent={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe("SendTokenForm fee picker", () => {
  it("shows a stablecoin's fee balance in cents and a volatile token's to six digits", () => {
    renderForm();

    fireEvent.click(screen.getByRole("combobox", { name: "Token the fee is paid in" }));

    const list = within(screen.getByRole("listbox"));
    expect(list.getByRole("option", { name: /USDnr/ }).textContent).toContain("22.27");
    expect(list.getByRole("option", { name: /USDnr/ }).textContent).not.toContain("22.270018");
    expect(list.getByRole("option", { name: /ETH/ }).textContent).toContain("0.0071");
  });
});
