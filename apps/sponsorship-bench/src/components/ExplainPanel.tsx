import type { BenchDecideResult } from "../bench/decide";
import { BENCH_ACTIONS, type BenchActionId } from "../consts";

function formatWei(wei: string | undefined) {
  if (!wei) return "—";
  try {
    // 18 decimals, trimmed — the number a person compares against a budget, with the
    // exact wei still one line away in the raw JSON.
    const value = BigInt(wei);
    const whole = value / 10n ** 18n;
    const frac = (value % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
    return `${whole}.${frac} ETH`;
  } catch {
    return wei;
  }
}

/**
 * `decided_by` is a free string that usually embeds a 40-hex address. Shorten the address
 * in place rather than the whole cell, so a rule name around it survives; the full string
 * stays in the cell's `title`.
 */
function shortenHex(text: string) {
  return text.replace(
    /0x[0-9a-fA-F]{40}/g,
    (hex) => `${hex.slice(0, 6)}…${hex.slice(-4)}`,
  );
}

export function ExplainPanel({
  personLabel,
  seeded,
  selectedActionId,
  onSelectAction,
  results,
  loading,
}: {
  personLabel: string;
  /** False for the signed-in DID, which may have no `users` row yet. */
  seeded: boolean;
  selectedActionId: BenchActionId;
  onSelectAction: (id: BenchActionId) => void;
  results: Partial<Record<BenchActionId, BenchDecideResult>>;
  loading: boolean;
}) {
  const selected = results[selectedActionId];
  // A real DID has no `users` row until the Privy pipeline has created one, and a person
  // with no row matches no conditioned segment — so an empty segment list here is the
  // system working, not the panel failing. Say so, or it reads as broken.
  const noSegments =
    selected?.status === "ok" && (selected.decision.segments?.length ?? 0) === 0;

  return (
    <section className="explain">
      <header>
        <h2>Dry run</h2>
        {/* The DID is already spelled out in the select immediately above; repeating it
            here just made the reader check two strings against each other. */}
        <p className="muted">
          <code>commit: false</code> — nothing moves. Answers for{" "}
          <strong>{personLabel}</strong>.
        </p>
        {!seeded && noSegments ? (
          <p className="muted">
            No segments matched. A signed-in DID has no Fluent profile row until the Privy
            pipeline creates one, and a person with no row matches nothing conditioned — so
            this is the expected answer for a fresh account, not a fault.
          </p>
        ) : null}
      </header>

      <table className="verdicts">
        <colgroup>
          <col className="col-action" />
          <col />
          <col className="col-decided" />
        </colgroup>
        <thead>
          <tr>
            <th>Action</th>
            <th>Verdict</th>
            <th>Decided by</th>
          </tr>
        </thead>
        <tbody>
          {BENCH_ACTIONS.map((action) => {
            const result = results[action.id];
            const isSelected = action.id === selectedActionId;
            const decidedBy =
              result?.status === "ok" ? result.decision.decided_by || "—" : "—";
            return (
              <tr
                key={action.id}
                className={isSelected ? "selected" : undefined}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={() => onSelectAction(action.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelectAction(action.id);
                }}
              >
                <td>{action.label}</td>
                <td>
                  {result?.status === "ok" ? (
                    <span className={result.decision.proceed ? "verdict-yes" : "verdict-no"}>
                      {result.decision.proceed ? "proceed" : (result.decision.reason || "refused")}
                    </span>
                  ) : result?.status === "failed" ? (
                    <span className="verdict-no">{result.message}</span>
                  ) : (
                    <span className="muted">{loading ? "…" : "—"}</span>
                  )}
                </td>
                <td className="mono-cell" title={decidedBy}>
                  {shortenHex(decidedBy)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {selected?.status === "ok" ? (
        <>
          {/* Proceed, Reason and Decided by all live in the row that is already selected
              above. Only what the table cannot show belongs here. */}
          <dl className="detail-grid">
            <div>
              <dt>Detail</dt>
              <dd>{selected.decision.detail || "—"}</dd>
            </div>
            <div>
              <dt>Segments</dt>
              <dd>
                {selected.decision.segments && selected.decision.segments.length > 0
                  ? selected.decision.segments.join(" · ")
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd className="mono">{formatWei(selected.decision.balance_wei)}</dd>
            </div>
            <div>
              <dt>Would leave</dt>
              <dd className="mono">{formatWei(selected.decision.would_leave_wei)}</dd>
            </div>
            <div className="engine-cell">
              <dt>Real sends decided by</dt>
              <dd>
                <span className="engine">{selected.decision.engine || "unknown"}</span>
                {/* This is NOT "which evaluator answered this panel" — the panel always
                    runs the new model. It reports the service's --model-engine-enabled
                    flag, i.e. which evaluator a real send through the widget would meet
                    right now. Conflating the two makes the page claim the model decided a
                    send the flat policy actually decided. */}
                <span className="engine-note">
                  {selected.decision.engine === "model"
                    ? "This dry run and a real send use the same evaluator."
                    : selected.decision.engine === "policy"
                      ? "A real send is still decided by the old flat policy — this verdict does not predict it."
                      : "Unknown; do not read this verdict as predicting a real send."}
                </span>
              </dd>
            </div>
          </dl>
          <details className="raw">
            <summary>Raw response</summary>
            <pre>{selected.raw}</pre>
          </details>
        </>
      ) : selected?.status === "failed" ? (
        <div className="panel-error">
          <p>
            <strong>/bench/decide answered {selected.message}.</strong> The route is
            registered, so this is a fault to read rather than a mode to hide.
          </p>
          {selected.raw ? <pre>{selected.raw}</pre> : null}
        </div>
      ) : (
        <p className="muted">{loading ? "Asking the service…" : "No verdict yet."}</p>
      )}
    </section>
  );
}
