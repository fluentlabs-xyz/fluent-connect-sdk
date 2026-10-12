import { AccountAvatar, FluentWidgetConnectButton, FluentWidgetNetworkProvider } from "@fluent.xyz/connect";
import { ActivityTokenTile } from "@fluent.xyz/connect/internal/bridge/ActivityTokenTile";
import { DetailRow, HashMenu } from "@fluent.xyz/connect/internal/bridge/BridgeActivityDetail";
import { AccountTag, HistoryRow } from "@fluent.xyz/connect/internal/bridge/BridgeHistory";
import { AddTokenForm } from "@fluent.xyz/connect/internal/components/AddTokenForm";
import {
  AMOUNT_INPUT_CLASS,
  AmountCard,
  getAmountFontStyle,
  SummaryRow,
} from "@fluent.xyz/connect/internal/components/AmountForm";
import { SendTokenForm } from "@fluent.xyz/connect/internal/components/SendTokenForm";
import { WalletMenuTokenList } from "@fluent.xyz/connect/internal/components/WalletMenuTokenList";
import { Button } from "@fluent.xyz/connect/internal/ui/button";

import { previewBridgeRows, previewFluentAccount } from "../../ActivityPreview";
import { BridgePreview } from "../../BridgePreview";
import { MOCK_X_AVATAR, SAMPLE_CUSTOM_LOGO } from "../../previewAvatars";
import { previewSendToken } from "../../previewScenarios";
import { Row, Section, Specimen, SpecimenGrid } from "../Specimen";
import { noop, previewNetwork } from "../fixtures/config";
import {
  balances,
  displayTokens,
  erroredBalances,
  existingSymbols,
  gasTokens,
  listedIdentities,
  usdPrices,
} from "../fixtures/tokens";

const ADDRESS_LABEL = "0x92b7...b8C7";

function AvatarTile({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-foreground/10 text-foreground">
      {children}
    </div>
  );
}

function ConnectButtonSpecimen() {
  return (
    <Specimen title="Connect button" note="The host-facing button in its three states, with each avatar source." status="tokens">
      <Row label="disconnected · pending">
        <FluentWidgetConnectButton connected={false} onClick={noop} />
        <FluentWidgetConnectButton connected={false} pending onClick={noop} />
      </Row>
      <Row label="connected · X avatar · custom logo">
        <FluentWidgetConnectButton connected addressLabel={ADDRESS_LABEL} onClick={noop} />
        <FluentWidgetConnectButton connected addressLabel={ADDRESS_LABEL} onClick={noop} userLogoUrl={MOCK_X_AVATAR} />
        <FluentWidgetConnectButton connected addressLabel={ADDRESS_LABEL} onClick={noop} defaultLogoUrl={SAMPLE_CUSTOM_LOGO} />
      </Row>
    </Specimen>
  );
}

function AvatarSpecimen() {
  return (
    <Specimen title="Account avatar" note="X picture, host logo, the Fluent mark as fallback, and a broken URL falling back." status="tokens">
      <Row label="in the drawer's tile">
        <AvatarTile><AccountAvatar userLogoUrl={MOCK_X_AVATAR} /></AvatarTile>
        <AvatarTile><AccountAvatar defaultLogoUrl={SAMPLE_CUSTOM_LOGO} /></AvatarTile>
        <AvatarTile><AccountAvatar /></AvatarTile>
        <AvatarTile><AccountAvatar userLogoUrl="https://widget-preview.invalid/missing.png" /></AvatarTile>
      </Row>
    </Specimen>
  );
}

function AmountSpecimen() {
  const value = "1,234.5678";
  return (
    <Specimen title="Amount card · Summary row" note="The Send and Bridge forms' figure card and fee lines." status="tokens">
      <AmountCard
        label="You send"
        footer={<span className="text-xs text-foreground/60">≈ $3,061.52 · Balance 1.2345 ETH</span>}
      >
        <div style={{ containerType: "inline-size" }}>
          <input
            readOnly
            aria-label="Amount"
            value={value}
            className={AMOUNT_INPUT_CLASS}
            style={getAmountFontStyle(value)}
          />
        </div>
      </AmountCard>
      <div className="flex flex-col gap-2">
        <SummaryRow label="Network fee" value="0.0004 ETH" secondary="$0.99" tooltip="Paid from your ETH balance." />
        <SummaryRow label="Fee token" value="BLEND" />
        <SummaryRow label="You receive" value="1,234.5678 ETH" secondary="$3,061.52" />
      </div>
    </Specimen>
  );
}

function BridgeRowsSpecimen() {
  return (
    <Specimen title="History row · Account tag" note="One row per status, tagged with its account. `hover:bg-neutral-800` and `text-green-400` are literals." status="mixed">
      <ul className="flex flex-col">
        {previewBridgeRows.map((row) => (
          <HistoryRow key={row.id} row={row} tag="External" onOpen={noop} />
        ))}
        <HistoryRow
          row={{ ...previewBridgeRows[0]!, id: "confirming", status: "confirming", direction: "l2_to_l1" }}
          onOpen={noop}
        />
      </ul>
      <Row label="tag alone">
        <AccountTag>Fluent</AccountTag>
        <AccountTag>External</AccountTag>
      </Row>
    </Specimen>
  );
}

function DetailSpecimen() {
  const row = previewBridgeRows[0]!;
  return (
    <Specimen title="Detail row · Hash menu" note="The transfer page's definition list; the hash opens a copy/explorer menu." status="tokens">
      <dl className="flex flex-col gap-3 rounded-2xl bg-neutral-900 p-4 text-sm">
        <DetailRow label="Status">Completed</DetailRow>
        <DetailRow label="Sent">
          <HashMenu hash={row.sentTxHash} url="https://testnet.fluentscan.xyz" onOpen={noop} />
        </DetailRow>
        <DetailRow label="Received">
          <HashMenu hash={row.receivedTxHash ?? row.sentTxHash} onOpen={noop} label="Receipt hash" />
        </DetailRow>
        <DetailRow label="To">{previewFluentAccount.slice(0, 6)}…{previewFluentAccount.slice(-4)}</DetailRow>
      </dl>
    </Specimen>
  );
}

function TokenTileSpecimen() {
  return (
    <Specimen title="Activity token tile" note="A token on a tile, badged with the chain it moved on. `ring-neutral-900` is a literal." status="mixed">
      <Row label="from Ethereum">
        {["ETH", "USDnr", "BLEND", "PRV", undefined].map((symbol) => (
          <ActivityTokenTile key={symbol ?? "none"} tokenSymbol={symbol} badge="l1_to_l2" />
        ))}
      </Row>
      <Row label="from Fluent">
        {["ETH", "USDnr", "BLEND", "PRV", undefined].map((symbol) => (
          <ActivityTokenTile key={symbol ?? "none"} tokenSymbol={symbol} badge="l2_to_l1" />
        ))}
      </Row>
    </Specimen>
  );
}

function TokenListSpecimen() {
  return (
    <>
      <Specimen title="Token list — ready" note="Defaults with the Gas badge, then a user token with its remove action. `bg-neutral-900` is a literal." status="mixed">
        <WalletMenuTokenList
          accountAddress={previewFluentAccount}
          balances={balances}
          busy={false}
          usdPrices={usdPrices}
          tokens={displayTokens}
          selectedSymbol="BLEND"
          onAddUserToken={async () => ({ status: "added" })}
          onRemoveUserToken={async () => {}}
        />
      </Specimen>
      <Specimen title="Token list — loading · error" note="Balances still on their way, then a read that failed, with a store error above it." status="mixed">
        <WalletMenuTokenList
          accountAddress={previewFluentAccount}
          balances={[]}
          busy
          tokens={displayTokens}
          selectedSymbol="BLEND"
        />
        <WalletMenuTokenList
          accountAddress={previewFluentAccount}
          balances={erroredBalances}
          busy={false}
          tokens={displayTokens}
          selectedSymbol="BLEND"
          error="Could not remove PRV: the service did not answer."
          onRemoveUserToken={async () => {}}
        />
      </Specimen>
    </>
  );
}

function FormsSpecimen() {
  return (
    <>
      <Specimen title="Add token form" note="Type an address and it is looked up on testnet RPC. `bg-black/30` and `bg-white/5` are literals." status="legacy">
        <FluentWidgetNetworkProvider network={previewNetwork}>
          <AddTokenForm
            existingSymbols={existingSymbols}
            listedIdentities={listedIdentities}
            onAdd={async () => ({ status: "added" })}
            onClose={noop}
          />
        </FluentWidgetNetworkProvider>
      </Specimen>
      <Specimen title="Send form" note="Every validation runs; sending refuses, as this page cannot sign." status="tokens">
        <FluentWidgetNetworkProvider network={previewNetwork}>
          <SendTokenForm
            tokens={displayTokens}
            balances={balances}
            balancesBusy={false}
            accountAddress={previewFluentAccount}
            usdPrices={usdPrices}
            gasTokens={gasTokens}
            defaultGasSymbol="BLEND"
            onSend={previewSendToken}
            onSent={noop}
          />
        </FluentWidgetNetworkProvider>
      </Specimen>
    </>
  );
}

export function CompositesSection() {
  return (
    <Section
      id="composites"
      title="Composite elements"
      note="Widget-specific pieces built from the primitives: the connect button, avatars, forms, rows and tiles the screens are assembled from."
    >
      <SpecimenGrid>
        <ConnectButtonSpecimen />
        <AvatarSpecimen />
        <AmountSpecimen />
        <Specimen title="Approval steps" note="The bridge's two-step stepper. `bg-[#ff8fda]` is a literal." status="legacy" padded={false}>
          <div className="p-4">
            <BridgePreview />
          </div>
        </Specimen>
        <BridgeRowsSpecimen />
        <DetailSpecimen />
        <TokenTileSpecimen />
        <TokenListSpecimen />
        <FormsSpecimen />
        <Specimen title="Button group" note="The cancel / confirm pair the review dialog ends with." status="tokens">
          <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2.5">
            <Button variant="secondary">Cancel</Button>
            <Button>Confirm and sign</Button>
          </div>
        </Specimen>
      </SpecimenGrid>
    </Section>
  );
}
