/**
 * @vitest-environment jsdom
 *
 * The Send page, the one widget flow with a fee selector, when its operation is refused because
 * the Gas token cannot cover the fee (FLU-1711): the page says what happened, offers paying the
 * fee in ETH, and choosing that makes ETH the fee of the next send.
 *
 * The form is mounted with the sender the widget gives it, `useTokenTransfer`, over the real
 * `createFluentBatchOp`, as `FluentWidgetContent` wires them. The executor's `sendCalls` is the
 * seam: behind it, `zerodevSession.gasTokenFee.test.ts` proves that a Gas token the account
 * cannot cover rejects with `FluentGasPaymentError` code `insufficient_gas_token`, and here it
 * rejects that way for the first send and resolves for the next.
 *
 * Fakes: the executor's `sendCalls`, as above; and `fetch`, which the fee estimate reaches and
 * which fails, so the estimate shows nothing and decides nothing.
 */
import {
  fluentTokenIdentity,
  type FluentDisplayToken,
  type FluentTokenBalance,
} from "@fluent.xyz/connect-sdk";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hash } from "viem";

import { FluentGasPaymentError } from "../core/zerodevPaymaster";
import {
  createFluentBatchOp,
  type FluentBatchApi,
  type FluentBatchOperationExecuteOptions,
} from "../widget/batchOperation";
import { useTokenTransfer } from "../widget/hooks/useTokenTransfer";
import { SendTokenForm } from "./SendTokenForm";

const SMART_ACCOUNT = "0x092AE7564C6611a114C20C6df766B5B35A52334A";
const RECIPIENT = "0x3333333333333333333333333333333333333333";
const TRANSACTION_HASH = `0x${"cc".repeat(32)}` as Hash;
const COPY = "Not enough USDnr to pay the network fee. Pay the fee in ETH or add USDnr.";

function display(definition: Omit<FluentDisplayToken, "source" | "identity">): FluentDisplayToken {
  return { ...definition, source: "default", identity: fluentTokenIdentity(definition) };
}

const ETH = display({ chainId: 20994, symbol: "ETH", name: "Ether", decimals: 18, native: true });
const USDNR = display({
  chainId: 20994,
  symbol: "USDnr",
  name: "USDnr",
  decimals: 6,
  address: "0x279a6DC6354374473f6f3CFB3999e6C2e146f8a1",
});

function balance(token: FluentDisplayToken, raw: bigint): FluentTokenBalance {
  return { ...token, raw, formatted: null, status: "ready" };
}

/** The `gasPayment` of every operation the executor was asked to send. */
let sentGasPayments: FluentBatchOperationExecuteOptions["gasPayment"][];
let sendCalls: ReturnType<typeof vi.fn>;

function SendPage() {
  // Safe: `useTokenTransfer` reaches only `createBatchOp` of the Widget API.
  const widget = {
    createBatchOp: (input: Parameters<FluentBatchApi["createBatchOp"]>[0]) =>
      createFluentBatchOp(input, {
        smartAccountReady: true,
        defaultSigningMode: "silent",
        sendCalls: sendCalls as never,
      }),
  } as unknown as FluentBatchApi;
  const onSend = useTokenTransfer({
    widget,
    track: () => {},
    beginTransfer: () => "pending",
    settleTransfer: () => {},
    endTransfer: () => {},
  });
  return (
    <SendTokenForm
      tokens={[ETH, USDNR]}
      balances={[balance(ETH, 10n ** 18n), balance(USDNR, 5_000_000n)]}
      balancesBusy={false}
      accountAddress={SMART_ACCOUNT}
      gasTokens={[ETH, USDNR]}
      defaultGasSymbol="USDnr"
      onSend={onSend}
      onSent={() => {}}
    />
  );
}

async function fillAndSend() {
  fireEvent.change(screen.getByLabelText("Recipient address"), { target: { value: RECIPIENT } });
  fireEvent.change(screen.getByLabelText("Amount of ETH to send"), { target: { value: "0.1" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Send ETH$/ }));
  });
}

beforeEach(() => {
  sentGasPayments = [];
  sendCalls = vi.fn(async (_calls: unknown, options: FluentBatchOperationExecuteOptions) => {
    sentGasPayments.push(options.gasPayment);
    if (options.gasPayment?.symbol === "USDnr") {
      throw new FluentGasPaymentError(
        "insufficient_gas_token" as never,
        "The paymaster could not charge the fee in USDnr: the balance does not cover it",
      );
    }
    return { hash: TRANSACTION_HASH, hashes: [TRANSACTION_HASH], atomic: true };
  });
  vi.stubGlobal("fetch", async () => {
    throw new Error("no network in tests");
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("criterion 6: the Send page's fee selector after insufficient_gas_token", () => {
  it("shows the copy and offers paying the fee in ETH", async () => {
    render(<SendPage />);

    await fillAndSend();

    expect(sentGasPayments.map((payment) => payment?.symbol)).toEqual(["USDnr"]);
    expect(screen.getAllByText(COPY).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /(pay|switch|use).*\bETH\b/i })).toBeTruthy();
  });

  it("selects ETH as the fee when the offer is chosen, and the next send pays in ETH", async () => {
    render(<SendPage />);
    await fillAndSend();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /(pay|switch|use).*\bETH\b/i }));
    });

    expect(screen.getByLabelText("Token the fee is paid in").textContent).toContain("ETH");
    expect(screen.getByLabelText("Token the fee is paid in").textContent).not.toContain("USDnr");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Send ETH$/ }));
    });
    expect(sentGasPayments.map((payment) => payment?.symbol)).toEqual(["USDnr", "ETH"]);
  });
});
