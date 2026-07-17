import { describe, expect, it } from "vitest";
import { parseAbi } from "viem";
import { createFluentBatchOp } from "./batchOperation";

const erc20Abi = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);

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
          return "0x1111111111111111111111111111111111111111111111111111111111111111";
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
