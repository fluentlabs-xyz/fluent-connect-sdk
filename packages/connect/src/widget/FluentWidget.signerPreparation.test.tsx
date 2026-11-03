/**
 * @vitest-environment jsdom
 *
 * Privy 2.25.0 publishes authentication before a newly created Signer reaches `useWallets`.
 * These cases keep those steps separate, including an X return with no dialog resume marker.
 * The Privy, ZeroDev, AppKit and network fakes are the external boundaries documented in
 * `test/fakes/fluentId.ts`; all widget modules run for real.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PRIVY_USER,
  SIGNER,
  SMART_ACCOUNT,
  boundary,
  resetBoundary,
  stubNetwork,
} from "../../test/fakes/fluentId";
import type { FluentWidgetConfig } from "../core/config";
import { resetAuthTokenSessions } from "./hooks/useAuthToken";
import type { FluentWidgetRenderContext } from "./FluentWidget";

const fixture = vi.hoisted(() => ({
  user: { id: "", linkedAccounts: [] as Array<Record<string, string>> },
  walletsReady: false,
  walletLoaded: false,
  createWallet: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@privy-io/react-auth", async () => {
  const base = (await import("../../test/fakes/fluentId")).privyModule();
  return {
    ...base,
    usePrivy: () => {
      const current = (base.usePrivy as () => { authenticated: boolean })();
      return { ...current, user: current.authenticated ? fixture.user : null };
    },
    useWallets: () => ({
      ready: fixture.walletsReady,
      wallets: fixture.walletLoaded
        ? (base.useWallets as () => { wallets: unknown[] })().wallets
        : [],
    }),
    useCreateWallet: () => ({ createWallet: fixture.createWallet }),
  };
});
vi.mock("@zerodev/sdk", async (importOriginal) =>
  (await import("../../test/fakes/fluentId")).zerodevSdkModule(await importOriginal()),
);
vi.mock("@zerodev/ecdsa-validator", async (importOriginal) =>
  (await import("../../test/fakes/fluentId")).zerodevValidatorModule(await importOriginal()),
);
vi.mock("@reown/appkit/react", async () =>
  (await import("../../test/fakes/fluentId")).reownAppKitModule(),
);

const { FluentWidget } = await import("./FluentWidget");
const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  reputationEnabled: false,
  disableAnalytics: true,
};
const SIGNER_ACCOUNT = {
  type: "wallet",
  walletClientType: "privy",
  chainType: "ethereum",
  address: SIGNER,
};
let host: FluentWidgetRenderContext | undefined;

function element() {
  return <FluentWidget config={CONFIG} renderHome={(context) => {
    host = context;
    return null;
  }} />;
}

async function flush() {
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetBoundary();
  resetAuthTokenSessions();
  window.localStorage.clear();
  window.sessionStorage.clear();
  stubNetwork();
  fixture.user = {
    id: PRIVY_USER,
    linkedAccounts: [{ type: "twitter_oauth", subject: "x-user" }],
  };
  fixture.walletsReady = false;
  fixture.walletLoaded = false;
  fixture.createWallet.mockReset().mockResolvedValue(SIGNER_ACCOUNT);
  host = undefined;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("FluentWidget Signer preparation", () => {
  it("prepares a fresh X user's Signer without a dialog marker and connects after it loads",
    async () => {
      let finishCreation!: (account: typeof SIGNER_ACCOUNT) => void;
      fixture.createWallet.mockReturnValueOnce(new Promise((resolve) => {
        finishCreation = resolve;
      }));
      const view = render(element());
      await flush();
      expect(fixture.createWallet).not.toHaveBeenCalled();
      expect(host?.widget.account.connected).toBe(false);

      fixture.walletsReady = true;
      await act(async () => { view.rerender(element()); });
      expect(fixture.createWallet).toHaveBeenCalledTimes(1);
      await act(async () => { view.rerender(element()); });
      expect(fixture.createWallet).toHaveBeenCalledTimes(1);

      fixture.user = {
        ...fixture.user,
        linkedAccounts: [...fixture.user.linkedAccounts, SIGNER_ACCOUNT],
      };
      await act(async () => {
        finishCreation(SIGNER_ACCOUNT);
        view.rerender(element());
      });
      expect(host?.widget.account.connected).toBe(false);
      fixture.walletLoaded = true;
      await act(async () => { view.rerender(element()); });
      await flush();
      expect(host?.widget.account.address).toBe(SMART_ACCOUNT);
      expect(host?.widget.account.executionReady).toBe(true);
      expect(fixture.createWallet).toHaveBeenCalledTimes(1);
    });

  it("waits for an existing Signer instead of creating another after an X return", async () => {
    fixture.user.linkedAccounts.push(SIGNER_ACCOUNT);
    fixture.walletsReady = true;
    const view = render(element());
    await flush();
    expect(fixture.createWallet).not.toHaveBeenCalled();
    expect(host?.widget.account.connected).toBe(false);
    fixture.walletLoaded = true;
    await act(async () => { view.rerender(element()); });
    await flush();
    expect(host?.widget.account.executionReady).toBe(true);
    expect(fixture.createWallet).not.toHaveBeenCalled();
  });

  it("keeps a manual retry waiting for Signer readiness instead of failing Direct login",
    async () => {
      render(element());
      await flush();
      act(() => { host?.openConnect(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await flush();
      expect(screen.queryByText(/no embedded wallet is available/)).toBeNull();
      expect(fixture.createWallet).not.toHaveBeenCalled();
      expect(host?.widget.account.connected).toBe(false);
    });

  it("opens Connect on a preparation failure and retries without another X login",
    async () => {
      fixture.walletsReady = true;
      fixture.createWallet.mockRejectedValueOnce(new Error("Signer creation unavailable"));
      render(element());
      await flush();
      expect(screen.getByText("Signer creation unavailable")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await flush();
      expect(fixture.createWallet).toHaveBeenCalledTimes(2);
      expect(screen.queryByText(/no embedded wallet is available/)).toBeNull();
    });

  it("ignores an old preparation failure after logout and re-login to the same Fluent ID",
    async () => {
      let rejectOld!: (reason: Error) => void;
      let rejectCurrent!: (reason: Error) => void;
      fixture.walletsReady = true;
      fixture.createWallet
        .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectOld = reject; }))
        .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectCurrent = reject; }));
      const view = render(element());
      await flush();
      expect(fixture.createWallet).toHaveBeenCalledTimes(1);

      boundary.signedIn = false;
      await act(async () => { view.rerender(element()); });
      boundary.signedIn = true;
      await act(async () => { view.rerender(element()); });
      expect(fixture.createWallet).toHaveBeenCalledTimes(2);
      await act(async () => { rejectOld(new Error("Previous login failed")); });
      expect(screen.queryByText("Previous login failed")).toBeNull();
      await act(async () => { rejectCurrent(new Error("Current preparation failed")); });
      await flush();
      expect(screen.getByText("Current preparation failed")).toBeTruthy();
    });

  it("does not prepare a Fluent ID from an External wallet's restored authentication", async () => {
    fixture.walletsReady = true;
    fixture.user.linkedAccounts.push({ type: "wallet", chainType: "ethereum", address: SIGNER });
    render(element());
    await flush();
    expect(fixture.createWallet).not.toHaveBeenCalled();
    expect(host?.widget.account.connected).toBe(false);
  });
});
