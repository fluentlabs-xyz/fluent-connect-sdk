/**
 * @vitest-environment jsdom
 *
 * Send's token choice: the Bridge page's "Select token" view, opened from the pill on the
 * amount card. Rows are keyed by token identity, since a token the person added may share a
 * symbol with one of Fluent's own.
 */
import type { FluentDisplayToken } from "@fluent.xyz/connect-sdk";
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

// Calls itself BLEND, but is not Fluent's: it must not be drawn with BLEND's glyph.
const ADDED: FluentDisplayToken = {
  chainId: 20994,
  symbol: "BLEND",
  name: "Not Blend",
  decimals: 18,
  address: "0x00000000000000000000000000000000000000aa",
  logoURI: "https://example.test/not-blend.png",
  source: "user",
  identity: "20994:0x00000000000000000000000000000000000000aa",
};

function renderForm() {
  render(
    <SendTokenForm
      tokens={[ETH, ADDED]}
      balances={[]}
      balancesBusy={false}
      gasTokens={[]}
      defaultGasSymbol="ETH"
      onSend={vi.fn()}
      onSent={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe("SendTokenForm token picker", () => {
  it("opens the Select token view from the pill and lists every token", () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Token to send" }));

    const list = within(screen.getByRole("listbox", { name: "Tokens" }));
    expect(list.getByRole("option", { name: /ETH/ }).getAttribute("aria-selected")).toBe("true");
    expect(list.getByRole("option", { name: /BLEND/ })).toBeTruthy();
  });

  it("sends the picked token, drawn with its own logo rather than a glyph by its symbol", () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Token to send" }));
    fireEvent.click(screen.getByRole("option", { name: /BLEND/ }));

    expect(screen.queryByRole("dialog", { name: "Select token" })).toBeNull();
    const pill = screen.getByRole("button", { name: "Token to send" });
    expect(pill.textContent).toContain("BLEND");
    expect(pill.querySelector("img")?.getAttribute("src")).toBe(ADDED.logoURI);
  });

  it("leaves the token as it was when the view is left without a pick", () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Token to send" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("button", { name: "Token to send" }).textContent).toContain("ETH");
  });
});
