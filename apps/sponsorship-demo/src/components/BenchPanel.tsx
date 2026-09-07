import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  readFluentTokenBalances,
  type FluentBatchApi,
  type FluentGasPayment,
  type FluentTokenBalance,
  type FluentWidgetSession,
} from "@fluent.xyz/connect";
import type { Address } from "viem";

import { preview, selectorOf } from "../bench/decide";
import {
  resolveErc20PaymasterAddress,
  type Erc20PaymasterState,
} from "../bench/erc20Paymaster";
import { describeApproval, dryRunAvailability, gasOptionAvailability } from "../bench/gasOption";
import { appendEvent, upsertEvent, type RowEvent } from "../bench/rowEvent";
import { describeWallet } from "../bench/walletInfo";
import { publicClient } from "../chain";
import {
  approveAmountFor,
  BENCH_ACTIONS,
  EXPLORER_BASE_URL,
  GAS_OPTIONS,
  GAS_TOKENS,
  gasLabelFor,
  gasOptionFor,
  type GasOptionId,
  SPONSORSHIP_URL,
  type BenchActionId,
} from "../consts";
import { ActionRow } from "./ActionRow";
import { GasPanel } from "./GasPanel";
import { classifyPayer } from "./PayerBadge";

export function BenchPanel({
  session,
  widget,
  getAuthToken,
}: {
  session: FluentWidgetSession | null;
  widget: FluentBatchApi;
  /** The SDK's one call to the service's auth exchange — the only source of a Fluent ID. */
  getAuthToken: () => Promise<string>;
}) {
  const signedInDid = session?.user?.id;
  const [fluentToken, setFluentToken] = useState<string | undefined>(undefined);
  const [fluentTokenStatus, setFluentTokenStatus] = useState<"idle" | "loading" | "error">("idle");
  const [fluentTokenError, setFluentTokenError] = useState<string | undefined>(undefined);
  const account = (widget.account.address ?? session?.wallet.smartAccountAddress) as
    | Address
    | undefined;
  const { getAccessToken, user } = usePrivy();
  const xHandle = user?.twitter?.username ?? null;

  // Everything that has happened, per action, newest first. One list rather than a verdict
  // slot and an outcome slot: with the gas token chosen once for the page, this log is the
  // only place a sponsored send and a token send can be seen side by side, which is the
  // comparison the page exists to make.
  const [events, setEvents] = useState<Partial<Record<BenchActionId, RowEvent[]>>>({});
  const recordEvent = useCallback(
    (actionId: BenchActionId, event: RowEvent, replace = false) => {
      setEvents((current) => ({
        ...current,
        [actionId]: replace
          ? upsertEvent(current[actionId] ?? [], event)
          : appendEvent(current[actionId] ?? [], event),
      }));
    },
    [],
  );
  // Segments, learned from a silent preview at sign-in so the reader
  // sees who they are before pressing anything. Refreshed by every explicit dry-run.
  const [profile, setProfile] = useState<{ segments: string[] } | null>(null);
  const [dryBusy, setDryBusy] = useState<BenchActionId | null>(null);
  const [busyAction, setBusyAction] = useState<BenchActionId | null>(null);
  // Who pays, chosen once for the page, and sponsored to begin with — that is the path
  // this demo exists to show, and it is the one a visitor should see working first.
  //
  // Deliberately NOT seeded from `widget.gasPayment`: the account menu has a gas selector of
  // its own that defaults to BLEND, so seeding from it opened the page already paying in
  // tokens with nothing on screen saying so. That selector is ignored here — every send
  // pins `gasPayment` from this one.
  const [gasId, setGasId] = useState<GasOptionId>("sponsored");

  // Who the ERC-20 paymaster is, asked of the SDK. The badge needs it to name the payer of
  // a settled operation, and the token buttons need it before they can be offered — so the
  // failure is kept as a state with its error in it, not flattened to an absent address. A
  // token button that is off has to be able to say why.
  const [erc20Paymaster, setErc20Paymaster] = useState<Erc20PaymasterState>({
    status: "resolving",
  });
  // Re-asked on demand, not once per page: the resolver deliberately does not cache a
  // failure, so a paymaster that was down when the page loaded can still answer. Without a
  // way to ask again that deliberate choice buys the visitor nothing.
  const [paymasterAttempt, setPaymasterAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setErc20Paymaster({ status: "resolving" });
    resolveErc20PaymasterAddress()
      .then((address) => {
        if (live) setErc20Paymaster({ status: "ready", address });
      })
      .catch((error: unknown) => {
        if (!live) return;
        setErc20Paymaster({
          status: "unreachable",
          error: error instanceof Error ? error.message : "no response",
        });
      });
    return () => {
      live = false;
    };
  }, [paymasterAttempt]);

  // Gas-token balances, read directly rather than taken from the widget: a token-paid send
  // with an empty balance fails inside the bundler as an opaque paymaster rejection, and
  // this page exists to state a precondition before it becomes an error. Re-read after each
  // send, because a send is the one thing that changes them.
  // `undefined` while the read is in flight, `null` when it failed — the two are different
  // sentences on screen, and neither of them is an empty balance.
  const [balances, setBalances] = useState<FluentTokenBalance[] | null | undefined>(undefined);
  const [balanceRevision, setBalanceRevision] = useState(0);
  useEffect(() => {
    if (!account) {
      setBalances(undefined);
      return;
    }
    let live = true;
    readFluentTokenBalances({ client: publicClient, account, tokens: GAS_TOKENS })
      .then((next) => {
        if (live) setBalances(next);
      })
      .catch(() => {
        // An unread balance is not an empty one, and the availability check words the two
        // differently — so record the failure rather than dropping to an empty list, which
        // would read as "you hold nothing".
        if (live) setBalances(null);
      });
    return () => {
      live = false;
    };
  }, [account, balanceRevision]);

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
        setProfile({ segments: result.decision.segments ?? [] });
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
          recordEvent(actionId, {
            kind: "dry-run",
            at: Date.now(),
            result: {
              status: "failed",
              message: "No Privy session — sign in with a Fluent ID first.",
            },
          });
          return;
        }
        const result = await preview({ accessToken, calls: callsFor(actionId) });
        recordEvent(actionId, { kind: "dry-run", at: Date.now(), result });
        if (result.status === "ok") {
          setProfile({ segments: result.decision.segments ?? [] });
        }
      } finally {
        setDryBusy(null);
      }
    },
    [callsFor, getAccessToken, recordEvent],
  );

  async function send(actionId: BenchActionId) {
    const action = BENCH_ACTIONS.find((candidate) => candidate.id === actionId);
    if (!action || !account) return;
    const option = gasOptionFor(gasId);
    setBusyAction(actionId);
    // Entered before it settles and updated in place afterwards, keyed by the moment it
    // started: a reader watching a send should see the line they are watching change, not
    // a second line appear beneath it.
    const at = Date.now();
    recordEvent(actionId, { kind: "send", at, requested: gasId, outcome: { requested: gasId } });

    // The gas token is always explicit, never inherited. Omitting `gasPayment` would take
    // the widget's own selector, which defaults to BLEND — so a button labelled "Send"
    // would quietly route around the sponsorship rules. The widget's `sponsored` flag is
    // ignored either way: the payer is derived from what the EntryPoint recorded on the
    // settled operation.
    //
    // A token send carries its own approval. The paymaster can only take its fee from an
    // allowance it has, and the widget prepends that call inside the send.
    const gasPayment: FluentGasPayment = option.token
      ? {
          symbol: option.symbol,
          includeApproval: true,
          approveAmount: approveAmountFor(option.token),
        }
      : { symbol: option.symbol, sponsorship: option.sponsorship };
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
      recordEvent(
        actionId,
        {
          kind: "send",
          at,
          requested: gasId,
          outcome: {
            requested: gasId,
            hash,
            paymaster,
            payer: classifyPayer(paymaster, erc20Paymaster.address),
          },
        },
        true,
      );
      // A settled send moved tokens — the balance behind the next click is a different one.
      setBalanceRevision((current) => current + 1);
    } catch (error) {
      recordEvent(
        actionId,
        {
          kind: "send",
          at,
          requested: gasId,
          outcome: {
            requested: gasId,
            error: error instanceof Error ? error.message : "send failed",
          },
        },
        true,
      );
    } finally {
      setBusyAction(null);
    }
  }

  const canSend = Boolean(account && widget.account.executionReady);
  const hasSender = Boolean(signedInDid);

  // One availability verdict per way of paying, shared by every row: what stops a token
  // send — the paymaster, the balance, the account kind — is a property of the account and
  // the network, never of which action was chosen.
  const gasChoices = useMemo(
    () =>
      GAS_OPTIONS.map((option) => {
        const token = option.token;
        // Looked up once and shared by the label and the verdict. Written twice, the two
        // disagreed: only one of them treated `balances === null` — the read failed — as an
        // error, so a chip could carry a reason its own label contradicted.
        const balance = token
          ? balances === null
            ? { status: "error" as const, raw: null }
            : balances?.find((item) => item.symbol === token.symbol)
          : undefined;
        return {
          option,
          // The label shows a number only when there is one to show; a failed read has none.
          balance: balance && "formatted" in balance ? balance : undefined,
          availability: gasOptionAvailability({
            symbol: option.symbol,
            executionReady: canSend,
            erc20Gas: widget.account.capabilities.erc20Gas,
            paymaster: erc20Paymaster,
            gasTokenAddress: token?.address,
            balance,
          }),
        };
      }),
    [balances, canSend, erc20Paymaster, widget.account.capabilities.erc20Gas],
  );

  // Only for the token that is actually selected: an approve the reader cannot trigger is
  // one more thing to read past.
  const selectedOption = gasOptionFor(gasId);
  const dryRunApplies = dryRunAvailability(gasId);
  const approval = selectedOption.token
    ? describeApproval({
        tokenAddress: selectedOption.token.address,
        spender: erc20Paymaster.address,
        approveAmount: approveAmountFor(selectedOption.token),
        decimals: selectedOption.token.decimals,
        symbol: selectedOption.symbol,
      })
    : null;

  // When nothing can be sent at all, every option carries the same reason. Say it once.
  const blockedForEveryone = canSend
    ? undefined
    : widget.account.executionError ??
      "Sign in and wait for the widget to prepare the smart account.";

  const accountType = widget.account.type;

  /*
   * Which account the Fluent ID in state belongs to. A ref rather than state: it must be
   * readable inside the effect below without becoming a reason for it to run again.
   */
  const accountKey = `${accountType ?? "none"}:${widget.account.address ?? ""}`;
  const fluentTokenFetchedFor = useRef<string | null>(null);

  /*
   * Fetched, never inferred: `getAuthToken()` is what actually calls `/auth/exchange/*`, and
   * its `sub` is the Fluent ID. Pressed rather than automatic for an external wallet, whose
   * exchange opens a signature prompt — a demo page must not raise a wallet dialog on load.
   */
  const requestFluentToken = useCallback(async () => {
    fluentTokenFetchedFor.current = accountKey;
    setFluentTokenStatus("loading");
    setFluentTokenError(undefined);
    try {
      setFluentToken(await getAuthToken());
      setFluentTokenStatus("idle");
    } catch (err) {
      setFluentTokenError(err instanceof Error ? err.message : "Fluent token exchange failed");
      setFluentTokenStatus("error");
    }
  }, [accountKey, getAuthToken]);

  /*
   * One effect, not two. A separate "clear on account change" effect ran on the first commit
   * as well and reset the fetch that had just started, so a single sign-in exchanged twice.
   * The ref is what distinguishes "a different account" from "the same account, rendering
   * again" — which is the distinction an effect's dependency list cannot make.
   *
   * A smart account exchanges two Privy tokens with no prompt, so its row fills itself in;
   * an external wallet waits for the press.
   */
  useEffect(() => {
    if (fluentTokenFetchedFor.current === accountKey) return;
    setFluentToken(undefined);
    setFluentTokenStatus("idle");
    setFluentTokenError(undefined);
    if (accountType === "smart") void requestFluentToken();
  }, [accountKey, accountType, requestFluentToken]);

  const walletFacts = describeWallet({
    accountType,
    address: widget.account.address ?? (account as Address | undefined),
    signerAddress: widget.account.signerAddress,
    fluentToken,
    fluentTokenStatus,
    fluentTokenError,
    privyDid: signedInDid,
    xHandle,
    segments: profile?.segments,
    sponsorshipHost: SPONSORSHIP_URL.replace(/^https?:\/\//, ""),
  });

  return (
    <section className="bench">
      <header className="bench-header">
        <div className="eyebrow">Fluent Connect SDK · Real partner budget</div>
        <h1>Sponsorship demo</h1>
        {/*
          * One row per fact, label left, so the eye runs down a single column of values and
          * two sign-ins can be compared line by line.
          */}
        <dl className="wallet-info">
          {walletFacts.map((fact) => (
            <div key={fact.label} className="wallet-info-row">
              <dt>{fact.label}</dt>
              <dd>
                <span className="mono wallet-info-value" title={fact.value}>
                  {fact.address ? (
                    <a
                      href={`${EXPLORER_BASE_URL}/address/${fact.value}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {fact.value}
                    </a>
                  ) : (
                    fact.value
                  )}
                </span>
                <span className="wallet-info-note">{fact.note}</span>
                {fact.obtainable ? (
                  <button type="button" className="link-button" onClick={requestFluentToken}>
                    Get one
                  </button>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <p className="context">
        <strong>Dry-run</strong> asks the service what it would decide — nothing moves.{" "}
        <strong>Send</strong> submits a real operation; the badge names who actually paid,
        read off the settled receipt.
      </p>

      {hasSender ? null : (
        <p className="hint">
          Dry-run needs a Fluent ID sign-in: the service identifies you by your Privy token.
          An external wallet can Send, but it pays its own gas — sponsorship covers smart
          accounts only.
        </p>
      )}

      <GasPanel
        choices={gasChoices}
        selected={gasId}
        accountType={widget.account.type}
        dryRunReason={dryRunApplies.reason}
        onSelect={setGasId}
        approval={approval}
        blockedForEveryone={blockedForEveryone}
        onRetryPaymaster={
          erc20Paymaster.status === "unreachable"
            ? () => setPaymasterAttempt((current) => current + 1)
            : undefined
        }
      />

      <ul className="rows">
        {BENCH_ACTIONS.map((action) => (
          <ActionRow
            key={action.id}
            action={action}
            account={account}
            events={events[action.id] ?? []}
            onDryRun={() => void dryRun(action.id)}
            dryRunning={dryBusy === action.id}
            canDryRun={
              hasSender && Boolean(account) && dryBusy === null && dryRunApplies.enabled
            }
            dryRunReason={dryRunApplies.reason}
            onSend={() => void send(action.id)}
            sending={busyAction === action.id}
            canSend={canSend && busyAction === null}
            sendLabel={`Send · ${gasLabelFor(gasId)}`}
          />
        ))}
      </ul>

    </section>
  );
}
