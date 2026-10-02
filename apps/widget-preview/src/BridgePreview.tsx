import { ApprovalSteps } from "@fluent.xyz/connect/internal/bridge/BridgeForm";
import { Button } from "@fluent.xyz/connect/internal/ui/button";

import { PreviewCard } from "./ActivityPreview";

/**
 * The two-step approval flow's stepper, in both states, with the button each
 * state shows beneath it. The live stepper needs a connected wallet holding an
 * ERC-20, so this is the only place to see it without one.
 */
export function BridgePreview() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(384px,100%),1fr))] items-start gap-5">
      <PreviewCard title="Step 1 — approving" note="The allowance is short; the approval is out with the wallet.">
        <ApprovalSteps currentStep={1} actionLabel="Deposit" busy />
        <Button className="w-full" disabled>
          Approving…
        </Button>
      </PreviewCard>

      <PreviewCard title="Step 2 — ready to deposit" note="The allowance covers the amount; the deposit is next.">
        <ApprovalSteps currentStep={2} actionLabel="Deposit" busy={false} />
        <Button className="w-full">Deposit to Fluent</Button>
      </PreviewCard>
    </div>
  );
}
