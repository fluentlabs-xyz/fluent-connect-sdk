import { BridgeActivityDetail } from "@fluent.xyz/connect/internal/bridge/BridgeActivityDetail";
import {
  type BridgeActivitySelection,
  type BridgeHistoryRow,
} from "@fluent.xyz/connect/internal/bridge/historyRows";
import { WIDGET_STYLE_SCOPE } from "@fluent.xyz/connect/internal/portalContainer";
import type { FluentTransactionHistoryEntry } from "@fluent.xyz/connect/internal/transactionHistory";
import {
  FluentActivityDetail,
  type FluentActivitySelection,
} from "@fluent.xyz/connect/internal/FluentActivityDetail";
import { WalletMenuActivityList } from "@fluent.xyz/connect/internal/WalletMenuActivity";
import { useState, type ReactNode } from "react";

// The External wallet the fabricated transfers were listed for, and the Fluent
// account whose transactions sit beside them.
const account = "0x8077c0aa108b77a4c0848471b88f97f4fb8fa4df";
const fluentAccount = "0x92b70EDC8975E9Cac4dB54C75c136465817Bb8C7" as const;

const hash = (seed: string) => `0x${seed.repeat(64 / seed.length)}` as `0x${string}`;

/** Two days, three tokens, every status, and one withdrawal for the Fluent badge. */
const rows: BridgeHistoryRow[] = [
  {
    id: "1",
    source: "indexer",
    sentAt: "2026-09-25T11:28:00Z",
    status: "completed",
    direction: "l1_to_l2",
    sentTxHash: hash("d674a1"),
    receivedTxHash: hash("9f3c"),
    tokenSymbol: "ETH",
    amount: 1_000_000_000_000_000n,
    decimals: 18,
  },
  {
    id: "2",
    source: "hyperlane",
    sentAt: "2026-09-24T15:02:00Z",
    status: "pending",
    direction: "l1_to_l2",
    sentTxHash: hash("8976c2"),
    tokenSymbol: "USDnr",
    amount: 250_000_000n,
    decimals: 6,
  },
  {
    id: "3",
    source: "indexer",
    sentAt: "2026-09-24T09:10:00Z",
    status: "failed",
    direction: "l2_to_l1",
    sentTxHash: hash("4cd0"),
    tokenSymbol: "BLEND",
    amount: 12_500_000_000_000_000_000n,
    decimals: 18,
  },
];

/** The Fluent account's side, interleaved with the transfers above: a receipt,
 *  the widget's own send (a user operation with one outgoing movement), a
 *  failed send and a swap — an operation that moved two tokens. */
const fluentEntries: FluentTransactionHistoryEntry[] = [
  {
    kind: "movement",
    id: "f1",
    status: "confirmed",
    timestamp: Date.parse("2026-09-25T11:31:00Z"),
    hash: hash("a1b2"),
    direction: "received",
    tokenIdentity: "eth",
    symbol: "ETH",
    amount: "0.001",
    counterparty: "0x9CAcf613fC29015893728563f423fD26dCdB8Ddc",
  },
  {
    kind: "operation",
    id: "f4",
    status: "confirmed",
    timestamp: Date.parse("2026-09-25T10:05:00Z"),
    hash: hash("7a7b"),
    transactionHash: hash("8c8d"),
    movements: [
      {
        kind: "movement",
        id: "f4a",
        status: "confirmed",
        timestamp: Date.parse("2026-09-25T10:05:00Z"),
        hash: hash("8c8d"),
        direction: "sent",
        tokenIdentity: "usdnr",
        symbol: "USDnr",
        amount: "40",
        counterparty: "0xdC9BF18a1c307ce1A84e2775C7645e57eB373CD4",
      },
    ],
  },
  {
    kind: "operation",
    id: "f2",
    status: "confirmed",
    timestamp: Date.parse("2026-09-25T08:12:00Z"),
    hash: hash("c3d4"),
    transactionHash: hash("e5f6"),
    movements: [
      {
        kind: "movement",
        id: "f2a",
        status: "confirmed",
        timestamp: Date.parse("2026-09-25T08:12:00Z"),
        hash: hash("e5f6"),
        direction: "sent",
        tokenIdentity: "blend",
        symbol: "BLEND",
        amount: "1",
        counterparty: "0x1ccF23916C572379630b067e9a0CbBddb56C5e72",
      },
      {
        kind: "movement",
        id: "f2b",
        status: "confirmed",
        timestamp: Date.parse("2026-09-25T08:12:00Z"),
        hash: hash("e5f6"),
        direction: "received",
        tokenIdentity: "usdnr",
        symbol: "USDnr",
        amount: "250",
        counterparty: "0x1ccF23916C572379630b067e9a0CbBddb56C5e72",
      },
    ],
  },
  {
    kind: "movement",
    id: "f3",
    status: "failed",
    timestamp: Date.parse("2026-09-24T12:40:00Z"),
    hash: hash("0a0b"),
    direction: "sent",
    tokenIdentity: "usdnr",
    symbol: "USDnr",
    amount: "40",
    counterparty: "0xdC9BF18a1c307ce1A84e2775C7645e57eB373CD4",
  },
];

export function PreviewCard({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-white/10 bg-neutral-950">
      <header className="flex flex-col gap-1.5 border-b border-white/10 px-5 py-4">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-xs leading-relaxed text-white/40">{note}</p>
      </header>
      {/* The widget's reset and colour tokens are scoped to `.fluent-root`, which
          only the drawer provides in the live widget — so the card supplies it,
          with the same padding DrawerContent gives the wallet menu. */}
      <div className={WIDGET_STYLE_SCOPE}>
        <div className="flex flex-col gap-3 bg-black p-4">{children}</div>
      </div>
    </section>
  );
}

/**
 * The Activity list and its detail page with fabricated transfers. The live
 * list needs a connected external wallet and two indexers, so this is the only
 * way to see either without one.
 */
export function ActivityPreview() {
  const [open, setOpen] = useState<
    { kind: "bridge"; selection: BridgeActivitySelection } | { kind: "fluent"; selection: FluentActivitySelection }
  >({ kind: "bridge", selection: { row: rows[0]!, account } });

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(384px,100%),1fr))] items-start gap-5">
      <PreviewCard
        title="Activity — list"
        note="Both accounts on one list, grouped per day: the Fluent account's transactions and the External wallet's bridge transfers, each row tagged with its account. Tap a transfer to open it on the right."
      >
        <WalletMenuActivityList
          fluent={{
            address: fluentAccount,
            label: "Fluent account",
            entries: fluentEntries,
            // A transfer the widget has sent and is still waiting on. Rendered
            // here because it is the one activity row with no on-chain record
            // to fabricate from — it exists only while a send is in flight.
            pending: [
              {
                id: "preview-pending",
                symbol: "BLEND",
                amount: "12.5",
                to: "0xdC9BF18a1c307ce1A84e2775C7645e57eB373CD4",
                startedAt: Date.now(),
              },
            ],
            busy: false,
            loadingMore: false,
            hasMore: false,
            loadMore: () => {},
            error: null,
          }}
          bridge={{
            address: account,
            rows,
            pending: false,
            error: null,
            hyperlaneError: false,
            hasNextPage: true,
            isFetchingNextPage: false,
            fetchNextPage: () => {},
          }}
          onOpenBridgeRow={(selection) => setOpen({ kind: "bridge", selection })}
          onOpenFluentEntry={(entry) =>
            setOpen({ kind: "fluent", selection: { entry, account: fluentAccount } })
          }
        />
      </PreviewCard>

      <PreviewCard title="Activity — detail" note="The `activity` sub-page for the tapped row; the drawer adds Back and the title.">
        {open.kind === "bridge" ? (
          <BridgeActivityDetail selection={open.selection} network="testnet" track={() => {}} />
        ) : (
          <FluentActivityDetail selection={open.selection} network="testnet" track={() => {}} />
        )}
      </PreviewCard>
    </div>
  );
}
