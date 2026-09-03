// Reached with `?drawer`. The default preview renders the wallet menu card on
// its own, but the live widget always renders it inside the account Drawer —
// and overlays behave differently once nested in a modal. This mounts the card
// the way the widget really does, so drawer-only overlay bugs are reproducible
// without a Privy login.
import type { FluentWidgetConfig } from "@fluent.xyz/connect";
import { FluentWidgetNetworkProvider } from "@fluent.xyz/connect";
import { WalletMenuActionCard } from "@fluent.xyz/connect/internal/WalletMenuActionCard";
import { Drawer, DrawerContent } from "@fluent.xyz/connect/internal/drawer";
import { useState } from "react";

import { previewScenarios } from "./previewScenarios";

function noop() {}

export function DrawerProbe({ config }: { config: FluentWidgetConfig }) {
  const [tab, setTab] = useState("home");
  const [gasPaymentToken, setGasPaymentToken] = useState("BLEND");
  const [silentSigning, setSilentSigning] = useState(false);
  const scenario = previewScenarios[0]!;

  return (
    <Drawer open onOpenChange={noop} swipeDirection="right">
      <DrawerContent aria-label="Connected account" className="dark text-white antialiased sm:w-96">
        <div className="overflow-y-auto p-4">
          <FluentWidgetNetworkProvider network={config.network ?? "testnet"}>
            <WalletMenuActionCard
              track={noop}
              session={scenario.session}
              smartAccountAddress={scenario.session?.wallet.smartAccountAddress}
              faucetBusy={false}
              onFaucet={noop}
              config={config}
              gasPaymentToken={gasPaymentToken}
              onGasPaymentTokenChange={setGasPaymentToken}
              silentSigningEnabled={silentSigning}
              onSilentSigningChange={setSilentSigning}
              onDisconnect={noop}
              onConnectWithX={noop}
              tab={tab}
              onTabChange={setTab}
            />
          </FluentWidgetNetworkProvider>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
