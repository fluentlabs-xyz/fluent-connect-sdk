import { zeroAddress } from "viem";

import { selectorOf, type BenchDecideResult } from "../bench/decide";
import { formatVerdict, shortenHex } from "../bench/format";
import { eventLabel, type RowEvent } from "../bench/rowEvent";
import { EXPLORER_BASE_URL, gasLabelFor, type BenchAction } from "../consts";
import { PayerBadge, payerSentence, type SendOutcome } from "./PayerBadge";

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

/** What a settled send turned out to be, in one line: the badge, then who paid and where. */
function SendLine({ outcome }: { outcome: SendOutcome }) {
  const sentence = payerSentence(outcome);
  return (
    <>
      <PayerBadge outcome={outcome} />
      {sentence ? <span className="hint">{sentence}</span> : null}
      {outcome.paymaster ? (
        <span className="mono muted paymaster-cell" title={outcome.paymaster}>
          paymaster {shortenHex(outcome.paymaster)}
        </span>
      ) : null}
      {outcome.hash ? (
        <a href={`${EXPLORER_BASE_URL}/tx/${outcome.hash}`} target="_blank" rel="noreferrer">
          View transaction
        </a>
      ) : null}
      {outcome.error ? <span className="error-text">{outcome.error}</span> : null}
      {!outcome.payer && !outcome.error ? <span className="hint">Sending…</span> : null}
    </>
  );
}

/**
 * One action: the rule it demonstrates, the two things you can do to it, and everything
 * that has happened to it so far.
 *
 * The log is the point. With one Send button and the gas token chosen above, a reader
 * comparing sponsored against token-paid has nowhere else to see both at once — so nothing
 * here ever replaces an earlier answer.
 */
export function ActionRow({
  action,
  account,
  events,
  onDryRun,
  dryRunning,
  canDryRun,
  dryRunReason,
  onSend,
  sending,
  canSend,
  sendLabel,
}: {
  action: BenchAction;
  /** The address the calldata is encoded for; undefined while nobody is signed in. */
  account: `0x${string}` | undefined;
  events: readonly RowEvent[];
  onDryRun: () => void;
  dryRunning: boolean;
  canDryRun: boolean;
  /** Why Dry-run is off, when it is off for a reason worth stating rather than "busy". */
  dryRunReason?: string;
  onSend: () => void;
  sending: boolean;
  canSend: boolean;
  /** States the consequence of pressing Send, since the gas token is chosen elsewhere. */
  sendLabel: string;
}) {
  const data = action.data(account ?? zeroAddress);
  const call = `${action.method} · ${action.targetLabel} ${action.target} · ${selectorOf(data)}`;

  return (
    <li className="row">
      <div className="row-head">
        <h2 className="row-label">{action.label}</h2>

        <button
          type="button"
          className="send-button dry-run-button"
          onClick={onDryRun}
          disabled={!canDryRun || dryRunning}
          title={dryRunReason}
        >
          {dryRunning ? "Asking…" : "Dry-run"}
        </button>
        <button type="button" className="send-button" onClick={onSend} disabled={!canSend}>
          {sending ? "Sending…" : sendLabel}
        </button>
      </div>

      {/* Truncates rather than wraps: an address split across two lines reads as two
          different addresses, and the whole string is in `title` either way. */}
      <p className="mono row-call" title={call}>
        {shortenHex(call)}
      </p>

      {events.length > 0 ? (
        <ol className="row-log">
          {events.map((event) => (
            <li className="row-log-entry" key={`${event.kind}-${event.at}`}>
              <span className="log-what">{eventLabel(event, gasLabelFor)}</span>
              <div className="log-answer">
                {event.kind === "dry-run" ? (
                  <>
                    <Verdict result={event.result} />
                    {event.result.status === "ok" && event.result.decision.decided_by ? (
                      <span className="hint" title={event.result.decision.decided_by}>
                        decided by {shortenHex(event.result.decision.decided_by)}
                        {event.result.decision.detail ? ` — ${event.result.decision.detail}` : ""}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <SendLine outcome={event.outcome} />
                )}
              </div>
              {/*
                * The exact answer survives only here; every line above rounds or names. Shown
                * for a refused response too, not just a decided one: the gate answers in plain
                * text ("origin not allowed", "partner disabled"), and that sentence is the
                * diagnosis — the one case where the body matters most is the one this block
                * used to hide.
                */}
              {event.kind === "dry-run" && event.result.status !== "absent" && event.result.raw ? (
                <details className="raw">
                  <summary>
                    {event.result.status === "ok" ? "Raw verdict" : "Raw response"}
                  </summary>
                  <pre>{formatVerdict(event.result.raw)}</pre>
                </details>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}
