import { describe, expect, it } from "vitest";

import { FluentAuthError } from "../core/authToken";
import type { FluentWidgetAccount } from "./batchOperation";
import {
  createFluentSignApi,
  type FluentSignExecutor,
  type FluentSignatureReview,
} from "./signRequest";

const SMART_ACCOUNT: FluentWidgetAccount = {
  address: "0x1111111111111111111111111111111111111111",
  signerAddress: "0x2222222222222222222222222222222222222222",
  connected: true,
  executionReady: true,
  executionStatus: "ready",
  type: "smart",
  capabilities: { atomicBatch: true, erc20Gas: true },
};

const ORIGIN = "https://app.zenkai.example";

function executor(overrides: Partial<FluentSignExecutor> = {}): FluentSignExecutor {
  return {
    authMode: "direct",
    account: SMART_ACCOUNT,
    origin: ORIGIN,
    confirm: async () => {},
    ensureReady: async () => {
      throw new Error("ensureReady not expected");
    },
    ...overrides,
  };
}

describe("createFluentSignApi", () => {
  it("rejects both methods in hosted mode with the code getAuthToken() uses", async () => {
    const api = createFluentSignApi(executor({ authMode: "hosted" }));
    await expect(api.signMessage({ message: "hi" })).rejects.toMatchObject({
      name: "FluentAuthError",
      code: "hosted_not_supported",
    });
    await expect(
      api.signTypedData({
        domain: { name: "Zenkai" },
        types: { Order: [{ name: "id", type: "uint256" }] },
        primaryType: "Order",
        message: { id: 1n },
      }),
    ).rejects.toBeInstanceOf(FluentAuthError);
  });
});

const ORDER = {
  domain: { name: "Zenkai", version: "1", chainId: 20994 } as const,
  types: { Order: [{ name: "id", type: "uint256" }] } as const,
  primaryType: "Order" as const,
  message: { id: 7n },
};

function kernel(signerSource: "privy" | "hosted" | "session", log: unknown[]) {
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

describe("createFluentSignApi — smart account", () => {
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
    // Quick sign never applies: the kernel asked for is always the prompt one.
    expect(readiness).toEqual([{ confirmation: "always" }, { confirmation: "always" }]);
    expect(signed).toEqual([
      ["signMessage", { message: "hello" }],
      ["signTypedData", ORDER],
    ]);
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

  it.each(["session", "hosted"] as const)(
    "refuses a %s kernel: only the root signer signs for the smart account",
    async (signerSource) => {
      const signed: unknown[] = [];
      const api = createFluentSignApi(
        executor({ ensureReady: async () => kernel(signerSource, signed) }),
      );
      await expect(api.signTypedData(ORDER)).rejects.toMatchObject({
        code: "root_signer_required",
      });
      expect(signed).toEqual([]);
    },
  );

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
