/**
 * @vitest-environment jsdom
 *
 * The transaction review as a page: what it lists for an operation, and that
 * its two buttons answer the review. The flow around it — opening the drawer on
 * this page, Back and dismissal rejecting — lives in FluentWidgetContent.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FluentBatchOperationReview, FluentWidgetAccount } from "../widget/batchOperation";
import { TransactionReviewScreen } from "./TransactionReviewScreen";

const SMART = "0x092AE7564C6611a114C20C6df766B5B35A52334A" as const;
const VAULT = "0x1ccF23916C572379630b067e9a0CbBddb56C5e72" as const;
const TOKEN = "0x9CAcf613fC29015893728563f423fD26dCdB8Ddc" as const;

const smartAccount: FluentWidgetAccount = {
  address: SMART,
  connected: true,
  executionReady: true,
  executionStatus: "ready",
  type: "smart",
  capabilities: { atomicBatch: true, erc20Gas: true },
};

const operation: FluentBatchOperationReview = {
  reviewTitle: "Deposit 250 USDnr",
  account: smartAccount,
  calls: [
    { to: TOKEN, functionName: "approve" },
    { to: VAULT, method: "deposit" },
    { to: VAULT, label: "Stake rewards", value: 10_000_000_000_000_000n },
  ],
  encodedCalls: [
    { to: TOKEN, label: "Approve USDnr", value: 0n, data: "0x" },
    { to: VAULT, value: 0n, data: "0x" },
    { to: VAULT, label: "Stake rewards", value: 10_000_000_000_000_000n, data: "0x" },
  ],
};

function renderReview(props?: Partial<Parameters<typeof TransactionReviewScreen>[0]>) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <TransactionReviewScreen
      operation={operation}
      network="testnet"
      appName="Fluent Vault"
      track={() => {}}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
}

afterEach(cleanup);

describe("TransactionReviewScreen", () => {
  it("lists the App, the signing account and every call by its label, method or name", () => {
    renderReview();

    expect(screen.getByText("Deposit 250 USDnr")).toBeTruthy();
    expect(screen.getByText("Fluent Vault · 3 calls")).toBeTruthy();
    expect(screen.getByText("Signing account")).toBeTruthy();
    expect(screen.getByTitle(SMART)).toBeTruthy();
    expect(screen.getByText("Approve USDnr")).toBeTruthy();
    expect(screen.getByText("deposit")).toBeTruthy();
    expect(screen.getByText("Stake rewards")).toBeTruthy();
    expect(screen.getByText("0.01 ETH")).toBeTruthy();
  });

  it("falls back to the page's own title and the generic call label", () => {
    renderReview({
      operation: {
        ...operation,
        reviewTitle: undefined,
        account: { ...smartAccount, type: "eoa", capabilities: { atomicBatch: false, erc20Gas: false } },
        calls: [{ to: VAULT }],
        encodedCalls: [{ to: VAULT, value: 0n, data: "0x" }],
      },
    });

    expect(screen.getByText("Confirm transaction")).toBeTruthy();
    expect(screen.getByText("Fluent Vault · 1 call")).toBeTruthy();
    expect(screen.getByText("Contract call")).toBeTruthy();
  });

  it("answers the review with its two buttons", () => {
    const { onConfirm, onCancel } = renderReview();

    fireEvent.click(screen.getByRole("button", { name: "Confirm and sign" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
