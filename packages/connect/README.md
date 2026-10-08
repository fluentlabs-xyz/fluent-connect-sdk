# `@fluent.xyz/connect`

React widget for Fluent Connect — login, smart account, balances, batch txs, signatures, and gas payment UI.

## Install

```bash
pnpm add @fluent.xyz/connect react react-dom
```

Also ensure peer/runtime packages your app needs are installed (versions compatible with this package):

```bash
pnpm add @privy-io/react-auth viem wagmi @tanstack/react-query
```

### `Buffer` is provided for you

Importing `@fluent.xyz/connect` defines `globalThis.Buffer` when the page has none, so your
app needs no `Buffer` polyfill of its own. Privy's embedded wallet calls `Buffer.from(...)`
while signing, and a browser has no `Buffer`; the SDK fills that gap at import time. An
existing `globalThis.Buffer` is never replaced, so a polyfill your app already ships keeps
working.

## Usage

Set the Fluent network via `config.network` or an environment variable:

```bash
# testnet (default)
VITE_FLUENT_WIDGET_NETWORK=testnet

# mainnet
VITE_FLUENT_WIDGET_NETWORK=mainnet
```

Aliases: `development` / `dev` → testnet, `production` / `prod` → mainnet.

```tsx
import {
  FluentWidget,
  resolveFluentWidgetNetworkFromEnv,
} from "@fluent.xyz/connect";
import "@fluent.xyz/connect/styles.css";

export function App() {
  return (
    <FluentWidget
      config={{
        appId: "app_<32 hex, from the Fluent Dashboard>",
        privyClientId: "client-<issued by Fluent>",
        network: resolveFluentWidgetNetworkFromEnv() ?? "testnet",
        appName: "My App",
        authMode: "direct",
      }}
      mode="page"
      renderPage={({ session, openConnect, widget }) => (
        <button type="button" onClick={openConnect}>
          {session ? "Connected" : "Connect"}
        </button>
      )}
    />
  );
}
```

`appId` and `privyClientId` are both required and come from Fluent. `appId` is the
App's identity — sponsorship, auth and analytics speak it — and must be the `app_<32 hex>`
value the Fluent Dashboard shows; the widget throws on any other shape. `privyClientId` is
login configuration: the Privy app client carrying your allowed origins.

> Upgrading from 0.2.x? `partnerId` was renamed to `appId` in 0.3.0 and the id value changed
> from `partner_…` to `app_…`; passing `partnerId` throws with the same hint. Migrating from
> `clientId`? That option is gone: the value it held is now `privyClientId`.

`authMode: "direct"` requires your origin registered on the Privy app client behind your `privyClientId`. Default `authMode: "hosted"` uses the Fluent authorize popup and works on any origin.

### Authenticating your backend

`getAuthToken()` (render context / `useFluentWidget()`) returns a 5-minute ES256 JWT signed by
Fluent Connect. Send it to your backend once and issue your own session; verify it with the keys
at `<iss>/.well-known/jwks.json` — `iss` is the API host root, not `/api/v1` — and check `iss`,
`aud` (your `appId`) and `exp`. `sub` is stable per user per app. `addresses` is present only
when your app has the `addresses` scope. Direct auth only. External wallets: an EOA or a deployed
contract wallet signs in; a counterfactual smart account cannot (no ERC-6492).
The token renews itself silently for both account types — an external wallet signs once, when
the session opens, not once per token; the session and what holding it costs are in
`INTEGRATION.md` §8. See `apps/auth-demo` for a browser-side verifier.

Brand images (logo, wallet icons) ship inside the package as bundled data URLs — you do not need a `/fluent-assets` folder.

### Connect button placement

By default the connect control floats top-right (`connectButton="fixed"`). To place it yourself:

```tsx
// Hide the default control and use your own CTA
<FluentWidget
  connectButton={false}
  config={{ appId: "app_…", privyClientId: "client-…", network: "testnet", appName: "My App" }}
  mode="page"
  renderPage={({ openConnect, openAccount, hasConnectedAccount }) => (
    <button type="button" onClick={hasConnectedAccount ? openAccount : openConnect}>
      {hasConnectedAccount ? "Account" : "Connect"}
    </button>
  )}
/>

// Or reuse the Fluent button in your layout
<FluentWidget
  connectButton={false}
  renderConnectButton={({ DefaultButton }) => (
    <header className="flex justify-end p-4">
      <DefaultButton />
    </header>
  )}
  mode="page"
  renderPage={() => null}
/>
```

### Execution gas headroom

For smart-account batches whose execution cost can change between estimation and
inclusion, set `userOperationGas` on `execute()`:

```ts
await widget.createBatchOp({ calls }).execute({
  userOperationGas: {
    callGasBuffer: { percentage: 50, fixed: 50_000n },
  },
});
```

This example sets `callGasLimit` to `ceil(estimate × 1.5) + 50,000`. The estimate
covers the complete UserOperation, including account deployment and any gas-token
approval prepended by the widget. The buffer is applied during normal gas
preparation, before final paymaster authorization and signing, without adding an
estimation request. Paymaster adapters that previously supplied data only once
are called again to authorize the final gas limit. The same policy
applies to sponsored, account-paid, and ERC-20 gas, including sponsorship fallback.

Alternatively, supply a known execution limit with
`userOperationGas: { callGasLimit: 600_000n }`. Use either `callGasLimit` or
`callGasBuffer`. Percentages must be nonnegative safe integers; fixed gas must be
a nonnegative bigint, and the final limit must fit a positive uint128. Defaults
keep the existing estimation behavior. These options apply only to smart-account
UserOperations; external EOA transactions keep their wallet's gas estimation.

Choose headroom for your application's execution paths and paymaster limits.
Headroom increases the maximum gas budget and does not guarantee execution if
state changes. An included outer transaction can still contain a failed
UserOperation; the widget continues to reject that failed execution.

## Styles

Import the package CSS once in your app entry:

```ts
import "@fluent.xyz/connect/styles.css";
```

## License

Apache-2.0
