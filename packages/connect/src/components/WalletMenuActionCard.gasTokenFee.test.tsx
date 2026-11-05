/**
 * @vitest-environment jsdom
 *
 * A Send in Prompt mode refused because its Gas token cannot cover the fee (FLU-1711). The
 * Review replaces the Send page while the person confirms, so when `execute()` rejects with
 * `insufficient_gas_token` the Send page and its fee selector are gone. The failure toast is
 * then where the offer to pay the fee in ETH is made, and choosing it opens the Send page
 * again for the same transfer with ETH as the fee.
 *
 * The host below holds the Send page's retry as `FluentWidgetContent` does: the toast's offer
 * hands it the refused request, and it opens the card's Send tab with it as `sendRetry`.
 *
 * Fakes: the executor's `sendCalls`, which rejects a USDnr-paid operation as
 * `zerodevSession.gasTokenFee.test.ts` proves the real one does; the executor's `confirm`, the
 * Review, which the person confirms; `toast.add`, read for the failure toast's offer; and
 * `fetch`, which no test here may reach.
 */
import {
  fluentTokenIdentity,
  getFluentDefaultWidgetGasTokens,
  isFluentNativeToken,
  type FluentDisplayToken,
} from "@fluent.xyz/connect-sdk";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";

import type { FluentWidgetConfig } from "../core/config";
import { FluentGasPaymentError } from "../core/zerodevPaymaster";
import {
  createFluentBatchOp,
  type FluentBatchApi,
  type FluentBatchOperationExecuteOptions,
} from "../widget/batchOperation";
import { useTokenTransfer } from "../widget/hooks/useTokenTransfer";
import type { FluentTokenTransferRequest } from "../widget/tokenTransfer";
import { toast } from "./ui/toast";
import { WalletMenuActionCard } from "./WalletMenuActionCard";

const SMART_ACCOUNT = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;
const RECIPIENT = "0x3333333333333333333333333333333333333333" as Address;
const TRANSACTION_HASH = `0x${"cc".repeat(32)}` as Hash;
const COPY = "Not enough USDnr to pay the network fee. Pay the fee in ETH or add USDnr.";

const config: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
  reputationEnabled: false,
  disableAnalytics: true,
};

const ethDefinition = getFluentDefaultWidgetGasTokens("testnet").find(isFluentNativeToken)!;
const ETH: FluentDisplayToken = {
  ...ethDefinition,
  source: "default",
  identity: fluentTokenIdentity(ethDefinition),
};

type FluentTokenTransferSendRef = ReturnType<typeof useTokenTransfer>;
type ToastInput = Parameters<typeof toast.add>[0];
let toasts: ToastInput[];
let sentGasPayments: FluentBatchOperationExecuteOptions["gasPayment"][];
let sendCalls: ReturnType<typeof vi.fn>;

/** The widget's wiring of a Send, reduced to the parts this criterion crosses. */
function Host({ onRequest }: { onRequest: (send: FluentTokenTransferSendRef) => void }) {
  const [sendRetry, setSendRetry] = useState<{
    key: number;
    request: FluentTokenTransferRequest;
  } | null>(null);
  // Safe: `useTokenTransfer` reaches only `createBatchOp` of the Widget API.
  const widget = {
    createBatchOp: (input: Parameters<FluentBatchApi["createBatchOp"]>[0]) =>
      createFluentBatchOp(input, {
        smartAccountReady: true,
        defaultSigningMode: "prompt",
        confirm: async () => {},
        sendCalls: sendCalls as never,
      }),
  } as unknown as FluentBatchApi;
  const send = useTokenTransfer({
    widget,
    track: () => {},
    beginTransfer: () => "pending",
    settleTransfer: () => {},
    endTransfer: () => {},
    onPayFeeInNative: (request) => setSendRetry({ key: Date.now(), request }),
  });
  onRequest(send);
  return sendRetry ? (
    <WalletMenuActionCard
      key={sendRetry.key}
      track={() => {}}
      session={null}
      faucetBusy={false}
      onFaucet={() => {}}
      config={config}
      gasPaymentToken="USDnr"
      onGasPaymentTokenChange={() => {}}
      silentSigningEnabled={false}
      onSilentSigningChange={() => {}}
      onDisconnect={() => {}}
      onConnectWithX={() => {}}
      tab="send"
      onTabChange={() => {}}
      smartAccountAddress={SMART_ACCOUNT}
      onSendToken={send}
      sendRetry={sendRetry}
    />
  ) : null;
}

beforeEach(() => {
  toasts = [];
  sentGasPayments = [];
  vi.spyOn(toast, "add").mockImplementation((input) => {
    toasts.push(input);
    return "toast";
  });
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("criterion 6: a Prompt mode Send after insufficient_gas_token", () => {
  it("offers ETH in the failure toast, which opens the Send page with ETH as the fee", async () => {
    let send: FluentTokenTransferSendRef | undefined;
    render(<Host onRequest={(sender) => (send = sender)} />);

    await act(async () => {
      await send!({ token: ETH, to: RECIPIENT, amount: 10n ** 17n, gasSymbol: "USDnr" });
    });

    expect(sentGasPayments.map((payment) => payment?.symbol)).toEqual(["USDnr"]);
    const failure = toasts.find((entry) => entry.type === "error");
    expect(failure?.description).toBe(COPY);
    const offer = (failure?.actionProps ?? {}) as { children?: unknown; onClick?: () => void };
    expect(String(offer.children)).toMatch(/(pay|switch|use).*\bETH\b/i);

    await act(async () => {
      offer.onClick?.();
    });

    expect((screen.getByLabelText("Recipient address") as HTMLInputElement).value).toBe(RECIPIENT);
    expect((screen.getByLabelText("Amount of ETH to send") as HTMLInputElement).value).toBe("0.1");
    const feeSelector = screen.getByLabelText("Token the fee is paid in");
    expect(feeSelector.textContent).toContain("ETH");
    expect(feeSelector.textContent).not.toContain("USDnr");
  });
});
