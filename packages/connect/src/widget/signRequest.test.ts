import { describe, expect, it } from "vitest";

import type { FluentWidgetAccount } from "./batchOperation";
import {
  createFluentSignApi,
  type FluentSignExecutor,
  type FluentSignatureReview,
} from "./signRequest";

const SMART_ACCOUNT: FluentWidgetAccount = {
  address: "0x1111111111111111111111111111111111111111",
  connected: true,
  executionReady: true,
  executionStatus: "ready",
  type: "smart",
  capabilities: { atomicBatch: true, erc20Gas: true },
};

const ORIGIN = "https://app.zenkai.example";

function executor(overrides: Partial<FluentSignExecutor> = {}): FluentSignExecutor {
  return {
    account: SMART_ACCOUNT,
    origin: ORIGIN,
    silentSigning: false,
    confirm: async () => {},
    ensureReady: async () => {
      throw new Error("ensureReady not expected");
    },
    ...overrides,
  };
}

const ORDER = {
  domain: { name: "Zenkai", version: "1", chainId: 20994 } as const,
  types: { Order: [{ name: "id", type: "uint256" }] } as const,
  primaryType: "Order" as const,
  message: { id: 7n },
};

function kernel(signerSource: "privy" | "session", log: unknown[]) {
  return {
    signerSource,
    account: {
      async signMessage(params: unknown) {
        log.push(["signMessage", params]);
        return "0xaa" as const;
      },
      async signTypedData(params: unknown) {
        log.push(["signTypedData", params]);
        return "0xbb" as const;
      },
    },
  };
}

describe("createFluentSignApi — smart account, Quick sign off", () => {
  it("shows the origin, the account and the payload, then signs with the prompt kernel", async () => {
    const reviews: unknown[] = [];
    const readiness: unknown[] = [];
    const signed: unknown[] = [];
    const api = createFluentSignApi(
      executor({
        confirm: async (review) => {
          reviews.push(review);
        },
        ensureReady: async (options) => {
          readiness.push(options);
          return kernel("privy", signed);
        },
      }),
    );

    await expect(api.signMessage({ message: "hello" })).resolves.toBe("0xaa");
    await expect(api.signTypedData(ORDER)).resolves.toBe("0xbb");

    expect(reviews).toEqual([
      {
        kind: "message",
        origin: ORIGIN,
        account: SMART_ACCOUNT,
        address: SMART_ACCOUNT.address,
        message: "hello",
      },
      {
        kind: "typedData",
        origin: ORIGIN,
        account: SMART_ACCOUNT,
        address: SMART_ACCOUNT.address,
        typedData: ORDER,
      },
    ]);
    // Quick sign off: the prompt kernel signs after the review.
    expect(readiness).toEqual([{ confirmation: "prompt" }, { confirmation: "prompt" }]);
    expect(signed).toEqual([
      ["signMessage", { message: "hello" }],
      ["signTypedData", ORDER],
    ]);
  });
});

describe("createFluentSignApi — smart account, Quick sign on", () => {
  it("skips the review and signs silently through the session kernel", async () => {
    const reviews: unknown[] = [];
    const readiness: unknown[] = [];
    const signed: unknown[] = [];
    const api = createFluentSignApi(
      executor({
        silentSigning: true,
        confirm: async (review) => {
          reviews.push(review);
        },
        ensureReady: async (options) => {
          readiness.push(options);
          return kernel("privy", signed);
        },
      }),
    );

    await expect(api.signMessage({ message: "hello" })).resolves.toBe("0xaa");
    await expect(api.signTypedData(ORDER)).resolves.toBe("0xbb");

    // No review is shown, and the silent kernel signs.
    expect(reviews).toEqual([]);
    expect(readiness).toEqual([{ confirmation: "silent" }, { confirmation: "silent" }]);
    expect(signed).toEqual([
      ["signMessage", { message: "hello" }],
      ["signTypedData", ORDER],
    ]);
  });

  it("falls back to the prompt kernel when the silent kernel is not the root signer", async () => {
    const readiness: unknown[] = [];
    const signed: unknown[] = [];
    const api = createFluentSignApi(
      executor({
        silentSigning: true,
        ensureReady: async (options) => {
          readiness.push(options);
          // A permission session answers the silent request; the root Signer answers
          // the prompt one and is the only key that may sign for the account.
          return options.confirmation === "silent"
            ? kernel("session", signed)
            : kernel("privy", signed);
        },
      }),
    );

    await expect(api.signMessage({ message: "hello" })).resolves.toBe("0xaa");
    expect(readiness).toEqual([{ confirmation: "silent" }, { confirmation: "prompt" }]);
    expect(signed).toEqual([["signMessage", { message: "hello" }]]);
  });

  it("refuses when neither the silent nor the prompt kernel is the root signer", async () => {
    const signed: unknown[] = [];
    const api = createFluentSignApi(
      executor({ silentSigning: true, ensureReady: async () => kernel("session", signed) }),
    );
    await expect(api.signTypedData(ORDER)).rejects.toMatchObject({
      code: "root_signer_required",
    });
    expect(signed).toEqual([]);
  });
});

describe("createFluentSignApi — refusals", () => {
  it("a dismissed review produces no signature and never touches the signer", async () => {
    const readiness: unknown[] = [];
    const api = createFluentSignApi(
      executor({
        confirm: async () => {
          throw new Error("User rejected Fluent signature review");
        },
        ensureReady: async (options) => {
          readiness.push(options);
          return kernel("privy", []);
        },
      }),
    );
    await expect(api.signMessage({ message: "hello" })).rejects.toThrow("User rejected");
    await expect(api.signTypedData(ORDER)).rejects.toThrow("User rejected");
    expect(readiness).toEqual([]);
  });

  it("refuses a session kernel: only the root signer signs for the smart account", async () => {
    const signed: unknown[] = [];
    const api = createFluentSignApi(
      executor({ ensureReady: async () => kernel("session", signed) }),
    );
    await expect(api.signTypedData(ORDER)).rejects.toMatchObject({
      code: "root_signer_required",
    });
    expect(signed).toEqual([]);
  });

  it("rejects with not_connected when no account is connected", async () => {
    const api = createFluentSignApi(
      executor({
        account: { ...SMART_ACCOUNT, connected: false, type: undefined, address: undefined },
      }),
    );
    await expect(api.signMessage({ message: "hello" })).rejects.toMatchObject({
      code: "not_connected",
    });
  });
});

describe("createFluentSignApi — External wallet", () => {
  const WALLET_ADDRESS = "0x3333333333333333333333333333333333333333";
  // The widget account still names the Fluent smart account while one is known, even
  // when the External wallet is the account that executes.
  const EOA_ACCOUNT: FluentWidgetAccount = {
    ...SMART_ACCOUNT,
    type: "eoa",
    capabilities: { atomicBatch: false, erc20Gas: false },
  };

  function walletClient(signed: unknown[]): NonNullable<FluentSignExecutor["wallet"]>["walletClient"] {
    return {
      account: undefined,
      signMessage: async (params) => {
        signed.push(["signMessage", params]);
        return "0xcc";
      },
      signTypedData: async (params) => {
        signed.push(["signTypedData", params]);
        return "0xdd";
      },
    };
  }

  it("reviews as the wallet's own address, then signs with it and never asks for a kernel", async () => {
    const reviews: FluentSignatureReview[] = [];
    const signed: unknown[] = [];
    const api = createFluentSignApi(
      executor({
        account: EOA_ACCOUNT,
        confirm: async (review) => {
          reviews.push(review);
        },
        wallet: { address: WALLET_ADDRESS, walletClient: walletClient(signed) },
      }),
    );

    await expect(api.signMessage({ message: "hello" })).resolves.toBe("0xcc");
    await expect(api.signTypedData(ORDER)).resolves.toBe("0xdd");
    expect(reviews.map((review) => [review.kind, review.address])).toEqual([
      ["message", WALLET_ADDRESS],
      ["typedData", WALLET_ADDRESS],
    ]);
    expect(signed).toEqual([
      ["signMessage", { account: WALLET_ADDRESS, message: "hello" }],
      ["signTypedData", { account: WALLET_ADDRESS, ...ORDER }],
    ]);
  });

  it("an External wallet without a client rejects with not_connected", async () => {
    const api = createFluentSignApi(
      executor({ account: EOA_ACCOUNT, wallet: { address: WALLET_ADDRESS } }),
    );
    await expect(api.signMessage({ message: "hello" })).rejects.toMatchObject({
      code: "not_connected",
      message: "External wallet has no signer.",
    });
  });
});
