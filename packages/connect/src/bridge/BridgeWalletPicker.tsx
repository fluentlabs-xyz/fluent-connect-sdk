// No stylesheet import here: a CSS specifier in `dist/index.js` breaks plain
// Node and Jest consumers of the package entry. RainbowKit's styles
// ship inside `@fluent.xyz/connect/styles.css` via `src/styles/globals.css`.
import {
  RainbowKitProvider,
  darkTheme,
  useConnectModal,
} from "@rainbow-me/rainbowkit";
import { type ReactNode, useEffect } from "react";
import { useConfig } from "wagmi";

import { REOWN_PROJECT_ID, getReownMetadata } from "../widget/reownAppKit";
import { registerBridgeWalletConnectors } from "./bridgeWalletConnectors";
import type { FluentBridgeRoute } from "./route";

/** Adds the picker's phone connectors to the widget's wagmi config when the picker mounts. */
function BridgeWalletConnectors() {
  const config = useConfig();

  useEffect(() => {
    registerBridgeWalletConnectors(config, {
      projectId: REOWN_PROJECT_ID,
      metadata: getReownMetadata(),
    });
  }, [config]);

  return null;
}

function EscapeGuard() {
  const { connectModalOpen } = useConnectModal();

  // RainbowKit's modal is outside base-ui's layer stack, so an Escape pressed in it would also
  // close the account drawer behind the picker; the modal closes by its button or a click
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

/**
 * The Bridge page's wallet picker. It adds UI only: the wallet itself is the widget's, on the
 * widget's wagmi config, which carries Fluent and the chain Deposits are signed on.
 *
 * There is deliberately no second wagmi config here. An injected wallet is one object per page
 * and broadcasts `accountsChanged` to every listener, and wagmi's injected connector
 * self-connects on that event whenever its config is idle
 * (`@wagmi/core/connectors/injected.js`). A second config would isolate nothing: connecting
 * through it makes the widget's config claim the same wallet a moment later, which shows its
 * address in the account header and opens AppKit's "unsupported network" modal on whatever
 * chain the wallet is on.
 *
 * What the picker lists depends on the device. On a desktop RainbowKit shows the extensions
 * EIP-6963 announces, under "Installed". On a phone it shows only wallets of its own making,
 * reached by deep link, so the picker adds three to the widget's config when it mounts
 * (`bridgeWalletConnectors.ts`).
 */
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
      <BridgeWalletConnectors />
      <EscapeGuard />
      {children}
    </RainbowKitProvider>
  );
}
