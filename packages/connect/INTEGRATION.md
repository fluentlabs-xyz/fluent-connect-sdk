# Integrating `@fluent.xyz/connect`

A step-by-step guide to adding the Fluent Connect widget to a React app.

The widget provides everything between "user clicks Connect" and "transaction is
confirmed on Fluent": login (Privy), a ZeroDev smart account, the account/wallet
UI, gas payment in ERC-20, and a single execution API (`createBatchOp`) that
works for both smart accounts and external EOAs.

> **Scope.** This widget targets apps running **on the Fluent network**. Auth,
> the smart account, and the paymaster all use Fluent's shared infrastructure —
> you bring a `clientId`, not your own Privy/ZeroDev project.

---

## 1. Prerequisites

Before writing code you need:

1. **A Fluent Connect `clientId`** — a registered app id issued by Fluent. This
   is required; the widget throws without it.
2. **A target network** — `testnet` (default) or `mainnet`.
3. **(Only for `authMode: "direct"`)** your app's origin added to the Fluent
   Privy *Allowed Origins*. If you skip this, use the default `"hosted"` mode,
   which opens the Fluent authorize popup and needs no origin allow-listing.

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
        clientId: "your_fluent_connect_app_id",
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

---

## 4. Config reference (`FluentWidgetConfig`)

| Field         | Required | Default            | Notes |
|---------------|----------|--------------------|-------|
| `clientId`    | ✅       | —                  | Registered Fluent Connect app id. |
| `network`     | ➖       | env → `"testnet"`  | `"testnet"` or `"mainnet"`. |
| `appName`     | ➖       | `"Fluent Connect Demo"` | Shown in login UI. |
| `authMode`    | ➖       | `"hosted"`         | `"hosted"` = Fluent popup; `"direct"` = in-app Privy modal (needs allow-listed origin). |
| `source`      | ➖       | `"fluent_connect_widget"` | Attribution tag. |
| `campaign`    | ➖       | —                  | Attribution tag. |
| `disableAnalytics` | ➖  | `false`            | `true` turns off Fluent's own analytics and opts out of the wallet SDKs' telemetry where they allow it — see [Analytics and third-party telemetry](#analytics-and-third-party-telemetry). |
| `gasPayment`  | ➖       | —                  | `{ ethValueByToken }` — ETH-value hints for the gas selector. |
| `swapper`     | ➖       | Fluent defaults    | On-ramp/bridge config. |
| `assets`      | ➖       | Fluent brand       | Override logo etc. |
| `scopes`      | ➖       | network defaults   | Permission scopes requested at login. |

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
  const { widget, session, status, openConnect } = useFluentWidget();

  const address = widget.account.address ?? session?.wallet.smartAccountAddress;

  if (status === "restoring" || status === "connecting") return <Spinner />;
  if (status === "disconnected") return <button onClick={openConnect}>Connect</button>;
  return <span>{address}</span>;
}
```

### `status` — is anyone signed in?

`status` answers that on **every** render, including the first one:

| Value | Meaning |
|-------|---------|
| `"restoring"` | A session from a previous visit may exist; nothing is decided yet. |
| `"connecting"` | A sign-in the user started is in flight. |
| `"connected"` | An account is available. |
| `"disconnected"` | No account, and none is being restored or negotiated. |

**Do not collapse `"restoring"` into `"disconnected"`.** Restoring a session is
asynchronous — Privy has to rehydrate its auth state, and an external wallet has
to be reconnected by wagmi. Until that settles, `hasConnectedAccount` is `false`
and `connecting` is `false`, exactly as they are for a genuinely signed-out
visitor. A host branching on those two flags cannot tell the cases apart and will
show a Connect button to users who already have a live session — which then looks
like the widget "lost" the session. `status` is what distinguishes them, so
branch on it and render a neutral/loading state while it is `"restoring"`.

`status` is a plain value you can read at any time, not an event, so there is
nothing to subscribe to and no race to lose: if you mirror widget state into your
own store (Zustand, Redux, a wagmi connector), copy `status` across and gate on it
instead of polling with timeouts.

`status === "connected"` means an account exists — **not** that it can send a
transaction yet. Smart-account initialisation continues after that point; use
`widget.account.executionReady` for the "can I submit right now?" question.

Key fields on `widget.account`:

- `connected` — a user is signed in.
- `executionReady` — the account can send transactions **now**.
- `executionStatus` / `executionError` — `"disconnected" | "ready" | "unavailable" | "error"` and a message.
- `type` — `"smart"` or `"eoa"`.
- `capabilities` — `{ atomicBatch, erc20Gas }` (both smart-account only), so you can adapt UI without branching on `type`. `erc20Gas` means gas can be paid in an ERC-20 via the paymaster — not free/sponsored gas.

Use `useWidget()` if you only need the `widget` API and nothing else from the context.

### Disconnecting from your own UI

`disconnect()` runs the same teardown as the account menu's **Disconnect**, for
both `authMode` values — you do not have to send the user into `openAccount()`
to end a hosted-login session. It clears the widget session, the stored identity
token and any connected external wallet, and resolves once that is done:

```tsx
const { disconnect } = useFluentWidget();

async function signOut() {
  await disconnect();
  resetMyAppState(); // the widget session is fully gone by here
}
```

`onSessionChange` still fires with `null` as part of the teardown, so a host that
already mirrors the session there does not need to await anything.

### Analytics and third-party telemetry

The widget embeds Reown AppKit and, through it, the Coinbase Wallet SDK. Both
ship telemetry of their own, so `disableAnalytics: true` is pushed down into them
as well — otherwise the option would silence only Fluent's own events while the
network tab kept filling up.

With `disableAnalytics: true`:

| Source | Endpoint | Result |
|--------|----------|--------|
| Fluent (PostHog) | your `analyticsHost` | Never initialised. |
| Coinbase Wallet SDK and Base Account SDK | `cca-lite.coinbase.com` | Fully off. Also stops both SDKs injecting their inline telemetry `<script>`, which a strict `script-src` CSP would otherwise block. |
| Reown AppKit | `pulse.walletconnect.org` | Off, **except** three events AppKit hardcodes as mandatory: `INITIALIZE`, `CONNECT_SUCCESS`, `SOCIAL_LOGIN_SUCCESS`. |

Those three cannot be suppressed through AppKit's public options. If your
environment must not reach `pulse.walletconnect.org` at all, block it at the CSP
or network layer — the widget degrades gracefully when the beacons fail.

Turning analytics off does not remove any wallet from the connect modal.

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

## 8. Auth modes

- **`hosted` (default)** — clicking Connect opens the Fluent authorize popup. No
  origin setup; works anywhere. Best default for third-party apps.
- **`direct`** — the Privy login modal renders inside your app. Smoother UX, but
  your origin **must** be registered in Fluent's Privy Allowed Origins first.

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

- [ ] Got a Fluent Connect `clientId`.
- [ ] Picked network (`testnet` / `mainnet`).
- [ ] (`direct` only) origin allow-listed in Fluent Privy.
- [ ] Imported `@fluent.xyz/connect/styles.css` once.
- [ ] Mounted `<FluentWidget>` at the root; app rendered via `renderPage`.
- [ ] Read account via `useFluentWidget()` / `useWidget()`.
- [ ] All txs go through `createBatchOp(...).execute()`, guarded on `executionReady`.
- [ ] Checked provider coexistence if the app already uses wagmi / viem / react-query (§9).
```
