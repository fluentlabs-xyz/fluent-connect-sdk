/**
 * Invariant (5) of FLU-1639, for generated messages: a message from any origin but the bridge's
 * allowed one is refused with no effect. Nothing is posted to the iframe, neither a reply nor the
 * `chainChanged` and `accountsChanged` the first accepted request announces; no executor member
 * is read or called; and the bridge's state is untouched, so the first request from the allowed
 * origin afterwards still gets the announcement ahead of its reply. Every message comes from the
 * iframe's own window, so only the origin check stands between it and the executor.
 *
 * Two things are faked: the window the bridge listens on, and the iframe's `contentWindow`,
 * which records what the bridge posts. The executor is a stand-in for the widget's behind a
 * `Proxy` that counts every read, introspection and call on it and on whatever it hands out.
 * `iframeBridge.ts` runs for real.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Hash } from "viem";

import {
  createFluentIframeBridge,
  type FluentIframeMessageEvent,
  type FluentIframeRpcExecutor,
} from "./iframeBridge";

const MARKETPLACE = "https://market.example";
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x3333333333333333333333333333333333333333" as const;
const HASH = `0x${"2".repeat(64)}` as Hash;

function fakeWindow() {
  const listeners = new Set<(event: FluentIframeMessageEvent) => void>();
  return {
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
  const posted: unknown[] = [];
  const waiting: Array<{ id: unknown; answered: () => void }> = [];
  const isReplyTo = (data: unknown, id: unknown) =>
    typeof data === "object" && data !== null && "id" in data && data.id === id;
  const contentWindow = {
    postMessage: (data: unknown) => {
      posted.push(data);
      for (const waiter of waiting.filter(({ id }) => isReplyTo(data, id))) {
        waiting.splice(waiting.indexOf(waiter), 1);
        waiter.answered();
      }
    },
  };
  /** Settles once the bridge has posted its reply to request `id`, at once if it already has. */
  const reply = (id: unknown) =>
    new Promise<void>((answered) => {
      if (posted.some((data) => isReplyTo(data, id))) answered();
      else waiting.push({ id, answered });
    });
  return { posted, contentWindow, iframe: { contentWindow }, reply };
}

/**
 * An executor that answers every member and counts every touch: a property read, an `in` check,
 * a key listing or a descriptor lookup on it or on any object or function it hands out, and
 * every call of such a function, so a method the bridge kept from an earlier read counts too.
 */
function countingExecutor() {
  let touched = 0;
  const count = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(object, key, receiver) {
        touched += 1;
        const value: unknown = Reflect.get(object, key, receiver);
        return (typeof value === "object" && value !== null) || typeof value === "function"
          ? count(value)
          : value;
      },
      has(object, key) {
        touched += 1;
        return Reflect.has(object, key);
      },
      ownKeys(object) {
        touched += 1;
        return Reflect.ownKeys(object);
      },
      getOwnPropertyDescriptor(object, key) {
        touched += 1;
        return Reflect.getOwnPropertyDescriptor(object, key);
      },
      apply(fn, thisArg, args) {
        touched += 1;
        return Reflect.apply(fn as (...args: unknown[]) => unknown, thisArg, args);
      },
    });
  const executor: FluentIframeRpcExecutor = count({
    account: () => ({
      address: ADDRESS,
      connected: true,
      executionReady: true,
      executionStatus: "ready" as const,
      type: "smart" as const,
      capabilities: { atomicBatch: true, erc20Gas: true },
    }),
    chainId: 20994,
    sign: {
      signMessage: async () => "0xsigned" as const,
      signTypedData: async () => "0xsigned" as const,
    },
    sendCalls: async () =>
      ({ hash: HASH }) as Awaited<ReturnType<FluentIframeRpcExecutor["sendCalls"]>>,
    rpc: async () => "0x0",
  });
  return { executor, touched: () => touched };
}

/** Origins that are not the allowed one: near misses of it, other origins, and any string. */
const foreignOrigin = fc
  .oneof(
    fc.constantFrom(
      "https://evil.example",
      "http://market.example",
      "https://market.example:8443",
      "https://market.example.evil.example",
      "https://sub.market.example",
      "https://MARKET.example",
      "https://market.example/",
      "https://market.example.",
      "null",
      "*",
      "",
      "market.example",
    ),
    fc.webUrl().map((url) => new URL(url).origin),
    fc.string(),
  )
  .filter((origin) => origin !== MARKETPLACE);

/** A wallet request the bridge would act on, had it come from the allowed origin. */
const walletRequest = fc.record({
  jsonrpc: fc.constant("2.0"),
  id: fc.oneof(fc.integer(), fc.string({ minLength: 1 })),
  method: fc.constantFrom(
    "enable",
    "eth_accounts",
    "eth_requestAccounts",
    "eth_chainId",
    "personal_sign",
    "eth_signTypedData_v4",
    "eth_sendTransaction",
    "eth_call",
    "eth_getBalance",
  ),
  params: fc.oneof(
    fc.constant<unknown[]>(["0x68656c6c6f", ADDRESS]),
    fc.constant<unknown[]>([ADDRESS, { domain: {}, types: {}, primaryType: "Mail", message: {} }]),
    fc.constant<unknown[]>([{ from: ADDRESS, to: OTHER, value: "0x1" }]),
    fc.array(fc.jsonValue()),
  ),
});

describe("invariant (5): the Iframe bridge refuses a foreign origin with no effect", () => {
  it("posts nothing, touches no executor and keeps its state for a foreign origin", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(foreignOrigin, walletRequest), { minLength: 1, maxLength: 5 }),
        async (messages) => {
          const win = fakeWindow();
          const frame = fakeFrame();
          const { executor, touched } = countingExecutor();
          const bridge = createFluentIframeBridge(frame.iframe, {
            allowedOrigin: MARKETPLACE,
            executor,
            listenOn: win,
          });
          const touchedAtStart = touched();

          for (const [origin, data] of messages) {
            win.emit({ origin, source: frame.contentWindow, data });
          }
          // The bridge accepts or drops a message inside its listener, and an accepted request
          // reads the executor and posts its announcement before the listener returns.
          expect(frame.posted).toEqual([]);
          expect(touched()).toBe(touchedAtStart);

          // The refused messages left the bridge as it was: the first allowed request is still
          // the one the announcement goes out ahead of.
          win.emit({
            origin: MARKETPLACE,
            source: frame.contentWindow,
            data: { jsonrpc: "2.0", id: "probe", method: "eth_chainId" },
          });
          await frame.reply("probe");
          expect(frame.posted).toEqual([
            { jsonrpc: "2.0", method: "chainChanged", params: ["0x5202"] },
            { jsonrpc: "2.0", method: "accountsChanged", params: [[ADDRESS]] },
            { jsonrpc: "2.0", id: "probe", result: "0x5202" },
          ]);
          bridge.dispose();
        },
      ),
    );
  });
});
