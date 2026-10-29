/**
 * @vitest-environment jsdom
 *
 * The error a dismissed Review rejects with (FLU-1622, criterion 4.1): standard A3's shape, a
 * `name` and a string `code` a host branches on, beside the `review` it already carried.
 *
 * Each case takes the path a host's call takes: `useWidgetExecution` builds the widget object
 * over the Fluent ID's smart account (`useFluentZeroDevAccount`), the Review is the widget's own
 * prompt (`useBatchReview`, `useSignatureReview`), and the case dismisses it the way the Review
 * screen's dismissal does, by calling the prompt's `reject`. All of these run for real; nothing
 * is signed or sent.
 *
 * Fakes, and nothing else (`test/fakes/fluentId.ts` says what each mirrors): Privy 2.25.0 with
 * a signed-in user and one Signer; the smart account `@zerodev/sdk` 5.5.10 derives and its
 * `@zerodev/ecdsa-validator` 5.4.9 validator; and `fetch`, answering as the widget chain and the
 * ZeroDev bundler.
 */
import { fluentTestnet } from "@fluent.xyz/connect-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SMART_ACCOUNT,
  boundary,
  methodsAt,
  resetBoundary,
  stubNetwork,
} from "../../test/fakes/fluentId";
import { FLUENT_CONNECT_DEFAULT_EXECUTION } from "../core/config";
import { useBatchReview } from "./hooks/useBatchReview";
import { useSignatureReview } from "./hooks/useSignatureReview";
import { useWidgetExecution } from "./hooks/useWidgetExecution";
import { FluentReviewRejectedError } from "./reviewRejected";
import { useFluentZeroDevAccount } from "./zerodevSession";

vi.mock("@privy-io/react-auth", async () =>
  (await import("../../test/fakes/fluentId")).privyModule(),
);
vi.mock("@zerodev/sdk", async (importOriginal) =>
  (await import("../../test/fakes/fluentId")).zerodevSdkModule(await importOriginal()),
);
vi.mock("@zerodev/ecdsa-validator", async (importOriginal) =>
  (await import("../../test/fakes/fluentId")).zerodevValidatorModule(await importOriginal()),
);

const CALLS = [{ to: "0x3333333333333333333333333333333333333333" as const, data: "0x" as const }];

/** The widget object in Prompt mode, and the two Reviews it asks for. */
function renderWidget() {
  const { result } = renderHook(() => {
    const smartAccount = useFluentZeroDevAccount({ execution: FLUENT_CONNECT_DEFAULT_EXECUTION });
    const { batchReview, confirmBatchOperation, rejectBatchReview } = useBatchReview();
    const { signatureReview, confirmSignature, rejectSignatureReview } = useSignatureReview();
    const widget = useWidgetExecution({
      chain: fluentTestnet,
      fluentAccountReady: false,
      wallet: null,
      smartAccount,
      widgetAccount: {
        address: SMART_ACCOUNT,
        connected: true,
        executionReady: false,
        executionStatus: "unavailable",
        type: "smart",
        capabilities: { atomicBatch: true, erc20Gas: true },
      },
      defaultSigningMode: "prompt",
      selectedGasPaymentToken: { symbol: "ETH", decimals: 18 },
      confirmBatchOperation,
      confirmSignature,
      refreshBalances: () => {},
      track: () => {},
    });
    return { widget, batchReview, rejectBatchReview, signatureReview, rejectSignatureReview };
  });
  return result;
}

/** What the call rejected with, once it settled. */
function settled(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (caught: unknown) => caught,
  );
}

beforeEach(() => {
  resetBoundary();
  stubNetwork();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("criterion 4.1: a dismissed Review", () => {
  it("rejects execute() with transaction_review_rejected, and nothing is sent", async () => {
    const view = renderWidget();

    const rejection = settled(view.current.widget.createBatchOp({ calls: CALLS }).execute());
    await waitFor(() => expect(view.current.batchReview).not.toBeNull());
    act(() => view.current.rejectBatchReview());
    const error = await rejection;

    expect(error).toBeInstanceOf(FluentReviewRejectedError);
    expect(error).toMatchObject({
      name: "FluentReviewRejectedError",
      code: "transaction_review_rejected",
      review: "transaction",
    });
    expect(methodsAt("bundler")).not.toContain("eth_sendUserOperation");
    expect(boundary.promptSignatures).toBe(0);
  });

  it("rejects signMessage() with signature_review_rejected, and nothing is signed", async () => {
    const view = renderWidget();

    const rejection = settled(view.current.widget.signMessage({ message: "hello" }));
    await waitFor(() => expect(view.current.signatureReview).not.toBeNull());
    act(() => view.current.rejectSignatureReview());
    const error = await rejection;

    expect(error).toBeInstanceOf(FluentReviewRejectedError);
    expect(error).toMatchObject({
      name: "FluentReviewRejectedError",
      code: "signature_review_rejected",
      review: "signature",
    });
    expect(boundary.promptSignatures).toBe(0);
    expect(boundary.providerRequests).not.toContain("personal_sign");
  });
});
