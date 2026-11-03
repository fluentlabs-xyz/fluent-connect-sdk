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

The embedded page needs no library: the bridge speaks JSON-RPC 2.0 over `postMessage`, and this
wire format is what the bridge guarantees. The page posts each request to `window.parent`, and
the bridge posts the reply to the page's window with the same `id`.

A request is an object with `jsonrpc: "2.0"`, a string `method`, an `id` and, when the method
takes any, positional `params` in a list:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "eth_requestAccounts", "params": [] }
```

- The `id` is a number or a string, and the reply carries it back as it was sent. A message with
  no `id`, or with `id: null`, gets no reply and runs nothing.
- A message that is not an object with `jsonrpc: "2.0"` and a string `method` is ignored.
- `params` that is not a list is refused with `-32602`.
- The method `enable` is answered as `eth_accounts` is, for clients that send it.
- The bridge sets no time limit: a request waiting on a Review is answered when the person
  decides, however long that takes.

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

The bridge posts every reply and event with the target origin `allowedOrigin`, so the browser
delivers them only while the iframe shows a page of that origin. The page posts its requests
with the App's origin as the target origin, not `"*"`, so that they reach no other page in the
parent window, and its `message` listener checks `event.source` and `event.origin` the same way:

```ts
/** The origin of the App that embeds this page. */
const APP_ORIGIN = "https://app.example";

/** The `error` of a failed reply. */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

type Message = {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown[];
  result?: unknown;
  error?: { code: number; message: string };
};

/** What the page knows of the App's side, kept up to date by the bridge's events. */
export const app: { account?: string; chainId?: number } = {};

type Waiting = { resolve: (result: unknown) => void; reject: (error: Error) => void };
const waiting = new Map<number, Waiting>();
let nextId = 1;

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window.parent || event.origin !== APP_ORIGIN) return;
  const message = event.data as Message;
  if (message?.jsonrpc !== "2.0") return;
  if (message.method === "accountsChanged") {
    // An empty list when no Widget account is signed in.
    app.account = (message.params?.[0] as string[])[0];
  } else if (message.method === "chainChanged") {
    // Hex, such as "0x5202" for 20994.
    app.chainId = Number(message.params?.[0]);
  } else if (message.id !== undefined) {
    const request = waiting.get(message.id);
    waiting.delete(message.id);
    if (message.error) request?.reject(new RpcError(message.error.code, message.error.message));
    else request?.resolve(message.result);
  }
});

export function request(method: string, params: unknown[] = []): Promise<unknown> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, APP_ORIGIN);
  });
}

/** Sends `value` wei, written as hex, to `to`; `undefined` when nobody is signed in. */
export async function pay(to: string, value: string): Promise<string | undefined> {
  const [from] = (await request("eth_requestAccounts")) as string[];
  if (!from) return undefined;
  try {
    return (await request("eth_sendTransaction", [{ from, to, value }])) as string;
  } catch (error) {
    // 4001: the person dismissed the Review.
    if (error instanceof RpcError && error.code === 4001) return undefined;
    throw error;
  }
}
```

### Events

The bridge posts two events, which carry no `id`. `chainChanged` holds the chain id of the
Network as unpadded hex, `"0x5202"` on testnet (20994) and `"0x6313"` on mainnet (25363):

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

Events the bridge posts before the embedded page has added its `message` listener are lost, and
the events of the mount can be among them. So the bridge posts `chainChanged` and
`accountsChanged` again ahead of its reply to the page's first request, whether that request
succeeds or fails. It does this once for each bridge.

### A ready-made client

`@ledgerhq/iframe-provider` speaks this protocol, and its `IFrameEthereumProvider` can stand in
for the code above. The package is archived: its last release is 0.4.3, from January 2023, and
its repository takes no more changes. The wire format above is what the bridge keeps working;
the package is one client of it. Two of its defaults differ from the example: it posts with the
target origin `"*"` unless it is built with `new IFrameEthereumProvider({ targetOrigin })`, and
it rejects a request with no reply within 240 seconds, while the bridge may still answer it
later, for example once the person confirms a Review left open that long.

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
