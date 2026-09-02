import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { FluentBatchApi, FluentGasPayment, FluentWidgetSession } from "@fluent.xyz/connect";
import type { Address } from "viem";

import { preview, selectorOf, type BenchDecideResult } from "../bench/decide";
import { resolveErc20PaymasterAddress } from "../bench/erc20Paymaster";
import { BENCH_ACTIONS, SPONSORSHIP_URL, type BenchActionId } from "../consts";
import { ActionRow } from "./ActionRow";
import { classifyPayer, type SendOutcome } from "./PayerBadge";

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

export function BenchPanel({
  session,
  widget,
}: {
  session: FluentWidgetSession | null;
  widget: FluentBatchApi;
}) {
  const signedInDid = session?.user?.id;
  const account = (widget.account.address ?? session?.wallet.smartAccountAddress) as
    | Address
    | undefined;
  const { getAccessToken, user } = usePrivy();
  const xHandle = user?.twitter?.username ?? null;

  const [verdicts, setVerdicts] = useState<Partial<Record<BenchActionId, BenchDecideResult>>>({});
  // Segments and partner balance, learned from a silent preview at sign-in so the reader
  // sees who they are before pressing anything. Refreshed by every explicit dry-run.
  const [profile, setProfile] = useState<{ segments: string[]; balanceWei: string } | null>(null);
  const [dryBusy, setDryBusy] = useState<BenchActionId | null>(null);
  const [outcomes, setOutcomes] = useState<Partial<Record<BenchActionId, SendOutcome>>>({});
  const [busyAction, setBusyAction] = useState<BenchActionId | null>(null);

  // Who the ERC-20 paymaster is, asked of the SDK: the badge needs it to name a payer even
  // though this page only ever asks for native gas — an ETH send that settled against the
  // ERC-20 paymaster is exactly the surprise worth naming.
  const [erc20Paymaster, setErc20Paymaster] = useState<Address | undefined>(undefined);
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

  const callsFor = useCallback(
    (actionId: BenchActionId) => {
      const action = BENCH_ACTIONS.find((candidate) => candidate.id === actionId);
      if (!action || !account) return [];
      const data = action.data(account);
      return [{ target: action.target.toLowerCase(), selector: selectorOf(data) }];
    },
    [account],
  );

  // One silent preview at sign-in: segments belong to the person, and the page should say
  // who it is looking at before any button is pressed. Nothing moves — same call as Dry-run.
  useEffect(() => {
    if (!signedInDid || !account) {
      setProfile(null);
      return;
    }
    let live = true;
    (async () => {
      const accessToken = await getAccessToken().catch(() => null);
      if (!accessToken) return;
      const result = await preview({ accessToken, calls: callsFor("deposit") });
      if (live && result.status === "ok") {
        setProfile({
          segments: result.decision.segments ?? [],
          balanceWei: result.decision.balance_wei,
        });
      }
    })();
    return () => {
      live = false;
    };
  }, [account, callsFor, getAccessToken, signedInDid]);

  // On click, not on load: a dry run is an answer to a question somebody asked. Identity
  // travels in the Privy token, so there is no dry run without a Fluent ID sign-in.
  const dryRun = useCallback(
    async (actionId: BenchActionId) => {
      setDryBusy(actionId);
      try {
        const accessToken = await getAccessToken().catch(() => null);
        if (!accessToken) {
          setVerdicts((current) => ({
            ...current,
            [actionId]: {
              status: "failed",
              message: "No Privy session — sign in with a Fluent ID first.",
            },
          }));
          return;
        }
        const result = await preview({ accessToken, calls: callsFor(actionId) });
        setVerdicts((current) => ({ ...current, [actionId]: result }));
        if (result.status === "ok") {
          setProfile({
            segments: result.decision.segments ?? [],
            balanceWei: result.decision.balance_wei,
          });
        }
      } finally {
        setDryBusy(null);
      }
    },
    [callsFor, getAccessToken],
  );

  async function send(actionId: BenchActionId) {
    const action = BENCH_ACTIONS.find((candidate) => candidate.id === actionId);
    if (!action || !account) return;
    setBusyAction(actionId);
    setOutcomes((current) => ({ ...current, [actionId]: { requested: "ETH" } }));

    // Explicit ETH on every send. Omitting `gasPayment` inherits the widget's own selector,
    // which defaults to BLEND — routed through the ERC-20 paymaster, where the sponsorship
    // rules are never consulted. The widget's own `sponsored` flag is ignored: the payer is
    // derived from what the EntryPoint recorded on the settled operation.
    const gasPayment: FluentGasPayment = { symbol: "ETH" };
    try {
      const op = widget.createBatchOp({
        id: `sponsorship-demo-${action.id}`,
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
      const { hash, paymaster } = await op.execute({ gasPayment });
      setOutcomes((current) => ({
        ...current,
        [actionId]: {
          requested: "ETH",
          hash,
          paymaster,
          payer: classifyPayer(paymaster, erc20Paymaster),
        },
      }));
    } catch (error) {
      setOutcomes((current) => ({
        ...current,
        [actionId]: {
          requested: "ETH",
          error: error instanceof Error ? error.message : "send failed",
        },
      }));
    } finally {
      setBusyAction(null);
    }
  }

  const canSend = Boolean(account && widget.account.executionReady);
  const hasSender = Boolean(signedInDid);

  const balance = formatWei(profile?.balanceWei);

  const identityParts: { text: string; shrink: boolean }[] = [
    ...(xHandle ? [{ text: `@${xHandle}`, shrink: false }] : []),
    { text: signedInDid ?? "not signed in", shrink: Boolean(signedInDid) },
    ...(account ? [{ text: account, shrink: true }] : []),
    { text: SPONSORSHIP_URL.replace(/^https?:\/\//, ""), shrink: false },
  ];
  const identity = identityParts.map((part) => part.text).join(" · ");

  return (
    <section className="bench">
      <header className="bench-header">
        <div className="eyebrow">Fluent Connect SDK · Real partner budget</div>
        <h1>Sponsorship demo</h1>
        {/* Truncates rather than wraps, so the address stays one comparable string. */}
        <p className="mono identity-line" title={identity}>
          {identityParts.map((part) => (
            <span key={part.text} className={part.shrink ? "identity-shrink" : undefined}>
              {part.text}
            </span>
          ))}
        </p>
      </header>

      <p className="context">
        <span>
          Two actions, two rules. <strong>Dry-run</strong> asks the sponsorship service what it
          would decide — nothing moves. <strong>Send</strong> submits a real operation, and the
          badge reports who actually paid, read off the settled receipt.
        </span>
        {hasSender ? (
          <span>
            Signed in as {xHandle ? <strong>@{xHandle}</strong> : "a Fluent ID"} — segments:{" "}
            {profile ? (profile.segments.length > 0 ? profile.segments.join(", ") : "none") : "…"}
          </span>
        ) : null}
        {balance ? <span>Partner balance {balance}</span> : null}
      </p>

      {hasSender ? null : (
        <p className="hint">
          Dry-run needs a Fluent ID sign-in: the service identifies you by your Privy token.
          An external wallet can Send, but it pays its own gas — sponsorship covers smart
          accounts only.
        </p>
      )}

      <ul className="rows">
        {BENCH_ACTIONS.map((action) => (
          <ActionRow
            key={action.id}
            action={action}
            account={account}
            verdict={verdicts[action.id]}
            onDryRun={() => void dryRun(action.id)}
            dryRunning={dryBusy === action.id}
            canDryRun={hasSender && Boolean(account) && dryBusy === null}
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
    </section>
  );
}
