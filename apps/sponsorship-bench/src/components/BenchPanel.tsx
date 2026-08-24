import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  FluentBatchApi,
  FluentGasPaymentSymbol,
  FluentWidgetSession,
} from "@fluent.xyz/connect";
import { zeroAddress, type Address } from "viem";

import { decide, selectorOf, type BenchDecideResult } from "../bench/decide";
import { readGasTokenBalance, type GasTokenSymbol } from "../bench/tokenBalance";
import {
  BENCH_ACTIONS,
  EXPLORER_BASE_URL,
  GAS_MODES,
  SEEDED_PEOPLE,
  SPONSORSHIP_URL,
  type BenchActionId,
} from "../consts";
import { ExplainPanel } from "./ExplainPanel";
import { classifyPayer, PayerBadge, payerSentence, type SendOutcome } from "./PayerBadge";

/** Only `target` and `selector` reach the evaluator, so a stand-in receiver changes nothing. */
const PLACEHOLDER_ACCOUNT = zeroAddress;

const SIGNED_IN = "__signed_in__";

export function BenchPanel({
  session,
  widget,
}: {
  session: FluentWidgetSession | null;
  widget: FluentBatchApi;
}) {
  // In direct auth the widget's session user id *is* the Privy DID — the same string the
  // proxy writes to Redis and the webhook later reads back.
  const signedInDid = session?.user?.id;
  const account = (widget.account.address ?? session?.wallet.smartAccountAddress) as
    | Address
    | undefined;

  // A seeded person by default, deliberately: the dry run then works on a cold page with
  // nobody signed in, which is the state the local Privy config is most likely wrong in.
  const [personKey, setPersonKey] = useState<string>(SEEDED_PEOPLE[0]?.privyId ?? SIGNED_IN);
  const [selectedActionId, setSelectedActionId] = useState<BenchActionId>("deposit");
  // ETH by default: it is the only mode that enters the sponsorship path at all, and a
  // bench that opened on a token would explain the rules while routing around them.
  const [gasMode, setGasMode] = useState<FluentGasPaymentSymbol>("ETH");
  const [outcomes, setOutcomes] = useState<Partial<Record<BenchActionId, SendOutcome>>>({});
  const [busyAction, setBusyAction] = useState<BenchActionId | null>(null);

  const [decisions, setDecisions] = useState<Partial<Record<BenchActionId, BenchDecideResult>>>({});
  const [decideLoading, setDecideLoading] = useState(false);
  // Undefined while we have not asked yet; false hides the whole panel, which is the one
  // conditional that lets this app become the public demo instead of being forked.
  const [explainAvailable, setExplainAvailable] = useState<boolean | undefined>(undefined);
  const [probeNonce, setProbeNonce] = useState(0);

  // Ask again when the tab regains focus, but only while we believe the endpoint is
  // absent. The ordinary dev loop starts this app first and the Go service second, and
  // without this the panel would stay hidden for the rest of the session — the reader
  // would conclude the flag is off when it is on. Focus rather than a timer: it is the
  // gesture of coming back from the terminal where the service was just started, it costs
  // one request, and a demo page with no service behind it never polls at all.
  useEffect(() => {
    if (explainAvailable !== false) return;
    const retry = () => setProbeNonce((n) => n + 1);
    window.addEventListener("focus", retry);
    return () => window.removeEventListener("focus", retry);
  }, [explainAvailable]);

  const effectivePerson = useMemo(() => {
    if (personKey === SIGNED_IN) {
      return signedInDid
        ? { privyId: signedInDid, name: "Signed in", seeded: false }
        : null;
    }
    const seeded = SEEDED_PEOPLE.find((person) => person.privyId === personKey);
    return seeded ? { privyId: seeded.privyId, name: seeded.name, seeded: true } : null;
  }, [personKey, signedInDid]);

  const callsFor = useCallback(
    (actionId: BenchActionId) => {
      const action = BENCH_ACTIONS.find((candidate) => candidate.id === actionId);
      if (!action) return [];
      const data = action.data(account ?? PLACEHOLDER_ACCOUNT);
      return [{ target: action.target.toLowerCase(), selector: selectorOf(data) }];
    },
    [account],
  );

  const dryRunPrivyId = effectivePerson?.privyId;
  useEffect(() => {
    if (!dryRunPrivyId) {
      setDecisions({});
      return;
    }
    const controller = new AbortController();
    let live = true;
    setDecideLoading(true);
    Promise.all(
      BENCH_ACTIONS.map(async (action) => {
        const result = await decide({
          privyId: dryRunPrivyId,
          // The service synthesises a sender per DID for the seeded people; only the
          // signed-in person has a real smart account to name.
          sender: effectivePerson?.seeded ? undefined : account,
          calls: callsFor(action.id),
          signal: controller.signal,
        });
        return [action.id, result] as const;
      }),
    )
      .then((entries) => {
        if (!live) return;
        setDecisions(Object.fromEntries(entries));
        // Absent from every action, not just one: a single transport hiccup is not proof
        // the route is unregistered.
        setExplainAvailable(entries.some(([, result]) => result.status !== "absent"));
      })
      .catch(() => {
        if (live) setExplainAvailable(false);
      })
      .finally(() => {
        if (live) setDecideLoading(false);
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [account, callsFor, dryRunPrivyId, effectivePerson?.seeded, probeNonce]);

  async function send(actionId: BenchActionId) {
    const action = BENCH_ACTIONS.find((candidate) => candidate.id === actionId);
    if (!action || !account) return;
    setBusyAction(actionId);
    // The mode is captured here, not read at render: the selector may move while this
    // send settles, and the intent recorded against a result must be the one it was sent
    // with. `requested` is intent only — the badge below never reads it for the verdict.
    const requested = gasMode;
    setOutcomes((current) => ({ ...current, [actionId]: { requested } }));
    try {
      const op = widget.createBatchOp({
        id: `sponsorship-bench-${action.id}`,
        reviewTitle: action.label,
        calls: [
          {
            id: action.id,
            label: action.summary,
            to: action.target,
            data: action.data(account),
          },
        ],
      });
      // Explicit on every send, including ETH. Omitting `gasPayment` inherits the widget's
      // own selector, which defaults to BLEND (F4) — so the obvious `execute({})` is never
      // sponsored and nothing says so. `symbol: "ETH"` resolves to no gas token, i.e.
      // native gas and the sponsorship path; a token symbol resolves to the ERC-20
      // paymaster, which returns `proceed` before any rule is read.
      // The widget's own `sponsored` flag is deliberately ignored: it guesses from having
      // built a sponsored client when the paymaster cannot be read. Derive the payer from
      // what the EntryPoint recorded, and admit when there isn't one.
      const { hash, paymaster } = await op.execute({ gasPayment: { symbol: requested } });
      setOutcomes((current) => ({
        ...current,
        [actionId]: { requested, hash, paymaster, payer: classifyPayer(paymaster) },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "send failed";
      // An empty balance is the ordinary reason a token send fails here — USDnr may have
      // none on this account at all — and it deserves that sentence rather than whatever
      // the bundler said. Asked only after the failure, and only about the token that was
      // actually requested; a failed read stays quiet rather than claiming anything.
      const balance =
        requested !== "ETH" && account
          ? await readGasTokenBalance(requested as GasTokenSymbol, account)
          : null;
      setOutcomes((current) => ({
        ...current,
        [actionId]: {
          requested,
          error: message,
          errorNote: balance === 0n ? `No ${requested} balance on this account.` : undefined,
        },
      }));
    } finally {
      setBusyAction(null);
    }
  }

  const canSend = Boolean(account && widget.account.executionReady);

  const selectedAction = BENCH_ACTIONS.find((action) => action.id === selectedActionId);
  // Read the in-flight label off `busyAction`, never off the selection: the selection can
  // move while a send is still settling, and a button that renames itself mid-flight would
  // attribute the result to the wrong action — the one thing this page must never do.
  const busyLabel = BENCH_ACTIONS.find((action) => action.id === busyAction)?.label;

  const gasModeNote = GAS_MODES.find((mode) => mode.symbol === gasMode)?.note;

  // `shrink` marks the parts that may be ellipsised when the line runs out of room. The
  // identifiers can be — the whole string is in `title` either way — but the service the
  // page is talking to cannot: signed in, the DID and the account together overrun the
  // line, and a plain one-line truncation would eat it off the end.
  // The gas route used to be named here too. It is a control on the page now, and saying
  // it twice was the sort of thing that made this page read as a panel.
  const identityParts: { text: string; shrink: boolean }[] = [
    { text: signedInDid ?? "not signed in", shrink: Boolean(signedInDid) },
    ...(account ? [{ text: account, shrink: true }] : []),
    { text: SPONSORSHIP_URL.replace(/^https?:\/\//, ""), shrink: false },
  ];
  const identity = identityParts.map((part) => part.text).join(" · ");

  return (
    <section className="bench">
      <header className="bench-header">
        <div className="eyebrow">Fluent Connect SDK · Local · Real partner budget</div>
        <h1>Sponsorship bench</h1>
        {/* Truncates rather than wraps, so the address stays one comparable string. */}
        <p className="mono identity-line" title={identity}>
          {identityParts.map((part, index) => (
            <span key={part.text} className={part.shrink ? "identity-shrink" : undefined}>
              {part.text}
            </span>
          ))}
        </p>
      </header>

      <div className="bench-columns">
        <section className="actions">
          <header>
            <h2>Actions</h2>
            <p className="muted">Always sends as the signed-in account.</p>
          </header>

          {BENCH_ACTIONS.map((action) => {
            const outcome = outcomes[action.id] ?? {};
            const data = action.data(account ?? PLACEHOLDER_ACCOUNT);
            const call = `${action.targetLabel} ${action.target} · ${selectorOf(data)}`;
            return (
              <article
                key={action.id}
                className={action.id === selectedActionId ? "action selected" : "action"}
                role="button"
                tabIndex={0}
                aria-pressed={action.id === selectedActionId}
                onClick={() => setSelectedActionId(action.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  // Space scrolls the page otherwise, which is the wrong answer to "pick
                  // this one".
                  event.preventDefault();
                  setSelectedActionId(action.id);
                }}
              >
                <div className="action-head">
                  <h3>
                    {action.label}{" "}
                    {action.uncovered ? <span className="tag">uncovered</span> : null}
                  </h3>
                </div>
                <p className="action-summary">{action.summary}</p>
                <p className="mono action-call" title={call}>
                  {call}
                </p>
                <div className="action-result">
                  <PayerBadge outcome={outcome} />
                  {/* Whose money moved, in one sentence — including when it was not the
                      money the send asked for. A badge alone cannot say that. */}
                  {payerSentence(outcome) ? (
                    <span className="hint payer-sentence">{payerSentence(outcome)}</span>
                  ) : null}
                  {outcome.paymaster ? (
                    <span
                      className="mono muted paymaster-cell"
                      title={`paymaster ${outcome.paymaster}`}
                    >
                      paymaster {outcome.paymaster}
                    </span>
                  ) : null}
                  {outcome.hash ? (
                    <a
                      href={`${EXPLORER_BASE_URL}/tx/${outcome.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                    >
                      View transaction
                    </a>
                  ) : null}
                  {/* The plainer reading when there is one; the raw message is still on
                      the FAILED badge's title, where it stays recoverable. */}
                  {outcome.error ? (
                    <span className="error-text">{outcome.errorNote ?? outcome.error}</span>
                  ) : null}
                </div>
              </article>
            );
          })}

          <div className="send-bar">
            <button
              type="button"
              className="send-button"
              onClick={() => void send(selectedActionId)}
              disabled={!canSend || busyAction !== null || !selectedAction}
            >
              {busyLabel ? `Sending ${busyLabel}…` : `Send ${selectedAction?.label ?? ""}`}
            </button>

            {/* Native radios, so the group is one tab stop and the arrow keys move within
                it — the behaviour a person expects from three exclusive choices. The input
                is invisible but still focusable and still hit by a click on the label. */}
            <span className="gas-label" id="gas-modes-label">
              pay gas in
            </span>
            <div className="gas-modes" role="group" aria-labelledby="gas-modes-label">
              {GAS_MODES.map((mode) => (
                <label
                  key={mode.symbol}
                  className={mode.symbol === gasMode ? "gas-mode selected" : "gas-mode"}
                >
                  <input
                    type="radio"
                    name="gas-mode"
                    value={mode.symbol}
                    checked={mode.symbol === gasMode}
                    onChange={() => setGasMode(mode.symbol)}
                  />
                  {mode.symbol}
                </label>
              ))}
            </div>
          </div>

          {/* What the mode asks for. What happened is the badge, and only the badge. */}
          <p className="hint gas-note">{gasModeNote}</p>

          {canSend ? null : (
            <p className="hint">
              {widget.account.executionError ??
                "Sign in and wait for the widget to prepare the smart account."}
            </p>
          )}
        </section>

        {explainAvailable === false ? null : (
          <div className="explain-column">
            <label className="person-select">
              <span>Explain as</span>
              <select value={personKey} onChange={(event) => setPersonKey(event.target.value)}>
                <option value={SIGNED_IN} disabled={!signedInDid}>
                  {signedInDid ? `Signed in — ${signedInDid}` : "Signed in — not available"}
                </option>
                {SEEDED_PEOPLE.map((person) => (
                  <option key={person.privyId} value={person.privyId}>
                    {person.name} — {person.families}
                  </option>
                ))}
              </select>
            </label>

            {effectivePerson ? (
              <ExplainPanel
                personLabel={effectivePerson.name}
                seeded={effectivePerson.seeded}
                selectedActionId={selectedActionId}
                onSelectAction={setSelectedActionId}
                results={decisions}
                loading={decideLoading}
              />
            ) : (
              <p className="muted">Pick a seeded person to dry-run while signed out.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
