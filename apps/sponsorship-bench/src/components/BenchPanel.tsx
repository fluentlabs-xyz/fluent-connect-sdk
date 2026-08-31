import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type {
  FluentBatchApi,
  FluentGasPayment,
  FluentGasPaymentSymbol,
  FluentWidgetSession,
} from "@fluent.xyz/connect";
import { zeroAddress, type Address } from "viem";

import { decide, preview, selectorOf, type BenchDecideResult } from "../bench/decide";
import {
  formatTokenAmount,
  plannedApproval,
  readPaymasterAllowance,
  resolveErc20PaymasterAddress,
  shortenAddress,
  type PaymasterAllowance,
} from "../bench/erc20Paymaster";
import { readGasTokenBalance, type GasTokenSymbol } from "../bench/tokenBalance";
import {
  BENCH_ACTIONS,
  GAS_MODES,
  SEEDED_PEOPLE,
  SPONSORSHIP_URL,
  type BenchActionId,
} from "../consts";
import { ActionRow } from "./ActionRow";
import { classifyPayer, type SendOutcome } from "./PayerBadge";

/** Only `target` and `selector` reach the evaluator, so a stand-in receiver changes nothing. */
const PLACEHOLDER_ACCOUNT = zeroAddress;

type Verdicts = Partial<Record<BenchActionId, BenchDecideResult>>;

/** 18 decimals, trimmed — the number a person compares against a budget. */
function formatWei(wei: string | undefined) {
  if (!wei) return null;
  try {
    const value = BigInt(wei);
    const whole = value / 10n ** 18n;
    const frac = (value % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
    return `${whole}.${frac} ETH`;
  } catch {
    return wei;
  }
}

function decisionOf(verdicts: Verdicts) {
  for (const action of BENCH_ACTIONS) {
    const result = verdicts[action.id];
    if (result?.status === "ok") return result.decision;
  }
  return undefined;
}

export function BenchPanel({
  session,
  widget,
}: {
  session: FluentWidgetSession | null;
  widget: FluentBatchApi;
}) {
  // In direct auth the widget's session user id *is* the Privy DID — the same string the
  // proxy writes to Redis and the webhook later reads back. It is also the person every
  // Send on this page acts as, which is why the row verdicts are computed for it.
  const signedInDid = session?.user?.id;
  const account = (widget.account.address ?? session?.wallet.smartAccountAddress) as
    | Address
    | undefined;

  // The comparison, never the sender. Seeded people only: they are the ones whose families
  // are known and whose verdicts therefore teach something.
  const [personKey, setPersonKey] = useState<string>(SEEDED_PEOPLE[0]?.privyId ?? "");
  // ETH by default: it is the only mode that enters the sponsorship path at all, and a
  // bench that opened on a token would explain the rules while routing around them.
  const [gasMode, setGasMode] = useState<FluentGasPaymentSymbol>("ETH");
  const [outcomes, setOutcomes] = useState<Partial<Record<BenchActionId, SendOutcome>>>({});
  const [busyAction, setBusyAction] = useState<BenchActionId | null>(null);

  const [senderVerdicts, setSenderVerdicts] = useState<Verdicts>({});
  const [compareVerdicts, setCompareVerdicts] = useState<Verdicts>({});
  const [decideLoading, setDecideLoading] = useState(false);
  // Undefined while we have not asked yet. "bench" is the laptop mode: /bench/decide is
  // registered, seeded people answer. "preview" is the deployed mode: the bench routes are
  // off, but /paymaster/{client_id}/preview answers for the signed-in person — same model,
  // identity from the Privy token, no seeded comparison. "none" hides every verdict, which
  // is the one conditional that lets this app become the public demo instead of being forked.
  const [explainSource, setExplainSource] = useState<"bench" | "preview" | "none" | undefined>(
    undefined,
  );
  const { getAccessToken } = usePrivy();
  const [probeNonce, setProbeNonce] = useState(0);

  // Who the ERC-20 paymaster actually is, asked of the SDK rather than read off a chart:
  // token-paid gas goes to a different ZeroDev project, so every address written down in
  // this repository belongs to the wrong one (F4b). Undefined means we could not establish
  // it, and a token-paid send then honestly reads UNKNOWN PAYMASTER.
  const [erc20Paymaster, setErc20Paymaster] = useState<Address | undefined>(undefined);
  // Undefined = not asked, null = could not be answered, otherwise the standing allowance.
  const [allowance, setAllowance] = useState<PaymasterAllowance | null | undefined>(undefined);
  const [allowanceNonce, setAllowanceNonce] = useState(0);

  // Ask again when the tab regains focus, but only while we believe the endpoint is
  // absent. The ordinary dev loop starts this app first and the Go service second, and
  // without this the verdicts would stay hidden for the rest of the session — the reader
  // would conclude the flag is off when it is on. Focus rather than a timer: it is the
  // gesture of coming back from the terminal where the service was just started, it costs
  // one request, and a demo page with no service behind it never polls at all.
  useEffect(() => {
    if (explainSource !== "none") return;
    const retry = () => setProbeNonce((n) => n + 1);
    window.addEventListener("focus", retry);
    return () => window.removeEventListener("focus", retry);
  }, [explainSource]);

  // Once, on load. The answer is per chain and EntryPoint, not per token, and the badge
  // needs it even in ETH mode — an ETH send that came back paid by the ERC-20 paymaster is
  // exactly the surprise this page exists to name.
  useEffect(() => {
    let live = true;
    resolveErc20PaymasterAddress()
      .then((address) => {
        if (live) setErc20Paymaster(address);
      })
      .catch(() => {
        if (live) setErc20Paymaster(undefined);
      });
    return () => {
      live = false;
    };
  }, []);

  const tokenMode: GasTokenSymbol | null = gasMode === "ETH" ? null : gasMode;

  // Read the standing allowance before sending, not after failing. `needsApproval` is the
  // whole of the F4c fix: the paymaster fronts the ETH and reclaims it with `transferFrom`
  // in `postOp`, so an operation sent with no allowance reverts and is charged anyway.
  useEffect(() => {
    if (!tokenMode || !account) {
      setAllowance(undefined);
      return;
    }
    let live = true;
    setAllowance(undefined);
    readPaymasterAllowance(tokenMode, account).then((result) => {
      if (live) setAllowance(result);
    });
    return () => {
      live = false;
    };
  }, [account, tokenMode, allowanceNonce]);

  const comparePerson = useMemo(
    () => SEEDED_PEOPLE.find((person) => person.privyId === personKey) ?? SEEDED_PEOPLE[0],
    [personKey],
  );

  const callsFor = useCallback(
    (actionId: BenchActionId) => {
      const action = BENCH_ACTIONS.find((candidate) => candidate.id === actionId);
      if (!action) return [];
      const data = action.data(account ?? PLACEHOLDER_ACCOUNT);
      return [{ target: action.target.toLowerCase(), selector: selectorOf(data) }];
    },
    [account],
  );

  const comparePrivyId = comparePerson?.privyId;
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setDecideLoading(true);

    const ask = async (privyId: string, sender: Address | undefined): Promise<Verdicts> => {
      const entries = await Promise.all(
        BENCH_ACTIONS.map(async (action) => {
          const result = await decide({
            privyId,
            sender,
            calls: callsFor(action.id),
            signal: controller.signal,
          });
          return [action.id, result] as const;
        }),
      );
      return Object.fromEntries(entries) as Verdicts;
    };

    // The deployed fallback: bench routes off, preview on. Same model, but only for the
    // signed-in person — identity travels in the Privy token, so there is nobody to ask
    // about but the caller.
    const askPreview = async (): Promise<Verdicts | null> => {
      const accessToken = await getAccessToken().catch(() => null);
      if (!accessToken) return null;
      const entries = await Promise.all(
        BENCH_ACTIONS.map(async (action) => {
          const result = await preview({
            accessToken,
            calls: callsFor(action.id),
            signal: controller.signal,
          });
          return [action.id, result] as const;
        }),
      );
      const verdicts = Object.fromEntries(entries) as Verdicts;
      const answered = Object.values(verdicts).some((result) => result.status !== "absent");
      return answered ? verdicts : null;
    };

    Promise.all([
      // The sender, with its real smart account: this is the answer that belongs beside a
      // Send, because this is who the Send acts as.
      signedInDid ? ask(signedInDid, account) : Promise.resolve<Verdicts>({}),
      // The comparison. The service synthesises a sender per DID for the seeded people, so
      // naming one here would split that person's counters.
      comparePrivyId ? ask(comparePrivyId, undefined) : Promise.resolve<Verdicts>({}),
    ])
      .then(async ([sender, compare]) => {
        // Absent from every question, not just one: a single transport hiccup is not proof
        // the route is unregistered.
        const all = [...Object.values(sender), ...Object.values(compare)];
        const benchAnswered = all.length > 0 && all.some((result) => result.status !== "absent");
        if (benchAnswered) {
          if (!live) return;
          setSenderVerdicts(sender);
          setCompareVerdicts(compare);
          setExplainSource("bench");
          return;
        }
        const previewVerdicts = signedInDid ? await askPreview() : null;
        if (!live) return;
        setSenderVerdicts(previewVerdicts ?? {});
        setCompareVerdicts({});
        setExplainSource(previewVerdicts ? "preview" : "none");
      })
      .catch(() => {
        if (live) setExplainSource("none");
      })
      .finally(() => {
        if (live) setDecideLoading(false);
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [account, callsFor, comparePrivyId, getAccessToken, signedInDid, probeNonce]);

  async function send(actionId: BenchActionId) {
    const action = BENCH_ACTIONS.find((candidate) => candidate.id === actionId);
    if (!action || !account) return;
    setBusyAction(actionId);
    // The mode is captured here, not read at render: the selector may move while this
    // send settles, and the intent recorded against a result must be the one it was sent
    // with. `requested` is intent only — the badge below never reads it for the verdict.
    const requested = gasMode;
    setOutcomes((current) => ({ ...current, [actionId]: { requested } }));

    // Include the approval when the standing allowance is short — and when it is not yet
    // known, which covers a Send pressed before the read landed and a read that failed.
    // There is no chicken-and-egg: the approve executes in the main phase, and the
    // paymaster takes its tokens in `postOp`, after.
    const planned = requested === "ETH" ? null : plannedApproval(requested);
    const grant =
      planned && (allowance === undefined || allowance === null || allowance.needsApproval)
        ? {
            symbol: requested as GasTokenSymbol,
            amount: planned.amount,
            decimals: planned.decimals,
            spender: allowance?.spender ?? erc20Paymaster,
          }
        : null;
    const gasPayment: FluentGasPayment = grant
      ? { symbol: requested, includeApproval: true, approveAmount: grant.amount }
      : { symbol: requested };

    try {
      const op = widget.createBatchOp({
        id: `sponsorship-bench-${action.id}`,
        reviewTitle: action.method,
        calls: [
          {
            id: action.id,
            label: action.method,
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
      const { hash, paymaster } = await op.execute({ gasPayment });
      setOutcomes((current) => ({
        ...current,
        [actionId]: {
          requested,
          hash,
          paymaster,
          payer: classifyPayer(paymaster, erc20Paymaster),
          // Stamped from what was sent, not re-read: the paymaster has already taken part
          // of it by the time the receipt lands, so a fresh read would report a number
          // nobody approved.
          approval: grant ?? undefined,
        },
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
      // Whatever happened, the standing allowance may have moved. Ask again.
      if (requested !== "ETH") setAllowanceNonce((n) => n + 1);
    }
  }

  const canSend = Boolean(account && widget.account.executionReady);
  const gasModeNote = GAS_MODES.find((mode) => mode.symbol === gasMode)?.note;
  const verdictsHidden = explainSource === "none";
  // The seeded comparison exists only where /bench/decide does: preview cannot answer for
  // anyone but the signed-in caller.
  const benchMode = explainSource === "bench";
  const hasSender = Boolean(signedInDid);

  // Segments belong to a person, so there are two sets and each is named. The balance and
  // the engine belong to the partner and the service, so they are said once.
  const senderDecision = decisionOf(senderVerdicts);
  const compareDecision = decisionOf(compareVerdicts);
  const service = senderDecision ?? compareDecision;
  const balance = formatWei(service?.balance_wei);

  // The two people answer differently for at least one action. Worth saying out loud,
  // because the ordinary cause is invisible: a signed-in account has no Fluent profile row
  // yet, and that is what every real first-time user looks like.
  const disagree =
    hasSender &&
    BENCH_ACTIONS.some((action) => {
      const mine = senderVerdicts[action.id];
      const theirs = compareVerdicts[action.id];
      return (
        mine?.status === "ok" &&
        theirs?.status === "ok" &&
        mine.decision.proceed !== theirs.decision.proceed
      );
    });

  // `shrink` marks the parts that may be ellipsised when the line runs out of room. The
  // identifiers can be — the whole string is in `title` either way — but the service the
  // page is talking to cannot: signed in, the DID and the account together overrun the
  // line, and a plain one-line truncation would eat it off the end.
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
          {identityParts.map((part) => (
            <span key={part.text} className={part.shrink ? "identity-shrink" : undefined}>
              {part.text}
            </span>
          ))}
        </p>
      </header>

      <div className="controls">
        {/* A comparison, and labelled as one whenever there is a sender to compare against.
            It drives nothing but the aside inside each row, so when the service does not
            answer it goes with them. */}
        {benchMode ? (
          <label className="person-select">
            <span>{hasSender ? "Compare with" : "Explain for"}</span>
            <select value={personKey} onChange={(event) => setPersonKey(event.target.value)}>
              {SEEDED_PEOPLE.map((person) => (
                <option key={person.privyId} value={person.privyId}>
                  {person.name} — {person.families}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {/* Native radios, so the group is one tab stop and the arrow keys move within it —
            the behaviour a person expects from three exclusive choices. The input is
            invisible but still focusable and still hit by a click on the label. */}
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

      {verdictsHidden ? null : (
        <p className="context">
          {/* Who each row's verdict is about, said before the rows rather than left to the
              reader. A verdict that answered for the selector while the button sent as the
              signed-in account is the defect this sentence exists to close. */}
          <span>
            {hasSender
              ? "Each row answers for your signed-in account — the one that sends"
              : `Nobody is signed in, so nothing can be sent; these answer for ${comparePerson?.name}`}
          </span>
          {explainSource === "preview" ? (
            <span>
              via <code>/preview</code> — the deployed dry-run; it answers only for you, so
              there is no seeded comparison here
            </span>
          ) : null}
          <span>
            <code>commit: false</code> — nothing moves
          </span>
          {hasSender ? (
            <span>
              Your segments:{" "}
              {senderDecision
                ? senderDecision.segments && senderDecision.segments.length > 0
                  ? senderDecision.segments.join(", ")
                  : "none"
                : "…"}
            </span>
          ) : null}
          {benchMode && comparePerson ? (
            <span>
              {comparePerson.name}:{" "}
              {compareDecision
                ? compareDecision.segments && compareDecision.segments.length > 0
                  ? compareDecision.segments.join(", ")
                  : "none"
                : "…"}
            </span>
          ) : null}
          {balance ? <span>Partner balance {balance}</span> : null}
          {benchMode && service ? (
            <span>
              {/* NOT "which evaluator answered these verdicts" — they always come from the
                  new model. This is the service's --model-engine-enabled flag, i.e. which
                  evaluator a real send would meet right now. Conflating the two makes the
                  page claim the model decided a send the flat policy actually decided. */}
              Real sends decided by <code>{service.engine || "unknown"}</code>
              {service.engine === "model"
                ? " — the same evaluator as these verdicts"
                : service.engine === "policy"
                  ? " — the old flat policy, so these verdicts do not predict a real send"
                  : " — unknown, so these verdicts do not predict a real send"}
            </span>
          ) : null}
        </p>
      )}

      {/* Every clause here is a standing fact about the system; the reader's own segments
          are on the line above and say which case they are in. */}
      {!verdictsHidden && disagree ? (
        <p className="hint">
          Your account and {comparePerson?.name} get different answers. A signed-in DID has
          no Fluent profile row until the Privy pipeline creates one, and a person without
          one matches no conditioned segment — so a fresh account lands in the fallback and
          is covered by fewer rules. That is what every real first-time user looks like, not
          a fault.
        </p>
      ) : null}

      {/* What the mode asks for. What happened is the badge, and only the badge. */}
      <p className="hint gas-note">
        {gasModeNote}{" "}
        {tokenMode && account ? (
          <AllowanceNote symbol={tokenMode} allowance={allowance} />
        ) : null}
      </p>

      <ul className="rows">
        {BENCH_ACTIONS.map((action) => (
          <ActionRow
            key={action.id}
            action={action}
            account={account ?? PLACEHOLDER_ACCOUNT}
            hasSender={hasSender}
            senderVerdict={verdictsHidden ? undefined : senderVerdicts[action.id]}
            compareVerdict={benchMode ? compareVerdicts[action.id] : undefined}
            compareLabel={comparePerson?.name ?? "Seeded person"}
            verdictsHidden={verdictsHidden}
            outcome={outcomes[action.id] ?? {}}
            onSend={() => void send(action.id)}
            sending={busyAction === action.id}
            canSend={canSend && busyAction === null}
          />
        ))}
      </ul>

      {canSend ? null : (
        <p className="hint">
          {widget.account.executionError ??
            "Sign in and wait for the widget to prepare the smart account."}
        </p>
      )}

      {decideLoading ? <p className="hint">Asking the service…</p> : null}
    </section>
  );
}

/**
 * What the account has standing, and what the next send will grant. Said before the send
 * rather than after it: an allowance a builder discovers later is the kind of thing this
 * bench exists to make visible.
 */
function AllowanceNote({
  symbol,
  allowance,
}: {
  symbol: GasTokenSymbol;
  allowance: PaymasterAllowance | null | undefined;
}) {
  // Both not-yet-read and could-not-be-read say the same thing, because the send behaves
  // the same way in both: it approves. Silence here would let a reader press Send believing
  // nothing would be granted.
  if (allowance === undefined || allowance === null) {
    const planned = plannedApproval(symbol);
    return (
      <>
        The standing allowance {allowance === null ? "could not be read" : "is still being read"}
        , so a send now approves {formatTokenAmount(planned.amount, planned.decimals)} {symbol} to
        the ERC-20 paymaster anyway — a redundant approval costs a little gas, a missing one
        reverts the whole operation.
      </>
    );
  }
  const standing = `${formatTokenAmount(allowance.allowance, allowance.decimals, 4)} ${allowance.symbol}`;
  const grant = `${formatTokenAmount(allowance.approveAmount, allowance.decimals)} ${allowance.symbol}`;
  const spender = <span title={allowance.spender}>{shortenAddress(allowance.spender)}</span>;
  return allowance.needsApproval ? (
    <>
      The paymaster {spender} has {standing} approved, so the next send approves {grant} to it
      first, in the same operation and the same signature. That allowance then stands until it
      is spent or revoked.
    </>
  ) : (
    <>
      The paymaster {spender} already has {standing} approved, so this send carries no approval
      — which is how an integration behaves after the first one.
    </>
  );
}
