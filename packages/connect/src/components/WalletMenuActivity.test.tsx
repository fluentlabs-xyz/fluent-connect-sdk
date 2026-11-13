/**
 * @vitest-environment jsdom
 *
 * The Activity list's ghost while its sources load: the day groups and ghost rows it draws in
 * the shape of the account's last loaded list, the widget's own transfers in flight above them,
 * and which ghost elements keep their DOM when the account or the transfers in flight change.
 * Rendered without wagmi, so the list has no bridge rows. No fakes.
 */
import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { FluentTransactionHistoryEntry } from "../core/transactionHistory";
import type { FluentPendingTransfer } from "../widget/tokenTransfer";
import { type FluentActivityState, WalletMenuActivity } from "./WalletMenuActivity";

const COUNTERPARTY = "0x00000000000000000000000000000000000000dd" as const;
const DAY_ONE = new Date(2026, 10, 2, 12).getTime();
const DAY_TWO = new Date(2026, 10, 3, 12).getTime();

function received(id: string, timestamp: number): FluentTransactionHistoryEntry {
  return {
    kind: "movement",
    id,
    hash: `0x${id.padStart(64, "0")}`,
    direction: "received",
    status: "confirmed",
    tokenIdentity: "20994:native",
    symbol: "ETH",
    amount: "0.1",
    counterparty: COUNTERPARTY,
    timestamp,
  };
}

const IN_FLIGHT: FluentPendingTransfer = {
  id: "send-1",
  tokenIdentity: "20994:native",
  symbol: "ETH",
  amount: "0.05",
  to: COUNTERPARTY,
  startedAt: DAY_TWO,
};

function state(
  address: `0x${string}`,
  fields: Partial<FluentActivityState> = {},
): FluentActivityState {
  return {
    address,
    entries: [],
    busy: false,
    loadingMore: false,
    hasMore: false,
    loadMore: () => {},
    error: null,
    ...fields,
  };
}

function renderActivity(fluent: FluentActivityState) {
  const view = render(
    <StrictMode>
      <WalletMenuActivity
        network="testnet"
        fluent={fluent}
        onOpenBridgeRow={() => {}}
        onOpenFluentEntry={() => {}}
      />
    </StrictMode>,
  );
  const rerender = (next: FluentActivityState) =>
    view.rerender(
      <StrictMode>
        <WalletMenuActivity
          network="testnet"
          fluent={next}
          onOpenBridgeRow={() => {}}
          onOpenFluentEntry={() => {}}
        />
      </StrictMode>,
    );
  return {
    rerender,
    /** The ghost's day groups, each a `role="status"` block. */
    groups: () => [
      ...view.container.querySelectorAll<HTMLElement>('[aria-busy="true"] > [role="status"]'),
    ],
    /** The ghost rows of one day group. */
    ghostRows: (group: HTMLElement | undefined) => [
      ...group!.querySelectorAll<HTMLElement>('li[aria-hidden="true"]'),
    ],
    /** The ghost's container, absent once the list has loaded. */
    ghost: () => view.container.querySelector('[aria-busy="true"]'),
  };
}

/** Three received entries, two on the later day and one on the earlier: a [2, 1] shape. */
const TWO_DAYS = [received("a1", DAY_TWO), received("a2", DAY_TWO - 1000), received("a3", DAY_ONE)];

afterEach(cleanup);

describe("WalletMenuActivity while its sources load", () => {
  it("draws one day of four ghost rows for an account it has never listed", () => {
    const view = renderActivity(
      state("0x00000000000000000000000000000000000000a0", { busy: true }),
    );

    expect(view.groups()).toHaveLength(1);
    expect(view.groups()[0]!.getAttribute("aria-label")).toBe("Loading activity");
    expect(view.ghostRows(view.groups()[0])).toHaveLength(4);
  });

  it("draws the ghost in the day groups of the account's last loaded list", () => {
    const account = "0x00000000000000000000000000000000000000a1" as const;
    const view = renderActivity(state(account, { entries: TWO_DAYS }));
    expect(view.ghost()).toBeNull();

    view.rerender(state(account, { entries: TWO_DAYS, busy: true }));

    const groups = view.groups();
    expect(groups.map((group) => view.ghostRows(group).length)).toEqual([2, 1]);
    expect(groups[1]!.getAttribute("aria-label")).toBeNull();
  });

  it("keeps every ghost element on an unrelated render", () => {
    const view = renderActivity(
      state("0x00000000000000000000000000000000000000a2", { busy: true }),
    );
    const [group] = view.groups();
    const rows = view.ghostRows(group);

    view.rerender(state("0x00000000000000000000000000000000000000a2", { busy: true }));

    const groups = view.groups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toBe(group);
    const next = view.ghostRows(group);
    expect(next).toHaveLength(4);
    expect(next[0]).toBe(rows[0]);
    expect(next[1]).toBe(rows[1]);
    expect(next[2]).toBe(rows[2]);
    expect(next[3]).toBe(rows[3]);
  });

  it("reuses the first day group's DOM when the account changes to one with fewer days", () => {
    const twoDays = "0x00000000000000000000000000000000000000a3" as const;
    const oneDay = "0x00000000000000000000000000000000000000a4" as const;
    const view = renderActivity(state(oneDay, { entries: [received("b1", DAY_TWO)] }));
    view.rerender(state(twoDays, { entries: TWO_DAYS }));
    view.rerender(state(twoDays, { entries: TWO_DAYS, busy: true }));
    const [first, second] = view.groups();

    view.rerender(state(oneDay, { busy: true }));

    // Pins current behaviour: day groups are keyed by position, so the first group's element is reused.
    const groups = view.groups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toBe(first);
    expect(view.ghostRows(first)).toHaveLength(1);
    expect(second!.isConnected).toBe(false);
  });

  it("puts a transfer in flight first and keeps the leading ghost rows' DOM", () => {
    const account = "0x00000000000000000000000000000000000000a5" as const;
    const view = renderActivity(state(account, { busy: true }));
    const [group] = view.groups();
    const [row0, row1, row2, row3] = view.ghostRows(group);

    view.rerender(state(account, { busy: true, pending: [IN_FLIGHT] }));

    const items = [...group!.querySelectorAll("ul > li")];
    expect(items).toHaveLength(4);
    expect(items[0]!.getAttribute("aria-hidden")).toBeNull();
    expect(items[0]!.textContent).toContain("ETH");
    // Pins current behaviour: ghost rows are keyed by position, so the first three keep their elements and the last goes.
    const rows = view.ghostRows(group);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe(row0);
    expect(rows[1]).toBe(row1);
    expect(rows[2]).toBe(row2);
    expect(row3!.isConnected).toBe(false);
  });

  it("drops the leading ghost row again when the transfer in flight is no longer listed", () => {
    const account = "0x00000000000000000000000000000000000000a6" as const;
    const view = renderActivity(state(account, { busy: true, pending: [IN_FLIGHT] }));
    const [group] = view.groups();
    const [row0, row1, row2] = view.ghostRows(group);

    view.rerender(state(account, { busy: true, pending: [{ ...IN_FLIGHT, expired: true }] }));

    const rows = view.ghostRows(group);
    expect(rows).toHaveLength(4);
    // Pins current behaviour: ghost rows are keyed by position, so the three kept rows stay and a fourth is appended.
    expect(rows[0]).toBe(row0);
    expect(rows[1]).toBe(row1);
    expect(rows[2]).toBe(row2);
  });
});
