/**
 * @vitest-environment jsdom
 *
 * `useFluentZeroDevAccount` around the widget's chain and Privy's wallets:
 * when a chain change drops the built smart account, which chain a new kernel is built on, and
 * when its `initialize` is rebuilt, read through the identity of `sendCalls`, which lists it.
 *
 * Fakes, from `test/fakes/fluentId.ts`:
 * - `@privy-io/react-auth@2.25.0`: a signed-in user with one Signer, or nobody;
 * - `@zerodev/sdk@5.5.10` `createKernelAccount` and `@zerodev/ecdsa-validator@5.4.9`
 *   `signerToEcdsaValidator`: the smart account and its validator;
 * - `fetch`: the widget chain's JSON-RPC.
 */
import { fluentMainnet, fluentTestnet } from "@fluent.xyz/connect-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SMART_ACCOUNT, boundary, resetBoundary, stubNetwork } from "../../test/fakes/fluentId";
import {
  FluentWidgetNetworkContext,
  type FluentWidgetNetworkContextValue,
} from "./widgetNetworkContext";
import { useFluentZeroDevAccount } from "./zerodevSession";

vi.mock("@privy-io/react-auth", async () =>
  (await import("../../test/fakes/fluentId")).privyModule(),
);
vi.mock("@zerodev/sdk", async (importOriginal) =>
  (await import("../../test/fakes/fluentId")).zerodevSdkModule(await importOriginal()),
);
vi.mock("@zerodev/ecdsa-validator", async (importOriginal) =>
  (await import("../../test/fakes/fluentId")).zerodevValidatorModule(await importOriginal()),
);

/** The network the widget's context hands the hook on the next render. */
let network: FluentWidgetNetworkContextValue;

function NetworkWrapper({ children }: { children: ReactNode }) {
  return createElement(
    StrictMode,
    null,
    createElement(FluentWidgetNetworkContext.Provider, { value: network }, children),
  );
}

async function renderAccount() {
  const rendered = renderHook(() => useFluentZeroDevAccount(), { wrapper: NetworkWrapper });
  await waitFor(() => expect(rendered.result.current.privyReady).toBe(true));
  return rendered;
}

beforeEach(() => {
  resetBoundary();
  stubNetwork();
  network = { network: "testnet", chain: fluentTestnet };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useFluentZeroDevAccount and the widget's chain", () => {
  it("keeps the built smart account through an unrelated render and a new chain object with the same id, and rebuilds initialize once for the new object", async () => {
    const { result, rerender } = await renderAccount();
    const kernel = await act(() => result.current.refresh());
    expect(kernel?.smartAccountAddress).toBe(SMART_ACCOUNT);
    expect(result.current.smartAccountReady).toBe(true);
    const sendCalls = result.current.sendCalls;

    rerender();
    expect(result.current.sendCalls).toBe(sendCalls);

    network = { network: "testnet", chain: { ...fluentTestnet, name: "Renamed testnet" } };
    rerender();
    expect(result.current.smartAccountReady).toBe(true);
    expect(result.current.smartAccountAddress).toBe(SMART_ACCOUNT);
    expect(result.current.kernel).toBe(kernel);
    const afterChain = result.current.sendCalls;
    expect(afterChain).not.toBe(sendCalls);

    rerender();
    expect(result.current.sendCalls).toBe(afterChain);
  });

  it("drops the built smart account once when the chain id changes", async () => {
    const { result, rerender } = await renderAccount();
    await act(() => result.current.refresh());
    const sendCalls = result.current.sendCalls;

    network = { network: "testnet", chain: fluentMainnet };
    rerender();
    expect(result.current.smartAccountReady).toBe(false);
    expect(result.current.smartAccountAddress).toBeUndefined();
    expect(result.current.kernel).toBeNull();
    expect(result.current.signerModesReady).toEqual([]);
    expect(result.current.sendCalls).not.toBe(sendCalls);

    const afterSwitch = result.current.sendCalls;
    rerender();
    expect(result.current.sendCalls).toBe(afterSwitch);
  });

  it("builds a kernel on the chain object of the latest render", async () => {
    const { result, rerender } = await renderAccount();
    const sendCalls = result.current.sendCalls;

    const renamed = { ...fluentTestnet, name: "Renamed testnet" };
    network = { network: "testnet", chain: renamed };
    rerender();
    expect(result.current.sendCalls).not.toBe(sendCalls);

    const kernel = await act(() => result.current.refresh());
    expect(kernel?.chain).toBe(renamed);
  });
});

describe("useFluentZeroDevAccount and Privy's wallets", () => {
  it("refuses to build without a Signer and builds once Privy reports one", async () => {
    resetBoundary({ signedIn: false });
    const { result, rerender } = await renderAccount();
    expect(result.current.embeddedWalletCount).toBe(0);

    await act(async () => {
      await expect(result.current.refresh()).rejects.toThrow();
    });
    const refusal = result.current.error;
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal?.message).toBe(
      "Fluent session is connected, but Privy embedded wallet is not authenticated on this page",
    );
    const sendCalls = result.current.sendCalls;

    rerender();
    expect(result.current.sendCalls).toBe(sendCalls);

    boundary.signedIn = true;
    rerender();
    expect(result.current.embeddedWalletCount).toBe(1);
    expect(result.current.sendCalls).not.toBe(sendCalls);

    const kernel = await act(() => result.current.refresh());
    expect(kernel?.smartAccountAddress).toBe(SMART_ACCOUNT);
    expect(result.current.smartAccountReady).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
