import { type Address, type Hex, hexToBigInt, isAddress, isHex, toHex } from "viem";

import { FluentAuthError } from "../core/authToken";
import type { FluentWidgetAuthMode } from "../core/config";
import type { FluentEncodedBatchCall, FluentExecuteResult, FluentWidgetAccount } from "./batchOperation";
import { FluentReviewRejectedError } from "./reviewRejected";
import type { FluentSignApi, FluentTypedDataRequest } from "./signRequest";

/** One JSON-RPC request as the embedded page sends it: method plus positional params. */
export type FluentIframeRpcRequest = {
  method: string;
  params?: unknown[];
};

/**
 * The widget surface answering an embedded page's wallet calls needs. Every field is
 * injected so the handler is pure: it never reads the DOM or React state on its own.
 */
export type FluentIframeRpcExecutor = {
  authMode: FluentWidgetAuthMode;
  /** Read at call time: the account changes while the bridge lives. */
  account: () => FluentWidgetAccount;
  chainId: number;
  sign: FluentSignApi;
  sendCalls: (calls: FluentEncodedBatchCall[]) => Promise<FluentExecuteResult>;
  /** Read-only chain access for the methods the wallet does not answer itself. */
  rpc: (method: string, params?: unknown[]) => Promise<unknown>;
};

/**
 * Methods the bridge forwards to the chain RPC as they are. An allowlist rather than
 * "everything else": a method that is not here is refused, so a new wallet-side method
 * never slips through to the node unnoticed.
 */
const READ_ONLY_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "net_version",
]);

export type FluentIframeRpcHandler = (request: FluentIframeRpcRequest) => Promise<unknown>;

/**
 * An error the embedded page understands: EIP-1193 provider codes (4001 user rejected,
 * 4100 unauthorized, 4200 unsupported method) and EIP-1474 JSON-RPC codes (-32602
 * invalid params, -32603 internal error).
 */
export class FluentIframeRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "FluentIframeRpcError";
  }
}

export function createFluentIframeRpcHandler(executor: FluentIframeRpcExecutor): FluentIframeRpcHandler {
  const invalid = (method: string, what: string) =>
    new FluentIframeRpcError(-32602, `${method}: expected ${what}`);

  /**
   * The embedded page names the address it wants to sign or send as. It must be the
   * account signed in here: the bridge never acts for anyone else, and it never acts
   * while nobody is signed in.
   */
  const assertOwnAddress = (candidate: unknown, method: string): void => {
    const address = executor.account().address;
    if (!address) {
      throw new FluentIframeRpcError(4100, `${method}: no account is signed in`);
    }
    if (typeof candidate !== "string" || !isAddress(candidate)) {
      throw invalid(method, "an address");
    }
    if (candidate.toLowerCase() !== address.toLowerCase()) {
      throw new FluentIframeRpcError(4100, `${method}: ${candidate} is not the signed-in account`);
    }
  };

  /** Write methods need a signer on this page; hosted mode has none, as `signMessage` says. */
  const assertDirectMode = () => {
    if (executor.authMode === "hosted") {
      throw new FluentAuthError(
        "hosted_not_supported",
        'The iframe bridge needs authMode: "direct" — there is no hosted signer to ask.',
      );
    }
  };

  const parseTypedData = (payload: unknown, method: string): FluentTypedDataRequest => {
    const value = typeof payload === "string" ? safeJsonParse(payload) : payload;
    if (!value || typeof value !== "object") {
      throw invalid(method, "EIP-712 typed data");
    }
    return value as FluentTypedDataRequest;
  };

  const parseHex = (value: unknown, method: string, what: string): Hex | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string" || !isHex(value)) throw invalid(method, `${what} as hex`);
    return value;
  };

  return async (request) => {
    const { method } = request;
    const params = request.params ?? [];
    switch (method) {
      case "eth_accounts":
      case "eth_requestAccounts": {
        const address = executor.account().address;
        return address ? [address] : [];
      }
      case "eth_chainId":
        return toHex(executor.chainId);
      case "eth_signTypedData_v4":
      case "eth_signTypedData_v3": {
        assertDirectMode();
        assertOwnAddress(params[0], method);
        return executor.sign.signTypedData(parseTypedData(params[1], method));
      }
      case "eth_signTypedData": {
        // The legacy method is [typedData, address] in MetaMask and [address, typedData] in
        // some libraries; whichever param is the address is the signer.
        assertDirectMode();
        const [first, second] = params;
        const addressFirst = typeof first === "string" && isAddress(first);
        assertOwnAddress(addressFirst ? first : second, method);
        return executor.sign.signTypedData(parseTypedData(addressFirst ? second : first, method));
      }
      case "personal_sign": {
        // personal_sign is [message, address]; a hex message is the bytes to sign, not text.
        assertDirectMode();
        assertOwnAddress(params[1], method);
        const message = params[0];
        if (typeof message !== "string") throw invalid(method, "a message");
        return executor.sign.signMessage({ message: isHex(message) ? { raw: message } : message });
      }
      case "eth_sendTransaction": {
        assertDirectMode();
        const tx = params[0];
        if (!tx || typeof tx !== "object") throw invalid(method, "a transaction object");
        const { from, to, data, value } = tx as Record<string, unknown>;
        assertOwnAddress(from, method);
        if (typeof to !== "string" || !isAddress(to)) throw invalid(method, "a recipient");
        const valueHex = parseHex(value, method, "value");
        // Gas fields are dropped on purpose: the widget prices its own userOp or transaction.
        const result = await executor.sendCalls([
          {
            to,
            data: parseHex(data, method, "data") ?? "0x",
            value: valueHex === undefined ? 0n : hexToBigInt(valueHex),
          },
        ]);
        return result.hash;
      }
      default:
        if (READ_ONLY_METHODS.has(method)) {
          return executor.rpc(method, request.params);
        }
        throw new FluentIframeRpcError(4200, `Unsupported method: ${method}`);
    }
  };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The part of a `message` event the bridge reads; named so tests can build one without a DOM. */
export type FluentIframeMessageEvent = {
  origin: string;
  source: unknown;
  data: unknown;
};

type MessageListener = (event: FluentIframeMessageEvent) => void;

/** Where the bridge listens for the iframe's messages; `window` outside tests. */
export type FluentIframeListenTarget = {
  addEventListener: (type: "message", listener: MessageListener) => void;
  removeEventListener: (type: "message", listener: MessageListener) => void;
};

/**
 * The iframe element, reduced to the window the bridge replies to. Read on every
 * message, so an element swapped in later is picked up without rebuilding the bridge.
 */
export type FluentIframeElement = {
  contentWindow: { postMessage: (message: unknown, targetOrigin: string) => void } | null;
};

export type FluentIframeBridgeOptions = {
  /**
   * The exact origin the marketplace is served from. Messages from any other origin are
   * dropped without a reply: `@ledgerhq/iframe-provider` posts with `targetOrigin "*"`
   * and checks nothing itself, so this is the only origin check in the exchange.
   */
  allowedOrigin: string;
  executor: FluentIframeRpcExecutor;
  listenOn?: FluentIframeListenTarget;
};

export type FluentIframeBridge = {
  /** Tell the iframe who is signed in now: `[]` on sign-out. */
  notifyAccountsChanged: (accounts: readonly Address[]) => void;
  notifyChainChanged: (chainId: number) => void;
  /** Stop listening and stop notifying; the iframe gets no further messages. */
  dispose: () => void;
};

type JsonRpcId = string | number | null;

function isJsonRpcRequest(
  data: unknown,
): data is { jsonrpc: "2.0"; id?: JsonRpcId; method: string; params?: unknown[] } {
  if (!data || typeof data !== "object") return false;
  const { jsonrpc, method } = data as Record<string, unknown>;
  return jsonrpc === "2.0" && typeof method === "string";
}

/**
 * Answers an embedded page's EIP-1193 calls with the widget, over the JSON-RPC 2.0
 * `postMessage` protocol `@ledgerhq/iframe-provider` speaks, which marketplace
 * white-label frontends embed: a request is `{jsonrpc, id, method, params}` posted to `window.parent`, the reply
 * carries the same `id` with `result` or `error`, and events are `{jsonrpc, method, params}`
 * without an `id`.
 */
export function createFluentIframeBridge(
  iframe: FluentIframeElement,
  options: FluentIframeBridgeOptions,
): FluentIframeBridge {
  const { allowedOrigin, executor } = options;
  if (!/^https?:\/\/[^/*]+$/.test(allowedOrigin)) {
    // "*" or a URL with a path would either answer everyone or never match `event.origin`.
    throw new Error(`allowedOrigin must be an exact origin such as https://market.example, got "${allowedOrigin}"`);
  }
  const listenOn = options.listenOn ?? (globalThis.window as FluentIframeListenTarget);
  const handle = createFluentIframeRpcHandler(executor);
  let disposed = false;

  const post = (message: unknown) => {
    if (disposed) return;
    iframe.contentWindow?.postMessage(message, allowedOrigin);
  };

  const listener: MessageListener = (event) => {
    if (event.origin !== allowedOrigin) return;
    if (!iframe.contentWindow || event.source !== iframe.contentWindow) return;
    if (!isJsonRpcRequest(event.data)) return;
    const { id, method, params } = event.data;
    // A JSON-RPC notification (no id) expects no reply; a wallet call always carries one.
    if (id === undefined || id === null) return;
    void handle({ method, params }).then(
      (result) => post({ jsonrpc: "2.0", id, result }),
      (error: unknown) => post({ jsonrpc: "2.0", id, error: toRpcError(error) }),
    );
  };
  listenOn.addEventListener("message", listener);

  return {
    notifyAccountsChanged: (accounts) =>
      post({ jsonrpc: "2.0", method: "accountsChanged", params: [accounts] }),
    notifyChainChanged: (chainId) =>
      post({ jsonrpc: "2.0", method: "chainChanged", params: [toHex(chainId)] }),
    dispose: () => {
      disposed = true;
      listenOn.removeEventListener("message", listener);
    },
  };
}

/**
 * The error as the iframe sees it. A dismissed review is the user rejecting (4001); a
 * hosted-mode refusal is the method being unsupported here (4200) and keeps the widget's
 * `hosted_not_supported` code in the message; any other widget failure is an internal
 * error that keeps its message, so the marketplace can show it.
 */
function toRpcError(error: unknown): { code: number; message: string } {
  if (error instanceof FluentIframeRpcError) return { code: error.code, message: error.message };
  if (error instanceof FluentReviewRejectedError) return { code: 4001, message: error.message };
  if (error instanceof FluentAuthError) return { code: 4200, message: `${error.code}: ${error.message}` };
  const message = error instanceof Error ? error.message : String(error);
  return { code: -32603, message };
}
