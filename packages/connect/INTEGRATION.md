# Integrating `@fluent.xyz/connect`

A step-by-step guide to adding the Fluent Connect widget to a React app.

> **Breaking in 0.3.0 — Partner is now App.**
>
> - `FluentWidgetConfig.partnerId` is renamed to `appId`. Passing `partnerId` throws
>   with this hint; there is no alias.
> - The id value is `app_<32 hex>`, re-issued for every App and shown in the Fluent
>   Dashboard. Old `partner_<32 hex>` ids are refused at startup (the widget asserts
>   `^app_[0-9a-f]{32}$`) and are unknown to the service.
> - `FluentAuthError.code` values `unknown_partner`, `partner_not_auth_enabled` and
>   `partner_mismatch` are now `unknown_app`, `app_not_auth_enabled` and `app_mismatch`.
> - The PostHog event property `partner_id` is now `app_id`.

The widget provides everything between "user clicks Connect" and "transaction is
confirmed on Fluent": login (Privy), a ZeroDev smart account, the account/wallet
UI, gas payment in ERC-20, and a single execution API (`createBatchOp`) that
works for both smart accounts and external EOAs.

> **Scope.** This widget targets apps running **on the Fluent network**. Auth,
> the smart account, and the paymaster all use Fluent's shared infrastructure —
> you bring an `appId`, not your own Privy/ZeroDev project.

---

## 1. Prerequisites

Before writing code you need:

1. **A Fluent `appId`** — the `app_<32 hex>` id of your App, shown in the
   Fluent Dashboard. Identity: sponsorship, auth and analytics speak it.
   Required; the widget throws without it, and throws on any other shape.
2. **A Privy app client (`privyClientId`)** — the `client-…` value Fluent
   issued alongside. Login configuration: your allowed origins live on it.
   Required; the widget throws without it.
3. **A target network** — `testnet` (default) or `mainnet`.
4. **(Only for `authMode: "direct"`)** your app's origin registered on that
   Privy app client. If you skip this, use the default `"hosted"` mode, which
   opens the Fluent authorize popup and needs no origin allow-listing.

> **Migrating from `clientId`?** The option is gone. The value it held is now
> `privyClientId`, and `appId` is new — passing `clientId` throws with the
> same hint.

Peer requirement: **React 18 or 19**.

---

## 2. Install

```bash
pnpm add @fluent.xyz/connect react react-dom viem wagmi @tanstack/react-query
```

`react`, `react-dom`, `viem`, `wagmi`, and `@tanstack/react-query` are
**peer dependencies** — you install them in your app so there is exactly **one**
copy of each in the tree (see §9 for why this matters). Privy, ZeroDev, and
Reown AppKit are bundled by the widget; you don't install those.

Peer version ranges: `react >=18`, `viem ^2`, `wagmi ^2`, `@tanstack/react-query ^5`.

### `Buffer` is provided for you

You do not need a `Buffer` polyfill. Importing `@fluent.xyz/connect` defines
`globalThis.Buffer` when the page has none: Privy's embedded wallet calls `Buffer.from(...)`
while signing a UserOperation, and a browser has no `Buffer`, so without it the first
signature fails. The SDK ships the polyfill as a side-effecting module of its own, which
survives a production build's tree-shaking, and it never replaces an existing
`globalThis.Buffer` — a polyfill your app already ships keeps working.

---

## 3. Minimal setup

Import the stylesheet once at your app entry, then mount `<FluentWidget>` near
the root and render your app inside its render prop:

```tsx
import { FluentWidget, resolveFluentWidgetNetworkFromEnv } from "@fluent.xyz/connect";
import "@fluent.xyz/connect/styles.css";

export function App() {
  return (
    <FluentWidget
      config={{
        appId: "app_<32 hex, from the Fluent Dashboard>",
        privyClientId: "client-<issued by Fluent>",
        network: resolveFluentWidgetNetworkFromEnv() ?? "testnet",
        appName: "My App",
        authMode: "hosted",
      }}
      mode="page"
      renderPage={() => <YourApp />}
    />
  );
}
```

`<FluentWidget>` is a **provider + UI host**. Everything rendered through
`renderPage` (or `renderHome`) — and any component below it — can read the widget
via `useFluentWidget()` / `useWidget()`. No prop-drilling required.

Set the network from an env var if you prefer:

```bash
# testnet (default) — aliases: development, dev
VITE_FLUENT_WIDGET_NETWORK=testnet
# mainnet — aliases: production, prod
VITE_FLUENT_WIDGET_NETWORK=mainnet
```

### Networks and chain ids

The chain id is **different per network** and is not derivable from the network
name, so anything in your app that is pinned to a chain — a wagmi/viem config, a
deployment address map, a subgraph — has to match the network the widget runs on.

| `network`   | Chain id | Chain name     | Settles on           | Explorer |
|-------------|----------|----------------|----------------------|----------|
| `"mainnet"` | `25363`  | Fluent Mainnet | Ethereum (`1`)       | https://fluentscan.xyz |
| `"testnet"` | `20994`  | Fluent Testnet | Sepolia (`11155111`) | https://testnet.fluentscan.xyz |

RPC endpoints: `https://rpc.fluent.xyz/` and `https://rpc.testnet.fluent.xyz/`.

Prefer reading these from the SDK over hardcoding them — the values travel with
the package, so a chain id change is a version bump rather than a hunt through
your codebase:

```ts
import { getFluentChainForNetwork, getFluentChainByChainId } from "@fluent.xyz/connect";

const chain = getFluentChainForNetwork("mainnet"); // viem Chain — chain.id === 25363
const definition = getFluentChainByChainId(20994); // reverse lookup — { id: "fluent-testnet", name, rpcUrls, … }
```

`fluentMainnet` and `fluentTestnet` are also exported directly as viem chains,
ready to drop into `createConfig({ chains: [...] })`.

> **Mismatch symptom.** A host pinned to one network while the widget runs on
> another fails with an *unsupported chain id* error at the first write, not at
> mount — the read path works fine until then, so the mismatch looks like a
> broken transaction rather than a broken config. If you see that error, compare
> your chain list against `network` before debugging the call itself.

**Treat the network as a deploy-time choice.** There is no `switchNetwork()` API,
and switching at runtime is not a supported flow today: changing `config.network`
does rebuild the widget's network context and remount its auth provider, but what
happens to an active session across that remount is undefined. If your app needs
to offer more than one network, mount the widget per network behind your own
routing rather than mutating `config.network` under a live session.

---

## 4. Config reference (`FluentWidgetConfig`)

| Field         | Required | Default            | Notes |
|---------------|----------|--------------------|-------|
| `appId`       | ✅       | —                  | The App's `app_<32 hex>` id — identity for sponsorship, auth and analytics; the token `aud`. Asserted at startup. |
| `privyClientId` | ✅     | —                  | Privy app client issued by Fluent — login configuration; allowed origins live on it. |
| `network`     | ➖       | env → `"testnet"`  | `"testnet"` or `"mainnet"` — see [Networks and chain ids](#networks-and-chain-ids). |
| `appName`     | ➖       | `"Fluent Connect Demo"` | Shown in login UI. |
| `authMode`    | ➖       | `"hosted"`         | `"hosted"` = Fluent popup; `"direct"` = inline Fluent sign-in (needs allow-listed origin). |
| `enabledAuthMethods` | ➖ | `["google", "email", "passkey"]` | Methods the `"direct"` dialog offers beside X, in the order given. X is always offered — see [Sign-in methods](#sign-in-methods). |
| `source`      | ➖       | `"fluent_connect_widget"` | Attribution tag. |
| `campaign`    | ➖       | —                  | Attribution tag. |
| `reconnectOnMount` | ➖ | `false` | Restore external wallet connections on page load. Opt in only if startup wallet prompts are acceptable; explicit connection and the Fluent session are unaffected. |
| `disableAnalytics` | ➖  | `false`            | `true` turns off all analytics — PostHog is never initialised, nothing sent or stored. |
| `gasPayment`  | ➖       | `{ defaultToken: "ETH", sponsorship: "auto" }` | Initial token, native-gas sponsorship policy, and optional `ethValueByToken` hints. Saved user token choices take precedence. |
| `swapper`     | ➖       | Fluent defaults    | On-ramp/bridge config. |
| `reputationEnabled` | ➖ | `true`             | `false` hides the Reputation tab — and with it the tab strip, leaving Home. The families request is never made. |
| `assets`      | ➖       | Fluent brand       | Override logo etc. |
| `avatar`      | ➖       | Fluent mark        | `{ defaultLogoUrl, forceDefault }` — see [Account avatar](#account-avatar). |
| `scopes`      | ➖       | network defaults   | Permission scopes requested at login. |

### Sign-in methods

With `authMode: "direct"`, sign-in methods default to this order: **X, Google,
email, passkey**. They and the external wallet list share a single Fluent dialog.
Email verification stays in place; X and Google redirect to their OAuth provider
and resume the matching dialog on return. Passkey login uses the browser's
credential prompt for an existing passkey. Enable these methods in the shared
Privy app's dashboard; displaying a button does not enable its provider.
Privy still owns any required MFA, recovery, or signing prompt, and the Fluent
dialog yields while those are open.
The wallet list scrolls within the dialog on smaller screens. WalletConnect hands
off to its QR flow after closing the Fluent dialog.

All four methods are on by default. `enabledAuthMethods` names the ones an app
wants beside X — **Google, email, passkey** — and the order it wants them in.
**Sign-in with X is always offered and cannot be switched off**, so it is not a
value here; it stays first whatever the list says.

```tsx
<FluentWidget
  config={{
    appId,
    privyClientId,
    authMode: "direct",
    // Leaves X and email.
    enabledAuthMethods: ["email"],
  }}
/>
```

Omit it to keep all three; pass `[]` to leave X as the only Fluent method. The
external wallet list is unaffected either way. The option only applies to
`authMode: "direct"`; the hosted popup owns its own method list.

Hosts supplying their own `wallet` prop can optionally provide `choices` (an array
of `{ id, name, icon?, handoff? }`) and `connectChoice(id)` to use the inline list.
Set `handoff: true` for a choice that owns its own dialog. Without these optional
fields, **Other wallets** retains the existing `wallet.open()` behavior.

### Account avatar

The tile on the connect button and in the account drawer shows the user's X
profile picture when Privy has one, and the Fluent mark otherwise. `avatar`
replaces that fallback with your own logo:

```tsx
<FluentWidget
  config={{
    appId,
    privyClientId,
    avatar: {
      // URL or data URI — rendered in a 32px rounded tile.
      defaultLogoUrl: "/brand/logo.svg",
      // Ignore the X avatar and always show `defaultLogoUrl`.
      forceDefault: true,
    },
  }}
/>
```

| Field            | Default | Notes |
|------------------|---------|-------|
| `defaultLogoUrl` | Fluent mark | Shown when there is no X avatar. A logo that fails to load falls back to the Fluent mark. |
| `forceDefault`   | `false` | `true` drops the X avatar entirely, so every user sees `defaultLogoUrl`. |

Rendering your own button through `renderConnectButton` bypasses this — pass the
logo yourself, or reuse the exported `AccountAvatar` component.

---

## 5. Placing the connect button

By default a floating **Connect / Account** button renders top-right
(`connectButton="fixed"`). You have three options:

```tsx
// (a) default floating button — do nothing.

// (b) inline the default button where you want it
<FluentWidget connectButton={false} renderConnectButton={({ DefaultButton }) => (
  <header><DefaultButton /></header>
)} mode="page" renderPage={() => <YourApp />} />

// (c) fully custom CTA
<FluentWidget connectButton={false} mode="page" renderPage={({
  openConnect, openAccount, hasConnectedAccount,
}) => (
  <button onClick={hasConnectedAccount ? openAccount : openConnect}>
    {hasConnectedAccount ? "Account" : "Connect"}
  </button>
)} />
```

---

## 6. Reading account state

From any component under the widget:

```tsx
import { useFluentWidget } from "@fluent.xyz/connect";

function Balance() {
  const { widget, session, openConnect, refreshBalances } = useFluentWidget();

  const address = widget.account.address ?? session?.wallet.smartAccountAddress;
  const ready   = widget.account.connected && widget.account.executionReady;

  if (!ready) return <button onClick={openConnect}>Connect</button>;
  return <span>{address}</span>;
}
```

Key fields on `widget.account`:

- `connected` — a user is signed in.
- `executionReady` — the account can send transactions **now**.
- `executionStatus` / `executionError` — `"disconnected" | "ready" | "unavailable" | "error"` and a message.
- `type` — `"smart"` or `"eoa"`.
- `capabilities` — `{ atomicBatch, erc20Gas }` (both smart-account only), so you can adapt UI without branching on `type`. `erc20Gas` means gas can be paid in an ERC-20 via the paymaster — not free/sponsored gas.

Use `useWidget()` if you only need the `widget` API and nothing else from the context.

### What the widget stores for a signed-in user

Three things belong to the person, not to your page, and the widget keeps them on
the Fluent service so they follow the user between your app, every other app that
embeds the widget, and every browser they sign in from:

- **Quick sign** — the "sign without a confirmation popup" preference.
- **The gas token** — which token the paymaster is asked to charge.
- **Their own token list** — the tokens they added by contract address
  ([§6](#6-reading-account-state)'s token list, not your `tokens` prop).

Your `tokens` prop and Fluent's own defaults are untouched by this: they are part
of the app, not of the user.

The widget reads them once per sign-in and writes every change back, using the
same Fluent token `getAuthToken()` returns ([§8](#8-auth-modes)). Nothing is sent
but that token — no user id is ever put in a request by the widget.

It falls back to this browser's `localStorage` in the two states where no Fluent
token can exist, and behaves there exactly as it did before 0.4.0:

| State | Where the three values live |
| --- | --- |
| direct / Fluent ID | the service, or `localStorage` and the in-memory defaults if the read fails |
| direct / external wallet | the service, or `localStorage` and the in-memory defaults if the read fails |
| hosted / external wallet | the service, or `localStorage` and the in-memory defaults if the read fails |
| hosted / Fluent ID | `localStorage`, in-memory defaults (`getAuthToken()` rejects with `hosted_not_supported`) |
| nobody connected | `localStorage`, in-memory defaults |

The first time a user signs in with tokens already in this browser's
`localStorage` and none on the service, the widget carries that list over once and
then clears the local key.

One more thing is kept in `localStorage`, and it is not a preference: the **refresh
token** that renews the Fluent token without asking the user to sign again. It is
keyed by service, `appId` and account like everything else here, it is cleared when
the user disconnects, and it is never exposed through a widget API. What it is, how
long it lasts and what keeping it there costs you:
[§8](#where-the-session-is-kept-and-what-that-costs).

Nothing here is ever thrown at your app, and a read and a write fail differently:

- **A failed read** — the user rejects the wallet signature, the network is down,
  the service answers 401 or 500 — is silent. The widget falls back to the last
  row of the table for that sign-in: this browser's `localStorage` list and the
  in-memory defaults (Quick sign on, the network's default gas token). No message
  is shown and nothing is logged. It reads again the next time the user signs in,
  or as soon as the missing wallet signer arrives for the same account.
- **A failed write** — a preference the user just changed, or a token they added
  or removed — is visible: the wallet menu's Settings screen shows the service's
  message on its status line, and `AddTokenForm` shows it under the address
  field. The value the user chose stays in place for the rest of the session, and
  a failed removal is logged through `debugLogging`
  ([§9b](#9b-debugging-an-integration)).

Failed writes are not queued or replayed. The next sign-in reads whatever the
service holds, which for a write that never landed is the old value.

> **Breaking in 0.4.0.** `UserTokenStore` is now asynchronous — `list`, `add` and
> `remove` return promises, and `add` has a new `{ status: "failed", message }`
> result. This matters only if you inject your own `userTokenStore`; wrap each
> method's return value in `Promise.resolve()` to port a 0.3.x implementation.

---

## 7. Sending a transaction

All execution goes through **one** API: `widget.createBatchOp({...}).execute()`.
The widget internally routes a smart account (one sponsored UserOp) vs an
external EOA (sequential native-gas txs), respects the Quick sign setting, waits for
inclusion, and refreshes balances — **no host-side branching by account type.**

The result includes `receipt` for `hash`, plus `userOpHash` for a smart-account
operation. Hosts can validate the receipt's logs and read application state at
`receipt.blockNumber` immediately, without waiting for another confirmation.
For a sequential EOA batch, `receipt` belongs to the final call; execution stops
if any call reverts. These fields are optional for compatibility with custom
executors and older SDKs. An included receipt is not a finality guarantee.

Each call is either raw calldata (`data`) or `abi + method + args`. The `to`
address can be **any** contract — there is no token allow-list on operations.

### Example: approve + deposit (one atomic batch on a smart account)

```tsx
import { useWidget } from "@fluent.xyz/connect";
import { erc20Abi } from "./abi";

function DepositButton({ asset, vault, amount, account }) {
  const widget = useWidget();

  async function onDeposit() {
    if (!widget.account.executionReady) return; // guard first

    const op = widget.createBatchOp({
      id: "approve-deposit",
      reviewTitle: "Approve + deposit",
      calls: [
        { to: asset, abi: erc20Abi, method: "approve", args: [vault, amount] },
        { to: vault, abi: vaultAbi,  method: "deposit", args: [amount, account] },
      ],
    });

    const { hash, atomic } = await op.execute();
    // atomic === true → both landed in a single UserOp (smart account)
  }

  return <button onClick={onDeposit}>Deposit</button>;
}
```

### Gas payment

The widget starts with native **ETH** selected. A valid saved user preference
takes precedence, and users can choose another supported gas token in the menu.
Set the initial/fallback token and native-gas sponsorship policy in config:

```tsx
<FluentWidget
  config={{
    appId,
    privyClientId,
    gasPayment: { defaultToken: "ETH", sponsorship: "never" },
  }}
/>
```

`sponsorship: "never"` pays native gas from the smart account's ETH balance and
skips sponsorship authentication and paymaster requests. The default `"auto"`
retains app-sponsored execution with native-gas fallback. This policy does not
disable an ERC-20 token's paymaster when the user selects BLEND or USDnr.
The configured token must be a supported gas token on the selected network.

Gas defaults to the token selected in the widget's own gas selector. To force a
token explicitly, pass just its **symbol** — the widget resolves the ERC-20
address for the active network internally, so you never pass (or mistype) an
address:

```ts
await op.execute({
  gasPayment: { symbol: "BLEND" },
});
```

To also fund the paymaster's ERC-20 allowance in the same batch, add
`includeApproval: true` and `approveAmount`:

```ts
await op.execute({
  gasPayment: { symbol: "BLEND", includeApproval: true, approveAmount: 100n * 10n ** 18n },
});
```

Gas can be paid in `USDnr`, `BLEND`, or native `ETH` (symbol `"ETH"` = native
gas, no ERC-20 paymaster; app sponsorship still follows the policy above).
This list is the *gas* token allow-list — it does **not**
restrict which tokens your calls operate on.

Per-operation `gasPayment.sponsorship` overrides the configured policy, so
`op.execute({ gasPayment: { symbol: "ETH", sponsorship: "auto" } })` can request
sponsorship even when the widget defaults to `"never"`.

### Execution timing

Set `<FluentWidget debugLogging />` to emit `[fluent execution stage]` progress
before waits and timing entries for setup, preparation, signing, broadcast and
inclusion. Timing entries contain durations and public hashes, not signatures,
calldata or authentication tokens. Each sponsored/fallback submission attempt
has its own timing entry. Logging is off by default and does not repeat gas
estimation, signing or submission.

ETH avoids the ERC-20 paymaster request but still needs UserOperation gas
estimation. Shorter receipt polling and receipt reuse do not remove bundler or
paymaster preparation latency; compare these stages before attributing a delay
to Fluent execution. Receipt inclusion is not additional block confirmation or
L1 finality.

Migration: the initial/fallback gas token changes from BLEND to ETH, without
overwriting saved preferences. External-wallet auto-reconnect now defaults to
off to prevent Base Account's interactive startup request; explicit connection
remains available. Set `reconnectOnMount: true` to retain auto-reconnect.

### Always guard on `executionReady`

`createBatchOp` never throws on its own, but `execute()` rejects if the session
can't execute. Gate the button on `widget.account.executionReady` and surface
`widget.account.executionError` to the user.

---

## 7b. Requesting a signature

`widget.signMessage` and `widget.signTypedData` ask the connected account for an
off-chain signature — marketplace orders, listings, signed approvals. Like
`createBatchOp`, they route by account type so the host never branches:

- **Smart account** (Fluent ID login): the signature comes from the ZeroDev Kernel
  account and is an **ERC-1271** signature. While the account is not deployed yet
  it is **ERC-6492**-wrapped; the wrapper is dropped automatically once it is.
- **External wallet**: the wallet itself signs; the result is a plain ECDSA
  signature.

```tsx
import { useWidget } from "@fluent.xyz/connect";

function ListButton({ order }) {
  const widget = useWidget();

  async function onList() {
    const signature = await widget.signTypedData({
      domain: { name: "Marketplace", version: "1", chainId: 20994, verifyingContract: exchange },
      types: { Order: [{ name: "maker", type: "address" }, { name: "price", type: "uint256" }] },
      primaryType: "Order",
      message: order,
    });
    await submitOrder({ order, signature });
  }

  return <button onClick={onList}>List</button>;
}

// EIP-191 personal message
const signature = await widget.signMessage({ message: "Sign in to Marketplace" });
```

The user reviews every request in the widget before anything is signed: the
origin of the page asking, the signing account, and — for typed data — the
domain, primary type and message. **Quick sign never applies to signatures**;
turning it on skips the review for transactions only. A dismissed review
rejects the promise with `User rejected Fluent signature review`.

### Verify with ERC-1271 / ERC-6492, never `ecrecover`

A smart-account signature does not recover to the account address, or to any
address you can compare against. Verify it by asking the account:

- **Off-chain**: viem `publicClient.verifyTypedData` / `verifyMessage` (they handle
  EOA, ERC-1271 and ERC-6492 in one call). Pass `address: widget.account.address`.
- **On-chain**: OpenZeppelin `SignatureChecker.isValidSignatureNow(account, hash, signature)`.
  For a not-yet-deployed account use an ERC-6492-aware validator, or deploy the
  account first (any transaction through `createBatchOp` deploys it).

A backend that does `ecrecover` and compares addresses will reject every
smart-account user. Check `widget.account.type` if you need to know which kind of
signature to expect.

### EIP-2612 `permit` does not work for smart accounts

`permit(owner, spender, value, deadline, v, r, s)` recovers an EOA signature on
chain; a Kernel account cannot produce one. Do not build a permit flow for
smart-account users — batch the `approve` and the call instead, which lands in
**one** atomic UserOp and needs no signature step:

```ts
await widget.createBatchOp({
  reviewTitle: "Approve + buy",
  calls: [
    { to: token,    abi: erc20Abi,  method: "approve", args: [exchange, price] },
    { to: exchange, abi: exchangeAbi, method: "buy",   args: [orderId] },
  ],
}).execute();
```

For an external wallet `permit` works as usual, so a host that supports both can
branch on `widget.account.capabilities.atomicBatch`.

### Signing requires direct mode

Both methods need `authMode: "direct"`. In hosted mode there is no signer on the
page, and they reject with `FluentAuthError` code `hosted_not_supported` — the
same code `getAuthToken()` uses for a Fluent ID in hosted mode (§8).

## 7c. Embedding a marketplace iframe

A page embedded in your app on another origin cannot see the account signed in
here: the browser partitions its storage by top-level site, so a widget inside the
iframe would ask the user to sign in again. `useFluentIframeBridge` answers the
embedded page's wallet calls with this page's account instead, over the JSON-RPC
2.0 `postMessage` protocol `@ledgerhq/iframe-provider` speaks, which white-label
marketplace frontends use to borrow the host page's wallet, so such a page works
without a second sign-in.

```tsx
import { useRef } from "react";
import { useFluentIframeBridge } from "@fluent.xyz/connect";

function Marketplace() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  useFluentIframeBridge(iframeRef, { allowedOrigin: "https://market.example" });
  return <iframe ref={iframeRef} src="https://market.example/collection/cards" />;
}
```

`allowedOrigin` is the origin the marketplace is served from, scheme and host,
normalised the way `event.origin` is; `"*"` and a bare host are refused at
construction. Messages from any other
origin, or from any other window, are dropped without a reply; this is the only
origin check in the exchange, because the iframe side posts to `"*"` and checks
nothing itself.

What the bridge answers:

| Method | Answer |
| --- | --- |
| `eth_accounts`, `eth_requestAccounts`, `enable` | the signed-in address, or `[]` |
| `eth_chainId` | the widget's chain |
| `eth_signTypedData_v4` / `_v3` / `eth_signTypedData`, `personal_sign` | `signTypedData` / `signMessage`, with the usual review |
| `eth_sendTransaction` | `createBatchOp([...]).execute()`; the hash returned is the one `execute()` returns, which the embedded page can poll with `eth_getTransactionReceipt` |
| `eth_call`, `eth_estimateGas`, `eth_getTransactionReceipt`, and the other read-only `eth_*` methods | forwarded to the chain RPC |
| anything else (`wallet_*`, `eth_sign`, `eth_sendRawTransaction`) | error `4200 Unsupported method` |

A request that names another address as `from` or signer is refused with `4100`.
A dismissed review reaches the iframe as `4001` (`FluentReviewRejectedError` on
this side); any other failure as `-32603` with the widget's message. The bridge states
`chainChanged` and `accountsChanged` ahead of its first reply, so a page that
loaded after the bridge still learns them; sign-in and sign-out reach the iframe
as `accountsChanged` after that. `eth_sendTransaction` resolves once the
transaction is included, so the hash it returns already has a receipt.

Like signing, the bridge needs `authMode: "direct"`: in hosted mode the signing
and sending methods reject with `FluentAuthError` code `hosted_not_supported`,
which the iframe sees as `4200` with that code in the message. And as in §7b, a
smart-account signature is ERC-1271, so the marketplace's order validation has to
accept that; a validator without an ERC-6492 path also needs the account deployed,
which means a not-yet-deployed account must send one transaction before its first
listing validates.

Outside React, `createFluentIframeBridge(iframe, { allowedOrigin, executor })` is
the same bridge with the widget calls injected; `createFluentIframeRpcHandler(executor)`
is the method mapping alone, for a transport of your own.

---

## 8. Auth modes

- **`hosted` (default)** — clicking Connect opens the Fluent authorize popup. No
  Privy origin setup; sign-in works anywhere. Best default for third-party apps.
- **`direct`** — the Privy login modal renders inside your app. Smoother UX, but
  your origin **must** be registered on the Privy app client behind your
  `privyClientId` first, otherwise Privy rejects it with `invalid_origin` and the
  login button does nothing. Required for `signMessage` and `signTypedData`
  (§7b), and for `getAuthToken()` with a Fluent ID.

What each mode and account type gets in this SDK version:

| Mode / account | Fluent token (`getAuthToken()`) minted by | Prompt | Signing | Sponsorship |
| --- | --- | --- | --- | --- |
| direct / Fluent ID | widget, with the in-page Privy tokens | none | in page, with review | yes, with the Fluent token |
| direct / external wallet | widget, challenge + wallet signature | one per session | the wallet | none: an EOA pays its own gas |
| hosted / Fluent ID | unavailable in this version: `getAuthToken()` rejects with `hosted_not_supported` | — | unavailable: `signMessage` and `signTypedData` reject with `hosted_not_supported` ([§7b](#7b-requesting-a-signature)) | none in this version (no Fluent token in the page) |
| hosted / external wallet | widget, challenge + wallet signature | one per session | unavailable: `signMessage` and `signTypedData` reject with `hosted_not_supported` ([§7b](#7b-requesting-a-signature)) | none |

A Fluent ID's Privy session lives on the Fluent authorize page in hosted mode, so
the page has no tokens to exchange; an external wallet signs the challenge in the
page in either mode. With nobody connected, `getAuthToken()` rejects with
`not_connected` in both modes. How your backend checks the token:
[§8b](#8b-verify-the-token-on-your-backend).

### The token renews itself, silently

A Fluent token lives five minutes. The session behind it lives thirty days, and the
widget renews the token from that session without involving the user at all — no
Privy round trip for a Fluent ID, **and no wallet prompt for an external wallet**.
The "one per session" in the Prompt column above is the whole change: the wallet
signs when the session opens, and the renewals that follow ask it for nothing.

What makes this work is a second, long-lived credential the service issues
alongside every Fluent token — a **refresh token**, an opaque string with no
structure that only the service can interpret. The widget keeps it, spends it for a
new pair when the Fluent token is close to `exp`, and gets a fresh refresh token
back each time. Each one is single-use: presenting the same one twice ends the
session, which is how a stolen copy is caught.

Your app never sees it, and never should. `getAuthToken()` returns the short-lived
Fluent token and nothing else; no widget API exposes the refresh token.

A **new signature** — a new full exchange — is needed only when:

- the session's thirty days are up (the service's `REFRESH_TOKEN_TTL` default; a
  renewal hands out a new credential but never moves that deadline);
- the service rejects the stored credential, because the session was revoked
  elsewhere or the same credential was presented twice;
- there is no stored credential in this browser: the user disconnected, cleared
  site data, or opened your app in another browser or another profile.

Two limits worth knowing. The first: renewal is coordinated **within one page**, not
across tabs. The stored credential is *shared* — the key carries the service, your
`appId` and the account, and nothing that distinguishes one tab from another — so two
tabs of your app hold one session between them, and only the page that renews knows the
credential rotated. If the other tab renews with the copy it read, the service sees the
same refresh token twice, ends that session as a suspected replay, and both tabs fall
back to a full exchange: one new signature for an external wallet, then business as
usual. Nothing is lost and nobody is signed out, but a multi-tab app should expect the
occasional extra prompt. Coordinating tabs is not in this release.

The second: a **hosted-mode Fluent ID has no session here at all** — `getAuthToken()`
rejects with `hosted_not_supported`, as the table says, and nothing above applies to it.

### Where the session is kept, and what that costs

The refresh token is kept in this browser's `localStorage`, under a key carrying the
service URL, your `appId` and the connected account. One App never reads another's,
and two accounts sharing a browser never read each other's.

> **This is an XSS exposure, and we are not going to tell you otherwise.**
> `localStorage` is readable by any script running on your page. A script that gets
> onto your origin — through a compromised dependency, an injected tag, a `dangerouslySetInnerHTML`
> you did not audit — can read the refresh token and use it, from that same origin, for
> up to thirty days.
>
> Single-use rotation and the service's origin checks do **not** remove that. Rotation
> means a stolen credential is *detected* once the real client renews next and the
> session is then killed — it does not prevent the theft or the window before it.
> The origin check means the stolen credential is not usable from *another* site in a
> browser — it does nothing about the site it was taken from, which is yours. Both
> narrow the blast radius; neither closes it.
>
> The tradeoff bought here is a user who signs once instead of every five minutes. What
> narrows the exposure is a Content-Security-Policy and a dependency review you treat as
> load-bearing — they were already — plus disconnecting a session you are done with, which
> revokes the family and clears the stored credential. What does *not* remove it is
> exchanging the Fluent token for your own session: the widget has already obtained and
> stored the credential by the time it hands you a token to exchange, and holding a session
> of your own neither clears it nor revokes it. This release offers no way to turn the
> persistence off, so an app that cannot accept the exposure at all has no configuration to
> reach for — tell us and it becomes a requirement rather than a workaround.

Disconnecting ends the session properly: the widget asks the service to revoke it and
clears the stored credential, so the thirty days stop there rather than running out on
their own. A Fluent token already issued keeps verifying until its `exp` — at most five
minutes — because its signature is checked offline and nothing can recall it. That is
the same property the short lifetime was chosen for.

The widget's own teardown is immediate, and the `Promise` that `disconnect()` returns is
the one that waits: it resolves after every refresh family the disconnect ended has been
revoked, best effort, including one opened by a `getAuthToken()` that was still out when
the user disconnected. A wallet dialog answered a minute after the disconnect still opens
a session, and that promise is what tells you there is none left. It can therefore take as
long as such a request does, and it never rejects — a service you cannot reach does not
leave the user signed in here, but do not read a resolved promise as proof the service
agreed. If you await `disconnect()` before signing the user out of your own backend, that
is the ordering you get.

### Sponsorship authenticates with the Fluent token

Gas sponsorship is the same token, used by the widget rather than by you. When a
Fluent ID sends a transaction in direct mode, the widget mints a Fluent token for
the signed-in user and sends it as the `Authorization` bearer to the sponsorship
paymaster, which checks that the token's `aud` is your App and that the operation's
sender is an address the user proved. **Release 0.4.0 of `@fluent.xyz/connect` is the
first that sends the Fluent token**; earlier releases sent the Privy access token,
which the service accepted through a transition path that applies neither check.
That transition path ends after 0.4.0, so a page still running an earlier release
will get unsponsored transactions rather than a hard error — the account pays its
own gas, as the table's other rows already do.

The Sponsorship column above says what each combination gets in this version, and
only the first row is sponsored. An external wallet, in either mode, sends through
the wallet and never through the smart account, so there is no user operation to
sponsor. A Fluent ID in hosted mode has no Privy session in your page, so it has no
Fluent token to authenticate with. Nothing throws in any of those cases: the account
pays its own gas and the transaction goes through.

If the paymaster rejects a token with a `401`, the widget mints one fresh token and
retries the operation once before the account falls back to paying its own gas. A
`403` means your App is not set up for sponsorship, and the widget stops asking for
the rest of the page's life. Turn on `debugLogging` ([§9b](#9b-debugging-an-integration))
to see which of these happened.

A Fluent token needs one more piece of setup, in either mode and for either
account type: your page origin must be registered on your App in the Fluent App
settings. That is the Fluent auth service's own list, separate from the Privy
origin registration direct mode needs. From an unregistered origin
`getAuthToken()` rejects with `FluentAuthError` code `origin_not_allowed`.

---

## 8b. Verify the token on your backend

`widget.getAuthToken()` returns a short-lived ES256 JWT issued by the Fluent
auth service. Your backend needs no Fluent SDK to check it:

1. Fetch `<iss>/.well-known/jwks.json` and cache it; the response carries
   `Cache-Control: public, max-age=3600`.
2. Pick the key by the token's `kid`. Require `alg == ES256`. Verify the signature.
3. Check `iss` equals the issuer you pinned, `aud` equals your `app_…` id, and `exp` is in the
   future.
4. Use `sub` as the user id. Read `addresses.account` only if your App has the `addresses`
   scope, and only for on-chain joins.

Go, with the same two libraries the Fluent auth service uses:

```go
jwks, _ := keyfunc.NewDefaultCtx(ctx, []string{issuer + "/.well-known/jwks.json"})
tok, err := jwt.Parse(raw, jwks.Keyfunc,
    jwt.WithIssuer(issuer),
    jwt.WithAudience(appID),
    jwt.WithValidMethods([]string{"ES256"}),
    jwt.WithExpirationRequired(),
)
if err != nil || !tok.Valid { /* 401 */ }
sub, _ := tok.Claims.GetSubject()
```

Node, with `jose`:

```ts
const JWKS = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const { payload } = await jwtVerify(raw, JWKS, { issuer, audience: appId, algorithms: ["ES256"] });
const userId = payload.sub;
```

Verify on every request, or exchange the token once for your own session. Both are fine; the
first needs no application-session state on your side.

Do not persist our token — call `getAuthToken()` each time you need one. It lives five minutes,
and the SDK renews it silently for both supported account types: a Fluent ID in direct mode, and
an external wallet in either mode. **Calling it often no longer prompts the wallet.** The wallet
signs once, when the session opens, and every renewal for the next thirty days is a background
request ([§8](#the-token-renews-itself-silently)); a hosted-mode Fluent ID is the exception, and
rejects with `hosted_not_supported` rather than returning a token at all.

So verifying on every request is a real option now, for external wallets too. Exchanging our
token once for your own session is still the lighter thing to do per request, and it is what to
reach for if you would rather your app's session outlive ours, or have its own expiry and its own
revocation. It does not change what the widget keeps in the browser: the refresh credential is
already stored by the time you have a token to exchange, and your own session neither clears nor
revokes it — see [§8](#where-the-session-is-kept-and-what-that-costs).

---

## 8c. Linking X

Some apps need to know a user's X account — a gated drop, a leaderboard, an entitlement that
belongs to a handle rather than to an address. `linkX()` is how a connected user gets one
linked, headless: no widget screen, no settings page, one call from your own UI.

It serves both account types. A **Fluent ID** — whether the user signed in *with* X, or with
Google, email or a passkey and has no X account yet — already has the Privy session the link
needs. An **external wallet** (MetaMask, say) gets one first: before the X redirect the SDK signs
the wallet in to Privy with Sign-In with Ethereum, which the user sees as a **signature
prompt** — and mints the wallet's Fluent token, a second prompt unless this page holds the token
already; see below. After that the two account types take exactly the same path, resolve the
same results and reject with the same codes.

### The call leaves the page, so it is idempotent instead

Linking X means an OAuth round trip through X, and that round trip **navigates away from your
page**. There is no popup variant to reach for. So `linkX()` is not one long promise that waits
for the user to come back — it could not be, because the page it was called on is gone by then.
It is idempotent and re-enterable, and it resolves one of two things:

```ts
type FluentLinkXResult =
  | { status: "linked"; x: FluentXAccount }   // done; the account is right here
  | { status: "redirecting" };                // the page is leaving for X
```

- **A user who already has X** resolves `{ status: "linked", x }`. No Privy dialog, no
  navigation, one request.
- **A user who has none** resolves `{ status: "redirecting" }` once the navigation to X has
  been started. The code after that `await` does run — briefly. Use it to show a "taking you to
  X" state; do not use it to wait for the link, because the page is unloading and the link
  completes on the page that comes back.

When the browser comes back, **call `linkX()` again** — and this time it resolves `linked`.
Calling it on a user who already has X costs one request and changes nothing, which is what makes
it safe to call on mount, on a button, or both.

```ts
type FluentXAccount = { id: string; handle: string; avatarUrl: string };

/** The wire body of `GET /api/v1/me/profile` and of the link request. `x` is nullable. */
type FluentProfile = { subject: string; appId: string; x: FluentXAccount | null };
```

### `useLinkX()` does the return trip for you

```tsx
import { useLinkX } from "@fluent.xyz/connect";

function LinkXButton() {
  const { linkX, status, x, error } = useLinkX();

  if (x) return <span>Linked as @{x.handle}</span>;
  return (
    <>
      <button onClick={() => linkX()} disabled={status === "pending" || status === "redirecting"}>
        {status === "redirecting" ? "Taking you to X…" : "Link X"}
      </button>
      {error ? <p>{error.code}</p> : null}
    </>
  );
}
```

Mount it and the return trip needs nothing from you: the hook sees that this tab started a link,
waits for the widget to finish it, and reports `status: "linked"` with `x`. Mount it on a page
that started no link and it does nothing at all.

The same call is on the render context — `const { linkX } = useFluentWidget()` — and behaves
identically, including the return trip, for an integrator who would rather hold the state
themselves.

A link that somebody else started in this tab — two people sharing a browser — or a stale
record of one is discarded, never resumed: the hook's mount-time re-entry stays idle and reports
no error, whether the other person is known from the stored session or only once Privy has
restored them, and a `linkX()` call you make yourself — on the hook or on the render context —
does no work and rejects with `link_failed`. Call again to start a link for the user who is
signed in now. For an external wallet the same applies to a link another wallet started: the
user switched wallets across the redirect, and the link the tab remembers is the other wallet's.

What the widget waits for on the way back is the **user Privy restores**, not a callback: after a
redirected link, Privy's `onSuccess` never fires, because the intent that would have fired it did
not survive the reload. It waits without polling, and the request that completes the link carries
a freshly minted identity token — the service reads the X account out of that token, so a stale
one would link nothing. For an external wallet it also waits for the wallet's client, which the
connector hands over a moment after it has named the address: the client is what makes the
connected address the wallet's own — the widget takes the address as connected only once the
client that signs for it is there — and the link completes as that wallet. The ordinary return
asks the client for nothing: the request that completes the link is authenticated with the
wallet's Fluent token, renewed from the refresh credential the pre-redirect mint stored (see
below). Only a page whose credential has expired in the meantime mints the token again, and that
needs the client to sign.

### An external wallet signs in to Privy first

Privy links X to a Privy user, and an external wallet has none until it signs in. So the first
`linkX()` for a wallet user — and only the first, while that Privy session lasts — starts with
**Sign-In with Ethereum**: the SDK asks Privy for a SIWE message for the connected address, asks
the wallet to sign it, and hands Privy the signature. The user sees one **signature prompt** in
their wallet, for a plain message naming your page and a nonce. **It is a signature, not a
transaction**: nothing is sent to the chain and nothing costs gas. Then, still before the
redirect, the SDK mints the wallet's Fluent token — the typed-data challenge of
[§8](#8-auth-modes), the same one `getAuthToken()` signs — so that **every signature happens
before the page leaves**. On a page that has not minted the token yet that is a second prompt;
on one that already holds it (you called `getAuthToken()` first, or an earlier call minted it)
the wallet is asked nothing more. Only then does the X redirect happen. The page that comes back
renews the token from the refresh credential the mint stored and opens the wallet for nothing;
and on every later call with that Privy session live, nothing is signed again. Tell your users
to expect the prompts — a wallet user who has never seen Privy will not expect their wallet to
open before a trip to X.

Each of Privy's two sign-in steps is bounded to ten seconds, and the wallet's own signature
prompt to five minutes; a step that never answers rejects `link_failed` with a message naming
the likely cause, and a late answer resumes nothing. **Captcha on the Privy app is not supported
for `linkX()` today**: with it enabled, Privy's headless sign-in waits for a captcha this SDK
does not render during `linkX()`, and the call fails after the bound. Wallet login disabled on
the Privy app ends the same way. Check both in the Privy Dashboard before shipping the wallet
path.

Nothing about the Fluent user changes over it. The connected account is still the wallet, its
kind is still the external wallet's, and `getAuthToken()` still mints the wallet's own token —
keyed on the address, renewed by the wallet's own refresh family ([§8](#8-auth-modes)) — before,
during and after the link. The Privy session SIWE makes is the link's machinery, not an account:
it never becomes a Fluent ID — not when Privy attaches an embedded wallet to it, not when the
wallet is disconnected or swapped for another while it lives — and the widget never signs with it.
The SDK tells that session from a Fluent ID's by the external wallet on the Privy user, which
rests on one assumption: this SDK is the only way an external wallet lands on a Privy user of
your Privy app — its sign-in offers no wallet method and links no wallets — so do not add one on
the same Privy app. Should the user choose a Fluent ID later, from the connect modal or the
account menu, while that session lives, the widget signs it out first: the sign-in method they
chose — X, Google, email or passkey — runs only once Privy has confirmed the sign-out, and a
sign-out that fails or runs past its bound runs no method and shows its error in the sign-in
dialog, where the next click tries again. The wallet stays connected throughout.

Three things can go wrong that are the wallet's own:

- **The user declines the signature.** `linkX()` rejects with `user_rejected` — the same code as
  saying no at X — and nothing was linked or started; call again when they are ready.
- **Privy signs in a user who does not hold the connected wallet.** The SDK checks the user Privy
  returns before it links anything: one without the connected address among their accounts is
  not a session the link can use, so the SDK asks Privy to sign it out again and `linkX()`
  rejects with `link_failed`, with nothing started. The sign-out is attempted and awaited within
  a bound of ten seconds, and the call rejects with `link_failed` either way: when Privy confirms
  it within the bound the session is gone, and when it does not — Privy's logout failed, or did
  not finish in time — the rejection says so in its message and the session may still be live on
  the page, though never as a Fluent ID: for as long as that page lives, the widget keeps reading
  it as the wallet's failed sign-in. Kept otherwise, it would be the one Privy session that could
  be taken for a Fluent ID on this page. The wallet stays connected and its token is untouched.
- **The service refuses the link with `403 privy_wallet_mismatch`.** The Privy session that linked
  X belongs to a different wallet than the Fluent token's. `linkX()` rejects with `link_failed`.
  The SDK makes this hard to reach: a Privy session left in the browser by another wallet — the
  user switched accounts in MetaMask, and Privy kept the old session across the reload — is
  **replaced before the link**, logged out and the connected wallet signed in afresh, rather than
  reused; until then it stays that other wallet's session, never the start of a Fluent ID for
  the wallet connected now. The one Privy session the SDK will not replace is a Fluent ID's: with
  a Fluent ID signed in on the page — whether Privy has restored them yet or not — and an
  external wallet connected beside it, `linkX()` for the wallet rejects with `link_failed`, since
  signing the Fluent ID out from under the person is not the link's to do.

### What it rejects with

Every rejection is a `FluentAuthError` with one of:

| `code` | What happened |
| --- | --- |
| `user_rejected` | The user said no at X, closed the flow, or declined the SIWE signature or the Fluent token's challenge. |
| `linked_to_another_user` | That X account is already linked to another Fluent user. |
| `not_authenticated` | No Fluent ID or external wallet is connected, or the wallet's client is not here yet. Connect first, or wait and call again. |
| `hosted_not_supported` | Hosted mode. Refused before any other call — see below. |
| `bad_request` | The service refused the request body. Report it; it is ours, not yours. |
| `link_failed` | Everything else: a discarded link, `privy_wallet_mismatch`, a Fluent ID signed in beside the wallet, a sign-in step that timed out, a failure under the call. |

No other code reaches you from `linkX()`. A refusal raised under it — by the request that mints
the Fluent token, say — keeps its message and arrives as `link_failed`, so one `switch` over the
six codes above is complete.

**Hosted mode cannot link X.** A hosted-mode Fluent ID has its Privy session on the Fluent
authorize page, not in yours, so there is nothing in your page to link an account to — the same
reason `getAuthToken()` refuses there ([§8](#8-auth-modes)).
`linkX()` rejects with `hosted_not_supported` before it touches Privy, the wallet or the network.

### The sequence your backend sees

1. Call `linkX()` until it reports `linked`. (`redirecting` means the browser is leaving; after
   it returns, `useLinkX()` or your own call finishes the job.)
2. Call `getAuthToken()` for a fresh Fluent token.
3. Your backend verifies that token ([§8b](#8b-verify-the-token-on-your-backend)) and makes its
   own check — `GET /api/v1/me/profile` with the token, server to server, reading `x`. The same
   account `linkX()` returned is the one that endpoint reports.

Step 3 is the one that counts. `linkX()` resolving `linked` is the widget telling you the link
went through; your backend verifying it is the part an entitlement should hang on.

---

## 9. One copy of the web3 stack (peer dependencies)

`viem`, `wagmi`, and `@tanstack/react-query` are peer dependencies precisely
because they rely on **single-instance React context and singletons**:

- **wagmi / react-query** — hooks resolve their provider by React-context object
  identity. A second copy of the package is a *different* context object, so
  hooks silently fail to see the provider across the boundary.
- **viem** — you build the `abi` / `Address` / `Hex` values you pass into
  `createBatchOp` with *your* viem. A second, mismatched copy makes those types
  incompatible at the boundary.

Installing them as peers (§2) guarantees your package manager resolves a single
shared copy. **Do not** add them back as direct nested dependencies with a
divergent version.

### Provider model (phase 1: single-chain)

`<FluentWidget>` mounts its own `WagmiProvider` + `QueryClientProvider` (Fluent
chain) and renders your app **inside** them via `renderPage`. For a single-chain
app that has no other wagmi, this is exactly what you want — the widget is the
one source of wallet/account state, and you read it through `useFluentWidget()`.

> If you later need **multiple chains** (your own wagmi config alongside the
> widget's), that's a separate architecture — shared providers / a single
> `WagmiProvider`. Not supported in phase 1; talk to the Fluent team.

---

## 9b. Debugging an integration

The widget's internal connect / smart-account / signing diagnostics are silent by
default. Turn them on with the `debugLogging` prop while wiring things up:

```tsx
<FluentWidget config={{ /* … */ }} debugLogging mode="page" renderPage={() => <YourApp />} />
```

`debugLogging={false}` (the default) suppresses **all** widget console output.
Leave it off in production.

## 10. Checklist

- [ ] Got a Fluent `appId` and `privyClientId`.
- [ ] Picked network (`testnet` / `mainnet`) — and every chain id pinned elsewhere in the app matches it (§3).
- [ ] (`direct` only) origin allow-listed in Fluent Privy.
- [ ] (`getAuthToken()`, either mode) page origin registered on your App in the Fluent App settings (§8).
- [ ] (linking X) called `linkX()` until it reports `linked` — it is re-entered after the redirect, not awaited across it — and verified the account on your backend (§8c).
- [ ] Imported `@fluent.xyz/connect/styles.css` once.
- [ ] Mounted `<FluentWidget>` at the root; app rendered via `renderPage`.
- [ ] Read account via `useFluentWidget()` / `useWidget()`.
- [ ] All txs go through `createBatchOp(...).execute()`, guarded on `executionReady`.
- [ ] Signatures go through `widget.signMessage` / `widget.signTypedData` and are verified with ERC-1271/6492, not `ecrecover` (§7b).
- [ ] Checked provider coexistence if the app already uses wagmi / viem / react-query (§9).
```
