/**
 * @vitest-environment jsdom
 *
 * The Bridge page's "Connect a wallet" button opens AppKit's wallet modal, the one the widget's
 * own External wallet connect uses: AppKit lists what it can reach from the device, a wallet app
 * behind a deep link on a phone included, where a picker of the page's own listed nothing.
 *
 * Fakes: `@reown/appkit/react` (its `useAppKit`), and `fetch` (the price and fee reads the form
 * starts). wagmi runs for real, on a config with no connector.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WagmiProvider, createConfig, http } from "wagmi";

import { getFluentChainForNetwork } from "../core/network";
import { BridgeForm } from "./BridgeForm";
import { getFluentBridgeRoute } from "./route";

const appKit = vi.hoisted(() => ({ open: vi.fn(async () => {}) }));

vi.mock("@reown/appkit/react", () => ({
  useAppKit: () => ({ open: appKit.open }),
}));

function renderForm() {
  const route = getFluentBridgeRoute("mainnet");
  if (!route) throw new Error("mainnet has no bridge route");
  const fluent = getFluentChainForNetwork("mainnet");
  const config = createConfig({
    chains: [fluent, route.source],
    transports: { [fluent.id]: http(), [route.source.id]: http() },
    connectors: [],
    multiInjectedProviderDiscovery: false,
  });
  render(
    <WagmiProvider config={config}>
      <QueryClientProvider client={new QueryClient()}>
        <BridgeForm route={route} network="mainnet" onOpenPortal={vi.fn()} />
      </QueryClientProvider>
    </WagmiProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  appKit.open.mockClear();
});

describe("BridgeForm connect", () => {
  it("opens AppKit's wallet modal from the Connect a wallet button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    renderForm();

    fireEvent.click(await screen.findByRole("button", { name: "Connect a wallet" }));

    expect(appKit.open).toHaveBeenCalledTimes(1);
  });
});
