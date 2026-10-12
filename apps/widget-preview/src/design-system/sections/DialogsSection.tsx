import { BatchOperationReviewModal } from "@fluent.xyz/connect/internal/components/BatchOperationReviewModal";
import {
  ConnectChoiceModal,
  HostedConnectChoiceBody,
} from "@fluent.xyz/connect/internal/components/ConnectChoiceModal";
import {
  ConnectDialog,
  ConnectDialogViewport,
} from "@fluent.xyz/connect/internal/components/ConnectDialog";
import { SignatureReviewModal } from "@fluent.xyz/connect/internal/components/SignatureReviewModal";
import { Button } from "@fluent.xyz/connect/internal/ui/button";
import { toast } from "@fluent.xyz/connect/internal/ui/toast";
import { DebugPanel } from "@fluent.xyz/connect/internal/widget/components/DebugPanel";
import { useRef } from "react";

import { previewScenarios } from "../../previewScenarios";
import { ConnectDialogCard } from "../ConnectDialogCard";
import { Row, Section, Specimen, SpecimenGrid } from "../Specimen";
import { noop } from "../fixtures/config";
import { choiceScreen, choiceWithWallets, connectScreens } from "../fixtures/connectScreens";
import { batchReview, messageReview, typedDataReview } from "../fixtures/reviews";
import { connectedWalletState, unconfiguredWalletState, walletState } from "../fixtures/wallet";

/** Which real overlay is open; the state lives on the page so the static review frames can sit outside the provider. */
export type LiveOverlay = "hosted" | "direct" | "batch" | "signature" | "typed-data";

const hostedProps = {
  track: noop,
  onExternalWalletSelected: noop,
  onClose: noop,
  onFluentLogin: noop,
  fluentAuthorizeUrl: "#",
  fluentReady: true,
  authMode: "hosted" as const,
};

export function DialogsSection({ onOpen }: { onOpen: (overlay: LiveOverlay) => void }) {
  const session = previewScenarios[0]!.session;
  return (
    <Section
      id="dialogs"
      title="Dialogs"
      note="The connect modals, the review dialogs and the debug panel. Static cards lay each state flat; the Open live buttons mount the real overlay in the widget's top layer."
    >
      <Specimen title="Open live" note="The real thing, portaled and modal. Close with Escape, the backdrop or a button." status="mixed" wide>
        <Row label="connect">
          <Button variant="secondary" onClick={() => onOpen("hosted")}>Hosted connect</Button>
          <Button variant="secondary" onClick={() => onOpen("direct")}>Direct login — choice</Button>
        </Row>
        <Row label="review">
          <Button variant="secondary" onClick={() => onOpen("batch")}>Transaction review</Button>
          <Button variant="secondary" onClick={() => onOpen("signature")}>Sign message</Button>
          <Button variant="secondary" onClick={() => onOpen("typed-data")}>Sign typed data</Button>
        </Row>
      </Specimen>

      <h3 className="text-base font-medium">Hosted connect</h3>
      <SpecimenGrid>
        <Specimen title="Connect Wallet" note="One button to the hosted login, a link to the wallet picker." status="legacy">
          <ConnectDialogCard>
            <HostedConnectChoiceBody {...hostedProps} wallet={walletState} />
          </ConnectDialogCard>
        </Specimen>
        <Specimen title="Connect Wallet — unavailable" note="No WalletConnect project and a hosted error to show." status="legacy">
          <ConnectDialogCard>
            <HostedConnectChoiceBody
              {...hostedProps}
              wallet={unconfiguredWalletState}
              hostedError="The hosted login window was closed."
            />
          </ConnectDialogCard>
        </Specimen>
      </SpecimenGrid>

      <h3 className="text-base font-medium">Direct login</h3>
      <SpecimenGrid>
        {connectScreens.map((screen) => (
          <Specimen key={screen.id} id={screen.id} title={screen.title} note={screen.note} status={screen.status}>
            <ConnectDialogCard>{screen.render()}</ConnectDialogCard>
          </Specimen>
        ))}
      </SpecimenGrid>

      <h3 className="text-base font-medium">Debug panel</h3>
      <SpecimenGrid>
        <Specimen title="Host app callback — connected" note="Developer-only: dumps the session and wallet state. All literal colours." status="legacy">
          <DebugPanel
            session={session}
            wallet={connectedWalletState}
            walletStatus="connected"
            hostedError={null}
          />
        </Specimen>
        <Specimen title="Host app callback — signed out, error" status="legacy">
          <DebugPanel
            session={null}
            wallet={null}
            walletStatus={null}
            hostedError="Popup blocked: allow popups for this site and try again."
          />
        </Specimen>
      </SpecimenGrid>
    </Section>
  );
}

/** The real modals, mounted inside the portal provider so they reach the top layer. */
export function LiveOverlays({
  live,
  onClose,
}: {
  live: LiveOverlay | null;
  onClose: () => void;
}) {
  const heading = useRef<HTMLDivElement>(null);
  const settle = (what: string) => {
    toast.add({ type: "info", title: what });
    onClose();
  };

  return (
    <>
      <ConnectChoiceModal
        {...hostedProps}
        open={live === "hosted"}
        onClose={onClose}
        wallet={walletState}
      />
      <ConnectDialog
        open={live === "direct"}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        initialFocus={heading}
        className="flex max-h-[calc(100dvh-2rem)] flex-col"
      >
        <ConnectDialogViewport>
          {choiceScreen({ headingRef: heading, children: choiceWithWallets() })}
        </ConnectDialogViewport>
      </ConnectDialog>
      <BatchOperationReviewModal
        operation={live === "batch" ? batchReview : null}
        onConfirm={() => settle("Transaction confirmed")}
        onCancel={() => settle("Transaction cancelled")}
      />
      <SignatureReviewModal
        review={live === "signature" ? messageReview : live === "typed-data" ? typedDataReview : null}
        onConfirm={() => settle("Signature confirmed")}
        onCancel={() => settle("Signature cancelled")}
      />
    </>
  );
}
