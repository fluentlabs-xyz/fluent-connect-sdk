import { useEffect, useMemo, useRef, type RefObject } from "react";
import { createPublicClient } from "viem";

import { createFluentRpcTransport } from "../../core/rpc";
import { createFluentIframeBridge, type FluentIframeElement } from "../iframeBridge";
import { useFluentWidget } from "../widgetContext";
import { useFluentWidgetNetwork } from "../widgetNetworkContext";

/** The options of `useFluentIframeBridge`. */
export type UseFluentIframeBridgeOptions = {
  /**
   * The exact origin the embedded page is served from. Messages from any other origin are
   * dropped without a reply: this is the only origin check in the exchange.
   */
  allowedOrigin: string;
};

/**
 * Lets a page embedded in `iframeRef` use the account signed in here, over the
 * JSON-RPC `postMessage` protocol `@ledgerhq/iframe-provider` speaks. The bridge lives
 * while the component is mounted; the bridge states the chain and account before its
 * first reply, and sign-in and sign-out reach the iframe as `accountsChanged`.
 *
 * @param iframeRef The `<iframe>` the embedded page runs in; read on every message, so an
 * element swapped in after mount is still answered.
 * @param options `allowedOrigin`, the one origin whose messages are answered.
 * @throws `Error`, from the effect that builds the bridge (so to the nearest error boundary),
 * when `allowedOrigin` is not an `http:` or `https:` origin: `"*"` and a bare host are
 * refused.
 *
 * @example
 * ```tsx
 * import { useFluentIframeBridge } from "@fluent.xyz/connect";
 * import { useRef } from "react";
 *
 * export function Marketplace() {
 *   const iframeRef = useRef<HTMLIFrameElement>(null);
 *   useFluentIframeBridge(iframeRef, { allowedOrigin: "https://market.example" });
 *   return <iframe ref={iframeRef} src="https://market.example/collection/cards" />;
 * }
 * ```
 */
export function useFluentIframeBridge(
  iframeRef: RefObject<FluentIframeElement | null>,
  { allowedOrigin }: UseFluentIframeBridgeOptions,
): void {
  const { widget } = useFluentWidget();
  const { chain } = useFluentWidgetNetwork();

  // The handler reads the widget at call time, so the bridge is not rebuilt on every
  // render; the ref always points at the latest API.
  const widgetRef = useRef(widget);
  widgetRef.current = widget;

  const rpc = useMemo(
    () => createPublicClient({ chain, transport: createFluentRpcTransport(chain) }),
    [chain],
  );

  const bridgeRef = useRef<ReturnType<typeof createFluentIframeBridge> | null>(null);

  useEffect(() => {
    // Resolved on every message, so an <iframe> swapped in after mount is still answered.
    const iframe: FluentIframeElement = {
      get contentWindow() {
        return iframeRef.current?.contentWindow ?? null;
      },
    };
    const bridge = createFluentIframeBridge(iframe, {
      allowedOrigin,
      executor: {
        account: () => widgetRef.current.account,
        chainId: chain.id,
        sign: {
          signMessage: (params) => widgetRef.current.signMessage(params),
          signTypedData: (typedData) => widgetRef.current.signTypedData(typedData),
        },
        sendCalls: (calls) => widgetRef.current.createBatchOp({ calls }).execute(),
        rpc: (method, params) =>
          rpc.request({ method, params } as Parameters<typeof rpc.request>[0]),
      },
    });
    bridge.notifyChainChanged(chain.id);
    bridgeRef.current = bridge;
    return () => {
      bridge.dispose();
      bridgeRef.current = null;
    };
  }, [iframeRef, allowedOrigin, chain.id, rpc]);

  const address = widget.account.address;
  useEffect(() => {
    bridgeRef.current?.notifyAccountsChanged(address ? [address] : []);
  }, [address]);
}
