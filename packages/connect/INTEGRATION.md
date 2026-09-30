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
| `source`      | ➖       | `"fluent_connect_widget"` | Attribution tag. |
| `campaign`    | ➖       | —                  | Attribution tag. |
| `reconnectOnMount` | ➖ | `false` | Restore external wallet connections on page load. Opt in only if startup wallet prompts are acceptable; explicit connection and the Fluent session are unaffected. |
| `disableAnalytics` | ➖  | `false`            | `true` turns off all analytics — PostHog is never initialised, nothing sent or stored. |
| `gasPayment`  | ➖       | —                  | `{ ethValueByToken }` — ETH-value hints for the gas selector. |
| `swapper`     | ➖       | Fluent defaults    | On-ramp/bridge config. |
| `reputationEnabled` | ➖ | `true`             | `false` hides the Reputation tab — and with it the tab strip, leaving Home. The families request is never made. |
| `assets`      | ➖       | Fluent brand       | Override logo etc. |
| `avatar`      | ➖       | Fluent mark        | `{ defaultLogoUrl, forceDefault }` — see [Account avatar](#account-avatar). |
| `scopes`      | ➖       | network defaults   | Permission scopes requested at login. |

With `authMode: "direct"`, X/email sign-in and the external wallet list share a
single Fluent dialog. Email verification stays in place; X redirects to its OAuth
provider and resumes the dialog on return. Privy still owns any required MFA,
recovery, or signing prompt, and the Fluent dialog yields while those are open.
The wallet list scrolls within the dialog on smaller screens. WalletConnect hands
off to its QR flow after closing the Fluent dialog.

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
external EOA (sequential native-gas txs), shows the review modal, waits for
confirmation, and refreshes balances — **no host-side branching by account type.**

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
gas, no paymaster). This list is the *gas* token allow-list — it does **not**
restrict which tokens your calls operate on.

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
- [ ] Imported `@fluent.xyz/connect/styles.css` once.
- [ ] Mounted `<FluentWidget>` at the root; app rendered via `renderPage`.
- [ ] Read account via `useFluentWidget()` / `useWidget()`.
- [ ] All txs go through `createBatchOp(...).execute()`, guarded on `executionReady`.
- [ ] Signatures go through `widget.signMessage` / `widget.signTypedData` and are verified with ERC-1271/6492, not `ecrecover` (§7b).
- [ ] Checked provider coexistence if the app already uses wagmi / viem / react-query (§9).
```
