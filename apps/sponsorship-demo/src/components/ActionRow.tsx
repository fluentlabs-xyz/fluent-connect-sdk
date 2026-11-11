import { zeroAddress } from "viem";

import { selectorOf, type BenchDecideResult } from "../bench/decide";
import { formatVerdict, shortenHex } from "../bench/format";
import { eventLabel, type RowEvent } from "../bench/rowEvent";
import { timelineCaveat, timelineRows } from "../bench/timeline";
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
 * Where this send's milliseconds went, stage by stage, under the answer. Each stage's `title`
 * says what it is, and a stage the widget could not measure reads `—` rather than `0`.
 */
function SendTimeline({ timing }: { timing: SendOutcome["timing"] }) {
  const rows = timelineRows(timing);
  if (rows.length === 0) return null;
  const caveat = timelineCaveat(rows);
  return (
    <div className="log-answer">
      {rows.map((row) => (
        <span key={row.label} className="mono muted" title={row.note}>
          {row.label} {row.value ?? "—"}
        </span>
      ))}
      {caveat ? <span className="hint">{caveat}</span> : null}
    </div>
  );
}

/**
 * One action: the rule it demonstrates, its Dry-run and Send buttons, and its log. No answer
 * replaces an earlier one, because the log is the only place a sponsored send and a token-paid
 * one appear together.
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
              {event.kind === "send" ? <SendTimeline timing={event.outcome.timing} /> : null}
              {/*
                * The exact answer, which every line above rounds or names. Shown for a refused
                * response too: the gate's plain text ("origin not allowed") is the diagnosis.
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
