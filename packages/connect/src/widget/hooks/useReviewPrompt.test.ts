/**
 * @vitest-environment jsdom
 *
 * `useReviewPrompt` as it behaves today: which label each settle path names, when the open
 * Review's promise is rejected, and which callbacks keep their identity across renders. No fakes:
 * the hook reaches no external boundary.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FluentReviewRejectedError } from "../reviewRejected";
import { useReviewPrompt } from "./useReviewPrompt";

type Label = "transaction" | "signature";
type Props = { label: Label; onOpen?: () => void };

afterEach(cleanup);

function renderPrompt(initialProps: Props) {
  return renderHook((props: Props) => useReviewPrompt<string>(props), {
    initialProps,
    wrapper: StrictMode,
  });
}

/** The settlement of a request, read without leaving the rejection unhandled. */
function settlementOf(promise: Promise<void>) {
  return promise.then(
    () => ({ status: "resolved" as const }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
}

describe("useReviewPrompt", () => {
  it("rejects with the current label after the label changes", async () => {
    const { result, rerender } = renderPrompt({ label: "transaction" });
    rerender({ label: "signature" });

    let settled!: ReturnType<typeof settlementOf>;
    act(() => {
      settled = settlementOf(result.current.request("review"));
    });
    act(() => result.current.reject());

    const outcome = await settled;
    expect(outcome.status).toBe("rejected");
    const { error } = outcome as { error: unknown };
    expect(error).toBeInstanceOf(FluentReviewRejectedError);
    expect(error).toMatchObject({
      name: "FluentReviewRejectedError",
      review: "signature",
      code: "signature_review_rejected",
    });
    expect(result.current.review).toBeNull();
  });

  it("names the current label when a newer review replaces a pending one", async () => {
    const { result, rerender } = renderPrompt({ label: "transaction" });
    rerender({ label: "signature" });

    let first!: ReturnType<typeof settlementOf>;
    let second!: ReturnType<typeof settlementOf>;
    act(() => {
      first = settlementOf(result.current.request("first"));
    });
    act(() => {
      second = settlementOf(result.current.request("second"));
    });

    expect(await first).toEqual({
      status: "rejected",
      error: new Error("A newer Fluent signature review replaced this request"),
    });
    expect(result.current.review).toBe("second");

    act(() => result.current.accept());
    expect(await second).toEqual({ status: "resolved" });
    expect(result.current.review).toBeNull();
  });

  it("makes a new reject once per label change and on no other render", () => {
    const onOpen = vi.fn();
    const { result, rerender } = renderPrompt({ label: "transaction", onOpen });
    const seen = new Set([result.current.reject]);
    const remember = () => seen.add(result.current.reject);

    rerender({ label: "transaction", onOpen });
    remember();
    rerender({ label: "transaction", onOpen: vi.fn() });
    remember();
    expect(seen.size).toBe(1);

    rerender({ label: "signature", onOpen });
    remember();
    rerender({ label: "signature", onOpen });
    remember();
    expect(seen.size).toBe(2);

    rerender({ label: "transaction", onOpen });
    remember();
    expect(seen.size).toBe(3);
  });

  it("rejects the pending review as closed under the old label when the label changes", async () => {
    const { result, rerender } = renderPrompt({ label: "transaction" });

    let settled!: ReturnType<typeof settlementOf>;
    act(() => {
      settled = settlementOf(result.current.request("review"));
    });
    rerender({ label: "signature" });

    expect(await settled).toEqual({
      status: "rejected",
      error: new Error("Fluent transaction review was closed"),
    });
    // Pins current behaviour: the label change rejects the promise but leaves the Review on screen.
    expect(result.current.review).toBe("review");
  });

  it("rejects the pending review as closed on unmount", async () => {
    const { result, unmount } = renderPrompt({ label: "signature" });

    let settled!: ReturnType<typeof settlementOf>;
    act(() => {
      settled = settlementOf(result.current.request("review"));
    });
    unmount();

    expect(await settled).toEqual({
      status: "rejected",
      error: new Error("Fluent signature review was closed"),
    });
  });

  it("calls the latest onOpen once per request, recreates request on a new onOpen or label and reject on a new label only", () => {
    const firstOnOpen = vi.fn();
    const secondOnOpen = vi.fn();
    const { result, rerender } = renderPrompt({ label: "transaction", onOpen: firstOnOpen });
    const mounted = result.current;

    rerender({ label: "transaction", onOpen: firstOnOpen });
    expect(result.current.request).toBe(mounted.request);
    expect(result.current.accept).toBe(mounted.accept);
    expect(result.current.reject).toBe(mounted.reject);

    rerender({ label: "transaction", onOpen: secondOnOpen });
    const afterOnOpen = result.current.request;
    expect(afterOnOpen).not.toBe(mounted.request);

    expect(result.current.reject).toBe(mounted.reject);

    rerender({ label: "signature", onOpen: secondOnOpen });
    expect(result.current.request).not.toBe(afterOnOpen);
    expect(result.current.accept).toBe(mounted.accept);
    // `reject` names its label in the error, so a new label makes a new `reject`, once.
    const afterLabel = result.current.reject;
    expect(afterLabel).not.toBe(mounted.reject);
    rerender({ label: "signature", onOpen: secondOnOpen });
    expect(result.current.reject).toBe(afterLabel);

    act(() => {
      void result.current.request("review").catch(() => undefined);
    });
    expect(firstOnOpen).not.toHaveBeenCalled();
    expect(secondOnOpen).toHaveBeenCalledTimes(1);
    expect(result.current.review).toBe("review");
  });
});
