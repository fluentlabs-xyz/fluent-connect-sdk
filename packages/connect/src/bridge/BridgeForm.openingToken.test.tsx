/**
 * @vitest-environment jsdom
 *
 * The token the Swap page opens on, reached the way a person reaches it: the widget signs in to a
 * Fluent ID on mount, the trigger opens the wallet menu, and its Swap button opens the page.
 * Where the network can bridge USDC the page opens on it, delivered as USDnr; where it cannot,
 * on ETH.
 *
 * Fakes, and nothing else (`test/fakes/fluentId.ts` says what each mirrors and how):
 * - `@privy-io/react-auth` 2.25.0: the signed-in user and its Signer, whose provider reports the
 *   chain its wallet's `switchChain` last moved it to, as Privy's embedded wallet does;
 * - `@zerodev/sdk` 5.5.10 `createKernelAccount` and `@zerodev/ecdsa-validator` 5.4.9
 *   `signerToEcdsaValidator`: the smart account at `SMART_ACCOUNT`;
 * - `@reown/appkit/react` 1.8.20 `createAppKit` and `useAppKit`, the External wallet modal;
 * - `fetch`, as `stubNetwork` answers it: the widget chain, the ZeroDev bundler, the sponsorship
 *   paymaster and fluent-connect-service; the page's own reads (the Ethereum RPC, prices, the
 *   Order deposit service) get its catch-all answers, which price nothing and quote nothing.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetBoundary, stubNetwork } from "../../test/fakes/fluentId";
import type { FluentWidgetConfig } from "../core/config";
import type { FluentWidgetNetwork } from "../core/network";
import { resetAuthTokenSessions } from "../widget/hooks/useAuthToken";

/** The chain the Signer's provider is on; Privy's `switchChain` moves it, as the real one does. */
const signerChain = vi.hoisted(() => ({ id: 20994 }));

// The shared Signer stays on the testnet chain whatever it is asked, and Direct login on mainnet
// switches it first, so this file's Signer follows `switchChain`.
vi.mock("@privy-io/react-auth", async () => {
  const fakes = await import("../../test/fakes/fluentId");
  const { numberToHex } = await import("viem");
  const provider = {
    request: async ({ method }: { method: string }) => {
      fakes.boundary.providerRequests.push(method);
      if (method === "eth_chainId") return numberToHex(signerChain.id);
      if (method === "personal_sign" || method === "eth_signTypedData_v4") {
        return fakes.PROVIDER_SIGNATURE;
      }
      throw new Error(`the Signer's provider has no method ${method}`);
    },
  };
  const signer = {
    address: fakes.SIGNER,
    walletClientType: "privy",
    connectorType: "embedded",
    getEthereumProvider: async () => provider,
    switchChain: async (chainId: number) => {
      signerChain.id = chainId;
    },
  };
  const signedIn = { ready: true, wallets: [signer] };
  const signedOut = { ready: true, wallets: [] };
  return {
    ...fakes.privyModule(),
    useWallets: () => (fakes.boundary.signedIn ? signedIn : signedOut),
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

const { FluentWidget } = await import("../widget/FluentWidget");

// The whole widget mounts and signs in per case, as the other end-to-end widget tests do.
vi.setConfig({ testTimeout: 30_000 });

const SIGN_IN = { timeout: 15_000 };

function configFor(network: FluentWidgetNetwork): FluentWidgetConfig {
  return {
    appId: "app_00000000000000000000000000000000",
    privyClientId: "client-test",
    network,
    reputationEnabled: false,
    disableAnalytics: true,
  };
}

/** Renders the widget, waits for its Fluent ID, and opens the Swap page from the wallet menu. */
async function openSwapPage(network: FluentWidgetNetwork) {
  render(<FluentWidget config={configFor(network)} />);
  fireEvent.click(await waitFor(() => screen.getByRole("button", { name: /0x092A/ }), SIGN_IN));
  fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "Swap" })));
}

/** The Send token, as the amount field and the token button both name it. */
async function expectSendToken(symbol: string) {
  expect(
    await waitFor(() => screen.getByRole("textbox", { name: `Amount to deposit in ${symbol}` })),
  ).toBeTruthy();
  const trigger = screen.getByRole("button", { name: "Token to deposit" });
  expect(within(trigger).getByText(symbol)).toBeTruthy();
}

/** The token the Receive card says arrives on Fluent. */
function expectReceiveToken(symbol: string) {
  const card = screen.getByText("Receive").parentElement;
  if (!card) throw new Error("the Receive card is missing");
  expect(within(card).getByText(symbol)).toBeTruthy();
}

/** Picks a Send token from the token list, as a person does. */
function pickSendToken(symbol: string) {
  fireEvent.click(screen.getByRole("button", { name: "Token to deposit" }));
  const list = screen.getByRole("listbox", { name: "Tokens" });
  const option = within(list)
    .getAllByRole("option")
    .find((candidate) => within(candidate).queryByText(symbol, { exact: true }));
  if (!option) throw new Error(`the token list has no ${symbol}`);
  fireEvent.click(option);
}

beforeEach(() => {
  signerChain.id = 20994;
  resetBoundary();
  resetAuthTokenSessions();
  window.localStorage.clear();
  window.sessionStorage.clear();
  stubNetwork();
  for (const method of ["log", "debug", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("FluentWidget: the token the Swap page opens on", () => {
  it("opens on USDC delivered as USDnr on mainnet, where USDC can be bridged", async () => {
    await openSwapPage("mainnet");

    await expectSendToken("USDC");
    expectReceiveToken("USDnr");
  });

  it("opens on ETH on testnet, where USDC is listed but cannot be bridged", async () => {
    await openSwapPage("testnet");

    await expectSendToken("ETH");
    expectReceiveToken("ETH");
  });

  it("switches from USDC to ETH and back, and the Receive card follows each pick", async () => {
    await openSwapPage("mainnet");
    await expectSendToken("USDC");

    pickSendToken("ETH");
    await expectSendToken("ETH");
    expectReceiveToken("ETH");

    pickSendToken("USDC");
    await expectSendToken("USDC");
    expectReceiveToken("USDnr");
  });
});
