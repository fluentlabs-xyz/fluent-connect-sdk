// @vitest-environment jsdom
/**
 * When `BenchPanel` asks the ERC-20 paymaster for its address and when it reads the Gas token
 * balances: the two effects keyed by `paymasterAttempt` and by `balanceRevision`.
 *
 * Fakes:
 * - `@privy-io/react-auth@2.25.0` `usePrivy`: nobody signed in to Privy;
 * - `fetch`, by URL: the ZeroDev paymaster's `zd_pm_accounts` as `@zerodev/sdk@5.5.10` sends it, and
 *   the chain's JSON-RPC as `viem@2.52.0` `http()` calls it;
 * - the widget's `FluentBatchApi` and `getAuthToken` props, as the widget hands them to a host;
 * - Node's `Request`, through `test/jsdomRequest.ts`: it takes jsdom's `AbortSignal`.
 */
// First: viem's `http()` builds a `Request` before any render reads the chain.
import "../../test/jsdomRequest";

import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeFunctionData,
  encodeAbiParameters,
  erc20Abi,
  getAddress,
  type Address,
  type Hash,
} from "viem";
import type { FluentBatchApi } from "@fluent.xyz/connect";

import { BLEND_ADDRESS } from "../consts";
import { BenchPanel } from "./BenchPanel";

vi.mock("@privy-io/react-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@privy-io/react-auth")>()),
  usePrivy: () => ({ getAccessToken: async () => null, user: null }),
}));

const ACCOUNT = getAddress("0x092ae7564c6611a114c20c6df766b5b35a52334a");
const OTHER_ACCOUNT = getAddress("0x3333333333333333333333333333333333333333");
const PAYMASTER = getAddress("0x5555555555555555555555555555555555555555");
const TRANSACTION_HASH = `0x${"cc".repeat(32)}` as Hash;

type RpcRequest = { url: string; method: string; params: unknown[] };

/** Every JSON-RPC request that left the page, and what the next ones answer. */
const network = {
  requests: [] as RpcRequest[],
  /** What `zd_pm_accounts` answers: an empty list names no paymaster. */
  paymasters: [] as Address[],
  /** `balanceOf` per holder, in the token's smallest unit. */
  balance: 5n * 10n ** 18n,
};

function balanceReads() {
  return network.requests.filter(
    (request) =>
      request.method === "eth_call" &&
      decodeFunctionData({
        abi: erc20Abi,
        data: (request.params[0] as { data: `0x${string}` }).data,
      }).functionName === "balanceOf",
  );
}

function paymasterLookups() {
  return network.requests.filter((request) => request.method === "zd_pm_accounts");
}

function holdersRead() {
  return balanceReads().map(
    (request) =>
      decodeFunctionData({
        abi: erc20Abi,
        data: (request.params[0] as { data: `0x${string}` }).data,
      }).args?.[0],
  );
}

beforeEach(() => {
  network.requests = [];
  network.paymasters = [];
  network.balance = 5n * 10n ** 18n;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params: unknown[];
      };
      network.requests.push({ url, method: body.method, params: body.params });
      const result =
        body.method === "zd_pm_accounts"
          ? network.paymasters
          : body.method === "eth_call"
            ? encodeAbiParameters([{ type: "uint256" }], [network.balance])
            : null;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function widgetFor(
  address: Address,
  execute: () => Promise<unknown> = async () => ({ hash: TRANSACTION_HASH, paymaster: PAYMASTER }),
) {
  const createBatchOp = vi.fn(() => ({ execute: vi.fn(execute) }));
  // Only the fields the panel reads: a smart account that is ready to send.
  const widget = {
    account: {
      address,
      type: "smart",
      executionReady: true,
      executionError: undefined,
      capabilities: { erc20Gas: true },
    },
    createBatchOp,
  } as unknown as FluentBatchApi;
  return { widget, createBatchOp };
}

function renderPanel(widget: FluentBatchApi, getAuthToken = async () => "auth-token") {
  const view = render(
    <StrictMode>
      <BenchPanel session={null} widget={widget} getAuthToken={getAuthToken} />
    </StrictMode>,
  );
  return {
    ...view,
    rerenderWith: (next: FluentBatchApi) =>
      view.rerender(
        <StrictMode>
          <BenchPanel session={null} widget={next} getAuthToken={getAuthToken} />
        </StrictMode>,
      ),
  };
}

const retryButton = () => screen.queryByRole("button", { name: "Ask the paymaster again" });

// The paymaster lookup keeps a resolved address for the life of the module, so this case runs
// first: once an address is known, no later render asks ZeroDev again.
describe("the ERC-20 paymaster lookup, keyed by the retry count", () => {
  it("asks ZeroDev once on mount, not on an unrelated render, and once more per retry", async () => {
    const { widget } = widgetFor(ACCOUNT);
    const view = renderPanel(widget);

    await waitFor(() => expect(retryButton()).not.toBeNull());
    // Pins current behaviour: StrictMode's second effect run shares the first run's lookup.
    expect(paymasterLookups()).toHaveLength(1);
    expect(paymasterLookups()[0]?.url).toContain("rpc.zerodev.app");

    view.rerenderWith(widget);
    await act(async () => {});
    expect(paymasterLookups()).toHaveLength(1);
    expect(retryButton()).not.toBeNull();

    network.paymasters = [PAYMASTER];
    const retry = retryButton();
    if (!retry) throw new Error("the retry button is gone");
    fireEvent.click(retry);

    await waitFor(() => expect(retryButton()).toBeNull());
    expect(paymasterLookups()).toHaveLength(2);

    view.rerenderWith(widget);
    await act(async () => {});
    expect(paymasterLookups()).toHaveLength(2);
  });
});

describe("the Gas token balances, keyed by the account and the balance revision", () => {
  it("reads once per effect run, again for a new account, and not on an unrelated render", async () => {
    const { widget } = widgetFor(ACCOUNT);
    const view = renderPanel(widget);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /BLEND/ }).textContent).toContain("5"),
    );
    // Pins current behaviour: StrictMode runs the effect twice on mount, so each token is read twice.
    expect(holdersRead()).toEqual([ACCOUNT, ACCOUNT, ACCOUNT, ACCOUNT]);
    expect(
      new Set(
        balanceReads().map((request) => (request.params[0] as { to: string }).to.toLowerCase()),
      ),
    ).toContain(BLEND_ADDRESS.toLowerCase());

    view.rerenderWith(widgetFor(ACCOUNT).widget);
    await act(async () => {});
    expect(balanceReads()).toHaveLength(4);

    network.balance = 7n * 10n ** 18n;
    view.rerenderWith(widgetFor(OTHER_ACCOUNT).widget);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /BLEND/ }).textContent).toContain("7"),
    );
    expect(holdersRead().slice(4)).toEqual([OTHER_ACCOUNT, OTHER_ACCOUNT]);
  });

  it("reads again for the same account after a send settles, and not after a send fails", async () => {
    const { widget, createBatchOp } = widgetFor(ACCOUNT);
    renderPanel(widget);
    await waitFor(() => expect(balanceReads()).toHaveLength(4));

    network.balance = 3n * 10n ** 18n;
    const transferRow = screen.getByText("Sponsored for anyone").closest("li");
    if (!transferRow) throw new Error("no transfer row");
    fireEvent.click(within(transferRow as HTMLElement).getByRole("button", { name: /^Send/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /BLEND/ }).textContent).toContain("3"),
    );
    expect(createBatchOp).toHaveBeenCalledTimes(1);
    expect(createBatchOp).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sponsorship-demo-transfer" }),
    );
    // Pins current behaviour: a settled send bumps the revision, so the same account is read again.
    expect(holdersRead().slice(4)).toEqual([ACCOUNT, ACCOUNT]);

    const failing = widgetFor(ACCOUNT, async () => {
      throw new Error("bundler refused");
    });
    cleanup();
    network.requests = [];
    renderPanel(failing.widget);
    await waitFor(() => expect(balanceReads()).toHaveLength(4));
    const row = screen.getByText("Sponsored for anyone").closest("li");
    if (!row) throw new Error("no transfer row");
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /^Send/ }));
    await waitFor(() => expect(screen.getByText(/bundler refused/)).not.toBeNull());
    expect(failing.createBatchOp).toHaveBeenCalledTimes(1);
    expect(balanceReads()).toHaveLength(4);
  });
});
