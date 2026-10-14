/**
 * @vitest-environment jsdom
 *
 * What one Get USDnr press does: the operation it creates, what pays for it,
 * what it says when it lands, and what it says when it does not.
 *
 * Only the toast manager and the batch API are stood in for. The batch API is
 * the seam the widget already hands this hook (`useWidgetExecution`), and the
 * toast is asserted on rather than rendered: this file is about what the mint
 * reports, not about how a toast looks.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Address, Hash } from "viem";

import { toast } from "../../components/ui/toast";
import { explorerTransaction } from "../../utils";
import type {
  FluentBatchApi,
  FluentBatchOperation,
  FluentBatchOperationExecuteOptions,
  FluentBatchOperationInput,
  FluentExecuteResult,
} from "../batchOperation";
import { FluentReviewRejectedError } from "../reviewRejected";
import { useUsdnrMint } from "./useUsdnrMint";

vi.mock("../../components/ui/toast", () => ({
  toast: { add: vi.fn(() => "toast-id"), close: vi.fn() },
}));

const RECIPIENT = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as Address;
const TESTNET_USDNR = "0x279a6DC6354374473f6f3CFB3999e6C2e146f8a1";
const HASH = `0x${"ab".repeat(32)}` as Hash;
const THOUSAND_USDNR = 1_000_000_000n;

const toastAdd = toast.add as unknown as Mock;

/**
 * A stand-in batch API that records what was asked of it. `send` decides the
 * fate of the one execution: resolve for a mined mint, reject for a refused
 * review or a failed send.
 */
function widgetStub(send: () => Promise<FluentExecuteResult>) {
  const created: FluentBatchOperationInput[] = [];
  const executed: (FluentBatchOperationExecuteOptions | undefined)[] = [];
  const widget = {
    createBatchOp(input: FluentBatchOperationInput) {
      created.push(input);
      return {
        ...input,
        encodedCalls: [],
        canExecute: true,
        execute(options?: FluentBatchOperationExecuteOptions) {
          executed.push(options);
          return send();
        },
      } as unknown as FluentBatchOperation;
    },
  } as unknown as FluentBatchApi;
  return { widget, created, executed };
}

const mined = (hash: Hash): FluentExecuteResult => ({
  hash,
  hashes: [hash],
  atomic: true,
  sponsored: false,
});

/** A send whose fate is decided after the press, so "in flight" is observable. */
function deferredSend() {
  let settle!: (result: FluentExecuteResult) => void;
  const pending = new Promise<FluentExecuteResult>((resolve) => {
    settle = resolve;
  });
  return { send: () => pending, settle };
}

function mount(params: {
  send: () => Promise<FluentExecuteResult>;
  gasSymbol?: "ETH" | "USDnr" | "BLEND";
}) {
  const stub = widgetStub(params.send);
  const track = vi.fn();
  const view = renderHook(() =>
    useUsdnrMint({
      widget: stub.widget,
      network: "testnet",
      gasSymbol: params.gasSymbol ?? "USDnr",
      track,
    }),
  );
  return { ...stub, track, view };
}

beforeEach(() => {
  toastAdd.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useUsdnrMint: the operation", () => {
  it("creates one mint of 1000 USDnr to the address it is given", async () => {
    const { created, view } = mount({ send: async () => mined(HASH) });

    await act(async () => {
      await view.result.current.mintUsdnr(RECIPIENT);
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.calls).toHaveLength(1);
    expect(created[0]!.calls[0]).toMatchObject({
      to: TESTNET_USDNR,
      method: "mint",
      args: [RECIPIENT, THOUSAND_USDNR],
    });
  });

  it("names the review after the button that started it", async () => {
    const { created, view } = mount({ send: async () => mined(HASH) });

    await act(async () => {
      await view.result.current.mintUsdnr(RECIPIENT);
    });

    expect(created[0]!.reviewTitle).toBe("Get USDnr");
  });

  it("charges the fee to the Gas token held in User settings", async () => {
    const { executed, view } = mount({ send: async () => mined(HASH), gasSymbol: "BLEND" });

    await act(async () => {
      await view.result.current.mintUsdnr(RECIPIENT);
    });

    expect(executed[0]?.gasPayment).toEqual({ symbol: "BLEND" });
  });

  it("creates one operation for two presses in a row", async () => {
    const { send, settle } = deferredSend();
    const { created, view } = mount({ send });

    // The second press lands while the first is still in flight — the case the
    // disabled button cannot catch, because its new state has not rendered yet.
    await act(async () => {
      const first = view.result.current.mintUsdnr(RECIPIENT);
      const second = view.result.current.mintUsdnr(RECIPIENT);
      settle(mined(HASH));
      const [, secondOutcome] = await Promise.all([first, second]);
      expect(secondOutcome).toEqual({ status: "skipped" });
    });

    expect(created).toHaveLength(1);
  });
});

describe("useUsdnrMint: what the button reads off it", () => {
  it("is busy from the press until the operation settles", async () => {
    const { send, settle } = deferredSend();
    const { view } = mount({ send });

    expect(view.result.current.mintingUsdnr).toBe(false);

    let press!: Promise<unknown>;
    await act(async () => {
      press = view.result.current.mintUsdnr(RECIPIENT);
    });
    expect(view.result.current.mintingUsdnr).toBe(true);

    await act(async () => {
      settle(mined(HASH));
      await press;
    });
    expect(view.result.current.mintingUsdnr).toBe(false);
  });

  it("is not busy after a refused review", async () => {
    const { view } = mount({
      send: async () => {
        throw new FluentReviewRejectedError("transaction");
      },
    });

    await act(async () => {
      expect(await view.result.current.mintUsdnr(RECIPIENT)).toEqual({ status: "rejected" });
    });

    expect(view.result.current.mintingUsdnr).toBe(false);
  });

  it("is not busy after a failed operation", async () => {
    const { view } = mount({
      send: async () => {
        throw new Error("execution reverted");
      },
    });

    await act(async () => {
      await view.result.current.mintUsdnr(RECIPIENT);
    });

    expect(view.result.current.mintingUsdnr).toBe(false);
  });
});

describe("useUsdnrMint: what it reports", () => {
  it("toasts the mined mint and returns its hash", async () => {
    const { view } = mount({ send: async () => mined(HASH) });

    await act(async () => {
      expect(await view.result.current.mintUsdnr(RECIPIENT)).toEqual({
        status: "minted",
        hash: HASH,
      });
    });

    expect(toastAdd).toHaveBeenCalledTimes(1);
    expect(toastAdd.mock.calls[0]![0]).toMatchObject({
      type: "success",
      title: "Minted 1000 USDnr",
    });
  });

  it("takes the success toast to the transaction in the explorer", async () => {
    const opened: string[] = [];
    vi.stubGlobal("open", (url: string | URL) => {
      opened.push(String(url));
      return null;
    });
    const { view } = mount({ send: async () => mined(HASH) });

    await act(async () => {
      await view.result.current.mintUsdnr(RECIPIENT);
    });
    const { actionProps } = toastAdd.mock.calls[0]![0];
    actionProps.onClick();

    expect(opened).toEqual([explorerTransaction(HASH, "testnet")]);
    expect(opened[0]).toContain(HASH);
  });

  it("says nothing at all when the review is refused", async () => {
    const { track, view } = mount({
      send: async () => {
        throw new FluentReviewRejectedError("transaction");
      },
    });

    await act(async () => {
      await view.result.current.mintUsdnr(RECIPIENT);
    });

    // A refusal is the person's own decision; reporting it back to them is noise.
    expect(toastAdd).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("wallet_usdnr_mint_failed", { reason: "rejected" });
  });

  it("toasts the error's own message when the operation fails", async () => {
    const { view } = mount({
      send: async () => {
        throw new Error("execution reverted: ERC20: transfer amount exceeds balance");
      },
    });

    await act(async () => {
      expect(await view.result.current.mintUsdnr(RECIPIENT)).toEqual({
        status: "failed",
        message: "execution reverted: ERC20: transfer amount exceeds balance",
      });
    });

    expect(toastAdd).toHaveBeenCalledTimes(1);
    expect(toastAdd.mock.calls[0]![0]).toMatchObject({
      type: "error",
      description: "execution reverted: ERC20: transfer amount exceeds balance",
    });
  });
});
