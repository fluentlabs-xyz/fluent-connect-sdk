// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { createContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SentBridgeDeposit } from "../bridge/historyRows";
import type { BridgeTxItem } from "../bridge/txHistory";
import { WalletMenuActivity, type FluentActivityState } from "./WalletMenuActivity";

// Fakes: `fetch` (the bridge indexer and the Hyperlane explorer), and wagmi
// 2.x's `useAccount` and `WagmiContext`, standing for a connected External wallet.

const wallet = "0x8077c0aa108b77a4c0848471b88f97f4fb8fa4df" as const;
const sentTxHash = "0xaaaa000000000000000000000000000000000000000000000000000000000001" as const;

vi.mock("wagmi", () => ({
  WagmiContext: createContext({}),
  useAccount: () => ({ address: wallet, isConnected: true }),
}));

const deposit: SentBridgeDeposit = {
  sentTxHash,
  sender: wallet,
  tokenSymbol: "ETH",
  amount: 10n ** 17n,
  decimals: 18,
  sentAt: new Date().toISOString(),
};

const relayed: BridgeTxItem = {
  amount: "100000000000000000",
  asset_type: "native",
  chain_id: "11155111",
  direction: "l1_to_l2",
  fee: "0",
  message_hash: "0x1111",
  nonce: "7",
  received_at: deposit.sentAt,
  received_tx_hash: "0xbbbb",
  recipient: "0x92b70edc8975e9cac4db54c75c136465817bb8c7",
  sender: wallet,
  sent_at: deposit.sentAt,
  sent_tx_hash: sentTxHash,
  status: "relayed",
  successful_call: true,
  token_symbol: "ETH",
  token_decimals: 18,
  transfer_type: "deposit",
  value: "100000000000000000",
};

const fluent: FluentActivityState = {
  entries: [],
  busy: false,
  loadingMore: false,
  hasMore: false,
  loadMore: () => {},
  error: null,
};

function serve(indexerItems: BridgeTxItem[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = String(url).includes("/indexer/v1/transactions")
        ? {
            has_more: false,
            limit: 10,
            offset: 0,
            l1_required_confirmations: 0,
            l2_required_confirmations: 0,
            items: indexerItems,
          }
        : { data: { message_view: [] } };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

function renderActivity() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <WalletMenuActivity
        network="testnet"
        fluent={fluent}
        sentDeposits={[deposit]}
        onOpenBridgeRow={() => {}}
        onOpenFluentEntry={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WalletMenuActivity with a Deposit signed on the Bridge page", () => {
  it("lists the Deposit as pending before the indexer has it", async () => {
    serve([]);
    renderActivity();

    const row = (await screen.findByText("Bridge deposit")).closest("li")!;
    expect(within(row).getByText("Pending")).toBeTruthy();
  });

  it("shows the indexer's row in its place once the indexer lists it", async () => {
    serve([relayed]);
    renderActivity();

    await waitFor(() => {
      expect(screen.getAllByText("Bridge deposit")).toHaveLength(1);
      expect(screen.queryByText("Pending")).toBeNull();
    });
  });
});
