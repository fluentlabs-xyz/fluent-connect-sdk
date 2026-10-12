import { BatchOperationReviewModal } from "@fluent.xyz/connect/internal/components/BatchOperationReviewModal";
import { SignatureReviewModal } from "@fluent.xyz/connect/internal/components/SignatureReviewModal";
import { useState } from "react";

import { OverlayFrame } from "../OverlayFrame";
import { Section, Specimen, SpecimenGrid } from "../Specimen";
import { batchReview, messageReview, typedDataReview, untitledBatchReview } from "../fixtures/reviews";

/**
 * The transaction and signature reviews laid flat. `ReviewDialog` renders its
 * overlay in place when there is no top layer to portal into, so this section
 * is mounted outside `FluentPortalContainerProvider` and each overlay is held
 * by a transformed frame.
 */
export function ReviewsStaticSection() {
  const [last, setLast] = useState<string | null>(null);
  const handlers = (name: string) => ({
    onConfirm: () => setLast(`${name}: confirmed`),
    onCancel: () => setLast(`${name}: cancelled`),
  });

  return (
    <Section
      id="reviews"
      title="Review dialogs"
      note={
        <>
          What a transaction or signature request shows before signing. These are the clearest
          legacy screens: <code>ReviewDialog.tsx</code> builds its own overlay instead of the Dialog
          primitive, on <code>#030213</code> and <code>#49eded</code>.{" "}
          {last ? <span className="text-white/80">Last action: {last}.</span> : null}
        </>
      }
    >
      <SpecimenGrid>
        <Specimen title="Transaction review" note="Three calls, one carrying value, titled by the App." status="legacy" wide padded={false}>
          <OverlayFrame>
            <BatchOperationReviewModal operation={batchReview} {...handlers("Transaction")} />
          </OverlayFrame>
        </Specimen>
        <Specimen title="Transaction review — untitled, External wallet" note="The dialog's own title; the method name labels the call." status="legacy" wide padded={false}>
          <OverlayFrame className="h-[480px]">
            <BatchOperationReviewModal operation={untitledBatchReview} {...handlers("Transaction")} />
          </OverlayFrame>
        </Specimen>
        <Specimen title="Signature review — message" note="A SIWE-style message, signed by the Fluent ID." status="legacy" wide padded={false}>
          <OverlayFrame>
            <SignatureReviewModal review={messageReview} {...handlers("Message")} />
          </OverlayFrame>
        </Specimen>
        <Specimen title="Signature review — typed data" note="An EIP-712 permit: domain, primary type and message, signed by an External wallet." status="legacy" wide padded={false}>
          <OverlayFrame className="h-[760px]">
            <SignatureReviewModal review={typedDataReview} {...handlers("Typed data")} />
          </OverlayFrame>
        </Specimen>
      </SpecimenGrid>
    </Section>
  );
}
