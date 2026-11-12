/**
 * @vitest-environment jsdom
 *
 * `useFluentZeroDevAccount`'s `initialize` and the wallets Privy lists: a signed-in user whose
 * list holds no Signer is refused with the count of the wallets listed now, and `initialize` is
 * rebuilt, read through the identity of `sendCalls`, once per change of that list's counts.
 *
 * Fakes, from `test/fakes/fluentId.ts`:
 * - `@privy-io/react-auth@2.25.0`: a signed-in user, with `useWallets()` answering the list this
 *   file sets, as Privy lists the user's linked wallets;
 * - `@zerodev/sdk@5.5.10` `createKernelAccount` and `@zerodev/ecdsa-validator@5.4.9`
 *   `signerToEcdsaValidator`: the smart account and its validator;
 * - `fetch`: the widget chain's JSON-RPC.
 */
import { fluentTestnet } from "@fluent.xyz/connect-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetBoundary, stubNetwork } from "../../test/fakes/fluentId";
import { FluentWidgetNetworkContext } from "./widgetNetworkContext";
import { useFluentZeroDevAccount } from "./zerodevSession";

/** The wallets `useWallets()` lists on the next render; one array per list, as Privy keeps it. */
const listed = vi.hoisted(() => ({ wallets: [] as unknown[] }));

vi.mock("@privy-io/react-auth", async () => {
  const privy = (await import("../../test/fakes/fluentId")).privyModule();
  return { ...privy, useWallets: () => ({ ready: true, wallets: listed.wallets }) };
});
vi.mock("@zerodev/sdk", async (importOriginal) =>
  (await import("../../test/fakes/fluentId")).zerodevSdkModule(await importOriginal()),
);
vi.mock("@zerodev/ecdsa-validator", async (importOriginal) =>
  (await import("../../test/fakes/fluentId")).zerodevValidatorModule(await importOriginal()),
);

const externalWallet = (address: string) => ({ address, walletClientType: "metamask" });

function NetworkWrapper({ children }: { children: ReactNode }) {
  return createElement(
    StrictMode,
    null,
    createElement(
      FluentWidgetNetworkContext.Provider,
      { value: { network: "testnet", chain: fluentTestnet } },
      children,
    ),
  );
}

async function refusal(refresh: () => Promise<unknown>): Promise<string> {
  let message = "";
  await act(async () => {
    await refresh().catch((error: unknown) => {
      message = error instanceof Error ? error.message : String(error);
    });
  });
  return message;
}

beforeEach(() => {
  resetBoundary();
  stubNetwork();
  listed.wallets = [externalWallet("0x1111111111111111111111111111111111111111")];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useFluentZeroDevAccount and the count of Privy's wallets", () => {
  it("refuses with the count listed now, rebuilding initialize once when the list grows and not on an unrelated render", async () => {
    const { result, rerender } = renderHook(() => useFluentZeroDevAccount(), {
      wrapper: NetworkWrapper,
    });
    await waitFor(() => expect(result.current.privyReady).toBe(true));
    expect(result.current.embeddedWalletCount).toBe(0);
    expect(await refusal(result.current.refresh)).toBe(
      "Privy is authenticated, but no embedded wallet is available (1 linked wallets found)",
    );
    const sendCalls = result.current.sendCalls;

    rerender();
    expect(result.current.sendCalls).toBe(sendCalls);

    listed.wallets = [
      ...listed.wallets,
      externalWallet("0x2222222222222222222222222222222222222222"),
    ];
    rerender();
    const afterGrowth = result.current.sendCalls;
    expect(afterGrowth).not.toBe(sendCalls);

    listed.wallets = [...listed.wallets];
    rerender();
    expect(result.current.sendCalls).toBe(afterGrowth);
    expect(await refusal(result.current.refresh)).toBe(
      "Privy is authenticated, but no embedded wallet is available (2 linked wallets found)",
    );
  });
});
