import {
  fluentTokenIdentity,
  type FluentDisplayToken,
  type FluentTokenBalance,
} from "@fluent.xyz/connect-sdk";
import { useMemo, useState } from "react";
import { formatUnits } from "viem";

import {
  parseFluentTransferAmount,
  parseFluentTransferRecipient,
  type FluentTokenTransferSender,
} from "../widget/tokenTransfer";
import { useFluentWidgetNetwork } from "../widget/widgetNetworkContext";
import { formatFluentGasTokenBalance, formatFluentLocaleAmount } from "../utils";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/select";

const FIELD_LABEL = "text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground";
const FIELD_INPUT =
  "w-full rounded-lg bg-black/30 px-2.5 py-2 text-xs leading-5 ring-1 ring-foreground/10 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-foreground/30 disabled:opacity-50";

/**
 * Send one Display token out of the widget account.
 *
 * Both fields are checked as they are typed and the button stays down until
 * every check passes: `parseFluentTransfer*` owns the rules, and this only
 * decides when their verdicts are worth showing. An amount is never checked
 * against a balance that has not arrived — until it does, there is nothing to
 * compare against and the form says so instead of letting a send through.
 */
export function SendTokenForm({
  tokens,
  balances,
  balancesBusy,
  accountAddress,
  onSend,
  onClose,
}: {
  /** The display tokens the account holds, in list order. */
  tokens: readonly FluentDisplayToken[];
  balances: readonly FluentTokenBalance[];
  balancesBusy: boolean;
  /** The account the transfer leaves, so it cannot also be the destination. */
  accountAddress?: string;
  onSend: FluentTokenTransferSender;
  onClose: () => void;
}) {
  const { chain } = useFluentWidgetNetwork();
  const [identity, setIdentity] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Not seeded into state: the list arrives asynchronously, so a default picked
  // on the first render would be whatever happened to be there at the time.
  const token = tokens.find((candidate) => candidate.identity === identity) ?? tokens[0];

  const balance = useMemo(() => {
    if (!token) return undefined;
    return balances.find((entry) => fluentTokenIdentity(entry) === token.identity);
  }, [balances, token]);
  const rawBalance = balance?.status === "ready" ? balance.raw : null;

  // A token's own contract is a valid-looking address that swallows whatever is
  // sent to it, so every listed one is barred as a destination — not just the
  // one being sent.
  const contracts = useMemo(
    () =>
      new Set(
        tokens
          .map((candidate) => candidate.address?.toLowerCase())
          .filter((address): address is string => Boolean(address)),
      ),
    [tokens],
  );

  const recipientCheck = parseFluentTransferRecipient({
    input: recipient,
    self: accountAddress,
    contracts,
  });
  const amountCheck =
    token && rawBalance !== null
      ? parseFluentTransferAmount({
          input: amount,
          symbol: token.symbol,
          decimals: token.decimals,
          balance: rawBalance,
        })
      : null;

  const balanceLabel =
    balance?.status === "ready"
      ? formatFluentGasTokenBalance(balance, 0) ??
        (balance.formatted ? formatFluentLocaleAmount(balance.formatted, 0) : null)
      : null;
  const balanceNote =
    rawBalance !== null
      ? `Balance ${balanceLabel ?? "0"} ${token?.symbol ?? ""}`
      : balancesBusy
        ? "Checking your balance…"
        : `Your ${token?.symbol ?? "token"} balance could not be read.`;

  const ready =
    Boolean(token) && recipientCheck.status === "ok" && amountCheck?.status === "ok" && !sending;

  const handleSend = async () => {
    if (!token || recipientCheck.status !== "ok" || amountCheck?.status !== "ok") return;
    setSendError(null);
    setSending(true);
    try {
      const outcome = await onSend({
        token,
        to: recipientCheck.address,
        amount: amountCheck.raw,
      });
      // "rejected" leaves the form exactly as it was: the user dismissed the
      // review and the amount they typed is still the one they meant.
      if (outcome.status === "sent") onClose();
      if (outcome.status === "failed") setSendError(outcome.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-white/5 p-3" aria-label="Send tokens">
      <span className="text-xs text-muted-foreground">
        Send to any address on {chain.name}. Transfers cannot be undone — check the address
        before sending.
      </span>

      <div className="flex flex-col gap-1.5">
        <span className={FIELD_LABEL} id="fluent-send-token-label">
          Token
        </span>
        <Select
          value={token?.identity ?? null}
          disabled={sending || tokens.length === 0}
          onValueChange={(value) => {
            if (!value) return;
            setSendError(null);
            // The amount was typed against the old token's balance and decimals.
            setAmount("");
            setIdentity(value);
          }}
        >
          <SelectTrigger
            aria-labelledby="fluent-send-token-label"
            className="w-full rounded-lg border-0 bg-black/30 ring-1 ring-foreground/10"
          >
            {/* The symbol, not a `SelectValue`: the value here is the token
                identity, which is what `SelectValue` would print. */}
            <span className="flex flex-1 text-left">{token?.symbol ?? "No tokens"}</span>
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            {tokens.map((candidate) => (
              <SelectItem key={candidate.identity} value={candidate.identity}>
                {candidate.symbol}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[11px] leading-4 text-muted-foreground tabular-nums">
          {balanceNote}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={FIELD_LABEL}>Recipient</span>
        <input
          aria-label="Recipient address"
          className={`${FIELD_INPUT} font-mono`}
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
          autoFocus
          disabled={sending}
          value={recipient}
          onChange={(event) => {
            setSendError(null);
            setRecipient(event.target.value);
          }}
        />
        {recipientCheck.status === "rejected" ? (
          <p className="text-xs text-destructive">{recipientCheck.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={FIELD_LABEL}>Amount</span>
        <div className="flex items-center gap-2">
          <input
            aria-label={`Amount of ${token?.symbol ?? "tokens"} to send`}
            className={`${FIELD_INPUT} tabular-nums`}
            // `decimal` rather than `numeric`: the phone keypad it opens is the
            // only one with a decimal point on it.
            inputMode="decimal"
            placeholder="0.0"
            spellCheck={false}
            autoComplete="off"
            disabled={sending}
            value={amount}
            onChange={(event) => {
              setSendError(null);
              setAmount(event.target.value);
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0 rounded-full px-3"
            disabled={sending || rawBalance === null || rawBalance === 0n}
            onClick={() => {
              if (!token || rawBalance === null) return;
              setSendError(null);
              setAmount(formatUnits(rawBalance, token.decimals));
            }}
          >
            Max
          </Button>
        </div>
        {amountCheck?.status === "rejected" ? (
          <p className="text-xs text-destructive">{amountCheck.message}</p>
        ) : null}
      </div>

      {sendError ? <p className="text-xs text-destructive">{sendError}</p> : null}

      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full px-3"
          disabled={sending}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="rounded-full px-3"
          disabled={!ready}
          onClick={() => void handleSend()}
        >
          {sending ? "Sending…" : `Send ${token?.symbol ?? ""}`.trim()}
        </Button>
      </div>
    </div>
  );
}
