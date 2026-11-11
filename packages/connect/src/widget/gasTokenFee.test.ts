/**
 * @vitest-environment jsdom
 *
 * The Send retry the failure toast of a Gas token refusal offers belongs to the account
 * the Send left: a toast shown for one account cannot reopen its transfer for another, and a
 * change of account drops a held retry (`docs/standards/widget-runtime.md` R1, R2).
 *
 * Fakes: none; `open` is a spy standing for opening the Send page.
 */
import { fluentTokenIdentity, type FluentDisplayToken } from "@fluent.xyz/connect-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFluentSendRetry } from "./gasTokenFee";
import type { FluentTokenTransferRequest } from "./tokenTransfer";

const ACCOUNT_A = "0x092AE7564C6611a114C20C6df766B5B35A52334A";
const ACCOUNT_B = "0x1ccF23916C572379630b067e9a0CbBddb56C5e72";

const ethDefinition = {
  chainId: 20994,
  symbol: "ETH",
  name: "Ether",
  decimals: 18,
  native: true as const,
};
const ETH: FluentDisplayToken = {
  ...ethDefinition,
  source: "default",
  identity: fluentTokenIdentity(ethDefinition),
};
const REQUEST: FluentTokenTransferRequest = {
  token: ETH,
  to: "0x3333333333333333333333333333333333333333",
  amount: 10n ** 17n,
  gasSymbol: "USDnr",
};

function mount(account: string) {
  const open = vi.fn();
  const hook = renderHook(({ subject }) => useFluentSendRetry(subject, open), {
    initialProps: { subject: account },
  });
  return { open, hook };
}

afterEach(() => {
  cleanup();
});

describe("useFluentSendRetry", () => {
  it("holds the request and opens the Send page for the account that sent", () => {
    const { open, hook } = mount(ACCOUNT_A);

    act(() => hook.result.current.payFeeInNative(REQUEST));

    expect(hook.result.current.sendRetry?.request).toBe(REQUEST);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("ignores a toast offered for another account than the current one", () => {
    const { open, hook } = mount(ACCOUNT_A);
    const offeredForA = hook.result.current.payFeeInNative;

    hook.rerender({ subject: ACCOUNT_B });
    act(() => offeredForA(REQUEST));

    expect(hook.result.current.sendRetry).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it("drops a held retry when the account changes", () => {
    const { hook } = mount(ACCOUNT_A);
    act(() => hook.result.current.payFeeInNative(REQUEST));

    hook.rerender({ subject: ACCOUNT_B });

    expect(hook.result.current.sendRetry).toBeNull();
  });
});
