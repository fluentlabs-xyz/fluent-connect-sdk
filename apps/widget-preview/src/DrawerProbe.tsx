// Reached with `?drawer`: mounts the wallet menu card inside the account Drawer and the
// `Toaster`, as the live widget does, so overlays nested in the modal reproduce without a Privy
// login. Its button fires the "Copy address" toast, which must stay clickable above the drawer.
import type { FluentWidgetConfig } from "@fluent.xyz/connect";
import { FluentWidgetNetworkProvider } from "@fluent.xyz/connect/internal/widgetNetworkContext";
import { WalletMenuActionCard } from "@fluent.xyz/connect/internal/WalletMenuActionCard";
import { Drawer, DrawerContent } from "@fluent.xyz/connect/internal/drawer";
import { Toaster, toast } from "@fluent.xyz/connect/internal/ui/toast";
import { useState } from "react";

import { previewGasContext, previewScenarios, previewSendToken } from "./previewScenarios";

function noop() {}

export function DrawerProbe({ config }: { config: FluentWidgetConfig }) {
  const [tab, setTab] = useState("home");
  const [gasPaymentToken, setGasPaymentToken] = useState("BLEND");
  const [silentSigning, setSilentSigning] = useState(false);
  const scenario = previewScenarios[0]!;

  return (
    <Toaster>
      <Drawer open onOpenChange={noop} swipeDirection="right">
        <DrawerContent
          aria-label="Connected account"
          className="dark text-white antialiased sm:w-96"
        >
          <div className="overflow-y-auto p-4">
            <button
              type="button"
              data-testid="probe-fire-toast"
              className="mb-3 rounded-lg bg-white/10 px-3 py-1.5 text-xs"
              onClick={() =>
                toast.add({ type: "success", title: "Address copied", description: "0x83Fe…2D8E" })
              }
            >
              Fire "Address copied" toast
            </button>
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
                onSendToken={previewSendToken}
                gasContext={previewGasContext}
              />
            </FluentWidgetNetworkProvider>
          </div>
        </DrawerContent>
      </Drawer>
    </Toaster>
  );
}
