import { selectorOf, type BenchDecideResult } from "../bench/decide";
import { formatTokenAmount, shortenAddress } from "../bench/erc20Paymaster";
import { EXPLORER_BASE_URL, type BenchAction } from "../consts";
import { PayerBadge, payerSentence, type SendOutcome } from "./PayerBadge";

/**
 * `decided_by` is a free string that usually embeds a 40-hex address. Shorten the address
 * in place rather than the whole line, so the rule name around it survives; the full
 * string stays in the element's `title`.
 */
function shortenHex(text: string) {
  return text.replace(/0x[0-9a-fA-F]{40}/g, (hex) => `${hex.slice(0, 6)}…${hex.slice(-4)}`);
}

function Verdict({ result }: { result: BenchDecideResult | undefined }) {
  if (result?.status === "ok") {
    return (
      <span className={result.decision.proceed ? "verdict-yes" : "verdict-no"}>
        {result.decision.proceed ? "proceed" : result.decision.reason || "refused"}
      </span>
    );
  }
  if (result?.status === "failed") {
    return (
      <span className="verdict-no" title={result.raw}>
        {result.message}
      </span>
    );
  }
  return null;
}

/**
 * One action, one row: what it demonstrates, what will happen if you press it, and the
 * press.
 *
 * The verdict in the head is computed for **the account that will actually send** and for
 * nobody else. It sat here once answering for whoever the selector named, while the button
 * beside it sent as the signed-in account — the two disagreed and the page said nothing,
 * because the eye binds a verdict to the button in its own row whatever the control above
 * is labelled. `aria-describedby` now binds them in the accessibility tree too.
 *
 * The selected person's answer is a comparison and is marked as one: named, set aside, and
 * never in the head.
 */
export function ActionRow({
  action,
  account,
  hasSender,
  senderVerdict,
  compareVerdict,
  compareLabel,
  outcome,
  onSend,
  sending,
  canSend,
  verdictsHidden,
}: {
  action: BenchAction;
  /** The address the calldata is encoded for; a stand-in while nobody is signed in. */
  account: `0x${string}`;
  /** False when nobody is signed in — there is then no sender, so there is no verdict. */
  hasSender: boolean;
  senderVerdict: BenchDecideResult | undefined;
  compareVerdict: BenchDecideResult | undefined;
  compareLabel: string;
  outcome: SendOutcome;
  onSend: () => void;
  sending: boolean;
  canSend: boolean;
  /** True when `/bench/decide` does not answer: the row is then the demo, and complete. */
  verdictsHidden: boolean;
}) {
  const data = action.data(account);
  const call = `${action.method} · ${action.targetLabel} ${action.target} · ${selectorOf(data)}`;
  const senderDecision = senderVerdict?.status === "ok" ? senderVerdict.decision : undefined;
  const verdictId = `verdict-${action.id}`;

  return (
    <li className="row">
      <div className="row-head">
        <h2 className="row-label">{action.label}</h2>

        <span className="row-verdict" id={verdictId}>
          {hasSender ? <Verdict result={senderVerdict} /> : null}
        </span>

        <button
          type="button"
          className="send-button"
          onClick={onSend}
          disabled={!canSend}
          // The verdict in this row is about this button and no other person's account.
          aria-describedby={hasSender && senderDecision ? verdictId : undefined}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>

      {/* Directly under the verdict, because it is the reason for it. */}
      {senderDecision?.decided_by && hasSender ? (
        <p className="row-decided" title={senderDecision.decided_by}>
          {shortenHex(senderDecision.decided_by)}
        </p>
      ) : null}

      {/* Truncates rather than wraps: an address split across two lines reads as two
          different addresses, and the whole string is in `title` either way. */}
      <p className="mono row-call" title={call}>
        {call}
      </p>

      {/* Set aside and named. It is somebody else's answer and this button will not
          produce it — the whole defect this treatment exists to prevent. */}
      {!verdictsHidden && compareVerdict ? (
        <p className="row-compare">
          <span className="row-compare-who">{compareLabel}</span> <Verdict result={compareVerdict} />
          {compareVerdict.status === "ok" && compareVerdict.decision.decided_by ? (
            <span className="row-compare-why" title={compareVerdict.decision.decided_by}>
              {" "}
              — {shortenHex(compareVerdict.decision.decided_by)}
            </span>
          ) : null}
        </p>
      ) : null}

      {(outcome.payer || outcome.error) && (
        <div className="row-result">
          <PayerBadge outcome={outcome} />
          {payerSentence(outcome) ? (
            <span className="hint payer-sentence">{payerSentence(outcome)}</span>
          ) : null}
          {/* A standing allowance granted quietly is the thing a builder should never
              discover later. Say the amount, and say that it persists. */}
          {outcome.approval ? (
            <span className="hint payer-sentence" title={outcome.approval.spender}>
              This send also approved{" "}
              {formatTokenAmount(outcome.approval.amount, outcome.approval.decimals)}{" "}
              {outcome.approval.symbol} to the ERC-20 paymaster
              {outcome.approval.spender ? ` ${shortenAddress(outcome.approval.spender)}` : ""}, in
              the same operation. That allowance stands until it is spent or revoked — later
              sends carry no approval.
            </span>
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
          {/* The plainer reading when there is one; the raw message stays on the FAILED
              badge's title, where it is still recoverable. */}
          {outcome.error ? (
            <span className="error-text">{outcome.errorNote ?? outcome.error}</span>
          ) : null}
        </div>
      )}

      {/* One disclosure, both answers, each captioned with whose it is. The prose above
          rounds; this is the only place the exact numbers survive. */}
      {!verdictsHidden && (senderVerdict?.status === "ok" || compareVerdict?.status === "ok") ? (
        <details className="raw">
          <summary>Raw verdicts</summary>
          {hasSender && senderVerdict?.status === "ok" ? (
            <>
              <p className="raw-caption">Your signed-in account</p>
              <pre>{senderVerdict.raw}</pre>
            </>
          ) : null}
          {compareVerdict?.status === "ok" ? (
            <>
              <p className="raw-caption">{compareLabel}</p>
              <pre>{compareVerdict.raw}</pre>
            </>
          ) : null}
        </details>
      ) : null}
    </li>
  );
}
