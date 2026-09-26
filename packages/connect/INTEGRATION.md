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
| `authMode`    | ➖       | `"hosted"`         | `"hosted"` = Fluent popup; `"direct"` = in-app Privy modal (needs allow-listed origin). |
| `source`      | ➖       | `"fluent_connect_widget"` | Attribution tag. |
| `campaign`    | ➖       | —                  | Attribution tag. |
| `disableAnalytics` | ➖  | `false`            | `true` turns off all analytics — PostHog is never initialised, nothing sent or stored. |
| `gasPayment`  | ➖       | —                  | `{ ethValueByToken }` — ETH-value hints for the gas selector. |
| `swapper`     | ➖       | Fluent defaults    | On-ramp/bridge config. |
| `reputationEnabled` | ➖ | `true`             | `false` hides the Reputation tab — and with it the tab strip, leaving Home. The families request is never made. |
| `assets`      | ➖       | Fluent brand       | Override logo etc. |
| `avatar`      | ➖       | Fluent mark        | `{ defaultLogoUrl, forceDefault }` — see [Account avatar](#account-avatar). |
| `scopes`      | ➖       | network defaults   | Permission scopes requested at login. |

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

  if (!widget.account.connected) return <button onClick={openConnect}>Connect</button>;
  return <span>{address}</span>;
}
```

Key fields on `widget.account`:

- `connected` — a user is signed in: a Fluent ID (hosted or direct login) or an external wallet.
- `executionReady` — the account can send transactions **now**.
- `executionStatus` / `executionError` — `"disconnected" | "ready" | "unavailable" | "error"` and a message. `"unavailable"` is connected-but-cannot-send, and `executionError` says why.
- `type` — `"smart"` or `"eoa"`.
- `capabilities` — `{ atomicBatch, erc20Gas }` (both smart-account only), so you can adapt UI without branching on `type`. `erc20Gas` means gas can be paid in an ERC-20 via the paymaster — not free/sponsored gas.

Use `useWidget()` if you only need the `widget` API and nothing else from the context.

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
`widget.account.executionError` to the user rather than leaving a silently
disabled button. Both auth modes (§8) report `executionReady: true` as soon as
the user is signed in — there is no initialization to wait for on your side.

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
same code `getAuthToken()` uses.

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
  origin setup; works anywhere. Best default for third-party apps. The Privy
  credentials stay on the Fluent origin, so each transaction the user confirms in
  your widget's review is then signed in a Fluent popup (`authorize?action=fluent_sign`),
  which the authorize page must serve. Gas is paid by the account itself: App
  sponsorship needs a Privy token this page does not have.
- **`direct`** — the Privy login modal renders inside your app. Smoother UX, but
  your origin **must** be registered on the Privy app client behind your
  `privyClientId` first, otherwise Privy rejects it with `invalid_origin` and the
  login button does nothing. Required for `getAuthToken()`, `signMessage` and
  `signTypedData` (§7b), and for gas sponsorship.

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
- [ ] Imported `@fluent.xyz/connect/styles.css` once.
- [ ] Mounted `<FluentWidget>` at the root; app rendered via `renderPage`.
- [ ] Read account via `useFluentWidget()` / `useWidget()`.
- [ ] All txs go through `createBatchOp(...).execute()`, guarded on `executionReady`.
- [ ] Signatures go through `widget.signMessage` / `widget.signTypedData` and are verified with ERC-1271/6492, not `ecrecover` (§7b).
- [ ] Checked provider coexistence if the app already uses wagmi / viem / react-query (§9).
```
