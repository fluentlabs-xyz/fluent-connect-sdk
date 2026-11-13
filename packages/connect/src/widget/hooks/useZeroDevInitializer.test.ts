/**
 * @vitest-environment jsdom
 *
 * `useZeroDevInitializer` as it behaves today: when it calls the smart account's `refresh`, how
 * often, and when its "signer unavailable" warning runs, read through `console.warn` with debug
 * logging on. No fakes: the smart account is handed in as plain state and a `refresh` spy.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { setDebugLogging } from "../../core/debugLogger";
import type { FluentWidgetAccount } from "../batchOperation";
import { useZeroDevInitializer } from "./useZeroDevInitializer";

type Props = Parameters<typeof useZeroDevInitializer>[0];
type SmartAccount = Props["smartAccount"];

const WIDGET_ACCOUNT: FluentWidgetAccount = {
  connected: false,
  executionReady: false,
  capabilities: { atomicBatch: false, erc20Gas: false },
  executionStatus: "disconnected",
};

const SIGNER_UNAVAILABLE = "[fluent widget] ZeroDev init skipped: signer unavailable";

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  setDebugLogging(true);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  setDebugLogging(false);
  vi.restoreAllMocks();
});

function smartAccount(overrides: Partial<SmartAccount> = {}): SmartAccount {
  return {
    refresh: vi.fn(async () => null),
    smartAccountReady: false,
    privyReady: true,
    privyAuthenticated: false,
    embeddedWalletCount: 0,
    smartAccountAddress: undefined,
    ...overrides,
  };
}

function renderInitializer(account: SmartAccount) {
  return renderHook((props: Props) => useZeroDevInitializer(props), {
    initialProps: { smartAccount: account, session: null, widgetAccount: WIDGET_ACCOUNT },
    wrapper: StrictMode,
  });
}

/** The "signer unavailable" warnings so far, each with the state it reported. */
function signerUnavailableWarnings() {
  return warn.mock.calls.filter(([message]) => message === SIGNER_UNAVAILABLE).map(([, s]) => s);
}

describe("useZeroDevInitializer", () => {
  it("calls refresh once when the Signer becomes available and not on an unrelated render", () => {
    const refresh = vi.fn(async () => null);
    let account = smartAccount({ refresh });
    const { rerender } = renderInitializer(account);
    const props = (next: SmartAccount) => ({
      smartAccount: next,
      session: null,
      widgetAccount: WIDGET_ACCOUNT,
    });

    expect(refresh).not.toHaveBeenCalled();
    // StrictMode mounts the effect twice; each run warns.
    expect(signerUnavailableWarnings()).toHaveLength(2);

    account = { ...account, privyAuthenticated: true };
    rerender(props(account));
    expect(refresh).not.toHaveBeenCalled();
    expect(signerUnavailableWarnings()).toHaveLength(3);

    account = { ...account, embeddedWalletCount: 1 };
    rerender(props(account));
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender(props({ ...account }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("warns once more when only privyReady changes while the Signer is unavailable, and not on an unrelated render", () => {
    let account = smartAccount({ privyReady: false });
    const { rerender } = renderInitializer(account);
    const props = (next: SmartAccount) => ({
      smartAccount: next,
      session: null,
      widgetAccount: WIDGET_ACCOUNT,
    });
    expect(signerUnavailableWarnings()).toHaveLength(2);

    account = { ...account, privyReady: true };
    rerender(props(account));
    // The warning reports privyReady, so a new privyReady is a new reason to warn.
    expect(signerUnavailableWarnings()).toHaveLength(3);
    expect(signerUnavailableWarnings()[2]).toEqual({
      privyReady: true,
      privyAuthenticated: false,
      embeddedWalletCount: 0,
    });

    rerender(props({ ...account }));
    expect(signerUnavailableWarnings()).toHaveLength(3);

    account = { ...account, embeddedWalletCount: 1 };
    rerender(props(account));
    expect(signerUnavailableWarnings()).toHaveLength(4);
    expect(signerUnavailableWarnings()[3]).toEqual({
      privyReady: true,
      privyAuthenticated: false,
      embeddedWalletCount: 1,
    });
  });

  it("calls refresh once on mount when the Signer is already available, and not for a new refresh after it succeeded", async () => {
    const firstRefresh = vi.fn(async () => null);
    const account = smartAccount({
      refresh: firstRefresh,
      privyAuthenticated: true,
      embeddedWalletCount: 1,
    });
    const { rerender } = renderInitializer(account);
    // The in-flight guard is a ref, which survives StrictMode's second mount of the effect.
    expect(firstRefresh).toHaveBeenCalledTimes(1);
    await act(async () => {});

    const secondRefresh = vi.fn(async () => null);
    rerender({
      smartAccount: { ...account, refresh: secondRefresh },
      session: null,
      widgetAccount: WIDGET_ACCOUNT,
    });
    // Pins current behaviour: a successful refresh never clears the guard, so a later refresh is not called.
    expect(secondRefresh).not.toHaveBeenCalled();
  });

  it("calls refresh again on the next dependency change after a refresh fails", async () => {
    const failing = vi.fn(async () => {
      throw new Error("kernel failed");
    });
    const account = smartAccount({
      refresh: failing,
      privyAuthenticated: true,
      embeddedWalletCount: 1,
    });
    const { rerender } = renderInitializer(account);
    expect(failing).toHaveBeenCalledTimes(1);
    await act(async () => {});

    const retry = vi.fn(async () => null);
    rerender({
      smartAccount: { ...account, refresh: retry },
      session: null,
      widgetAccount: WIDGET_ACCOUNT,
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("does not call refresh while the smart account is ready, and calls it once resetInitialization runs and it is not", () => {
    const refresh = vi.fn(async () => null);
    const account = smartAccount({
      refresh,
      smartAccountReady: true,
      privyAuthenticated: true,
      embeddedWalletCount: 1,
    });
    const { result, rerender } = renderInitializer(account);
    const reset = result.current.resetInitialization;
    expect(refresh).not.toHaveBeenCalled();

    rerender({ smartAccount: { ...account }, session: null, widgetAccount: WIDGET_ACCOUNT });
    expect(result.current.resetInitialization).toBe(reset);

    act(() => result.current.resetInitialization());
    rerender({
      smartAccount: { ...account, smartAccountReady: false },
      session: null,
      widgetAccount: WIDGET_ACCOUNT,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
