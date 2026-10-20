# The widget in a host that owns its wagmi, query client and SSR

Research for [FLU-1532](https://linear.app/fluentlabs-xyz/issue/FLU-1532). Written against
`@fluent.xyz/connect@0.4.2` as published, and against the source at commit
**`80a69dbd`** (`80a69db`, `devel`) plus this branch's own change (§3a). Every `file:line` below
is at that state.

The Issue was written against `0.4.0`, and two of the things it describes have been fixed since:
[#120](https://github.com/fluentlabs-xyz/fluent-connect-sdk/pull/120) (FLU-1559) made the package
entry importable without a bundler, and
[#134](https://github.com/fluentlabs-xyz/fluent-connect-sdk/pull/134) pinned
`@wagmi/connectors` as a direct dependency. §2 records both the old and the current state,
because what was fixed and how is the best evidence we have for what the remaining fixes cost.

**A word on words.** `CONTEXT.md` calls the builder whose app embeds the widget the **App**. This
document says "host" throughout, because that is the language of the Issue it answers and of the
conversation with Zenkai; read it as **App**. The source and `INTEGRATION.md` changes this branch
makes use **App**.

Two changes to the package come with it. The Issue is research-only, but two of the things it
asks about turned out small enough to do rather than schedule: the TanStack Query half of
question 3 (§3a) and the server render (§3b). Everything else here stays a recommendation.

## Why

Zenkai (Giannis, Telegram, 18 Sep) runs React Router v7 with SSR, TanStack Query and their own
wagmi config, with Privy isolated as client-only. They cannot integrate `@fluent.xyz/connect`
cleanly, and the only advice we had was "mount it as a client-only island and keep every signing
page inside `renderPage`". This asks whether that is the whole truth, what it would take to do
better, and in what order.

## The short answer

Three separate things were in the way, and they are usually discussed as one:

1. **Packaging — fixed in 0.4.1.** `dist/index.js` carried a stylesheet import and a dependency
   whose ESM Node cannot resolve. `node -e "import('@fluent.xyz/connect')"` now exits 0, and
   `packages/connect/test/entryImport.node.test.ts` keeps it that way.
2. **The server render — fixed on this branch (§3b).** Four places demanded a browser during
   render, not the one the Issue names: AppKit's `useAppKit()`, two browser-derived values in
   `FluentConnectSDK`'s constructor, and one `window.location.origin`. A stock React Router v7
   SSR app now returns 200 with the widget's real markup, hydrates with no errors, and opens
   AppKit's modal from that page.
3. **Provider ownership — the query half fixed (§3a), the wagmi half open and expensive.** The
   widget mounts its own
   `WagmiProvider` and `QueryClientProvider` and renders the host *inside* them. Measured at
   0.4.2: a host component rendered through `renderPage` sees the widget's wagmi config and the
   widget's query client, not its own, and does not see the wallet the host connected. This is
   not a conflict between two configs — it is the host's config being silently replaced for the
   whole subtree.

Nothing in the package reads `window`, `document`, `localStorage` or `navigator` at import time —
which is why (2) came to four small fixes rather than a rewrite.

One documentation trap, introduced by the same PR that fixed (1). `INTEGRATION.md:107-109` now
says the entry imports no CSS "so `import "@fluent.xyz/connect"` also works where no bundler
handles stylesheets — server-side rendering, plain Node scripts, Jest." The *import* works. The
*render* did not: at published 0.4.2 a React Router v7 route that imports and renders
`<FluentWidget>` returns HTTP 500. §3b closes that gap, so the sentence becomes true — but only
once this branch ships.

The recommendation is **A → D → B2 → C** (§5), with A's server-render half already done here:
finish what is left of the SSR-safe entry, then separate the
account/execution engine from the widget UI so `useFluentWidget()` works anywhere in the host's
tree, then let the host own wagmi, then ship the connector
[FLU-1190](https://linear.app/fluentlabs-xyz/issue/FLU-1190) asks for. FLU-1190 is **kept and
reshaped**, not superseded (§6).

---

## 1. Inventory

### Providers the widget mounts

Outermost first. The first six are **above** the host's `renderPage`; (7a) wraps the host's own
content; (8) and (9) are below it, inside widget UI only.

| # | Provider | Mounted at | Notes |
|---|---|---|---|
| 1 | `FluentWidgetNetworkProvider` | `src/widget/FluentWidget.tsx:444` | Own context (`src/widget/widgetNetworkContext.tsx:33`). Network + chain. |
| 2 | `WagmiProvider` **or** `WagmiContext.Provider` | `src/widget/reownAppKit.tsx:223` / `:216` | Two branches. A `SilentReconnectAdapter` (`:79`, added by [#118](https://github.com/fluentlabs-xyz/fluent-connect-sdk/pull/118)) owns hydration itself, so that path mounts the raw context rather than `WagmiProvider`, which would hydrate a second time. Both carry `wagmiAdapter.wagmiConfig`. |
| 3 | `QueryClientProvider` | `src/widget/reownAppKit.tsx:217` and `:227` | Client is module-level (`:32`) — one per process, shared by every `<FluentWidget>` on the page. |
| 4 | `FluentPrivyProvider` | `src/widget/FluentWidget.tsx:454` | Selects the web Privy SDK or a host-supplied native one (`src/widget/privyAdapter.tsx:36`, added by [#124](https://github.com/fluentlabs-xyz/fluent-connect-sdk/pull/124)). Note the order: Reown is **outside** Privy; at `0.4.0` it was the reverse. |
| 5 | `FluentPortalContainerProvider` | `src/widget/FluentWidgetContent.tsx:1999` | Overlay portal target; also owns a toast container and a top-layer `<dialog>` (`src/widget/portalContainer.tsx:58-101`, FLU-1469). |
| 6 | `Toaster` → base-ui `Toast.Provider` | `src/widget/FluentWidgetContent.tsx:2002`; `src/components/ui/toast.tsx:214` | |
| 7 | `FluentWidgetProvider` | `src/widget/FluentWidgetContent.tsx:2096` | The context `useFluentWidget()` reads. The host's `renderPage` / `renderHome` output is its only child (`:2097`). |
| 7a | `QueryClientProvider`, the host's | `src/widget/FluentWidgetContent.tsx:1992` | Added on this branch. Only when the host mounted one around the widget; see §3a. Wraps the host's content and nothing else. |
| 8 | `RainbowKitProvider` | `src/bridge/BridgeWalletPicker.tsx:55` | Bridge screen only. Adds UI; deliberately reuses the wagmi context at (2) — see `src/bridge/BridgeWalletPicker.tsx:13-25`. |
| 9 | `TooltipProvider` (base-ui) | `src/bridge/BridgeForm.tsx`, `src/components/SendTokenForm.tsx`, `src/components/WalletMenuTokenList.tsx` | Leaf UI. |

(7) is the one that matters for the host: `useFluentWidget()` throws outside it
(`src/widget/widgetContext.tsx:30-38`), so `createBatchOp`, `signMessage`, `signTypedData`,
`getAuthToken` and the permission builders are reachable only from components rendered through
`renderPage` / `renderHome`.

### What runs at import time

| What | Where | Effect |
|---|---|---|
| Buffer polyfill | `src/index.ts:3` → `src/polyfills/buffer.ts:20-21` | Assigns `globalThis.Buffer` if absent. The only global the package writes. |
| Shared `QueryClient` | `src/widget/reownAppKit.tsx:32` | `new QueryClient()` at module scope. |
| AppKit adapter cache | `src/widget/reownAppKit.tsx:35` | `Map` keyed by `(networks, analytics, reconnect)`; holds the `WagmiAdapter` and, with it, the one wagmi `Config`. |
| Toast manager | `src/components/ui/toast.tsx:9` | `ToastPrimitive.createToastManager()` at module scope. |
| Analytics state | `src/core/analytics.ts:58-62` | Module-level client, queue and flags. `posthog-js` is a dynamic `import()` inside `initFluentAnalytics` (`:86`), so it is *not* loaded at import time. |

Two entries that were on this list at `0.4.0` are gone: RainbowKit's stylesheet now arrives
through `src/styles/globals.css:21` (so it ships inside `dist/fluent-connect.css`), and
`@swapper-finance/deposit-sdk` is a lazy `await import()` on the on-ramp click
(`src/components/WalletMenuActionCard.tsx:511`).

**Nothing reads a browser global at import time.** Measured at 0.4.2 under Vitest with
`environment: "node"`:

```
import under node env  : ok
window after import    : undefined
document after import  : undefined
exports                : 127
```

### What touches the DOM, and when

| What | Where | Guarded? |
|---|---|---|
| `createAppKit(...)` | `src/widget/reownAppKit.tsx:135-136`, from the `useMemo` at `:190` | Yes — `typeof window !== "undefined"` at `:135`. Skipped on the server. |
| `useAppKit()` | `src/widget/reownAppKit.tsx:222` | **No.** Throws when `createAppKit` never ran. This is the server crash. |
| Portal root, toast container, top-layer `<dialog>` | `src/widget/portalContainer.tsx:58-101`, `:221` | `useLayoutEffect` — never runs on the server, but React warns about `useLayoutEffect` during SSR. |
| `"ethereum" in window` | `src/widget/reownAppKit.tsx:237` | Yes. |
| `localStorage` | `src/core/browserStorage.ts:19-26` | Yes — resolved behind try/catch, returns `null` without one. |

So the asymmetry at `src/widget/reownAppKit.tsx:135` vs `:222` is the whole of the server-render
problem. Everything else is already server-tolerant.

---

## 2. What actually happens on the server

Throwaway apps, rebuilt for 0.4.1, **not merged** — reproduction steps in the appendix.
Node 22.14.0, npm 10.9.2.

### Plain Node — fixed

```
$ cd packages/connect && node --input-type=module -e "await import('./dist/index.js')"
IMPORT OK
```

At `0.4.0` this was:

```
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".css" for
  .../@rainbow-me/rainbowkit/dist/index.css
```

and working around it exposed a second fault — `@swapper-finance/deposit-sdk` ships ESM whose
files import each other without extensions, which Node's resolver rejects:

```
Cannot find module '.../@swapper-finance/deposit-sdk/dist/SwapperIframe'
  imported from .../dist/index.js
```

[#120](https://github.com/fluentlabs-xyz/fluent-connect-sdk/pull/120) fixed both and added
`packages/connect/test/entryImport.node.test.ts`, which imports the built entry in a child Node
process and asserts the bundle carries no `.css` specifier. Worth noting for the options below:
the package's other packaging check, `pnpm --filter @fluent.xyz/connect lint:pack`
(publint + `attw`), was green throughout — both tools resolve entry points and type
declarations, neither evaluates the module. Only the child-process smoke test catches this class
of bug.

### React Router v7 with SSR — one error left

`react-router@7.18.4`, `vite@6.3.5`, `react@19`, `ssr: true`, **stock Vite config**. A route
module imports `FluentWidget` and renders it with `mode="page"`.

```
$ npm run build && PORT=3007 npm start
[react-router-serve] http://localhost:3007
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:3007/
500
```

```
Error: Please call "createAppKit" before using "useAppKit" hook
    at useReownWallet (.../@fluent.xyz/connect/src/widget/reownAppKit.tsx:222:20)
    at FluentWidgetContent (.../@fluent.xyz/connect/src/widget/FluentWidgetContent.tsx:340:26)
[Error: Unexpected Server Error]
GET / 500 - - 111.000 ms
```

This is the whole result, and it is a much better one than at `0.4.0`. Then, the server process
died at startup on the stylesheet and never served a byte; you had to add
`ssr.noExternal: ["@fluent.xyz/connect", "@rainbow-me/rainbowkit", "@swapper-finance/deposit-sdk"]`
to `vite.config.ts` before the module graph would even evaluate. Now the build is stock, the
server boots, the request reaches React, and **one unguarded hook is the only thing between a
React Router v7 host and a server-rendered widget.**

A client-only island still works and is still the interim advice: a
`lazy(() => import("./FluentWidgetClient"))` behind a `useSyncExternalStore` hydration gate
returns HTTP 200 with `<p>loading wallet…</p>` server-rendered.

Two details a host will hit on the way:

- `resolveFluentWidgetConfig` throws during render for a malformed `appId` or `privyClientId`
  (`src/core/config.ts`). On the server that is an HTTP 500, which looks like an SSR bug and is
  not — but it is the first thing a new integrator sees.
- Stack frames point at `node_modules/@fluent.xyz/connect/src/...` because the published
  sourcemaps resolve to source paths that are not in the tarball. The line numbers in those
  frames are from the pre-build source and do not always match `src/` at the tagged commit; the
  ones quoted in this document are corrected against `e183f2f`.

### Next.js App Router — unchanged

`next@15.5.27`, `react@19`, webpack, App Router.

**Step A — a Server Component imports the package.** Compiles, then:

```
   Collecting page data ...
[Error: Failed to collect configuration for /] {
  [cause]: TypeError: (0 , ac.createContext) is not a function
      at 97055 (.next/server/app/page.js:8642:12569)
}
> Build error occurred
[Error: Failed to collect page data for /]
```

No file in `src/` carries `"use client"` and the banner is absent from `dist/index.js` — checked
again at 0.4.2 — so the React Server Components graph evaluates `createContext` from the server
build of React, which does not have it. Unchanged from `0.4.0`.

**Step B — the host adds its own `"use client"` boundary.** Compiles. Prerender fails with the
same error React Router gives:

```
 ✓ Compiled successfully in 36s
Error occurred prerendering page "/".
Error: Please call "createAppKit" before using "useAppKit" hook
```

**Step C — `"use client"` patched into the installed `dist/index.js`, Server Component passes
render props.** Measured at `0.4.0`; the API has not changed since, so it still holds:

```
Error: Functions cannot be passed directly to Client Components unless you explicitly
expose it by marking it with "use server". Or maybe you meant to call this function
rather than return it.
  {config: ..., mode: "page", renderPage: function renderPage}
                                          ^^^^^^^^^^^^^^^^^^^
```

**The render-prop API cannot cross an RSC boundary.** Even a perfectly `"use client"`-marked
package cannot be used from a Server Component as long as the host composes through
`renderPage` / `renderHome` / `renderConnectButton`. Composition through `children` can cross
it; a function prop cannot. This is a design constraint, not a bug, and it is the strongest
argument in this document for option D.

**Step D — client-only island** (`next/dynamic(..., { ssr: false })`, unpatched 0.4.2, built
with Turbopack for the reason below). Builds:

```
 ✓ Generating static pages (4/4)
Route (app)                         Size  First Load JS
┌ ○ /                            1.69 kB         116 kB
└ ○ /_not-found                      0 B         114 kB
```

### Next.js plus webpack: `@x402` is unresolvable, and Turbopack is the way out

`@wagmi/connectors`' `baseAccount` reaches `@base-org/account` → `@coinbase/cdp-sdk`, whose
optional `@x402/*` imports webpack cannot resolve. A Next build dies on nine of them before it
reaches any Fluent code:

```
./node_modules/@coinbase/cdp-sdk/_esm/actions/x402/signX402Payment.js
Module not found: Can't resolve '@x402/evm/upto/client'
Import trace:
  … → @base-org/account → @wagmi/connectors/baseAccount → wagmi/connectors → @fluent.xyz/connect
```

[#134](https://github.com/fluentlabs-xyz/fluent-connect-sdk/pull/134) is often read as the fix
for this, and it is not. It added `"@wagmi/connectors": "6.2.0"` to `packages/connect`'s own
dependencies so a consumer stops resolving 8.x, whose peer is `@wagmi/core` 3.x. Measured at
0.4.2, with that 6.2.0 in place and no overrides of the host's own, the webpack build still
fails exactly as above.

What does work, measured: **`next build --turbopack`** — Turbopack treats those optional dynamic
imports as optional and the build succeeds. The alternative is an `overrides` entry pinning
`@wagmi/connectors` back to `5.9.9`, which also builds but downgrades a direct dependency of the
package and is not something to recommend.

One honest caveat on the measurement: Turbopack builds the **client-only island** shape. A Next
Server Component that imports the package still fails under Turbopack, on the same `@x402`
specifiers — a dynamic `import("@x402/core/client")` that Turbopack resolves in a client graph
and not in an RSC one. To see what the RSC boundary itself does at 0.4.2 (below) the probe used
the `5.9.9` override to get past `@x402` first.

This belongs in `INTEGRATION.md` regardless of which option we build: it is the first error a new
integrator sees and it has nothing to do with Fluent.

---

## 3. A host that owns its wagmi config and query client

### What was run

A Vitest + jsdom probe (`react@18.3.1`, `wagmi@2.19.5`, `viem@2.52.0`) importing published
`@fluent.xyz/connect@0.4.2`. The host builds its own config — chains `[mainnet, fluentTestnet]`,
its own `mock` connector, its own transports — and its own `QueryClient`, and wraps the widget:

```tsx
<WagmiProvider config={hostConfig}>
  <QueryClientProvider client={hostQueryClient}>
    <HostOutside />                         {/* host providers, outside the widget */}
    <FluentWidget config={CONFIG} mode="page" renderPage={() => <HostInside />} />
  </QueryClientProvider>
</WagmiProvider>
```

`HostOutside` and `HostInside` are the same three lines of wagmi/query hooks. Only Privy and
AppKit's React modal entry (`@reown/appkit/react`) are mocked — `@reown/appkit-adapter-wagmi`
is real, so the second wagmi context and the second `QueryClient` under test are the widget's
own. The host then connects its config the way its own UI would.

At `0.4.0` this probe also needed `server.deps.inline` for the same two packaging faults as §2.
From 0.4.1 it does not — a stock `vitest.config.ts` runs it.

### Output

```
host wagmi config chains                     : [ 1, 20994 ]
OUTSIDE widget  useConfig() === host config   : true
OUTSIDE widget  useQueryClient() === host     : true
OUTSIDE widget  useAccount().address          : 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
INSIDE renderPage useConfig() === host config : false
INSIDE renderPage useConfig().chains          : [ 20994, 11155111 ]
INSIDE renderPage useQueryClient() === host   : false
INSIDE renderPage useAccount().address        : undefined
INSIDE renderPage widget.status               : disconnected
localStorage keys both configs share          : [ 'wagmi.store', 'wagmi.recentConnectorId' ]

execute()       : threw: Privy wallet context is still loading
signTypedData() : threw: Signing needs authMode: "direct" — there is no hosted signer to ask.
useFluentWidget() outside <FluentWidget>: threw: useFluentWidget must be used within <FluentWidget>
                                          (e.g. inside renderHome/renderPage).
```

Identical to `0.4.0` and `0.4.1` on every line that matters. The two thrown messages are both
"nothing is connected yet" phrased for the state the probe is in: no Privy session, and — in
published `0.4.2` — the hosted auth mode still present.

One thing the probe shows about the release train rather than about providers: that
`authMode` message exists in published `0.4.2`.
[#139](https://github.com/fluentlabs-xyz/fluent-connect-sdk/pull/139) removed `authMode` and
hosted mode (`211993f`, a breaking change) **after** the `0.4.2` bump, so it is on `devel` and
unreleased. A builder reading this document against the published package still has `authMode`;
one reading it against `devel` does not.

### What works

- Mounting the widget inside the host's providers is accepted. Nothing errors, nothing warns.
- Outside the widget, the host's providers are intact and its connected wallet is visible.
- Inside `renderPage`, `useFluentWidget()` resolves and the whole widget API is reachable:
  `createBatchOp`, `signMessage`, `signTypedData`, `getAuthToken`, the permission builders.
  With a Fluent ID or an External wallet connected *in the widget*, `execute()` and
  `signTypedData` work — that is the supported path today and current integrations use it.

### What breaks

1. **The host's providers are replaced for the whole `renderPage` subtree.** The same component
   sees `[1, 20994]` outside and `[20994, 11155111]` inside — the widget's Fluent-plus-bridge-
   source chain list. Every `useAccount`, `useReadContract`, `useWriteContract`, `useBalance` and
   `useSwitchChain` the host wrote resolves against a config it has never seen, with different
   chains, different transports and a different connection. It does not throw. It silently reads
   the wrong chain.
2. **The host's connected wallet is invisible inside.** `0x7099…` outside, `undefined` inside.
   The host's "connect" button and the widget's are two unrelated connection states.
3. **The host's `QueryClient` is replaced.** Any SSR-hydrated or prefetched cache the host built
   is not there; the same query runs twice on one page, once per client. **Fixed on this branch
   — see §3a.**
4. **Both configs write the same `localStorage` keys** — `wagmi.store` and
   `wagmi.recentConnectorId`. wagmi's default storage prefix is `wagmi`
   (`@wagmi/core@2.22.1/dist/esm/createStorage.js:4`) and the persisted slice is named `store`
   (`.../createConfig.js:159`). Two configs with default storage overwrite each other's
   reconnect state; which one wins on the next page load is a race.
5. **An injected wallet is one object per page and leaks between the two configs.** Already
   known and documented here: `src/bridge/BridgeWalletPicker.tsx:13-25` records that connecting
   through a second config made the first claim the same wallet a beat later, flashing its
   address into the account header and popping AppKit's "unsupported network" modal. That is why
   the bridge adds RainbowKit UI *without* a second wagmi config.
6. **Two WalletConnect instances.** Both configs can construct one; WalletConnect's core warns
   and misbehaves when initialized twice in a page. The widget already carries a workaround for
   its own half of this ([#118](https://github.com/fluentlabs-xyz/fluent-connect-sdk/pull/118),
   `SilentReconnectAdapter` at `src/widget/reownAppKit.tsx:68`) — which only underlines how
   little room there is for a second config beside it.
7. **Nothing outside `renderPage` can reach the widget API.** `useFluentWidget()` throws
   (`src/widget/widgetContext.tsx:30-38`). A host with its own routing — which is the whole
   point of React Router v7 — must either put its entire app inside `renderPage` or prop-drill.

### What each library actually requires

**Reown AppKit's wagmi adapter.** It always builds its own config. `WagmiAdapter`'s constructor
takes `Partial<CreateConfigParameters> & { networks, projectId, … }` and calls wagmi's
`createConfig` itself (`@reown/appkit-adapter-wagmi@1.8.20/dist/esm/src/client.js:80-100`);
`wagmiConfig` is a field it assigns, never one it accepts. So:

- A host **cannot** hand AppKit an existing `Config`.
- A host **can** have its `connectors`, `transports`, `storage`, `ssr` and
  `multiInjectedProviderDiscovery` forwarded into the config AppKit builds, and its chains via
  `networks`. That is the opening option B2 uses.
- `useAppKit()` throws unless `createAppKit()` ran
  (`@reown/appkit/src/library/react/index.ts:117`), and `createAppKit` is a page-level singleton,
  not a per-tree provider.

**Privy.** No opinion about wagmi at all. The widget never routes Privy through wagmi — the
ZeroDev kernel takes the embedded wallet's EIP-1193 provider directly
(`src/widget/zerodevSession.ts`). `PrivyProvider` can sit above or below the host's providers;
it constrains nothing here. (It is still client-only, which is why Zenkai already isolates it.)

**RainbowKit.** Needs a wagmi context and a `QueryClientProvider` above it and uses whichever
config it finds. It already does exactly that here. Under a host-owned `WagmiProvider` it would
work unchanged — in fact better, since `src/bridge/BridgeWalletPicker.tsx:13-25` says the bridge
*wants* the page's one config.

---

## 3a. The query client, fixed

Breakage 3 is implemented on this branch. It is written up here rather than as an option
because, once the two halves of "provider ownership" are separated, the query half turns out to
be nothing like the wagmi half.

### Why it is cheap, and wagmi is not

**`QueryClientProvider` is stateless.** The cache lives in the `QueryClient` object the host
holds; the provider only publishes it. `WagmiProvider` is the opposite — it calls `hydrate()` on
mount, which with `reconnectOnMount: false` (the SDK default) runs `connections: new Map()` and
drops live connections. That is the whole reason #118 had to move `ReownProvider` above the keyed
`PrivyProvider`.

Measured, with the widget's own `openConnect()` as the remount trigger (it bumps `privyEpoch`,
`src/widget/FluentWidget.tsx` → the `PrivyProvider` key):

```
а wagmi-конфиг хоста под тем же ключом:
  до openConnect()  : address = 0x7099… | connections = 1
  после openConnect(): address = undefined | connections = 0   ← соединение потеряно

а query-клиент хоста:
  после openConnect(): клиент === host : true | данные: "данные с сервера" | запросов: 0
```

So a query client can be handed around freely; a wagmi config cannot. Everything below follows
from that.

### What the widget actually keeps in a query cache

Four queries, all in the bridge, all namespaced — no key can collide with a host's:

| Query | Where | Key | `staleTime` |
|---|---|---|---|
| bridge tx history | `src/bridge/txHistory.ts:118` | `["fluent-bridge-tx-history", …]` | 15s |
| Hyperlane transfers | `src/bridge/hyperlaneHistory.ts:177` | `["fluent-bridge-hyperlane-history", …]` | 15s |
| fast-path fee | `src/bridge/useBridgeDeposit.ts:335` | `["fluent-bridge-fast-path-fee", …]` | 30s |
| gas estimate | `src/bridge/useBridgeDeposit.ts:416` | `["fluent-bridge-gas", …]` | — |

Plus wagmi's own queries from `useBalance` / `useReadContract` / `useWaitForTransactionReceipt`
in `src/bridge/useBridgeDeposit.ts`. The widget's *core* data — token balances
(`src/hooks/useFluentTokenBalances.ts`) and transaction history
(`src/hooks/useFluentTransactionHistory.ts`) — uses plain `useState` / `useEffect` and no query
at all. The client at `src/widget/reownAppKit.tsx:32` is there mostly because wagmi's hooks
require one.

### The change

Rather than take the host's client for everything, hand the host's content back its own and keep
ours for ours:

- `src/widget/FluentWidget.tsx:200` reads `useContext(QueryClientContext)` **above**
  `ReownProvider` — below it, that context already answers with the widget's own client — and
  passes it down as `appQueryClient`.
- `src/widget/FluentWidgetContent.tsx:1992` wraps the `renderPage` / `renderHome` output in a
  `QueryClientProvider` for that client, when there is one, and renders it at `:2068`.

`useContext` rather than `useQueryClient`, which throws where there is no provider; no provider
is the ordinary case. The same non-throwing read is already used at
`src/components/WalletMenuActionCard.tsx:360`, `src/bridge/BridgeScreen.tsx:46` and
`src/components/WalletMenuActivity.tsx:473`.

Rejected: a `queryClient` prop replacing the module-level client. It contaminates — the widget's
four queries and every wagmi query inherit the host's `defaultOptions`, and a host client with
`staleTime: Infinity` would freeze the bridge's `useBalance` and `useReadContract` for the page's
lifetime. Worse, wagmi's query keys carry no config identity (`['balance', {address, chainId}]`,
`@wagmi/core@2.22.1/dist/esm/query/getBalance.js`), so a host that also runs wagmi on Fluent
would share cache entries with the widget across two configs with different transports. Nothing
is shared under the change as made.

No prop was added. A host wraps `<FluentWidget>` the way it would wrap anything else.

### Measured

Two ways. First against two packed tarballs of the package — published `0.4.2` and the same
version built from this branch — in a throwaway Vitest + jsdom app whose own query client holds
one entry a prefetch would have left:

| Probe | published 0.4.2 | 0.4.2 + this change |
|---|---|---|
| A — host mounts no client | `useQueryClient() === host` false, 1 fetch | false, 1 fetch (unchanged) |
| C — host wraps `<FluentWidget>` | **false, 1 fetch** | **true, 0 fetches** |
| C again, after `openConnect()` | false, 1 fetch | true, 0 fetches |

`A` is the unchanged path and must stay that way. `C` is the fix: the host's prefetched entry is
served from the host's cache and nothing goes to the network, through a provider remount
included.

Second, in the repository's own suite:
`packages/connect/src/widget/FluentWidget.appQueryClient.test.tsx` covers both paths, entering
through `render(<FluentWidget>)` and faking only Privy and AppKit's React modal, so the real
`ReownProvider` mounts the real widget client the test is about. Per `docs/standards/testing.md`
T2 it was run against the base commit first and fails there:

```
× an App's query client around <FluentWidget> > serves the App's own pages from inside renderPage
  → expected QueryClient{} to be QueryClient{} // Object.is equality
```

The second case passes with and without the change, which is correct — it pins the behaviour the
change must not alter.

Documented for builders in `INTEGRATION.md` under "Provider model" → "Your own TanStack Query
client" (`docs/standards/docs-and-comments.md` D1).

---

## 3b. The server render, fixed

Also implemented on this branch. Walking the render path to the end found **four** places that
demand a browser, not the one the Issue names — and all four are small.

| # | Where | What it threw |
|---|---|---|
| 1 | `src/widget/reownAppKit.tsx` `useReownWallet` | `Please call "createAppKit" before using "useAppKit" hook`, because `createAppKit` sits under the `typeof window` guard at `:135` |
| 2 | `packages/connect-sdk/src/index.ts:67` | `origin is required outside a browser` |
| 3 | `packages/connect-sdk/src/index.ts`, same constructor | `redirectUri is required outside a browser` |
| 4 | `src/widget/hooks/useWidgetExecution.ts:171` | `ReferenceError: window is not defined` |

(2) and (3) are one fault: `FluentConnectSDK`'s constructor derives the App's identity from the
browser, and the widget built it in a **render** memo. (4) is a render memo too.

### What each fix is

**1 — hold the instance instead of calling the hook.** `useAppKit()` is not a hook: it reads a
module variable in `@reown/appkit/react` and throws when it is unset
(`@reown/appkit/dist/esm/src/library/react/index.js:43-53`). `createAppKit` returns the instance,
which the widget now keeps (`src/widget/reownAppKit.tsx:46`, assigned at `:147`) and opens at
call time (`:236`). AppKit is one per page, so a module variable mirrors what AppKit itself does.

**2 and 3 — build the SDK on first use.** `src/widget/FluentWidgetContent.tsx:392-400` replaces
the render memo with a ref and `getFluentConnect()`. No placeholder origin is invented: `origin`
is the App's identity in origin mode and `readStoredSession` compares against it
(`packages/connect-sdk/src/index.ts:114`, `:153`), so faking it would be worse than throwing.
Every caller runs from a user's action, by which time a browser is there.

**4 — guard the review's origin.** `src/widget/hooks/useWidgetExecution.ts:171`. It feeds
`FluentSignatureReview.origin`, shown in the review dialog; a server render reaches no dialog,
and the first client render recomputes it with a real `window`.

### Measured

A stock React Router v7 SSR app — no `ssr.noExternal`, no client-only island, a route module that
imports `FluentWidget` and renders it — against a packed tarball of this branch:

```
$ npm run build && PORT=5173 npm start
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/
200
```

4537 bytes of real widget markup in `<main>`: the `fluent-root` scope, the connect button, and
the host's `renderPage` output. Then in headless Chrome against that same server-rendered page:

```
— hydration-ошибок: 0
— pageerror: 0
клик по кнопке виджета: true
клик по Other wallets : true
кнопки после раскрытия: ["Connect Wallet","Continue with X","Continue with Google",
  "Continue with email","Continue with passkey","Base Account","Coinbase Wallet",
  "WalletConnect","Close"]
AppKit после WalletConnect: {"shadowChildren":2} ✅ open() сработал
```

The last line is the one that matters for fix 1: `w3m-modal`'s shadow root goes from empty to
populated, so the instance the widget now holds really does open the modal — from a page that was
rendered on a server.

And on this repository's own flagship demo (`pnpm run dev:chess:local`, client-rendered), the
same sequence with the same result and `pageerror: 0` — so the AppKit change costs the existing
client path nothing.

### What is not verified

A real wallet connection. Headless Chrome has no extension (`Detected injected providers: []`),
so the probe stops at AppKit's modal opening. The signing paths behind it are unchanged by these
four fixes, but nobody has clicked through them on a server-rendered page.

---

## 4. The options

Estimates are in the team's points, for implementation plus tests plus the `INTEGRATION.md`
change, excluding review.

### A — finish the SSR-safe entry · A2 done, A1 + A3 remain · 2 points · not breaking

Two of the four pieces are already done, in 0.4.1: no stylesheet in the JS entry, and the deposit
SDK loaded on click. What is left:

**A1 — `"use client"` banner · 1 point.**

```ts
// tsup.config.ts
export default defineConfig({ banner: { js: '"use client";' } });
```
Unblocks the Next.js App Router step A error. One line.

**A2 — a server-safe render · done on this branch.** It was four places, not one; see §3b.

```diff
// src/widget/reownAppKit.tsx
  export function useReownWallet(): ReownWalletState {
-   const { open } = useAppKit();
+   // AppKit is a browser singleton created in a mount effect. Until it exists —
+   // on the server, and on the first client render — report a wallet that is
+   // simply not connected rather than throwing.
+   const open = useAppKitOpenOrNoop();
```
with `createAppKit` moved out of the render `useMemo` (`:190`) into a mount effect, and
`FluentWidgetContent` tolerating a not-yet-configured wallet on the first pass
(`src/widget/FluentWidgetContent.tsx:345`).

The diff is small; the cost is manual verification. The comments in that file (`:39-50`,
`:116-119`, `:202-203`) record how touchy AppKit is about ordering — `ssr: true` on the adapter,
hydration, `SilentReconnectAdapter`, reconnect loops, "Maximum update depth exceeded", a
blocking "Switch Network" modal over the bridge. Budget a browser pass: connect a wallet, open
the bridge, reload, toggle Quick sign.

**A3 — a `./headless` subpath · 1 point.** `"use client"` on the single entry makes the *whole*
package a client module, including the headless helpers `src/index.ts` re-exports from the
private `@fluent.xyz/connect-sdk` — `createFluentClient`, `getFluentChain`,
`readFluentTokenBalances`. Those are what a Server Component or a route loader wants.

```jsonc
"exports": {
  ".":          { "types": "./dist/index.d.ts",    "import": "./dist/index.js" },
  "./headless": { "types": "./dist/headless.d.ts", "import": "./dist/headless.js" },
  "./styles.css": "./dist/fluent-connect.css"
}
```
New surface, so it rides a minor rather than the patch A1 + A2 can ship in. (Publishing
`@fluent.xyz/connect-sdk` on its own would do the same job; a subpath is the smaller change,
since that package is `private: true` and has never been released.)

**Also:** fix `INTEGRATION.md:107-109`, which currently reads as "SSR is supported" when only
the import is.

Modules: `tsup.config.ts`, `src/widget/reownAppKit.tsx`, `src/widget/FluentWidgetContent.tsx`,
`INTEGRATION.md`; plus `package.json` and a new `src/headless.ts` for A3.

What it buys: a Server Component may import the package; the widget renders a disconnected shell
on the server and connects after hydration; no client-only island needed.

What it does **not** buy: composition through `renderPage` still cannot cross an RSC boundary
(§2, Next step C), and the host still does not own wagmi. A: necessary, not sufficient.

### B — Host-supplied providers

**B1 — the host's query client · done, on this branch.** See §3a. Removes breakage 3 and nothing
else; no API was added.

**B2 — `createFluentWagmiConfig()` · 5 points · not breaking.**

The host builds *one* config, through our factory, and mounts it:

```tsx
import { createFluentWagmiConfig } from "@fluent.xyz/connect";

const config = createFluentWagmiConfig({
  network: "testnet",
  chains: [mainnet, optimism],        // merged with Fluent + the bridge source
  connectors: [injected(), walletConnect({ projectId })],
  transports: { [mainnet.id]: http(MY_RPC) },
  storage: createStorage({ key: "zenkai", storage: localStorage }),
});

<WagmiProvider config={config}>
  <QueryClientProvider client={queryClient}>
    <FluentWidget config={…} providers="host" />
    <MyRoutes />                       {/* outside the widget; still the host's config */}
  </QueryClientProvider>
</WagmiProvider>
```

This works because `WagmiAdapter` accepts `Partial<CreateConfigParameters>` (§3): the host's
chains, connectors, transports and storage go *into* the config AppKit builds, so there is one
config on the page and it is the one the host mounted. `providers="host"` makes `ReownProvider`
a passthrough — `src/widget/reownAppKit.tsx:199` already has the shape — and `useReownWallet`
read the ambient config.

Modules: `src/widget/reownAppKit.tsx`, `src/widget/FluentWidget.tsx`, `src/index.ts`,
`INTEGRATION.md` (§ "Provider model (phase 1: single-chain)", `:1204-1213`, which currently says
this is not supported). Needs A first, because the factory must be importable on a server.

Removes breakages 1, 2, 4, 5 and 6. Leaves 7 — that is D.

Cost: the host must build its config through our factory rather than wagmi's `createConfig`, and
must accept Fluent's chains and AppKit's connectors in it. For a host that already uses AppKit,
free. For a host on RainbowKit or ConnectKit, a real migration.

**B3 — the widget stops mounting wagmi at all · 13 points · breaking.**

`<FluentWidget>` mounts no wagmi context and requires one above it. The external-wallet surface
is re-expressed over plain wagmi hooks, AppKit's modal is replaced by a host-supplied
`onRequestConnect`, and the widget's connect UI becomes the host's. Clean, and the end state B2
approximates, but it deletes a feature integrators use (the built-in wallet picker) and makes
every current integration a migration. Not worth it as long as B2 reaches the same place.

### C — a wagmi connector and an EIP-1193 / EIP-6963 provider · 13 points · not breaking · depends on D

```ts
import { fluentConnector, createFluentProvider } from "@fluent.xyz/connect";

const config = createConfig({
  chains: [fluentTestnet, mainnet],
  connectors: [injected(), fluentConnector({ appId, privyClientId, network: "testnet" })],
  transports: { … },
});
```

The Fluent ID becomes one more entry in the host's own connector list. The host keeps wagmi,
the query client and SSR entirely; `useAccount()`, `useSignTypedData()` and `useSendCalls()`
work with no Fluent-specific code. For Zenkai-shaped hosts this is the best end state.

Most of the method surface already exists and is React-free.
`createFluentIframeRpcHandler(executor)` (`src/widget/iframeBridge.ts:71`) answers `enable`,
`eth_accounts`, `eth_requestAccounts`, `eth_chainId`, `personal_sign`, `eth_signTypedData`,
`eth_signTypedData_v3`, `eth_signTypedData_v4` and `eth_sendTransaction`, maps errors to
EIP-1193 codes (`:312-321`), and forwards a read-only allowlist to the chain RPC (`:35-52`).
`createFluentProvider()` is that handler behind a `request()` plus an event emitter, announced
over EIP-6963 `eip6963:announceProvider`. `fluentConnector()` is a thin wagmi connector over the
same provider.

Two things are genuinely missing:

- **A non-React way to build the executor.** `FluentIframeRpcExecutor`
  (`src/widget/iframeBridge.ts:19-28`) is assembled today by a hook from `useFluentWidget()`
  (`src/widget/hooks/useFluentIframeBridge.ts`). That is option D.
- **Login.** Privy's login is React UI. A connector's `connect()` must be able to open it, so
  either `<FluentWidget>` or a minimal headless `<FluentConnectProvider>` has to be mounted
  somewhere on the page and the connector talks to it. There is no version of this where the
  package becomes a pure non-React module.

Also note what does *not* map: EIP-1193 has no atomic batch, no ERC-20 gas token and no
sponsorship policy. The honest mapping is EIP-5792 `wallet_sendCalls` / `wallet_getCapabilities`
for batching, with gas token and sponsorship as capability fields, and `createBatchOp` staying
the richer Fluent-native API.

### D — a headless API · 8 points · not breaking

Split the widget in two: the account, execution and auth engine, and the UI.

```tsx
<FluentConnectProvider config={…}>     {/* mounts Privy + the execution engine. No UI. */}
  <MyRouter>
    <Header><FluentWidget /></Header>  {/* UI only; anywhere under the provider */}
    <SigningPage />                    {/* useFluentWidget() works here */}
  </MyRouter>
</FluentConnectProvider>
```

`useFluentWidget()` resolves against `FluentConnectProvider` instead of `FluentWidget`
(`src/widget/widgetContext.tsx:6`), so `createBatchOp`, `signMessage`, `signTypedData`,
`getAuthToken` and the permission builders are reachable from any component in the host's tree
— no `renderPage`, no prop-drilling, and composition through `children` rather than function
props, which is the one shape that crosses an RSC boundary (§2).

Alongside it, an imperative handle for the callers that are not React — the connector in C, a
host's non-React service layer:

```ts
const fluent = createFluentConnect({ appId, privyClientId, network });
await fluent.ready();
const token = await fluent.getAuthToken();
const { hash } = await fluent.createBatchOp({ calls }).execute();
```

The engine is mostly already factored for this. `createFluentBatchOp`
(`src/widget/batchOperation.ts`) takes an injected executor; `createFluentSignApi`
(`src/widget/signRequest.ts`) takes an injected `FluentSignExecutor`; the auth session is already
module state rather than React state (`src/widget/hooks/useAuthToken.ts`). What is React-bound is
the assembly: `useWidgetExecution` (`src/widget/hooks/useWidgetExecution.ts`) and
`useFluentZeroDevAccount` (`src/widget/zerodevSession.ts`), plus the confirmation UI the
executor's `confirm` callbacks open — which, since
[#126](https://github.com/fluentlabs-xyz/fluent-connect-sdk/pull/126), is a drawer page rather
than a modal and is therefore more entangled with the widget's own navigation than it was.

This is the expensive option, and not because of the diff: `FluentWidgetContent.tsx` is **2102
lines** and is the heart of the widget (it was 981 at `0.4.0` — it is growing fast, which is an
argument for doing this sooner rather than later). Two invariants must survive the split: the
confirmation UI must stay reachable from a UI-free engine, and the `PrivyProvider` key remount
(`src/widget/FluentWidget.tsx:464`, with refs deliberately held above it) must keep working.
1027 tests in `packages/connect` give decent cover of behaviour, but they cover the
current composition.

Modules: `src/widget/FluentWidget.tsx` and `src/widget/FluentWidgetContent.tsx` (split into a
provider half and a UI half), `src/widget/widgetContext.tsx`, `src/index.ts`; the hooks move but
do not change shape.

Breaking: no. `renderPage` / `renderHome` keep working — `<FluentWidget>` mounts its own
provider when there isn't one above it — and are documented as superseded.

---

## 5. Recommendation

**A → D → B2 → C**, in that order, because each one unblocks the next.

| Order | Option | Release | Points | Why here |
|---|---|---|---|---|
| 1 | **A1 + A2** — `"use client"` banner, server-safe `useReownWallet` | `0.4.2` | 3 | The last two blockers for every SSR host, and `0.4.1` already paid for half of this work. No new API, so it is a patch. |
| 2 | **A3** (`./headless`) + **D** (headless API) | `0.5.0` | 1 + 8 | Unblocks a host's own routing, makes composition `children`-shaped so it can cross an RSC boundary, and is the prerequisite for C. The largest single improvement for Zenkai. |
| 3 | **B2** — `createFluentWagmiConfig()` | `0.6.0` | 5 | One wagmi config on the page, owned by the host. Removes five of the seven breakages in §3. |
| 4 | **C** — connector + EIP-1193/6963 | `0.7.0` | 13 | The end state. Only sensible on top of D, and B2 is the cheaper 80% of its value for hosts that just want their own wagmi. |

**B3 is not recommended.** B2 reaches the same place without breaking every current integration.

### What Zenkai does in the meantime

Unchanged advice, now with the reasons measured:

1. Until 0.4.3 ships, mount the widget as a client-only island — `lazy()` behind a hydration
   gate in React Router, `next/dynamic(..., { ssr: false })` in Next. Both verified at 0.4.2.
   From 0.4.3 the island is no longer needed in React Router (§3b); Next still needs it until
   A1 lands.
2. Keep every signing page inside `renderPage`, because `useFluentWidget()` throws outside it.
3. Do not put a second `WagmiProvider` around it expecting the widget to use it — it will not,
   and the failure is silent (§3).
4. On Next, build with `next build --turbopack`; webpack cannot resolve `@coinbase/cdp-sdk`'s
   optional `@x402/*` imports, and #134 does not change that (§2).
5. Mount their own `QueryClientProvider` **around** `<FluentWidget>` — from 0.4.3 that is all it
   takes for their prefetched and SSR-hydrated queries to be visible inside `renderPage` (§3a).

And tell them 0.4.1 already removed the import-time blockers, so `@fluent.xyz/connect` no longer
has to be kept out of their server bundle entirely — only out of the server *render*.

### Follow-up Issue drafts

Not yet filed. Each needs review with Danil Naumov before it goes in.

---

> **`<FluentWidget>` renders on a server**
>
> **What to build.** `dist/index.js` carries a `"use client"` banner, and `useReownWallet`
> returns a disconnected state instead of throwing when `createAppKit` has not run —
> `createAppKit` moves from the render `useMemo` into a mount effect. A React Router v7 SSR app
> and a Next.js App Router app each render `<FluentWidget>` on the server without a client-only
> island.
>
> **Problem.** At 0.4.1 a stock React Router v7 route that renders the widget returns HTTP 500
> with `Please call "createAppKit" before using "useAppKit" hook`
> (`src/widget/reownAppKit.tsx:222` against the `typeof window` guard at `:135`). Next's App
> Router fails earlier still, on `createContext is not a function`, for want of the banner.
> FLU-1559 removed the import-time blockers; this is what is left. See
> `docs/host-owned-wagmi-query-and-ssr.md` §2.
>
> **Also.** `INTEGRATION.md:107-109` reads as "SSR is supported" when only the import is. Fix it
> with the code.
>
> **Surface.** `tsup.config.ts`, `src/widget/reownAppKit.tsx`,
> `src/widget/FluentWidgetContent.tsx`, `INTEGRATION.md`.
>
> **Not in scope.** Provider ownership. Render props across an RSC boundary. The `./headless`
> subpath (its own 1-point Issue — new surface, next minor).
>
> **Watch for.** AppKit is order-sensitive: adapter `ssr: true`, `SilentReconnectAdapter`
> hydration (#118), reconnect loops, the "Switch Network" modal over the bridge. Budget a
> browser pass, not just the suite.
>
> **Estimate.** 3.

> **A banner-free `./headless` entry**
>
> **What to build.** `@fluent.xyz/connect/headless` exports the chain, token, client and registry
> surface with no React and no `"use client"` banner, so a Server Component or a route loader can
> call `createFluentClient`, `getFluentChain` and `readFluentTokenBalances`.
>
> **Problem.** The `"use client"` banner makes the whole single entry a client module, including
> everything `src/index.ts` re-exports from `@fluent.xyz/connect-sdk`.
>
> **Surface.** `package.json` exports, `tsup.config.ts`, new `src/headless.ts`, `INTEGRATION.md`.
>
> **Blocked by.** The SSR-render Issue (the banner lands there).
>
> **Estimate.** 1.

> **The widget API works outside `renderPage`**
>
> **What to build.** `<FluentConnectProvider>` mounts the account, execution and auth engine with
> no UI; `<FluentWidget>` becomes UI that may be mounted anywhere beneath it; and
> `useFluentWidget()` resolves against the provider, so `createBatchOp`, `signMessage`,
> `signTypedData`, `getAuthToken` and the permission builders work from any component in the
> host's own router. `renderPage` / `renderHome` keep working and are documented as superseded.
> Plus `createFluentConnect()`, the same engine for a non-React caller.
>
> **Problem.** `useFluentWidget()` throws outside `<FluentWidget>`
> (`src/widget/widgetContext.tsx:30-38`), so a host with its own routing must put its whole app
> inside a function prop — and a function prop cannot cross a React Server Components boundary
> (`docs/host-owned-wagmi-query-and-ssr.md` §2, Next step C).
>
> **Surface.** `src/widget/FluentWidget.tsx`, `src/widget/FluentWidgetContent.tsx` (2102 lines;
> this is a split, not a rewrite), `src/widget/widgetContext.tsx`, `src/index.ts`,
> `INTEGRATION.md`.
>
> **Watch for.** The confirmation UI is a drawer page since #126, so a UI-free engine still has
> to reach it. The `PrivyProvider` key remount and the refs held above it must survive the split.
>
> **Blocked by.** The SSR-render Issue.
>
> **Estimate.** 8.

> **A host supplies the wagmi config and the query client**
>
> **What to build.** `createFluentWagmiConfig({ network, chains, connectors, transports, storage })`
> returns one wagmi `Config` carrying both Fluent's chains and the host's; the host mounts it in
> its own `WagmiProvider`; `<FluentWidget providers="host">` mounts no wagmi of its own and reads
> the ambient config. (The TanStack Query half is already done — see §3a of the document.)
>
> **Problem.** The widget's providers replace the host's for the whole `renderPage` subtree —
> measured in `docs/host-owned-wagmi-query-and-ssr.md` §3: different chains, a different query
> client, and the host's connected wallet invisible. Reown's `WagmiAdapter` cannot accept an
> existing `Config`, but does accept the parts one is built from.
>
> **Surface.** `src/widget/reownAppKit.tsx`, `src/widget/FluentWidget.tsx`, `src/index.ts`,
> `INTEGRATION.md:1204-1213` (which currently says this is "not supported in phase 1").
>
> **Blocked by.** The SSR-render Issue.
>
> **Do not** accept a wagmi `Config` or a provider element. `WagmiAdapter` always builds its own
> config, `SilentReconnectAdapter` is selected by `instanceof` (`src/widget/reownAppKit.tsx:201`),
> and the provider's position above the keyed `PrivyProvider` is load-bearing (#118). Only the
> *parts* a config is built from can be accepted without dismantling AppKit — that is B3, and it
> is four times the size.
>
> **Estimate.** 5.

> **Fluent as a wagmi connector and an EIP-1193 / EIP-6963 provider** — reshapes
> [FLU-1190](https://linear.app/fluentlabs-xyz/issue/FLU-1190)
>
> **What to build.** `createFluentProvider()` returns an EIP-1193 provider over the method surface
> `createFluentIframeRpcHandler` already implements (`src/widget/iframeBridge.ts:71`), announced
> over EIP-6963. `fluentConnector()` wraps it as a wagmi connector a host adds to its own
> `createConfig`. Batching is exposed as EIP-5792 `wallet_sendCalls` with gas token and
> sponsorship in `wallet_getCapabilities`.
>
> **Problem.** A host that owns its wagmi has no way to make a Fluent ID one of its accounts.
>
> **Open questions.** Where login lives — a connector's `connect()` needs Privy's React UI, so
> something Fluent must be mounted on the page. Whether `eth_sendTransaction` for a smart account
> that cannot send a bare transaction is honest, or whether the connector should advertise
> `wallet_sendCalls` only.
>
> **Blocked by.** The headless API Issue — a connector cannot be built from a React hook.
>
> **Estimate.** 13.

---

## 6. FLU-1190

**Kept and reshaped. Not superseded, and not a substitute for anything above.**

- It is **not** the same solution as host-supplied providers. A connector lets a host adopt a
  Fluent ID into a wagmi config it already owns. It does not stop `<FluentWidget>` mounting a
  second wagmi context for its own UI, so a host that renders the widget still gets §3's
  shadowing until B2 lands. The two are complementary: B2 makes the widget fit a host's config,
  C makes the Fluent ID fit a host's connector list.
- It is **not** a substitute for the SSR-render fix. A connector ships from this package, and a
  host that renders the widget anywhere still gets an HTTP 500 on the server.
- It is **blocked by** the headless API. A wagmi connector is a plain object with a `connect()`
  method; it cannot be a React hook. Everything it needs exists except a non-React way to build
  `FluentIframeRpcExecutor`, which is exactly what option D produces.

The reshaping is in scope and ordering, not direction:

1. Add EIP-5792 (`wallet_sendCalls`, `wallet_getCapabilities`) to the brief. EIP-1193 alone
   cannot express atomic batching, the ERC-20 gas token or the sponsorship policy, which are the
   three things that make Fluent execution worth using.
2. Settle how `connect()` reaches Privy's login UI before estimating the rest.
3. Mark it blocked by the headless API Issue, and schedule it after `createFluentWagmiConfig()`.

---

## Appendix — reproducing the test apps

Throwaway, **not merged**, built under `~/.cache/flu-1532`. Node 22.14.0, npm 10.9.2. Each
imports published `@fluent.xyz/connect@0.4.2`; `appId` and `privyClientId` are the public testnet
credentials of `apps/widget-preview` in this repo.

No `@wagmi/connectors` override is needed any more — `packages/connect` depends on 6.2.0 since
[#134](https://github.com/fluentlabs-xyz/fluent-connect-sdk/pull/134). The Next probe needs
Turbopack instead, and the Vitest probe needs `"overrides": { "undici": "8.11.2" }`: jsdom 30
pulls undici 8.12.3, which throws `Cannot read properties of undefined (reading 'bind')` at
`undici/lib/interceptor/decompress.js:78` on Node 22.14. That is the probe's own problem, not the
package's; this repository resolves 8.11.2 and its suite runs.

### Plain Node

```bash
pnpm install && pnpm exec turbo run build
cd packages/connect
node --input-type=module -e "await import('./dist/index.js')"   # IMPORT OK at 0.4.2
```
The same check runs in the suite as `packages/connect/test/entryImport.node.test.ts`.

### React Router v7 with SSR

```bash
npx create-react-router@latest rr7 --no-git-init --no-install --yes
cd rr7
# pin react-router / @react-router/{node,serve,dev} to 7.18.4, vite ^6.3.5,
# add @fluent.xyz/connect@0.4.2 + peers (wagmi, viem, @tanstack/react-query)
npm install
# app/routes/home.tsx: import { FluentWidget } and render it with mode="page"
npm run build && PORT=3007 npm start
curl -s -o /dev/null -w "%{http_code}" http://localhost:3007/     # 500, useAppKit
```
A stock `vite.config.ts` reaches the render; no `ssr.noExternal` is needed at 0.4.2. The
client-only island variant moves the import into `lazy(() => import("./FluentWidgetClient"))`
behind a `useSyncExternalStore(subscribe, () => true, () => false)` gate and returns 200.

### Next.js App Router

```bash
npx create-next-app@latest nextapp --ts --app --no-tailwind --no-eslint --no-src-dir \
  --import-alias "@/*" --use-npm --skip-install
cd nextapp
# pin next@15.5.27, add @fluent.xyz/connect@0.4.2 + peers
npm install
npx next build                 # webpack: dies on @x402 before reaching Fluent
npx next build --turbopack     # builds, for the client-only island shape
```
Step A is `app/page.tsx` as a Server Component importing `FluentWidget`; to reach the RSC error
rather than the `@x402` one, add `"overrides": { "@wagmi/connectors": "5.9.9" }` and reinstall.
Step B wraps the widget in a host-owned `"use client"` component. Step C prepends `"use client";`
to `node_modules/@fluent.xyz/connect/dist/index.js` and passes `renderPage` from the Server
Component. Step D uses `next/dynamic(() => import("./FluentWidgetClient"), { ssr: false })`.

### Host-owned providers

```bash
cd host-providers && npm install && npx vitest run
```
`vitest.config.ts` needs `environment: "jsdom"`, this repository's `test/jsdomPolyfills.ts` and
the undici override above. The probe files mock `@privy-io/react-auth` and `@reown/appkit/react`
only; `@reown/appkit-adapter-wagmi` is real. `src/serverImport.test.ts` is the
`environment: "node"` import probe, and `src/queryClient.test.tsx` is the §3a before/after — run
it once against published `0.4.2` and once after
`npm install /tmp/fluent.xyz-connect-0.4.2.tgz` from `npm pack` of this branch.
