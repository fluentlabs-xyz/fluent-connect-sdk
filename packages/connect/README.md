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

For Capacitor social login, pass
`customOAuthRedirectUrl: "https://app.example.com/auth/ios/callback"` in `config`.
This forwards an HTTPS Universal Link callback to Privy; the host must configure
the dashboard allowlists, iOS Associated Domains, and callback handling.
See [Capacitor OAuth setup](https://github.com/fluentlabs-xyz/fluent-connect-sdk/blob/devel/packages/connect/INTEGRATION.md#capacitor-oauth).

> Upgrading from 0.2.x? `partnerId` was renamed to `appId` in 0.3.0 and the id value changed
> from `partner_…` to `app_…`; passing `partnerId` throws with the same hint. Migrating from
> `clientId`? That option is gone: the value it held is now `privyClientId`.

### Logging in

Clicking Connect opens Fluent's own sign-in dialog inside your page — Direct login, the one
way to log in to a Fluent ID. It mounts Privy on your origin, so that origin has to be
registered on the Privy app client behind your `privyClientId`; Privy answers an unregistered
origin with a silent no-op on the login button. Fluent registers the origins you give it when
it issues the client. The user's Privy session then lives in your page, which is what lets
`signMessage`, `signTypedData`, `getAuthToken()` and `linkX()` answer for a Fluent ID without
leaving it. External wallets connect through Reown AppKit beside it.

### Authenticating your backend

`getAuthToken()` (render context / `useFluentWidget()`) returns a 5-minute ES256 JWT signed by
Fluent Connect. Send it to your backend once and issue your own session; verify it with the keys
at `<iss>/.well-known/jwks.json` — `iss` is the API host root, not `/api/v1` — and check `iss`,
`aud` (your `appId`) and `exp`. `sub` is stable per user per app. `addresses` is present only
when your app has the `addresses` scope. A Fluent ID and an external wallet both get a token —
for a wallet, an EOA or a deployed contract wallet signs in; a counterfactual smart account
cannot (no ERC-6492).
The token renews itself silently for both account types — against a service that issues the
refresh credential this release expects, an external wallet signs once, when the session opens,
not once per token; against a deployment that answers without one there is nothing to renew from,
and every expired token costs another signature. The session and what holding it costs are in
[`INTEGRATION.md` §8](INTEGRATION.md#8-auth-and-the-fluent-token). See
[`apps/auth-demo`](https://github.com/fluentlabs-xyz/fluent-connect-sdk/tree/main/apps/auth-demo)
for a browser-side verifier.

Brand images (logo, wallet icons) ship inside the package as bundled data URLs — you do not need a `/fluent-assets` folder.

### Connect button placement

By default the connect control floats top-right (`connectButton="fixed"`). To place it yourself:

```tsx
// Hide the default control and use your own CTA
<FluentWidget
  connectButton={false}
  config={{
    appId: "app_…",
    privyClientId: "client-…",
    network: "testnet",
    appName: "My App",
  }}
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

### Sending a transaction

Everything your app sends goes through one call: `widget.createBatchOp({...}).execute()`.
`widget` comes from the render context (`renderPage` / `renderHome`) or from
`useFluentWidget()` anywhere below `<FluentWidget>`; `useWidget()` returns it on its own. The
widget routes a Fluent ID (one UserOperation, all calls atomic) and an external wallet (one
transaction per call, each confirmed in the wallet) itself, so your app never branches on the
account type.

```tsx
import { useFluentWidget } from "@fluent.xyz/connect";
import { erc20Abi, exchangeAbi } from "./abi";

function BuyButton({ token, exchange, price, orderId }) {
  const { widget } = useFluentWidget();

  async function onBuy() {
    // Guard first: `execute()` rejects when the session cannot execute, and
    // `widget.account.executionError` is the message to show when it is not ready.
    if (!widget.account.executionReady) return;

    const { hash, atomic } = await widget
      .createBatchOp({
        id: "buy-order",
        reviewTitle: "Approve + buy",
        calls: [
          { to: token, abi: erc20Abi, method: "approve", args: [exchange, price] },
          { to: exchange, abi: exchangeAbi, method: "buy", args: [orderId] },
        ],
      })
      .execute();
    // atomic === true → both calls landed in a single UserOperation (Fluent ID)
  }

  return (
    <button type="button" onClick={onBuy} disabled={!widget.account.executionReady}>
      Buy
    </button>
  );
}
```

`calls` is the only required field: `reviewTitle` is the heading of the Fluent review modal
and `id` is a label for your own bookkeeping. Each call carries either `abi` + `method` +
`args` or raw `data`, and `to` can be any contract. `createBatchOp` itself throws straight
away on an empty `calls` array, or on a call that has neither `data` nor `abi` + `method`.

`execute()` resolves once the transaction is included, with `hash`, every hash in order as
`hashes`, `atomic`, `sponsored`, the `receipt` for `hash`, and `userOpHash` for a
smart-account operation. It rejects when the session cannot execute (the message is
`widget.account.executionError`), when the user dismisses the Fluent review
(`FluentReviewRejectedError`, message `User rejected Fluent transaction review`), when the
wallet rejects a call, and when a call reverts — a sequential external-wallet batch stops at
the call that reverted. Who pays the gas, how to force a gas token, and what each stage costs
in time: [`INTEGRATION.md` §7](INTEGRATION.md#7-sending-a-transaction).

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

For a batch with known gas budgets, opt out of SDK gas estimation explicitly:

```ts
await widget.createBatchOp({ calls }).execute({
  userOperationGas: {
    skipEstimation: true,
    callGasLimit: 600_000n,
    verificationGasLimit: 500_000n,
    preVerificationGas: 100_000n,
    paymasterVerificationGasLimit: 100_000n,
    paymasterPostOpGasLimit: 50_000n,
  },
});
```

This skips the account gas hook and `eth_estimateUserOperationGas`. Supply budgets
for the complete batch, account deployment and paymaster; the example values are
illustrative. Paymaster limits are required when sponsorship or ERC-20 gas uses a
paymaster. The default is `skipEstimation: false`; a fixed `callGasLimit` alone
still allows other gas fields to be estimated. See
[`INTEGRATION.md` §7](INTEGRATION.md#skipping-useroperation-gas-estimation) for validation,
authorization and remaining network requests.

## Styles

Import the package CSS once in your app entry:

```ts
import "@fluent.xyz/connect/styles.css";
```

## Upgrading from 0.4

0.5.0 removes hosted mode. Direct login — Fluent's sign-in dialog inside your page — is the one
way to log in to a Fluent ID.

- **`authMode` is removed from `FluentWidgetConfig`.** Delete the key. A config that passed
  `authMode: "direct"` keeps exactly the behaviour it had; the widget accepts the key one last
  time, ignores it and warns once. `authMode: "hosted"` throws at startup with this note's
  instructions.
- **A config that omitted `authMode` was on hosted mode** — it was the 0.4.x default — and is
  now on Direct login. Direct login mounts Privy on your page, so your App's origin has to be
  registered on the Privy app client behind your `privyClientId`. Ask Fluent to add it before
  you upgrade, or your users meet a login button that silently does nothing.
- **`fluent.initialize().connect()` and `.buildAuthorizeUrl()` are removed**, together with
  `authorizeUrl` and `redirectUri` on `fluent.initialize()`. There is no authorize popup to
  open. `initialize`, `status()`, `setSession()` and `disconnect()` are unchanged.
- **The `hosted_not_supported` error code is gone** from `FluentAuthError` and from `linkX()`:
  nothing refuses a signature, a token or a link for want of an in-page Privy session any more.
- **A user signed in through hosted mode on 0.4.x signs in again** after your App upgrades.
  Their stored session still shows them as connected and the first signature finds no signer;
  Disconnect, then sign in again, clears it.
- `FluentWidgetAuthMode` is no longer exported, and `FluentWidgetRenderContext` and
  `FluentIframeRpcExecutor` no longer carry `authMode`.

## Native Privy SDK adapter

Hosts that use a native Privy SDK can supply `privyAdapter` to `FluentWidget`.
The adapter implements `FluentPrivyAdapter`: a provider and
Privy-compatible hooks for authentication, user/identity tokens, embedded wallet
RPC and the enabled login methods. Fluent Connect continues to derive the same
ZeroDev account, exchange verified Privy tokens, review operations and apply
sponsorship policy. Web hosts omit this prop and retain the React SDK.

Keep one stable adapter and Provider per SDK runtime. The native provider must
restore its own session before reporting ready, publish logout and token changes,
and bind every signature to the connected native wallet. It must keep wallet keys
in the SDK and implement or disable the login methods exposed by the UI. Passing
mobile client IDs to the web provider alone does not provide native authentication.

## License

Apache-2.0
