# Iframe bridge

How a page the App embeds in an `<iframe>` uses the Widget account as its wallet. The Iframe
bridge answers the embedded page's wallet requests with the widget: the same Widget account, the
same Review and the same Batch operations as the App's own requests. The terms used here are
defined in [concepts.md](../concepts.md).

## Set it up

Call `useFluentIframeBridge(iframeRef, { allowedOrigin })` in a component rendered inside
`<FluentWidget>`:

- `iframeRef` is a ref to the `<iframe>`, typed `RefObject<FluentIframeElement | null>`. A
  `useRef<HTMLIFrameElement>(null)` fits it. `FluentIframeElement` is the element reduced to the
  window the bridge replies to; the bridge reads it on every message, so an element swapped in
  after mount is still answered.
- `allowedOrigin` is the exact origin the embedded page is served from, such as
  `"https://market.example"`. It must be an `http:` or `https:` origin: `"*"` and a bare host are
  refused, with an `Error` thrown from the effect that builds the bridge, so the nearest error
  boundary catches it. Messages from any other origin, or from any window other than the
  iframe's, are dropped without a reply: this is the only origin check in the exchange.

The bridge lives while the component is mounted. A request the embedded page sent before the
component unmounts is still answered, as long as the `<iframe>` element is still mounted.

```tsx
import {
  FluentWidget,
  useFluentIframeBridge,
  type FluentWidgetConfig,
} from "@fluent.xyz/connect";
import { useRef } from "react";

const config: FluentWidgetConfig = {
  appId: "app_0123456789abcdef0123456789abcdef",
  privyClientId: "client-0123456789abcdef",
  network: "testnet",
};

function Marketplace() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  useFluentIframeBridge(iframeRef, { allowedOrigin: "https://market.example" });
  return (
    <iframe
      ref={iframeRef}
      src="https://market.example/collection/cards"
      title="Marketplace"
      style={{ width: "100%", height: 640, border: 0 }}
    />
  );
}

export function App() {
  return <FluentWidget config={config} mode="page" renderPage={() => <Marketplace />} />;
}
```

## Set up the embedded page

The embedded page reaches the bridge through `@ledgerhq/iframe-provider`; the example uses its
version 0.4.3. `new IFrameEthereumProvider()` posts each request to `window.parent` and listens
for the replies and events on the page's own `window`:

```ts
import { IFrameEthereumProvider, RpcError } from "@ledgerhq/iframe-provider";

const provider = new IFrameEthereumProvider();

/** What the page knows of the App's side, kept up to date by the bridge's events. */
export const app: { account?: string; chainId?: number } = {};

// An empty list when no Widget account is signed in.
provider.on("accountsChanged", (accounts) => {
  app.account = accounts[0];
});
// Hex, such as "0x5202" for 20994.
provider.on("chainChanged", (chainId) => {
  app.chainId = Number(chainId);
});

/** Sends `value` wei, written as hex, to `to`; `undefined` when nobody is signed in. */
export async function pay(to: string, value: string): Promise<string | undefined> {
  const [from] = await provider.enable();
  if (!from) return undefined;
  try {
    return await provider.send<unknown[], string>("eth_sendTransaction", [{ from, to, value }]);
  } catch (error) {
    // 4001: the person dismissed the Review.
    if (error instanceof RpcError && error.code === 4001) return undefined;
    throw error;
  }
}
```

- `enable()` sends the method `enable`, which the bridge answers as it answers `eth_accounts`.
  The provider keeps the list of the last `accountsChanged` event, and a later `enable()`
  returns that list without asking the bridge again.
- `send(method, params)` resolves with the reply's `result`. It rejects with `RpcError` for the
  reply's `error`: its `code` is one of [the codes below](#errors-the-embedded-page-receives),
  and its `reason` is the error's message.
- A request with no reply within 240 seconds is rejected with a plain `Error`, while the bridge
  may still answer it later, for example once the person confirms a Review left open that long.
  `new IFrameEthereumProvider({ timeoutMilliseconds })` changes the limit.
- With no options, the provider posts its requests with the target origin `"*"`.
  `new IFrameEthereumProvider({ targetOrigin })` with the App's origin keeps them from reaching
  any other page in the parent window.

## What the embedded page sends

The embedded page speaks JSON-RPC 2.0 over `postMessage`, the protocol of
`@ledgerhq/iframe-provider`: it posts a request to `window.parent`, and the bridge posts the
reply back with the same `id`, holding `result` or `error`. Events carry no `id`. A message
without an `id` gets no reply.

```json
{ "jsonrpc": "2.0", "id": 1, "method": "eth_requestAccounts", "params": [] }
```

A reply that succeeds holds `result`:

```json
{ "jsonrpc": "2.0", "id": 1, "result": ["0x52908400098527886E0F7030069857D2E4169EE7"] }
```

A reply that fails holds `error`, its `code` one of
[the codes below](#errors-the-embedded-page-receives):

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "error": { "code": 4100, "message": "eth_sendTransaction: no account is signed in" }
}
```

The bridge posts two events. `chainChanged` holds the chain id of the Network as unpadded hex,
`"0x5202"` on testnet (20994) and `"0x6313"` on mainnet (25363):

```json
{ "jsonrpc": "2.0", "method": "chainChanged", "params": ["0x5202"] }
```

`accountsChanged` holds one parameter, the list of accounts, so its `params` is a list holding
that list: the address of the Widget account, or an empty list when `widget.account.address` is
empty.

```json
{
  "jsonrpc": "2.0",
  "method": "accountsChanged",
  "params": [["0x52908400098527886E0F7030069857D2E4169EE7"]]
}
```

When the component that calls `useFluentIframeBridge` mounts, the bridge posts `chainChanged`
and then `accountsChanged`. After that, it posts `accountsChanged` each time
`widget.account.address` changes, as on sign-in and on sign-out (an empty list). When the
Network's chain or `allowedOrigin` changes, the hook replaces the bridge with a new one, which
posts `chainChanged` again but not `accountsChanged`. Once the component unmounts, the bridge
posts no more events.

Events the bridge posts before the embedded page has loaded and built its
`IFrameEthereumProvider` are lost: nothing in the page listens for them yet. The events of the
mount can be among them, so the bridge posts `chainChanged` and `accountsChanged` again ahead of
its reply to the page's first request, whether that request succeeds or fails. It does this once
for each bridge, and with `@ledgerhq/iframe-provider` the first request is usually the `enable`
that `enable()` sends.

## What the bridge answers

| Method | Answer |
|---|---|
| `eth_accounts`, `eth_requestAccounts`, `enable` | `widget.account.address` in a list, or `[]` when it is empty. It does not open the connect dialog. |
| `eth_chainId` | The chain id of the widget's Network. |
| `personal_sign` | `widget.signMessage(…)`; a hex message is signed as raw bytes. |
| `eth_signTypedData_v4`, `eth_signTypedData_v3`, `eth_signTypedData` | `widget.signTypedData(…)`. |
| `eth_sendTransaction` | One Batch operation with one call, `widget.createBatchOp({ calls }).execute()`, answered with the operation's `hash` once it is included. `to` is required; `data` and `value` are passed on; gas fields are ignored, because the widget prices the operation itself. |
| `eth_blockNumber`, `eth_call`, `eth_estimateGas`, `eth_feeHistory`, `eth_gasPrice`, `eth_getBalance`, `eth_getBlockByHash`, `eth_getBlockByNumber`, `eth_getCode`, `eth_getLogs`, `eth_getStorageAt`, `eth_getTransactionByHash`, `eth_getTransactionCount`, `eth_getTransactionReceipt`, `eth_maxPriorityFeePerGas`, `net_version` | Forwarded to the Network's chain as they are. |

The signing and sending methods must name the connected Widget account (`from`, or the address
parameter of a signature); the bridge never acts for any other address. Every other method is
refused. The bridge reads the account from `widget.account.address`, which can hold the address of
a Widget session from an earlier visit while `status` is not `"connected"`
([getting-started.md](../getting-started.md)).

A signature shows the Review as `widget.signMessage` and `widget.signTypedData` do, and an
`eth_sendTransaction` as the App's own Batch operations do: see
[concepts.md](../concepts.md#prompt-mode-and-silent-mode).

## Errors the embedded page receives

The bridge answers a failed request with an EIP-1193 or JSON-RPC error `{ code, message }`:

| `code` | When |
|---|---|
| `4001` | The person dismissed the Review of the signature or the Batch operation. |
| `4100` | `widget.account.address` is empty, or the request names another address. |
| `4200` | The method is not one of those above. |
| `-32602` | The parameters are malformed: a missing address, typed data, message, recipient or transaction object, or a value that is not hex. |
| `-32603` | Any other failure, with its message. A `FluentAuthError` arrives as `"<code>: <message>"`. |

An External wallet's refusal in its own prompt is the wallet's error, not a dismissed Review, so
it reaches the iframe as `-32603` with the wallet's message. On the App's side, the codes of the
errors the widget throws are in [errors.md](../errors.md#how-to-branch).
