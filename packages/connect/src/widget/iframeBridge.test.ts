import { describe, expect, it } from "vitest";
import type { Hash } from "viem";

import { FluentAuthError } from "../core/authToken";

import type { FluentWidgetAccount } from "./batchOperation";
import {
  createFluentIframeBridge,
  createFluentIframeRpcHandler,
  type FluentIframeMessageEvent,
  type FluentIframeRpcExecutor,
} from "./iframeBridge";
import { FluentReviewRejectedError } from "./reviewRejected";

const SMART_ACCOUNT: FluentWidgetAccount = {
  address: "0x1111111111111111111111111111111111111111",
  signerAddress: "0x2222222222222222222222222222222222222222",
  connected: true,
  executionReady: true,
  executionStatus: "ready",
  type: "smart",
  capabilities: { atomicBatch: true, erc20Gas: true },
};

const DISCONNECTED: FluentWidgetAccount = {
  connected: false,
  executionReady: false,
  executionStatus: "disconnected",
  capabilities: { atomicBatch: false, erc20Gas: false },
};

function deps(overrides: Partial<FluentIframeRpcExecutor> = {}): FluentIframeRpcExecutor {
  return {
    authMode: "direct",
    account: () => SMART_ACCOUNT,
    chainId: 20994,
    sign: {
      signMessage: async () => {
        throw new Error("signMessage not expected");
      },
      signTypedData: async () => {
        throw new Error("signTypedData not expected");
      },
    },
    sendCalls: async () => {
      throw new Error("sendCalls not expected");
    },
    rpc: async () => {
      throw new Error("rpc not expected");
    },
    ...overrides,
  };
}

describe("createFluentIframeRpcHandler", () => {
  it("answers eth_accounts with the signed-in address, and [] when signed out", async () => {
    expect(await createFluentIframeRpcHandler(deps())({ method: "eth_accounts" })).toEqual([
      SMART_ACCOUNT.address,
    ]);
    expect(
      await createFluentIframeRpcHandler(deps({ account: () => DISCONNECTED }))({
        method: "eth_accounts",
      }),
    ).toEqual([]);
  });

  it("answers eth_chainId with the widget chain as a hex string", async () => {
    expect(await createFluentIframeRpcHandler(deps())({ method: "eth_chainId" })).toBe("0x5202");
  });
});

describe("unsupported methods", () => {
  it.each(["wallet_switchEthereumChain", "eth_sign", "net_peerCount"])(
    "rejects %s with EIP-1193 code 4200",
    async (method) => {
      await expect(createFluentIframeRpcHandler(deps())({ method })).rejects.toMatchObject({
        code: 4200,
        message: expect.stringContaining(method),
      });
    },
  );
});

const ORDER = {
  domain: { name: "Marketplace", version: "1", chainId: 20994 },
  types: { Order: [{ name: "id", type: "uint256" }] },
  primaryType: "Order",
  message: { id: "7" },
};
const SIGNATURE = "0xabcdef";

describe("signing", () => {
  it.each(["eth_signTypedData_v4", "eth_signTypedData_v3"])(
    "%s parses the JSON payload and signs it as the account",
    async (method) => {
      const seen: unknown[] = [];
      const handler = createFluentIframeRpcHandler(
        deps({
          sign: {
            signMessage: async () => {
              throw new Error("not expected");
            },
            signTypedData: async (typedData) => {
              seen.push(typedData);
              return SIGNATURE;
            },
          },
        }),
      );
      const result = await handler({
        method,
        params: [SMART_ACCOUNT.address, JSON.stringify(ORDER)],
      });
      expect(result).toBe(SIGNATURE);
      expect(seen).toEqual([ORDER]);
    },
  );

  it("eth_signTypedData (legacy) accepts the payload as an object", async () => {
    const seen: unknown[] = [];
    const handler = createFluentIframeRpcHandler(
      deps({
        sign: {
          signMessage: async () => {
            throw new Error("not expected");
          },
          signTypedData: async (typedData) => {
            seen.push(typedData);
            return SIGNATURE;
          },
        },
      }),
    );
    await handler({ method: "eth_signTypedData", params: [SMART_ACCOUNT.address, ORDER] });
    expect(seen).toEqual([ORDER]);
  });

  it("personal_sign signs the message as the account", async () => {
    const seen: unknown[] = [];
    const handler = createFluentIframeRpcHandler(
      deps({
        sign: {
          signMessage: async ({ message }) => {
            seen.push(message);
            return SIGNATURE;
          },
          signTypedData: async () => {
            throw new Error("not expected");
          },
        },
      }),
    );
    // personal_sign params are [message, address]; a hex message is signed as raw bytes.
    expect(await handler({ method: "personal_sign", params: ["0x6869", SMART_ACCOUNT.address] })).toBe(
      SIGNATURE,
    );
    expect(seen).toEqual([{ raw: "0x6869" }]);
  });

  it("refuses to sign for an address that is not the signed-in account", async () => {
    const handler = createFluentIframeRpcHandler(deps());
    await expect(
      handler({
        method: "eth_signTypedData_v4",
        params: ["0x9999999999999999999999999999999999999999", JSON.stringify(ORDER)],
      }),
    ).rejects.toMatchObject({ code: 4100 });
    await expect(
      handler({ method: "personal_sign", params: ["0x6869", "0x9999999999999999999999999999999999999999"] }),
    ).rejects.toMatchObject({ code: 4100 });
  });

  it("refuses to sign while signed out", async () => {
    const handler = createFluentIframeRpcHandler(deps({ account: () => DISCONNECTED }));
    await expect(
      handler({ method: "eth_signTypedData_v4", params: [SMART_ACCOUNT.address, JSON.stringify(ORDER)] }),
    ).rejects.toMatchObject({ code: 4100 });
  });
});

const EXCHANGE = "0x3333333333333333333333333333333333333333";
const BUNDLE_HASH = `0x${"ab".repeat(32)}` as const;

describe("eth_sendTransaction", () => {
  function sendingDeps(seen: unknown[]) {
    return deps({
      sendCalls: async (calls) => {
        seen.push(calls);
        return { hash: BUNDLE_HASH as Hash, hashes: [BUNDLE_HASH as Hash], atomic: true, sponsored: true };
      },
    });
  }

  it("executes the call through the widget and returns the hash execute() returns", async () => {
    const seen: unknown[] = [];
    const result = await createFluentIframeRpcHandler(sendingDeps(seen))({
      method: "eth_sendTransaction",
      params: [{ from: SMART_ACCOUNT.address, to: EXCHANGE, data: "0xdeadbeef", value: "0x10" }],
    });
    expect(result).toBe(BUNDLE_HASH);
    expect(seen).toEqual([[{ to: EXCHANGE, data: "0xdeadbeef", value: 16n }]]);
  });

  it("defaults value to 0 and data to 0x, and ignores gas fields the widget prices itself", async () => {
    const seen: unknown[] = [];
    await createFluentIframeRpcHandler(sendingDeps(seen))({
      method: "eth_sendTransaction",
      params: [{ from: SMART_ACCOUNT.address, to: EXCHANGE, gas: "0x5208", gasPrice: "0x1" }],
    });
    expect(seen).toEqual([[{ to: EXCHANGE, data: "0x", value: 0n }]]);
  });

  it("refuses a transaction from another address, and one without a recipient", async () => {
    const handler = createFluentIframeRpcHandler(sendingDeps([]));
    await expect(
      handler({
        method: "eth_sendTransaction",
        params: [{ from: "0x9999999999999999999999999999999999999999", to: EXCHANGE }],
      }),
    ).rejects.toMatchObject({ code: 4100 });
    await expect(
      handler({ method: "eth_sendTransaction", params: [{ from: SMART_ACCOUNT.address }] }),
    ).rejects.toMatchObject({ code: -32602 });
  });
});

describe("eth_requestAccounts", () => {
  it("behaves like eth_accounts: the bridge never opens the connect flow itself", async () => {
    expect(await createFluentIframeRpcHandler(deps())({ method: "eth_requestAccounts" })).toEqual([
      SMART_ACCOUNT.address,
    ]);
  });
});

describe("read-only methods", () => {
  it.each([
    "eth_getTransactionReceipt",
    "eth_getTransactionByHash",
    "eth_estimateGas",
    "eth_gasPrice",
    "eth_blockNumber",
    "eth_call",
    "eth_getBalance",
    "eth_getCode",
    "eth_getLogs",
    "eth_getBlockByNumber",
    "eth_getTransactionCount",
    "net_version",
  ])("forwards %s to the chain RPC unchanged", async (method) => {
    const seen: unknown[] = [];
    const handler = createFluentIframeRpcHandler(
      deps({
        rpc: async (m, p) => {
          seen.push([m, p]);
          return "rpc-answer";
        },
      }),
    );
    expect(await handler({ method, params: ["0x1", "latest"] })).toBe("rpc-answer");
    expect(seen).toEqual([[method, ["0x1", "latest"]]]);
  });

  it("does not forward methods that would move funds or change wallet state", async () => {
    const handler = createFluentIframeRpcHandler(
      deps({
        rpc: async () => {
          throw new Error("must not reach the RPC");
        },
      }),
    );
    for (const method of ["eth_sendRawTransaction", "wallet_addEthereumChain", "eth_sign"]) {
      await expect(handler({ method })).rejects.toMatchObject({ code: 4200 });
    }
  });
});

const MARKETPLACE = "https://market.example";

function fakeWindow() {
  const listeners = new Set<(event: FluentIframeMessageEvent) => void>();
  return {
    listeners,
    addEventListener: (_type: "message", fn: (event: FluentIframeMessageEvent) => void) => {
      listeners.add(fn);
    },
    removeEventListener: (_type: "message", fn: (event: FluentIframeMessageEvent) => void) => {
      listeners.delete(fn);
    },
    emit: (event: FluentIframeMessageEvent) => {
      for (const fn of listeners) fn(event);
    },
  };
}

function fakeFrame() {
  const posted: Array<[unknown, string]> = [];
  const contentWindow = { postMessage: (data: unknown, origin: string) => posted.push([data, origin]) };
  return { posted, contentWindow, iframe: { contentWindow } };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createFluentIframeBridge", () => {
  it("answers a JSON-RPC message from the allowed origin with the same id, to that origin only", async () => {
    const win = fakeWindow();
    const frame = fakeFrame();
    createFluentIframeBridge(frame.iframe, { allowedOrigin: MARKETPLACE, executor: deps(), listenOn: win });

    win.emit({
      origin: MARKETPLACE,
      source: frame.contentWindow,
      data: { jsonrpc: "2.0", id: 7, method: "eth_accounts" },
    });
    await tick();

    expect(frame.posted.at(-1)).toEqual([
      { jsonrpc: "2.0", id: 7, result: [SMART_ACCOUNT.address] },
      MARKETPLACE,
    ]);
    // Everything went to the allowed origin only.
    expect(new Set(frame.posted.map(([, origin]) => origin))).toEqual(new Set([MARKETPLACE]));
  });

  it("ignores messages from any other origin, from another window, and non-JSON-RPC data", async () => {
    const win = fakeWindow();
    const frame = fakeFrame();
    const other = fakeFrame();
    let executed = 0;
    createFluentIframeBridge(frame.iframe, {
      allowedOrigin: MARKETPLACE,
      executor: deps({
        account: () => {
          executed += 1;
          return SMART_ACCOUNT;
        },
      }),
      listenOn: win,
    });

    win.emit({
      origin: "https://evil.example",
      source: frame.contentWindow,
      data: { jsonrpc: "2.0", id: 1, method: "eth_accounts" },
    });
    win.emit({
      origin: MARKETPLACE,
      source: other.contentWindow,
      data: { jsonrpc: "2.0", id: 2, method: "eth_accounts" },
    });
    win.emit({ origin: MARKETPLACE, source: frame.contentWindow, data: { hello: "world" } });
    win.emit({ origin: MARKETPLACE, source: frame.contentWindow, data: "eth_accounts" });
    await tick();

    expect(frame.posted).toEqual([]);
    expect(other.posted).toEqual([]);
    expect(executed).toBe(0);
  });

  it("reports a handler failure as a JSON-RPC error with the handler's code", async () => {
    const win = fakeWindow();
    const frame = fakeFrame();
    createFluentIframeBridge(frame.iframe, { allowedOrigin: MARKETPLACE, executor: deps(), listenOn: win });

    win.emit({
      origin: MARKETPLACE,
      source: frame.contentWindow,
      data: { jsonrpc: "2.0", id: "abc", method: "wallet_switchEthereumChain", params: [] },
    });
    await tick();

    expect(frame.posted.at(-1)).toEqual([
      {
        jsonrpc: "2.0",
        id: "abc",
        error: { code: 4200, message: expect.stringContaining("wallet_switchEthereumChain") },
      },
      MARKETPLACE,
    ]);
  });

  it("pushes accountsChanged and chainChanged to the iframe, and stops after dispose", async () => {
    const win = fakeWindow();
    const frame = fakeFrame();
    const bridge = createFluentIframeBridge(frame.iframe, {
      allowedOrigin: MARKETPLACE,
      executor: deps(),
      listenOn: win,
    });

    bridge.notifyAccountsChanged([]);
    bridge.notifyChainChanged(20994);
    bridge.dispose();
    bridge.notifyAccountsChanged([SMART_ACCOUNT.address!]);
    win.emit({
      origin: MARKETPLACE,
      source: frame.contentWindow,
      data: { jsonrpc: "2.0", id: 9, method: "eth_accounts" },
    });
    await tick();

    expect(frame.posted).toEqual([
      [{ jsonrpc: "2.0", method: "accountsChanged", params: [[]] }, MARKETPLACE],
      [{ jsonrpc: "2.0", method: "chainChanged", params: ["0x5202"] }, MARKETPLACE],
    ]);
    expect(win.listeners.size).toBe(0);
  });
});

describe("error codes the iframe sees", () => {
  async function errorFor(signTypedData: () => Promise<never>) {
    const win = fakeWindow();
    const frame = fakeFrame();
    createFluentIframeBridge(frame.iframe, {
      allowedOrigin: MARKETPLACE,
      executor: deps({
        sign: {
          signMessage: async () => {
            throw new Error("not expected");
          },
          signTypedData,
        },
      }),
      listenOn: win,
    });
    win.emit({
      origin: MARKETPLACE,
      source: frame.contentWindow,
      data: { jsonrpc: "2.0", id: 1, method: "eth_signTypedData_v4", params: [SMART_ACCOUNT.address, ORDER] },
    });
    await tick();
    return (frame.posted.at(-1)?.[0] as { error: { code: number; message: string } }).error;
  }

  it("a dismissed review is 4001 (user rejected)", async () => {
    expect(
      await errorFor(async () => {
        throw new FluentReviewRejectedError("signature");
      }),
    ).toEqual({ code: 4001, message: "User rejected Fluent signature review" });
  });

  it("any other widget failure is -32603 with the widget's message", async () => {
    expect(
      await errorFor(async () => {
        throw new Error("bundler unavailable");
      }),
    ).toEqual({ code: -32603, message: "bundler unavailable" });
  });
});

describe("hosted mode", () => {
  it.each([
    ["eth_signTypedData_v4", [SMART_ACCOUNT.address, ORDER]],
    ["personal_sign", ["0x6869", SMART_ACCOUNT.address]],
    ["eth_sendTransaction", [{ from: SMART_ACCOUNT.address, to: EXCHANGE }]],
  ])("%s rejects with the widget's hosted_not_supported code", async (method, params) => {
    const handler = createFluentIframeRpcHandler(deps({ authMode: "hosted" }));
    await expect(handler({ method, params })).rejects.toMatchObject({
      name: "FluentAuthError",
      code: "hosted_not_supported",
    });
  });

  it("reaches the iframe as 4200 with the code in the message", async () => {
    const win = fakeWindow();
    const frame = fakeFrame();
    createFluentIframeBridge(frame.iframe, {
      allowedOrigin: MARKETPLACE,
      executor: deps({ authMode: "hosted" }),
      listenOn: win,
    });
    win.emit({
      origin: MARKETPLACE,
      source: frame.contentWindow,
      data: { jsonrpc: "2.0", id: 1, method: "eth_sendTransaction", params: [{ from: SMART_ACCOUNT.address, to: EXCHANGE }] },
    });
    await tick();
    expect(frame.posted.at(-1)?.[0]).toMatchObject({
      error: { code: 4200, message: expect.stringContaining("hosted_not_supported") },
    });
  });
});

describe("legacy eth_signTypedData param order", () => {
  it("accepts [typedData, address] as MetaMask sends it", async () => {
    const seen: unknown[] = [];
    const handler = createFluentIframeRpcHandler(
      deps({
        sign: {
          signMessage: async () => {
            throw new Error("not expected");
          },
          signTypedData: async (typedData) => {
            seen.push(typedData);
            return SIGNATURE;
          },
        },
      }),
    );
    await handler({ method: "eth_signTypedData", params: [ORDER, SMART_ACCOUNT.address] });
    expect(seen).toEqual([ORDER]);
  });
});

describe("eth_sendTransaction params that are not hex", () => {
  it.each([
    [{ from: SMART_ACCOUNT.address, to: EXCHANGE, value: "16" }],
    [{ from: SMART_ACCOUNT.address, to: EXCHANGE, value: 16 }],
    [{ from: SMART_ACCOUNT.address, to: EXCHANGE, data: "deadbeef" }],
  ])("rejects %o with -32602 instead of sending something else", async (tx) => {
    let sent = 0;
    const handler = createFluentIframeRpcHandler(
      deps({
        sendCalls: async () => {
          sent += 1;
          return { hash: BUNDLE_HASH as Hash, hashes: [BUNDLE_HASH as Hash], atomic: true, sponsored: false };
        },
      }),
    );
    await expect(handler({ method: "eth_sendTransaction", params: [tx] })).rejects.toMatchObject({
      code: -32602,
    });
    expect(sent).toBe(0);
  });
});

describe("bridge configuration and notifications", () => {
  it.each(["*", "", "market.example", "ftp://market.example"])(
    "refuses allowedOrigin %j at construction",
    (allowedOrigin) => {
      expect(() =>
        createFluentIframeBridge(fakeFrame().iframe, {
          allowedOrigin,
          executor: deps(),
          listenOn: fakeWindow(),
        }),
      ).toThrow(/allowedOrigin/);
    },
  );

  it("does not answer, or execute, a JSON-RPC notification (no id)", async () => {
    const win = fakeWindow();
    const frame = fakeFrame();
    let executed = 0;
    createFluentIframeBridge(frame.iframe, {
      allowedOrigin: MARKETPLACE,
      executor: deps({
        account: () => {
          executed += 1;
          return SMART_ACCOUNT;
        },
      }),
      listenOn: win,
    });
    win.emit({ origin: MARKETPLACE, source: frame.contentWindow, data: { jsonrpc: "2.0", method: "eth_accounts" } });
    await tick();
    expect(frame.posted).toEqual([]);
    expect(executed).toBe(0);
  });

  it("answers the iframe element that is current at message time, not the one at construction", async () => {
    const win = fakeWindow();
    const first = fakeFrame();
    const second = fakeFrame();
    let current = first;
    const iframe = {
      get contentWindow() {
        return current.contentWindow;
      },
    };
    createFluentIframeBridge(iframe, { allowedOrigin: MARKETPLACE, executor: deps(), listenOn: win });
    current = second;
    win.emit({
      origin: MARKETPLACE,
      source: second.contentWindow,
      data: { jsonrpc: "2.0", id: 3, method: "eth_chainId" },
    });
    await tick();
    expect(first.posted).toEqual([]);
    expect(second.posted.at(-1)).toEqual([{ jsonrpc: "2.0", id: 3, result: "0x5202" }, MARKETPLACE]);
  });
});

describe("dispose", () => {
  it("still delivers the reply to a request accepted before dispose", async () => {
    const win = fakeWindow();
    const frame = fakeFrame();
    let release!: () => void;
    const bridge = createFluentIframeBridge(frame.iframe, {
      allowedOrigin: MARKETPLACE,
      executor: deps({
        sign: {
          signMessage: async () => {
            throw new Error("not expected");
          },
          signTypedData: () =>
            new Promise<`0x${string}`>((resolve) => {
              release = () => resolve(SIGNATURE);
            }),
        },
      }),
      listenOn: win,
    });
    win.emit({
      origin: MARKETPLACE,
      source: frame.contentWindow,
      data: { jsonrpc: "2.0", id: 5, method: "eth_signTypedData_v4", params: [SMART_ACCOUNT.address, ORDER] },
    });
    await tick();
    bridge.dispose();
    release();
    await tick();
    expect(frame.posted.at(-1)).toEqual([{ jsonrpc: "2.0", id: 5, result: SIGNATURE }, MARKETPLACE]);
  });
});

describe("review follow-ups", () => {
  it("answers enable, which @ledgerhq/iframe-provider's enable() sends, like eth_accounts", async () => {
    expect(await createFluentIframeRpcHandler(deps())({ method: "enable" })).toEqual([SMART_ACCOUNT.address]);
  });

  it("refuses params that are not an array with -32602", async () => {
    await expect(
      createFluentIframeRpcHandler(deps())({ method: "eth_accounts", params: "oops" as unknown as unknown[] }),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it("normalises allowedOrigin so a trailing slash or upper-case host still matches", async () => {
    const win = fakeWindow();
    const frame = fakeFrame();
    createFluentIframeBridge(frame.iframe, {
      allowedOrigin: "HTTPS://Market.Example/",
      executor: deps(),
      listenOn: win,
    });
    win.emit({
      origin: MARKETPLACE,
      source: frame.contentWindow,
      data: { jsonrpc: "2.0", id: 1, method: "eth_chainId" },
    });
    await tick();
    expect(frame.posted.at(-1)).toEqual([{ jsonrpc: "2.0", id: 1, result: "0x5202" }, MARKETPLACE]);
  });

  it("announces the chain and accounts once, before the first reply, so a page that loaded late still learns them", async () => {
    const win = fakeWindow();
    const frame = fakeFrame();
    createFluentIframeBridge(frame.iframe, { allowedOrigin: MARKETPLACE, executor: deps(), listenOn: win });
    for (const id of [1, 2]) {
      win.emit({ origin: MARKETPLACE, source: frame.contentWindow, data: { jsonrpc: "2.0", id, method: "eth_chainId" } });
    }
    await tick();
    expect(frame.posted.map(([m]) => m)).toEqual([
      { jsonrpc: "2.0", method: "chainChanged", params: ["0x5202"] },
      { jsonrpc: "2.0", method: "accountsChanged", params: [[SMART_ACCOUNT.address]] },
      { jsonrpc: "2.0", id: 1, result: "0x5202" },
      { jsonrpc: "2.0", id: 2, result: "0x5202" },
    ]);
  });

  it("maps only hosted_not_supported to 4200; another FluentAuthError is -32603 with its code", async () => {
    const win = fakeWindow();
    const frame = fakeFrame();
    createFluentIframeBridge(frame.iframe, {
      allowedOrigin: MARKETPLACE,
      executor: deps({
        sign: {
          signMessage: async () => {
            throw new Error("not expected");
          },
          signTypedData: async () => {
            throw new FluentAuthError("origin_not_allowed", "nope");
          },
        },
      }),
      listenOn: win,
    });
    win.emit({
      origin: MARKETPLACE,
      source: frame.contentWindow,
      data: { jsonrpc: "2.0", id: 1, method: "eth_signTypedData_v4", params: [SMART_ACCOUNT.address, ORDER] },
    });
    await tick();
    expect(frame.posted.at(-1)?.[0]).toMatchObject({ error: { code: -32603, message: "origin_not_allowed: nope" } });
  });
});
