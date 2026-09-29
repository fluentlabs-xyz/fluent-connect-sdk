import { BridgeActivityDetail } from "@fluent.xyz/connect/internal/bridge/BridgeActivityDetail";
import { HistoryRow } from "@fluent.xyz/connect/internal/bridge/BridgeHistory";
import {
  groupRowsByDay,
  type BridgeActivitySelection,
  type BridgeHistoryRow,
} from "@fluent.xyz/connect/internal/bridge/historyRows";
import { WIDGET_STYLE_SCOPE } from "@fluent.xyz/connect/internal/portalContainer";
import { useState, type ReactNode } from "react";

// The wallet the fabricated transfers were listed for.
const account = "0x8077c0aa108b77a4c0848471b88f97f4fb8fa4df";

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

const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function PreviewCard({ title, note, children }: { title: string; note: string; children: ReactNode }) {
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
  const [open, setOpen] = useState<BridgeActivitySelection>({ row: rows[0]!, account });

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(384px,100%),1fr))] items-start gap-5">
      <PreviewCard title="Activity — list" note="Grouped per day. Tap a row to open it on the right.">
        {groupRowsByDay(rows).map((group) => (
          <div key={group.day.getTime()} className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">{dayFormat.format(group.day)}</span>
            <ul className="flex flex-col gap-1">
              {group.rows.map((row) => (
                <HistoryRow key={row.id} row={row} onOpen={() => setOpen({ row, account })} />
              ))}
            </ul>
          </div>
        ))}
      </PreviewCard>

      <PreviewCard title="Activity — detail" note="The `activity` sub-page for the tapped row; the drawer adds Back and the title.">
        <BridgeActivityDetail selection={open} network="testnet" track={() => {}} />
      </PreviewCard>
    </div>
  );
}
