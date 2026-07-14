import { describe, expect, it } from "vitest";
import { parseAbi } from "viem";
import { createFluentBatchOp } from "./batchOperation";

const erc20Abi = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);

describe("createFluentBatchOp", () => {
  it("encodes abi calls and executes them through the provided executor", async () => {
    const sentCalls: unknown[] = [];
    const op = createFluentBatchOp(
      {
        button: "Approve + move",
        calls: [
          {
            to: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
            abi: erc20Abi,
            method: "approve",
            args: ["0xf01977020ba70fd4D36077c830037cd30400f436", 50n],
          },
        ],
      },
      {
        smartAccountReady: true,
        async sendCalls(calls) {
          sentCalls.push(...calls);
          return "0x1111111111111111111111111111111111111111111111111111111111111111";
        },
      },
    );

    expect(op.button?.label).toBe("Approve + move");
    expect(op.canExecute).toBe(true);
    expect(op.encodedCalls).toHaveLength(1);
    expect(op.encodedCalls[0]?.data.startsWith("0x095ea7b3")).toBe(true);

    await expect(op.execute()).resolves.toBe(
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    expect(sentCalls).toEqual(op.encodedCalls);
  });

  it("rejects empty batches", () => {
    expect(() => createFluentBatchOp({ calls: [] })).toThrow(
      "A Fluent batch operation requires at least one call",
    );
  });

  it("prepares execution before sending calls when the signer is not ready yet", async () => {
    const sentCalls: unknown[] = [];
    let prepared = false;
    const op = createFluentBatchOp(
      {
        calls: [
          {
            to: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
            abi: erc20Abi,
            method: "approve",
            args: ["0xf01977020ba70fd4D36077c830037cd30400f436", 50n],
          },
        ],
      },
      {
        smartAccountReady: false,
        account: {
          connected: true,
          executionReady: false,
          executionStatus: "unavailable",
        },
        async ensureReady() {
          prepared = true;
        },
        async sendCalls(calls) {
          sentCalls.push(...calls);
          return "0x2222222222222222222222222222222222222222222222222222222222222222";
        },
      },
    );

    expect(op.canExecute).toBe(true);
    await expect(op.execute()).resolves.toBe(
      "0x2222222222222222222222222222222222222222222222222222222222222222",
    );
    expect(prepared).toBe(true);
    expect(sentCalls).toEqual(op.encodedCalls);
  });

  it("requires Fluent transaction review before sending calls when a confirmer is provided", async () => {
    const events: string[] = [];
    const op = createFluentBatchOp(
      {
        id: "approve-deposit",
        button: "Approve + deposit",
        calls: [
          {
            id: "approve",
            label: "Approve asset",
            to: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
            abi: erc20Abi,
            method: "approve",
            args: ["0xf01977020ba70fd4D36077c830037cd30400f436", 50n],
          },
        ],
      },
      {
        smartAccountReady: true,
        async confirm(review) {
          events.push(`confirm:${review.id}:${review.encodedCalls.length}`);
        },
        async sendCalls() {
          events.push("send");
          return "0x3333333333333333333333333333333333333333333333333333333333333333";
        },
      },
    );

    await expect(op.execute()).resolves.toBe(
      "0x3333333333333333333333333333333333333333333333333333333333333333",
    );
    expect(events).toEqual(["confirm:approve-deposit:1", "send"]);
  });

  it("shows Fluent transaction review before preparing a prompted signer", async () => {
    const events: string[] = [];
    const op = createFluentBatchOp(
      {
        id: "blend-self-transfer",
        calls: [
          {
            to: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
            abi: erc20Abi,
            method: "approve",
            args: ["0xf01977020ba70fd4D36077c830037cd30400f436", 50n],
          },
        ],
      },
      {
        smartAccountReady: false,
        account: {
          connected: true,
          executionReady: false,
          executionStatus: "unavailable",
        },
        async confirm(review) {
          events.push(`confirm:${review.id}`);
        },
        async ensureReady(context) {
          events.push(`ready:${context.confirmation}`);
        },
        async sendCalls(_calls, context) {
          events.push(`send:${context.confirmation}`);
          return "0x3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f";
        },
      },
    );

    await expect(op.execute({ confirmation: "always" })).resolves.toBe(
      "0x3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f",
    );
    expect(events).toEqual(["confirm:blend-self-transfer", "ready:always", "send:always"]);
  });

  it("skips Fluent transaction review when session confirmation is requested", async () => {
    const events: string[] = [];
    const op = createFluentBatchOp(
      {
        id: "approve-deposit",
        calls: [
          {
            to: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
            abi: erc20Abi,
            method: "approve",
            args: ["0xf01977020ba70fd4D36077c830037cd30400f436", 50n],
          },
        ],
      },
      {
        smartAccountReady: true,
        async confirm() {
          events.push("confirm");
        },
        async sendCalls() {
          events.push("send");
          return "0x4444444444444444444444444444444444444444444444444444444444444444";
        },
      },
    );

    await expect(op.execute({ confirmation: "session" })).resolves.toBe(
      "0x4444444444444444444444444444444444444444444444444444444444444444",
    );
    expect(events).toEqual(["send"]);
  });

  it("uses the executor default confirmation mode when no per-call option is passed", async () => {
    const events: string[] = [];
    const op = createFluentBatchOp(
      {
        id: "approve-deposit",
        calls: [
          {
            to: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
            abi: erc20Abi,
            method: "approve",
            args: ["0xf01977020ba70fd4D36077c830037cd30400f436", 50n],
          },
        ],
      },
      {
        smartAccountReady: true,
        defaultConfirmation: "session",
        async confirm() {
          events.push("confirm");
        },
        async sendCalls() {
          events.push("send");
          return "0x5555555555555555555555555555555555555555555555555555555555555555";
        },
      },
    );

    await expect(op.execute()).resolves.toBe(
      "0x5555555555555555555555555555555555555555555555555555555555555555",
    );
    expect(events).toEqual(["send"]);
  });

  it("passes the effective confirmation mode to readiness and execution", async () => {
    const events: string[] = [];
    const op = createFluentBatchOp(
      {
        id: "approve-deposit",
        calls: [
          {
            to: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
            abi: erc20Abi,
            method: "approve",
            args: ["0xf01977020ba70fd4D36077c830037cd30400f436", 50n],
          },
        ],
      },
      {
        smartAccountReady: false,
        defaultConfirmation: "session",
        async ensureReady(context) {
          events.push(`ready:${context.confirmation}`);
        },
        async sendCalls(_calls, context) {
          events.push(`send:${context.confirmation}`);
          return "0x6666666666666666666666666666666666666666666666666666666666666666";
        },
      },
    );

    await expect(op.execute()).resolves.toBe(
      "0x6666666666666666666666666666666666666666666666666666666666666666",
    );
    expect(events).toEqual(["ready:session", "send:session"]);
  });

  it("passes gas payment options to the executor", async () => {
    const contexts: unknown[] = [];
    const op = createFluentBatchOp(
      {
        id: "gas-paid-call",
        calls: [
          {
            to: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
            abi: erc20Abi,
            method: "approve",
            args: ["0xf01977020ba70fd4D36077c830037cd30400f436", 50n],
          },
        ],
      },
      {
        smartAccountReady: true,
        async sendCalls(_calls, context) {
          contexts.push(context);
          return "0x7777777777777777777777777777777777777777777777777777777777777777";
        },
      },
    );

    await expect(op.execute({
      confirmation: "session",
      gasPayment: {
        token: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
        symbol: "BLEND",
        includeApproval: true,
      },
    })).resolves.toBe(
      "0x7777777777777777777777777777777777777777777777777777777777777777",
    );
    expect(contexts).toEqual([
      {
        confirmation: "session",
        gasPayment: {
          token: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
          symbol: "BLEND",
          includeApproval: true,
        },
      },
    ]);
  });

  it("reports when the widget session has no execution authority", async () => {
    const op = createFluentBatchOp(
      {
        calls: [
          {
            to: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
            abi: erc20Abi,
            method: "approve",
            args: ["0xf01977020ba70fd4D36077c830037cd30400f436", 50n],
          },
        ],
      },
      {
        smartAccountReady: false,
        account: {
          connected: true,
          executionReady: false,
          executionStatus: "unavailable",
        },
        async sendCalls() {
          throw new Error("sendCalls should not run");
        },
      },
    );

    expect(op.canExecute).toBe(false);
    await expect(op.execute()).rejects.toThrow(
      "Fluent smart account execution is not available for this widget session",
    );
  });
});
