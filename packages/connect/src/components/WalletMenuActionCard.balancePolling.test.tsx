/**
 * @vitest-environment jsdom
 *
 * The token list keeps itself current while the wallet menu is on screen: a
 * transfer that arrives from outside the widget gives it no signal, so the
 * card reads the balances again on a schedule, and quietly, with no loading
 * state between reads. The card is mounted for real, because the schedule and
 * the quiet are both things only the mounted card shows.
 *
 * Fakes: `fetch`, answering the Fluent RPC's `eth_getBalance` and `eth_call`
 * from a balance the test moves, and refusing everything else, the price feeds
 * among them.
 */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { numberToHex, parseEther } from "viem";

import { WalletMenuActionCard } from "./WalletMenuActionCard";
import type { FluentWidgetConfig } from "../core/config";
import { clearFluentTokenUsdPriceCache } from "../core/tokenPrices";
import { FLUENT_BALANCE_POLL_INTERVAL_MS } from "../hooks/useFluentTokenBalances";

const CONFIG: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  reputationEnabled: false,
  disableAnalytics: true,
};

const SMART_ACCOUNT = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;

/** The chain as the fake RPC sees it: one native balance, every ERC-20 balance zero. */
const chain = { nativeBalance: parseEther("1234"), reads: 0 };
/** How often the price feeds were asked: a balance read must never be one of these. */
const priceRequests = () =>
  vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("coinbase")).length;

type RpcCall = { id: number; method: string };

function rpcAnswer(call: RpcCall) {
  if (call.method === "eth_getBalance") chain.reads += 1;
  const result =
    call.method === "eth_getBalance"
      ? numberToHex(chain.nativeBalance)
      : numberToHex(0n, { size: 32 });
  return { jsonrpc: "2.0", id: call.id, result };
}

function stubRpc() {
  return vi.fn(async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "null") as RpcCall | RpcCall[] | null;
    if (!body) return new Response("{}", { status: 404 });
    const payload = Array.isArray(body) ? body.map(rpcAnswer) : rpcAnswer(body);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function renderHome() {
  return render(
    <WalletMenuActionCard
      track={() => {}}
      session={null}
      faucetBusy={false}
      onFaucet={() => {}}
      config={CONFIG}
      gasPaymentToken="ETH"
      onGasPaymentTokenChange={() => {}}
      silentSigningEnabled={false}
      onSilentSigningChange={() => {}}
      onDisconnect={() => {}}
      onConnectWithX={() => {}}
      tab="home"
      onTabChange={() => {}}
      smartAccountAddress={SMART_ACCOUNT}
    />
  );
}

const tokenList = () => within(screen.getByLabelText("Token balances"));
const ethRow = () => tokenList().getByText("ETH").closest("[class*='rounded-xl']") as HTMLElement;

const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};
const elapse = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  chain.nativeBalance = parseEther("1234");
  chain.reads = 0;
  clearFluentTokenUsdPriceCache();
  vi.stubGlobal("fetch", stubRpc());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("WalletMenuActionCard balance polling", () => {
  it("reads the balances on mount, then again every poll interval", async () => {
    renderHome();
    await flush();
    // Mounting reads more than once (the Display tokens settle after the user's
    // own arrive), so the schedule is measured from here, not from zero.
    const onMount = chain.reads;
    expect(onMount).toBeGreaterThan(0);
    const feedsAskedForTheOpening = priceRequests();
    expect(feedsAskedForTheOpening).toBeGreaterThan(0);
    expect(ethRow().textContent).toContain("1,234");

    chain.nativeBalance = parseEther("5678");
    await elapse(FLUENT_BALANCE_POLL_INTERVAL_MS - 1);
    expect(chain.reads).toBe(onMount);
    expect(ethRow().textContent).toContain("1,234");

    await elapse(1);
    expect(chain.reads).toBe(onMount + 1);
    expect(ethRow().textContent).toContain("5,678");

    await elapse(FLUENT_BALANCE_POLL_INTERVAL_MS);
    expect(chain.reads).toBe(onMount + 2);
    // The feeds were asked for the opening, and the balance reads since asked nothing.
    expect(priceRequests()).toBe(feedsAskedForTheOpening);
  });

  it("shows no loading state during a scheduled read", async () => {
    renderHome();
    await flush();
    const onMount = chain.reads;

    // The answer is held back so the read stays in flight while the screen is looked at.
    let answer: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const rpc = stubRpc();
    vi.stubGlobal("fetch", async (url: unknown, init?: { body?: string }) => {
      await held;
      return rpc(url, init);
    });
    await elapse(FLUENT_BALANCE_POLL_INTERVAL_MS);

    expect(screen.queryByLabelText("Loading portfolio total")).toBeNull();
    expect(tokenList().queryByRole("status")).toBeNull();
    answer?.();
    await flush();
    expect(chain.reads).toBe(onMount + 1);
  });

  it("stops reading when the card leaves the screen", async () => {
    const { unmount } = renderHome();
    await flush();
    const onMount = chain.reads;
    unmount();

    await elapse(FLUENT_BALANCE_POLL_INTERVAL_MS * 3);
    expect(chain.reads).toBe(onMount);
  });
});
