import { useMemo, useState } from "react";
import { erc20Abi, isAddress, parseUnits, type Address } from "viem";

import { debugError } from "../core/debugLogger";
import { getFluentTokenDefaults, type FluentWidgetNetwork } from "../core/network";
import { useWidgetOptional } from "../widget/widgetContext";
import { Button } from "./ui/button";
import { toast } from "./ui/toast";

const INPUT_CLASS =
  "h-10 w-full rounded-xl bg-primary/10 px-3.5 text-sm outline-none transition-colors placeholder:text-white/30 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-3 aria-invalid:ring-destructive/40";

/** `parseUnits` throws on anything that isn't a decimal string — treat that as "not a number yet". */
function parseAmount(value: string, decimals: number): bigint | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = parseUnits(trimmed, decimals);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * One-off BLEND transfer out of the connected Fluent account. Goes through the
 * widget batch API, so the smart account executes it as a single UserOp with the
 * gas token selected in Settings, and an external EOA still works as a plain tx.
 */
export function WalletMenuSendToken({ network }: { network: FluentWidgetNetwork }) {
  // Optional: the preview harness mounts the wallet menu outside the widget.
  const widget = useWidgetOptional();
  const blend = useMemo(() => getFluentTokenDefaults(network).BLEND, [network]);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const trimmedRecipient = recipient.trim();
  const recipientValid = isAddress(trimmedRecipient);
  const parsedAmount = parseAmount(amount, blend.decimals);
  const canSend =
    !busy &&
    Boolean(widget?.account.connected) &&
    Boolean(blend.address) &&
    recipientValid &&
    parsedAmount !== null;

  const handleSend = async () => {
    if (!widget || !blend.address || !recipientValid || parsedAmount === null) return;

    setBusy(true);
    try {
      const operation = widget.createBatchOp({
        id: "send-blend",
        reviewTitle: "Send BLEND",
        calls: [
          {
            id: "transfer-blend",
            label: `Send ${amount.trim()} BLEND`,
            to: blend.address,
            abi: erc20Abi,
            method: "transfer",
            args: [trimmedRecipient as Address, parsedAmount],
          },
        ],
      });
      // Mainnet has no ERC-20 paymaster deployed yet, so this form always pays
      // gas in native ETH and ignores the gas token picked in Settings.
      // `symbol: "ETH"` resolves to no paymaster address → plain UserOp.
      const result = await operation.execute({ gasPayment: { symbol: "ETH" } });
      toast.add({
        type: "success",
        title: "BLEND sent",
        description: `Transaction ${result.hash}`,
      });
      setRecipient("");
      setAmount("");
    } catch (error) {
      debugError("[fluent widget] BLEND transfer failed", error);
      toast.add({
        type: "error",
        title: "Send failed",
        description: error instanceof Error ? error.message : "Could not send BLEND.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase opacity-50">Send BLEND</span>
      <input
        className={INPUT_CLASS}
        value={recipient}
        onChange={(event) => setRecipient(event.target.value)}
        placeholder="Recipient address (0x…)"
        spellCheck={false}
        autoComplete="off"
        aria-label="Recipient address"
        aria-invalid={trimmedRecipient.length > 0 && !recipientValid}
        disabled={busy}
      />
      <input
        className={INPUT_CLASS}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder="Amount"
        inputMode="decimal"
        aria-label="Amount of BLEND"
        aria-invalid={amount.trim().length > 0 && parsedAmount === null}
        disabled={busy}
      />
      <Button disabled={!canSend} onClick={handleSend}>
        {busy ? "Sending…" : "Send"}
      </Button>
      <span className="text-xs opacity-50">Gas is paid in ETH.</span>
      {!blend.address ? (
        <span className="text-xs opacity-50">BLEND is not configured for this network.</span>
      ) : null}
    </div>
  );
}
