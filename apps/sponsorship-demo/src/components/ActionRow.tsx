import { zeroAddress } from "viem";

import { selectorOf, type BenchDecideResult } from "../bench/decide";
import { EXPLORER_BASE_URL, type BenchAction } from "../consts";
import { PayerBadge, payerSentence, type SendOutcome } from "./PayerBadge";

/** `decided_by` is a free string that usually embeds a 40-hex address; shorten it, keep the whole in `title`. */
function shortenHex(value: string) {
  return value.replace(/0x[0-9a-fA-F]{40}/g, (hex) => `${hex.slice(0, 8)}…${hex.slice(-4)}`);
}

function Verdict({ result }: { result: BenchDecideResult }) {
  if (result.status === "ok") {
    return (
      <span className={result.decision.proceed ? "verdict-yes" : "verdict-no"}>
        {result.decision.proceed ? "would sponsor" : `refused — ${result.decision.reason}`}
      </span>
    );
  }
  return (
    <span className="verdict-no" title={result.status === "failed" ? result.raw : undefined}>
      {result.message}
    </span>
  );
}

/**
 * One action, one row: the rule's promise, a Dry-run that asks the service, and a Send
 * whose badge reports who actually paid. The verdict always answers for the signed-in
 * account — preview accepts no other identity.
 */
export function ActionRow({
  action,
  account,
  verdict,
  onDryRun,
  dryRunning,
  canDryRun,
  outcome,
  onSend,
  sending,
  canSend,
}: {
  action: BenchAction;
  /** The address the calldata is encoded for; undefined while nobody is signed in. */
  account: `0x${string}` | undefined;
  verdict: BenchDecideResult | undefined;
  onDryRun: () => void;
  dryRunning: boolean;
  canDryRun: boolean;
  outcome: SendOutcome;
  onSend: () => void;
  sending: boolean;
  canSend: boolean;
}) {
  const data = action.data(account ?? zeroAddress);
  const call = `${action.method} · ${action.targetLabel} ${action.target} · ${selectorOf(data)}`;
  const decision = verdict?.status === "ok" ? verdict.decision : undefined;
  const verdictId = `verdict-${action.id}`;

  return (
    <li className="row">
      <div className="row-head">
        <h2 className="row-label">{action.label}</h2>

        <span className="row-verdict" id={verdictId}>
          {verdict ? <Verdict result={verdict} /> : null}
        </span>

        <button
          type="button"
          className="send-button dry-run-button"
          onClick={onDryRun}
          disabled={!canDryRun || dryRunning}
        >
          {dryRunning ? "Asking…" : "Dry-run"}
        </button>
        <button
          type="button"
          className="send-button"
          onClick={onSend}
          disabled={!canSend}
          aria-describedby={decision ? verdictId : undefined}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>

      {/* Directly under the verdict, because it is the reason for it. */}
      {decision?.decided_by ? (
        <p className="row-decided" title={decision.decided_by}>
          decided by {shortenHex(decision.decided_by)}
          {decision.detail ? ` — ${decision.detail}` : ""}
        </p>
      ) : null}

      {/* Truncates rather than wraps: an address split across two lines reads as two
          different addresses, and the whole string is in `title` either way. */}
      <p className="mono row-call" title={call}>
        {call}
      </p>

      {(outcome.payer || outcome.error) && (
        <div className="row-result">
          <PayerBadge outcome={outcome} />
          {payerSentence(outcome) ? (
            <span className="hint payer-sentence">{payerSentence(outcome)}</span>
          ) : null}
          {outcome.paymaster ? (
            <span className="mono muted paymaster-cell" title={outcome.paymaster}>
              paymaster {outcome.paymaster}
            </span>
          ) : null}
          {outcome.hash ? (
            <a href={`${EXPLORER_BASE_URL}/tx/${outcome.hash}`} target="_blank" rel="noreferrer">
              View transaction
            </a>
          ) : null}
          {outcome.error ? <span className="error-text">{outcome.error}</span> : null}
        </div>
      )}

      {/* The exact numbers survive only here; the prose above rounds. */}
      {verdict?.status === "ok" ? (
        <details className="raw">
          <summary>Raw verdict</summary>
          <pre>{verdict.raw}</pre>
        </details>
      ) : null}
    </li>
  );
}
