import type { FluentWidgetConfig } from "@fluent.xyz/connect";
import { WalletMenuActionCard } from "@fluent.xyz/connect/internal/WalletMenuActionCard";
import { useState } from "react";
import {
  PREVIEW_PUBLIC_API_URL,
  previewScenarios,
  type PreviewScenario,
} from "./previewScenarios";

const previewConfig: FluentWidgetConfig = {
  network: "testnet",
  appName: "Fluent Widget Preview",
  publicApiUrl: PREVIEW_PUBLIC_API_URL,
};

function noop() {}

function ScenarioCard({ scenario }: { scenario: PreviewScenario }) {
  const [tab, setTab] = useState("reputation");
  const [gasPaymentToken, setGasPaymentToken] = useState<"USDnr" | "BLEND" | "ETH">("BLEND");
  const [silentSigning, setSilentSigning] = useState(false);

  return (
    <section className="overflow-hidden rounded-xl border border-white/10 bg-neutral-950">
      <header className="flex flex-col gap-1.5 border-b border-white/10 px-5 py-4">
        <h2 className="text-sm font-medium">{scenario.title}</h2>
        <p className="text-xs leading-relaxed text-white/40">{scenario.note}</p>
      </header>

      {/* Same padding the widget's DrawerContent gives the wallet menu. */}
      <div className="bg-black p-4">
        <WalletMenuActionCard
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
      </div>
    </section>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-black text-white antialiased">
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
            card to reach Home and Settings, though those still read live on-chain balances.
          </p>
        </header>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(384px,100%),1fr))] items-start gap-5">
          {previewScenarios.map((scenario) => (
            <ScenarioCard key={scenario.id} scenario={scenario} />
          ))}
        </div>
      </main>
    </div>
  );
}
