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
4. **Your app's origin registered on that Privy app client** — Fluent's sign-in
   dialog runs in your page, and Privy refuses an origin it does not know.

> **Upgrading from 0.4?** The login config changed in 0.5.0 — see
> [Upgrading from 0.4](#upgrading-from-04).

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
      }}
      mode="page"
      renderPage={() => <YourApp />}
    />
  );
}
```

`@fluent.xyz/connect/styles.css` is the package's **only** stylesheet and
carries everything the widget renders, including RainbowKit's styles for the
bridge wallet picker. The JavaScript entry imports no CSS of its own, so
`import "@fluent.xyz/connect"` also works where no bundler handles stylesheets
— server-side rendering, plain Node scripts, Jest.

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
| `clientId`    | ⛔       | —                  | Removed in 0.2.0, and still typed (as `never`) only so the error can name the fix: pass the App's id as `appId` and the Privy app client as `privyClientId`. Passing it throws at resolve time. |
| `partnerId`   | ⛔       | —                  | Renamed to `appId` in 0.3.0, and still typed (as `never`) only so the error can name the fix. Passing it throws at resolve time. |
| `network`     | ➖       | env → `"testnet"`  | `"testnet"` or `"mainnet"` — see [Networks and chain ids](#networks-and-chain-ids). |
| `appName`     | ➖       | `"Fluent Connect Demo"` | Shown in login UI. |
| `customOAuthRedirectUrl` | ➖ | current page | Exact HTTPS callback for the widget's Privy OAuth flows; no credentials, query, or fragment. See [Capacitor OAuth](#capacitor-oauth). |
| `enabledAuthMethods` | ➖ | `["google", "email", "passkey"]` | Methods the sign-in dialog offers beside X, in the order given. X is always offered — see [Sign-in methods](#sign-in-methods). |
| `source`      | ➖       | `"fluent_connect_widget"` | Attribution tag. |
| `campaign`    | ➖       | —                  | Attribution tag. |
| `reconnectOnMount` | ➖ | unset | Unset restores only injected wallets (including EIP-6963) and WalletConnect silently on page load. `true` restores every connector, including Base Account and Coinbase Wallet SDK, which may prompt. Explicit `false` restores none. Explicit connection and the Fluent session are unaffected. |
| `disableAnalytics` | ➖  | `false`            | `true` turns off all analytics — PostHog is never initialised, nothing sent or stored. |
| `gasPayment`  | ➖       | `{ defaultToken: "ETH", sponsorship: "auto" }` | Initial token, native-gas sponsorship policy, and optional `ethValueByToken` hints. A Fluent ID's saved token choice takes precedence; an external wallet applies no saved choice and always pays native gas — see [What the widget stores for a signed-in user](#what-the-widget-stores-for-a-signed-in-user). |
| `quickSign`   | ➖       | unset              | `{ whitelistAddresses }` — call targets Quick sign may execute without the review. Set, an operation is silent only when every call's `to` is on the list (compared case-insensitively); any other target shows the review and the signer prompt even with Quick sign on, including for an explicit `confirmation: "session"`. An empty list stops Quick sign from silencing anything; unset covers every address. Message / typed-data signatures have no call target and are not scoped by it. |
| `swapper`     | ➖       | Fluent defaults    | On-ramp/bridge config. |
| `reputationEnabled` | ➖ | `true`             | `false` hides the Reputation tab — and with it the tab strip, leaving Home. The families request is never made. |
| `assets`      | ➖       | Fluent brand       | Override logo etc. |
| `avatar`      | ➖       | Fluent mark        | `{ defaultLogoUrl, forceDefault }` — see [Account avatar](#account-avatar). |
| `scopes`      | ➖       | network defaults   | Permission scopes requested at login. |
| `sponsorshipUrl` | ➖    | network default    | Point the widget at another sponsorship service. Local development only. |
| `authTokenRenewalOffsetSeconds` | ➖ | `30`     | How many seconds before `exp` `getAuthToken()` stops reusing a token and fetches a fresh one. `0` drops the margin: a token is reused until `exp` itself, not fetched afresh on every call. |

✅ required, ➖ optional, ⛔ forbidden. The table is the whole of `FluentWidgetConfig`: a ⛔
field is still part of the type so that a config carrying it fails the typecheck and, past the
type, throws a message naming its replacement. A key removed from the type outright is not in
the table at all — for those, see the upgrade sections at the end of this document.

### Capacitor OAuth

Capacitor apps run at a local origin such as `capacitor://localhost` on iOS.
For X and other social sign-in, set
`customOAuthRedirectUrl` to an HTTPS Universal Link that returns to the app:

```tsx
<FluentWidget
  config={{
    appId,
    privyClientId,
    enabledAuthMethods: [], // X remains available.
    customOAuthRedirectUrl: "https://app.example.com/auth/ios/callback",
  }}
/>
```

The widget passes this URL to its internal `PrivyProvider`. Omitting it, or
passing a blank string, keeps Privy's current-page callback. Values are trimmed
and otherwise preserved to match the dashboard's exact redirect allowlist.
Custom schemes such as `capacitor://localhost` are not supported as callbacks.

The host still needs to:

1. Register `capacitor://localhost` and the callback's HTTPS domain in the
   Fluent-issued Privy client's allowed origins; enable X in the shared Privy app.
   Register the exact callback URL in Privy's allowed OAuth redirects.
2. Configure iOS Associated Domains and serve an `apple-app-site-association`
   file for the callback domain and the app's team/bundle identifier.
3. Install Capacitor's App/Browser plugins and handle `appUrlOpen` (and the
   launch URL when appropriate). Validate the callback origin and path, then
   copy its `privy_oauth_code`, `privy_oauth_state`, and `privy_oauth_provider`
   query parameters to the local webview URL so Privy can finish its OAuth flow.
   Keep the local OAuth session/state intact and close the browser after return.
4. Test sign-in, cancellation, and return on an iOS device. Dashboard allowlists
   and Universal Links are deployment prerequisites; setting this option alone
   does not complete native authentication.

See [Privy's Capacitor OAuth guide](https://docs.privy.io/recipes/capacitor-oauth)
and [allowed OAuth redirects](https://docs.privy.io/recipes/react/allowed-oauth-redirects).
This uses X OAuth through the browser; it does not guarantee a handoff to the
installed X app.

### Sign-in methods

Sign-in methods default to this order: **X, Google,
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
    // Leaves X and email.
    enabledAuthMethods: ["email"],
  }}
/>
```

Omit it to keep all three; pass `[]` to leave X as the only Fluent method. The
external wallet list is unaffected either way.

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

The first two describe a Fluent smart account and nothing else: Quick sign
governs the Fluent ID's signer, and the gas token decides what the paymaster is
charged. **For an external wallet (`widget.account.type === "eoa"`) the widget
neither applies nor writes either one.** It still performs the settings read —
the user's token list rides on it — and that list is still loaded, added to,
removed from and one-time-imported exactly as below, but no `PATCH /me/settings`
is ever sent for a preference, on any path. An external wallet confirms every
call in the wallet itself and pays native gas, so a stored value for either
preference would describe nothing it does; and writing one would overwrite what
the same person's Fluent ID keeps, because the service resolves both of their
sessions to one person and cannot tell them apart.

The widget reads once per sign-in and writes every change back — for an external
wallet, every change to the token list — using the same Fluent token
`getAuthToken()` returns ([§8](#8-auth-and-the-fluent-token)). Nothing is sent but that token —
no user id is ever put in a request by the widget.

It falls back to this browser's `localStorage` where no Fluent token can exist,
and behaves there exactly as it did before 0.4.0:

| State | The user's token list | Quick sign and the gas token |
| --- | --- | --- |
| Fluent ID | the service, or `localStorage` if the read fails | the service, or the in-memory defaults if the read fails |
| external wallet | the service, or `localStorage` if the read fails | not kept: neither applies to an external wallet |
| nobody connected | `localStorage` | the in-memory defaults |

The first time a user signs in with tokens already in this browser's
`localStorage` and none on the service, the widget carries that list over once and
then clears the local key. This is the token list, so it happens for an external
wallet too.

### What an external-wallet user sees in Settings

The wallet menu's Settings screen says the same thing the table does, so nothing
on it is a control over something that cannot happen. For an external wallet:

- **Quick sign** is shown off and disabled, described as "Available with a Fluent
  smart account". Every call is confirmed in the wallet, whatever the row holds.
- **Gas payment** is shown disabled, with the same description and the network's
  native token (ETH) as its value — what an external wallet always pays fees in,
  whatever `gasPayment.defaultToken` names.
- **Faucet** is hidden. It funds a Fluent smart account, and there is none here.
- **Explorer** reads "View account on explorer" and opens the EOA's own address
  rather than a smart account's.

The user's token list is on the same screen's Home panel and behaves as it does
for a Fluent ID: it loads from the service, and additions and removals are
written there. A Fluent ID's Settings screen is unchanged — both preferences are
live, the faucet is offered on a faucet network, and Explorer opens the smart
account.

One more thing is kept in `localStorage`, and it is not a preference: the **refresh
token** that renews the Fluent token without asking the user to sign again. It is
keyed by service, `appId` and account like everything else here, it is cleared when
the user disconnects, and it is never exposed through a widget API. What it is, how
long it lasts and what keeping it there costs you:
[§8](#where-the-session-is-kept-and-what-that-costs).

Nothing here is ever thrown at your app, and a read and a write fail differently:

- **A failed read** falls back to what the table above calls the read-failure
  case: this browser's `localStorage` token list, and for the two preferences
  whatever is on screen already — the in-memory defaults (Quick sign on, the
  network's default gas token), or the user's own choice if they have changed one
  since signing in. A failed read never applies the defaults over a value the
  person chose. Whether they are told depends on what failed:
  - **Nothing is shown** when the read only says "not yet" — no wallet connected
    yet, no Privy token yet. It is read again as soon as the missing wallet
    signer arrives for the same account. A service with no settings routes at all
    (a bare `404`) is also silent: that describes a deployment, not anything the
    person did or can clear.
  - **The message is shown** for every other failure — the user rejects the
    wallet signature, the network is down, the service answers 401 or 500. The
    wallet menu's Settings screen puts the service's message on its status line,
    the same line a failed write uses. There is no retry behind the user's back;
    it is read again the next time they sign in.

  Nothing is logged either way. For an external wallet only the token list is
  affected: it applied neither preference from a read that succeeded either, and
  the defaults it is left with are inert — but a read failure that has a message
  still shows it, because the same read carries the token list.
- **A failed write** — a preference the user just changed, or a token they added
  or removed — is visible: the wallet menu's Settings screen shows the service's
  message on its status line, and `AddTokenForm` shows it under the address
  field. The value the user chose stays in place for the rest of the session, and
  a failed removal is logged through `debugLogging`
  ([§9b](#9b-debugging-an-integration)). An external wallet writes no preference
  at all, so only its token writes can fail this way.

Failed writes are not queued or replayed. The next sign-in reads whatever the
service holds, which for a write that never landed is the old value.

> **Breaking in 0.4.0.** `UserTokenStore` is now asynchronous — `list`, `add` and
> `remove` return promises, and `add` has a new `{ status: "failed", message }`
> result. If you inject your own `userTokenStore`, wrap each method's return value in
> `Promise.resolve()` to port a 0.3.x implementation.
>
> `useFluentUserTokens()` changed shape with it, and that one needs no injected store to
> reach you: `add` and `remove` return promises — `add` resolving that same result — and
> `tokens` starts as an empty array on every mount, filling when the first load settles,
> so an empty `tokens` on the first render means "not loaded yet", not "no tokens".
> Called without `{ store }`, the hook reads and writes **this browser's `localStorage`
> only**, never the service's list the widget syncs for a signed-in user, and after the
> widget's one-time import moves the local list to the service, that local list is empty.
> The widget does not expose its service-backed store, so a host that needs the user's
> synced list must pass its own `store`. A failed load leaves the
> last list that settled on screen and tells your component nothing; the failure goes to
> `debugLogging`'s output ([§9b](#9b-debugging-an-integration)).

---

## 7. Sending a transaction

All execution goes through **one** API: `widget.createBatchOp({...}).execute()`.
The widget internally routes a smart account (one sponsored UserOp, signed under
the user's Quick sign setting) vs an external EOA (sequential native-gas txs,
each confirmed in the wallet, where Quick sign does not apply), waits for
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

The widget starts with native **ETH** selected. On a Fluent ID a valid saved user
preference takes precedence, and the user can choose another supported gas token
in the menu. An external wallet pays native gas on every call: its menu shows the
choice disabled over ETH, no saved preference is applied to it, and nothing is
saved from it ([§6](#what-an-external-wallet-user-sees-in-settings)).
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
overwriting saved preferences. External-wallet auto-reconnect now restores only injected wallets (including
EIP-6963) and WalletConnect when `reconnectOnMount` is unset. Base Account,
Coinbase Wallet SDK and unknown connectors do not reconnect or prompt by default;
explicit connection remains available. Set `reconnectOnMount: true` to restore
every connector, or explicitly set `false` to restore none. Wallet users returning
from Link X can therefore resume with the same EOA under the default policy.

### Always guard on `executionReady`

`createBatchOp` throws only on malformed input (an empty `calls` array, or a call
with neither `data` nor `abi` + `method`), but `execute()` rejects if the session
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

### What answers the signature

For a Fluent ID the **in-page Signer** answers: the Privy embedded wallet that
signed the user in, reached through the ZeroDev kernel in your page. For an
external wallet the wallet answers. Either way the signature is produced where
the user is, with no second window and no service round trip.

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

As in §7b, a smart-account signature is ERC-1271, so the marketplace's order validation has to
accept that; a validator without an ERC-6492 path also needs the account deployed,
which means a not-yet-deployed account must send one transaction before its first
listing validates.

Outside React, `createFluentIframeBridge(iframe, { allowedOrigin, executor })` is
the same bridge with the widget calls injected; `createFluentIframeRpcHandler(executor)`
is the method mapping alone, for a transport of your own.

---

## 8. Auth and the Fluent token

**Direct login** is the one way in. Clicking Connect opens **Fluent's own sign-in dialog**
inside your page, carrying the sign-in methods and the external wallet list on one screen
([§4](#sign-in-methods)); Privy runs headless behind it and renders no modal of its own.
Your origin **must** be registered on the Privy app client behind your `privyClientId`
first, otherwise Privy rejects it with `invalid_origin` and the login button does nothing.
Because the user's Privy session then lives in your page, so does everything that needs it:
`signMessage` and `signTypedData` ([§7b](#7b-requesting-a-signature)), the iframe bridge
([§7c](#7c-embedding-a-marketplace-iframe)), `linkX()` ([§8c](#8c-linking-x)) and
`getAuthToken()`.

What each account type gets:

| Account | Fluent token (`getAuthToken()`) minted by | Prompt | Signing | Sponsorship |
| --- | --- | --- | --- | --- |
| Fluent ID, on Direct login | widget, with the in-page Privy tokens | none | in page, with review | yes, with the Fluent token |
| External wallet, on Direct login | widget, challenge + wallet signature | one per session | the wallet | none: an EOA pays its own gas |

A Fluent ID exchanges the Privy tokens your page holds; an external wallet signs the
challenge in the page. With nobody connected, `getAuthToken()` rejects with
`not_connected`. How your backend checks the token:
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
session, which is how a stolen copy is caught. All of the above rests on the service
issuing that credential: a deployment old enough to answer the exchange without a refresh
half leaves the widget nothing to renew from, and the last case below is what happens
instead.

Your app never sees it, and never should. `getAuthToken()` returns the short-lived
Fluent token and nothing else; no widget API exposes the refresh token.

A **new signature** — a new full exchange — is needed only when:

- the session's thirty days are up (the service's `REFRESH_TOKEN_TTL` default; a
  renewal hands out a new credential but never moves that deadline);
- the service rejects the stored credential, because the session was revoked
  elsewhere or the same credential was presented twice;
- there is no stored credential in this browser: the user disconnected, cleared
  site data, or opened your app in another browser or another profile;
- the service answered the exchange without a refresh credential at all — a service
  deployment that predates refresh credentials. Nothing is stored, so nothing renews:
  every expired token is another full exchange, which for an external wallet is another
  signature every five minutes. The service this release targets issues one.

Two limits worth knowing. The first: renewal is coordinated **within one page**, not
across tabs. The stored credential is *shared* — the key carries the service, your
`appId` and the account, and nothing that distinguishes one tab from another — so two
tabs of your app hold one session between them, and only the page that renews knows the
credential rotated. If the other tab renews with the copy it read, the service sees the
same refresh token twice, ends that session as a suspected replay, and both tabs fall
back to a full exchange: one new signature for an external wallet, then business as
usual. Nothing is lost and nobody is signed out, but a multi-tab app should expect the
occasional extra prompt. Coordinating tabs is not in this release.

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
That transition path will be withdrawn, and the SDK release notes will say in which
release: this guide sets no date for it. Once it is gone, a page still running an earlier
release will get unsponsored transactions rather than a hard error — the account pays its
own gas, as the table's other rows already do.

The Sponsorship column above says what each account type gets, and only the first row
is sponsored. An external wallet sends through the wallet and never through the smart
account, so there is no user operation to sponsor. Nothing throws: the wallet pays its
own gas and the transaction goes through.

If the paymaster rejects a token with a `401`, the widget mints one fresh token and
retries the operation once before the account falls back to paying its own gas. A
`403` means your App is not set up for sponsorship, and the widget stops asking — for as
long as the widget's provider subtree lives, which is not the same as the page. The latch
sits in that subtree, and toggling Quick sign rebuilds it, so after a toggle the next
operation asks once more and latches again on the same `403`. Turn on `debugLogging`
([§9b](#9b-debugging-an-integration)) to see which of these happened.

A Fluent token needs one more piece of setup, in either mode and for either
account type: your page origin must be registered on your App in the Fluent App
settings. That is the Fluent auth service's own list, separate from the Privy
origin registration direct mode needs. From an unregistered origin
`getAuthToken()` rejects with `FluentAuthError` code `origin_not_allowed`.

> **Breaking in 0.4.0, for a host that builds its own ZeroDev account.** Two exported
> helpers changed with the switch to the Fluent token.
> `createFluentZeroDevSponsoredPaymaster({ chain, rpcUrl, bearerToken })` takes
> `bearerToken` where 0.3.x took `accessToken`, and the value is now the Fluent token
> `getAuthToken()` mints rather than a Privy access token. `useFluentZeroDevAccount` no
> longer reads a token itself: it sponsors nothing unless it is given
> `sponsorshipTokenSource` — a function returning the token source for the signed-in
> user — beside `appId` and `sponsorshipUrl`. `<FluentWidget>` wires both for you; this
> matters only if you call them yourself.

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
and the SDK renews it silently for both account types, a Fluent ID and an external wallet.
**Calling it often no longer prompts the wallet.** The wallet signs once, when the session
opens, and every renewal for the next thirty days is a background request, for as long as the
service issues the refresh credential a renewal spends
([§8](#the-token-renews-itself-silently)).

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
Calling it again after the last call has settled costs one request and changes nothing for a
user who already has X. Keep **one `linkX()` in flight per page**: do not mount `useLinkX()` and
also call `linkX()` on mount, and do not mount two `useLinkX()` hooks. A second call made while
the first still waits for the return replaces it, and the first never settles.

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
[§8](#8-auth-and-the-fluent-token), the same one `getAuthToken()` signs — so that **every signature happens
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
keyed on the address, renewed by the wallet's own refresh family ([§8](#8-auth-and-the-fluent-token)) — before,
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
| `bad_request` | The service refused the request body. Report it; it is ours, not yours. |
| `link_failed` | Everything else: a discarded link, `privy_wallet_mismatch`, a Fluent ID signed in beside the wallet, a sign-in step that timed out, a failure under the call. |

No other code reaches you from `linkX()`. A refusal raised under it — by the request that mints
the Fluent token, say — keeps its message and arrives as `link_failed`, so one `switch` over the
five codes above is complete.

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
- [ ] Origin allow-listed on the Privy app client behind your `privyClientId`.
- [ ] (`getAuthToken()`) page origin registered on your App in the Fluent App settings (§8).
- [ ] (linking X) called `linkX()` until it reports `linked` — it is re-entered after the redirect, not awaited across it — and verified the account on your backend (§8c).
- [ ] Imported `@fluent.xyz/connect/styles.css` once.
- [ ] Mounted `<FluentWidget>` at the root; app rendered via `renderPage`.
- [ ] Read account via `useFluentWidget()` / `useWidget()`.
- [ ] All txs go through `createBatchOp(...).execute()`, guarded on `executionReady`.
- [ ] Signatures go through `widget.signMessage` / `widget.signTypedData` and are verified with ERC-1271/6492, not `ecrecover` (§7b).
- [ ] Checked provider coexistence if the app already uses wagmi / viem / react-query (§9).

---

## Upgrading from 0.4

0.5.0 removes hosted mode. Direct login — Fluent's sign-in dialog inside your page
([§8](#8-auth-and-the-fluent-token)) — is the one way to log in to a Fluent ID.

- **`authMode` is removed from `FluentWidgetConfig`.** Delete the key. A config that passed
  `authMode: "direct"` keeps exactly the behaviour it had; the widget accepts the key one
  last time, ignores it and warns once. `authMode: "hosted"` throws at startup with these
  instructions.
- **A config that omitted `authMode` was on hosted mode** — it was the 0.4.x default — and is
  now on Direct login. Direct login mounts Privy on your page, so your App's origin has to be
  registered on the Privy app client behind your `privyClientId`
  ([§1](#1-prerequisites)). Ask Fluent to add it before you upgrade, or your
  users meet a login button that silently does nothing.
- **`fluent.initialize().connect()` and `.buildAuthorizeUrl()` are removed**, together with
  the `authorizeUrl` and `redirectUri` options of `fluent.initialize()`. There is no authorize
  popup to open. `initialize`, `status()`, `setSession()` and `disconnect()` are unchanged.
- **The `hosted_not_supported` error code is gone** from `FluentAuthError` and from the
  `linkX()` codes ([§8c](#8c-linking-x)): nothing refuses a signature, a token or a link for
  want of an in-page Privy session any more.
- **A user signed in through hosted mode on 0.4.x signs in again** after your App upgrades.
  Their stored session still shows them as connected and the first signature finds no signer;
  Disconnect, then sign in again, clears it.
- `FluentWidgetAuthMode` is no longer exported, and `FluentWidgetRenderContext` and
  `FluentIframeRpcExecutor` no longer carry `authMode`.
