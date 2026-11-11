/**
 * @vitest-environment jsdom
 *
 * The bridge page's picker registers wallets of its own into the widget's wagmi config
 * (`bridgeWalletConnectors.ts`), and the login dialog's External wallet list is drawn from that
 * same config through `useReownWallet`. Each of them carries AppKit's `walletConnect` id, so
 * unfiltered the list would grow one "WalletConnect" per wallet; it keeps only the widget's own.
 *
 * Fakes:
 * - `fetch`, because AppKit prefetches its wallet API on boot and this test has no network;
 * - the user agent, an iPhone's, since the picker registers its wallets on a phone only.
 * The config, the registration and the hook run for real: wagmi 2.19 and `@reown/appkit` 1.8.20.
 */
import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConfig, useConnect } from "wagmi";

import {
  isBridgeWalletConnector,
  registerBridgeWalletConnectors,
} from "../bridge/bridgeWalletConnectors";
import { REOWN_PROJECT_ID, ReownProvider, getReownMetadata, useReownWallet } from "./reownAppKit";

/** The bridge page's registration, next to the list the login dialog draws from. */
function Choices() {
  const config = useConfig();
  const { connectors } = useConnect();
  const { choices } = useReownWallet();

  useEffect(() => {
    registerBridgeWalletConnectors(config, {
      projectId: REOWN_PROJECT_ID,
      metadata: getReownMetadata(),
    });
  }, [config]);

  return (
    <div>
      <div data-testid="registered">
        {connectors
          .filter(isBridgeWalletConnector)
          .map((connector) => connector.uid)
          .join(",")}
      </div>
      <div data-testid="appkit-walletconnect">
        {connectors
          .filter(
            (connector) => connector.id === "walletConnect" && !isBridgeWalletConnector(connector),
          )
          .map((connector) => connector.uid)
          .join(",")}
      </div>
      <ul>
        {(choices ?? []).map((choice) => (
          <li key={choice.id} data-testid="choice" data-connector={choice.id}>
            {choice.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

const uidsIn = (testId: string) =>
  (screen.getByTestId(testId).textContent ?? "").split(",").filter(Boolean);

/** Settled when AppKit's modal element exists and has applied the state it found. */
async function renderedModal() {
  await vi.waitFor(() => expect(document.querySelector("w3m-modal")).not.toBeNull(), {
    timeout: 20_000,
  });
  await (document.querySelector("w3m-modal") as unknown as { updateComplete: Promise<boolean> })
    .updateComplete;
}

const IPHONE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

describe("the External wallet choices beside the bridge page's wallets", () => {
  beforeEach(() => {
    vi.spyOn(Navigator.prototype, "userAgent", "get").mockReturnValue(IPHONE_USER_AGENT);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("leave the bridge page's wallets to its picker", async () => {
    render(
      <ReownProvider network="mainnet">
        <Choices />
      </ReownProvider>,
    );

    // The hooks see the picker's wallets in the config...
    await vi.waitFor(() => expect(uidsIn("registered")).toHaveLength(3), { timeout: 20_000 });
    await renderedModal();
    const registered = new Set(uidsIn("registered"));

    // ...and the choices leave every one of them out, whatever else they offer.
    const listed = screen.queryAllByTestId("choice");
    expect(listed.filter((choice) => choice.textContent === "WalletConnect").length).toBeLessThan(
      2,
    );
    for (const choice of listed) {
      expect(registered.has(choice.getAttribute("data-connector") ?? "")).toBe(false);
    }
  }, 40_000);
});
