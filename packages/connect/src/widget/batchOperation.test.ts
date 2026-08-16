import { describe, expect, it } from "vitest";
import { parseAbi } from "viem";
import {
  createFluentBatchOp,
  type FluentBatchOperationExecuteOptions,
} from "./batchOperation";

const erc20Abi = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);

/** Smart-account executor result for a single confirmed UserOp. */
const result = (hash: `0x${string}`) => ({ hash, hashes: [hash], atomic: true });

describe("createFluentBatchOp", () => {
  it("encodes abi calls and executes them through the provided executor", async () => {
    const sentCalls: unknown[] = [];
    const executionOptions: unknown[] = [];
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
        async sendCalls(calls, options) {
          sentCalls.push(...calls);
          executionOptions.push(options);
          return result("0x1111111111111111111111111111111111111111111111111111111111111111");
        },
      },
    );

    expect(op.button?.label).toBe("Approve + move");
    expect(op.canExecute).toBe(true);
    expect(op.encodedCalls).toHaveLength(1);
    expect(op.encodedCalls[0]?.data.startsWith("0x095ea7b3")).toBe(true);

    const res = await op.execute();
    expect(res.hash).toBe(
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    expect(res.atomic).toBe(true);
    expect(sentCalls).toEqual(op.encodedCalls);
    expect(executionOptions).toEqual([{ confirmation: "always" }]);
  });

  it("uses the widget default signer mode and permits an explicit override", async () => {
    const confirmations: unknown[] = [];
    const op = createFluentBatchOp(
      {
        calls: [{ to: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E", data: "0x" }],
      },
      {
        smartAccountReady: true,
        defaultConfirmation: "session",
        async sendCalls(_calls, options) {
          confirmations.push(options?.confirmation);
          return result("0x1111111111111111111111111111111111111111111111111111111111111111");
        },
      },
    );

    await op.execute();
    await op.execute({ confirmation: "always" });

    expect(confirmations).toEqual(["session", "always"]);
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
          capabilities: { atomicBatch: false, erc20Gas: false },
        },
        async ensureReady() {
          prepared = true;
        },
        async sendCalls(calls) {
          sentCalls.push(...calls);
          return result("0x2222222222222222222222222222222222222222222222222222222222222222");
        },
      },
    );

    expect(op.canExecute).toBe(true);
    const res = await op.execute();
    expect(res.hash).toBe(
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
          return result("0x3333333333333333333333333333333333333333333333333333333333333333");
        },
      },
    );

    const res = await op.execute();
    expect(res.hash).toBe(
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
          capabilities: { atomicBatch: false, erc20Gas: false },
        },
        async confirm(review) {
          events.push(`confirm:${review.id}`);
        },
        async ensureReady(context) {
          events.push(`ready:${context.confirmation}`);
        },
        async sendCalls(_calls, context) {
          events.push(`send:${context.confirmation}`);
          return result("0x3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f");
        },
      },
    );

    const res = await op.execute({ confirmation: "always" });
    expect(res.hash).toBe(
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
          return result("0x4444444444444444444444444444444444444444444444444444444444444444");
        },
      },
    );

    const res = await op.execute({ confirmation: "session" });
    expect(res.hash).toBe(
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
          return result("0x5555555555555555555555555555555555555555555555555555555555555555");
        },
      },
    );

    const res = await op.execute();
    expect(res.hash).toBe(
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
          return result("0x6666666666666666666666666666666666666666666666666666666666666666");
        },
      },
    );

    const res = await op.execute();
    expect(res.hash).toBe(
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
          return result("0x7777777777777777777777777777777777777777777777777777777777777777");
        },
      },
    );

    const res = await op.execute({
      confirmation: "session",
      gasPayment: {
        token: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
        symbol: "BLEND",
        includeApproval: true,
        approveAmount: 100n,
      },
    });
    expect(res.hash).toBe(
      "0x7777777777777777777777777777777777777777777777777777777777777777",
    );
    expect(contexts).toEqual([
      {
        confirmation: "session",
        gasPayment: {
          token: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
          symbol: "BLEND",
          includeApproval: true,
          approveAmount: 100n,
        },
      },
    ]);
  });

  it("defaults gas payment to the widget-selected token when execute omits it", async () => {
    const contexts: FluentBatchOperationExecuteOptions[] = [];
    const op = createFluentBatchOp(
      {
        id: "default-gas",
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
        defaultGasPayment: {
          symbol: "BLEND",
          token: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
          decimals: 18,
        },
        async sendCalls(_calls, context) {
          contexts.push(context);
          return result("0x8888888888888888888888888888888888888888888888888888888888888888");
        },
      },
    );

    await op.execute();
    expect(contexts[0]?.gasPayment).toEqual({
      token: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
      symbol: "BLEND",
    });
  });

  it("lets an explicit gas payment override the widget default", async () => {
    const contexts: FluentBatchOperationExecuteOptions[] = [];
    const op = createFluentBatchOp(
      {
        id: "override-gas",
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
        defaultGasPayment: {
          symbol: "BLEND",
          token: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
          decimals: 18,
        },
        async sendCalls(_calls, context) {
          contexts.push(context);
          return result("0x9999999999999999999999999999999999999999999999999999999999999999");
        },
      },
    );

    await op.execute({
      gasPayment: {
        token: "0x092AE7564C6611a114C20C6df766B5B35A52334A",
        symbol: "USDnr",
      },
    });
    expect(contexts[0]?.gasPayment).toEqual({
      token: "0x092AE7564C6611a114C20C6df766B5B35A52334A",
      symbol: "USDnr",
    });
  });

  it("leaves gas payment undefined for native (no token) widget selections", async () => {
    const contexts: FluentBatchOperationExecuteOptions[] = [];
    const op = createFluentBatchOp(
      {
        id: "native-gas",
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
        defaultGasPayment: { symbol: "ETH", decimals: 18 },
        async sendCalls(_calls, context) {
          contexts.push(context);
          return result("0x1010101010101010101010101010101010101010101010101010101010101010");
        },
      },
    );

    await op.execute();
    expect(contexts[0]?.gasPayment).toBeUndefined();
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
          capabilities: { atomicBatch: false, erc20Gas: false },
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
