import type { FluentWidgetConfig } from "@fluent.xyz/connect";
import {
  FluentWidgetNetworkProvider,
  resolveFluentWidgetNetworkFromEnv,
} from "@fluent.xyz/connect";
import { WalletMenuActionCard } from "@fluent.xyz/connect/internal/WalletMenuActionCard";
import { FluentPortalContainerProvider } from "@fluent.xyz/connect/internal/portalContainer";
import { useState } from "react";
import {
  previewScenarios,
  type PreviewScenario,
} from "./previewScenarios";
import { DrawerProbe } from "./DrawerProbe";

const previewConfig: FluentWidgetConfig = {
  // Auth demo dev partner, kept on purpose: this harness never signs in or sponsors,
  // the config only has to resolve.
  partnerId: "partner_8908941315934a06b738c6804ce26132",
  privyClientId: "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiDrgxAtC7ht1",
  network: resolveFluentWidgetNetworkFromEnv() ?? "testnet",
  appName: "Fluent Widget Preview",
};

function noop() {}

function ScenarioCard({ scenario }: { scenario: PreviewScenario }) {
  const [tab, setTab] = useState("reputation");
  const [gasPaymentToken, setGasPaymentToken] = useState("BLEND");
  const [silentSigning, setSilentSigning] = useState(true);

  return (
    <section className="overflow-hidden rounded-xl border border-white/10 bg-neutral-950">
      <header className="flex flex-col gap-1.5 border-b border-white/10 px-5 py-4">
        <h2 className="text-sm font-medium">{scenario.title}</h2>
        <p className="text-xs leading-relaxed text-white/40">{scenario.note}</p>
      </header>

      {/* Same padding the widget's DrawerContent gives the wallet menu. */}
      <div className="bg-black p-4">
        <FluentWidgetNetworkProvider network={previewConfig.network ?? "testnet"}>
          <WalletMenuActionCard
          /* Preview harness renders the card outside the widget — nothing to report to. */
          track={noop}
          session={scenario.session}
          smartAccountAddress={scenario.session?.wallet.smartAccountAddress}
          faucetBusy={false}
          onFaucet={noop}
          config={previewConfig}
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
    </section>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-black font-sans text-white antialiased">
      {/* Overlays (token selects) portal into a `.fluent-root` container, as in
          the real widget — without it they'd land on a bare, unstyled body. */}
      <FluentPortalContainerProvider>
        {new URLSearchParams(window.location.search).has("drawer") ? (
          <DrawerProbe config={previewConfig} />
        ) : null}
      <main className="mx-auto w-full max-w-[1280px] px-6 py-14">
        <header className="mb-10 flex max-w-[720px] flex-col gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.055em] text-white/40">
            Fluent Widget Preview
          </span>
          <h1 className="text-3xl font-medium tracking-tight">Wallet menu — Reputation states</h1>
          <p className="text-sm leading-relaxed text-white/50">
            Every card is the real <code className="rounded bg-white/10 px-1.5 py-0.5">WalletMenuActionCard</code>{" "}
            with a fabricated session. The families API is stubbed in the browser, so this page needs
            no Privy login, no smart account, and no Fluent Connect backend. Switch tabs inside any
            card to reach Home; Settings is opened from the account menu in the live widget.
          </p>
        </header>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(384px,100%),1fr))] items-start gap-5">
          {previewScenarios.map((scenario) => (
            <ScenarioCard key={scenario.id} scenario={scenario} />
          ))}
        </div>
      </main>
      </FluentPortalContainerProvider>
    </div>
  );
}
