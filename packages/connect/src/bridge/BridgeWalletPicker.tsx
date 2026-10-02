import "@rainbow-me/rainbowkit/styles.css";

import {
  RainbowKitProvider,
  darkTheme,
  useConnectModal,
} from "@rainbow-me/rainbowkit";
import { type ReactNode, useEffect } from "react";

import type { FluentBridgeRoute } from "./route";

/**
 * The bridge page's wallet picker. It adds UI only — the wallet itself is the
 * app's, on the app's wagmi config, which carries Fluent and the chain deposits
 * are signed on.
 *
 * There is deliberately no second wagmi config here. An injected wallet is one
 * object per page and broadcasts `accountsChanged` to every listener, and
 * wagmi's injected connector self-connects on that event whenever its config is
 * idle (`@wagmi/core/connectors/injected.js`). A second config therefore
 * isolates nothing: connecting through it made the app's config claim the same
 * wallet a beat later, flashing its address into the account header and popping
 * AppKit's "unsupported network" modal on whatever chain the wallet was on.
 */
function EscapeGuard() {
  const { connectModalOpen } = useConnectModal();

  // RainbowKit's modal is not part of base-ui's layer stack, so an Escape
  // pressed inside it reached the account drawer too and tore the whole wallet
  // menu down behind the picker. Dismiss it with its close button or a click
  // outside instead.
  useEffect(() => {
    if (!connectModalOpen) return;

    const swallowEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.stopPropagation();
    };

    window.addEventListener("keydown", swallowEscape, true);
    return () => window.removeEventListener("keydown", swallowEscape, true);
  }, [connectModalOpen]);

  return null;
}

export function BridgeWalletPicker({
  route,
  children,
}: {
  route: FluentBridgeRoute;
  children: ReactNode;
}) {
  return (
    <RainbowKitProvider
      initialChain={route.source}
      theme={darkTheme({ accentColor: "#49EDED", accentColorForeground: "#05131f" })}
      modalSize="compact"
    >
      <EscapeGuard />
      {children}
    </RainbowKitProvider>
  );
}
