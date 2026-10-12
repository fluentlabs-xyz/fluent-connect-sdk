import { FluentWidgetConnectButton, FluentWidgetNetworkProvider } from "@fluent.xyz/connect";
import { BridgeScreen } from "@fluent.xyz/connect/internal/BridgeScreen";
import { FluentAccountDrawer } from "@fluent.xyz/connect/internal/FluentAccountDrawer";
import { ReownProvider } from "@fluent.xyz/connect/internal/reownAppKit";
import { WalletMenuActionCard } from "@fluent.xyz/connect/internal/WalletMenuActionCard";
import { useState } from "react";

import { ActivityPreview } from "../../ActivityPreview";
import { previewGasContext, previewScenarios, previewSendToken } from "../../previewScenarios";
import { Section, Specimen, SpecimenGrid, type SpecimenStatus } from "../Specimen";
import { noop, previewConfig, previewNetwork } from "../fixtures/config";

const scenario = previewScenarios.find((candidate) => candidate.id === "mixed")!;
const session = scenario.session!;
const address = session.wallet.smartAccountAddress;
const EXTERNAL = "0xdC9BF18a1c307ce1A84e2775C7645e57eB373CD4";

type CardVariant = {
  id: string;
  title: string;
  note: string;
  status: SpecimenStatus;
  tab: string;
  panel?: string;
  eoa?: boolean;
};

const CARDS: CardVariant[] = [
  { id: "home-tokens", title: "Home — tokens", note: "Balance, actions and the token list. Balances and prices are read live.", status: "mixed", tab: "home", panel: "tokens" },
  { id: "home-activity", title: "Home — activity", note: "The account's transactions from FluentScan, read live.", status: "mixed", tab: "home", panel: "activity" },
  { id: "reputation", title: "Reputation", note: "The families API is stubbed: mixed tiers.", status: "mixed", tab: "reputation" },
  { id: "settings", title: "Settings — Fluent ID", note: "Quick sign and the gas token.", status: "tokens", tab: "settings" },
  { id: "settings-eoa", title: "Settings — External wallet", note: "Only what applies to an EOA.", status: "tokens", tab: "settings", eoa: true },
  { id: "send", title: "Send", note: "The send sub-page inside the card.", status: "tokens", tab: "send" },
];

function CardSpecimen({ variant }: { variant: CardVariant }) {
  const [tab, setTab] = useState(variant.tab);
  const [panel, setPanel] = useState(variant.panel ?? "tokens");
  const [gasPaymentToken, setGasPaymentToken] = useState("BLEND");
  const [silentSigning, setSilentSigning] = useState(true);

  return (
    <Specimen title={variant.title} note={variant.note} status={variant.status}>
      <FluentWidgetNetworkProvider network={previewNetwork}>
        <WalletMenuActionCard
          track={noop}
          session={session}
          smartAccountAddress={address}
          externalWalletAddress={EXTERNAL}
          connectedAddress={variant.eoa ? EXTERNAL : address}
          accountKind={variant.eoa ? "eoa" : "smart"}
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
          panel={panel}
          onPanelChange={setPanel}
          onSendToken={previewSendToken}
          gasContext={variant.eoa ? { erc20Gas: false, sponsorshipAvailable: false } : previewGasContext}
        />
      </FluentWidgetNetworkProvider>
    </Specimen>
  );
}

/** The real account drawer, opened from its own connect button; `subPage` swaps the header. */
function DrawerSpecimen({ subPage }: { subPage: string | null }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(subPage === "Settings" ? "settings" : "home");
  const [gasPaymentToken, setGasPaymentToken] = useState("BLEND");
  const [silentSigning, setSilentSigning] = useState(true);
  const label = `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <Specimen
      title={subPage ? `Account drawer — ${subPage} header` : "Account drawer — account menu"}
      note={
        subPage
          ? "A sub-page replaces the account menu with Back and a title."
          : "The drawer shell: the account menu (FluentScan, copy, settings, disconnect) above the wallet menu."
      }
      status="tokens"
    >
      <FluentWidgetNetworkProvider network={previewNetwork}>
        <FluentAccountDrawer
          accountOpen={open}
          setAccountOpen={setOpen}
          hasConnectedAccount
          isMobile={false}
          accountMenuAddress={address}
          onAccountMenuAction={(value) => {
            if (value === "settings") setTab("settings");
            if (value === "disconnect") setOpen(false);
          }}
          subPageTitle={subPage ?? (tab === "settings" ? "Settings" : null)}
          onCloseSubPage={() => setTab("home")}
          connectButton={
            <FluentWidgetConnectButton
              connected
              addressLabel={label}
              onClick={() => setOpen((current) => !current)}
            />
          }
        >
          <WalletMenuActionCard
            track={noop}
            session={session}
            smartAccountAddress={address}
            faucetBusy={false}
            onFaucet={noop}
            config={previewConfig}
            gasPaymentToken={gasPaymentToken}
            onGasPaymentTokenChange={setGasPaymentToken}
            silentSigningEnabled={silentSigning}
            onSilentSigningChange={setSilentSigning}
            onDisconnect={() => setOpen(false)}
            onConnectWithX={noop}
            tab={tab}
            onTabChange={setTab}
            onSendToken={previewSendToken}
            gasContext={previewGasContext}
          />
        </FluentAccountDrawer>
      </FluentWidgetNetworkProvider>
    </Specimen>
  );
}

export function ScreensSection() {
  return (
    <Section
      id="screens"
      title="Screens"
      note="The wallet menu's pages, the activity pages and the bridge, each pinned to one state. Cards marked live read testnet RPC, the price feed or FluentScan and show their loading or error state offline."
    >
      <SpecimenGrid>
        {CARDS.map((variant) => (
          <CardSpecimen key={variant.id} variant={variant} />
        ))}
        <DrawerSpecimen subPage={null} />
        <DrawerSpecimen subPage="Settings" />
      </SpecimenGrid>
      <ActivityPreview />
      <SpecimenGrid>
        <Specimen title="Bridge" note="The bridge page with its RainbowKit wallet picker, live against Reown. The picker's accent `#49EDED` is a literal." status="mixed" wide>
          <FluentWidgetNetworkProvider network={previewNetwork}>
            <ReownProvider network={previewNetwork}>
              <div className="mx-auto w-full max-w-sm">
                <BridgeScreen config={previewConfig} recipient={address} track={noop} />
              </div>
            </ReownProvider>
          </FluentWidgetNetworkProvider>
        </Specimen>
      </SpecimenGrid>
    </Section>
  );
}
