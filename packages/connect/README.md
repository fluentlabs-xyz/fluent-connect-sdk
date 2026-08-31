# `@fluent.xyz/connect`

React widget for Fluent Connect — login, smart account, balances, batch txs, and gas payment UI.

## Install

```bash
pnpm add @fluent.xyz/connect react react-dom
```

Also ensure peer/runtime packages your app needs are installed (versions compatible with this package):

```bash
pnpm add @privy-io/react-auth viem wagmi @tanstack/react-query
```

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
        clientId: "your_fluent_connect_app_id",
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

`clientId` is required and must come from the host app (Fluent Connect registered app id).

`authMode: "direct"` requires your origin registered on the Privy app client behind your `clientId`. Default `authMode: "hosted"` uses the Fluent authorize popup and works on any origin.

### Authenticating your backend

`getAuthToken()` (render context / `useFluentWidget()`) returns a 5-minute ES256 JWT signed by
Fluent Connect. Send it to your backend once and issue your own session; verify it with the keys
at `<iss>/.well-known/jwks.json` — `iss` is the API host root, not `/api/v1` — and check `iss`,
`aud` (your `clientId`) and `exp`. `sub` is stable per user per app. `addresses` is present only
when your app has the `addresses` scope. Direct auth only. External wallets: an EOA or a deployed
contract wallet signs in; a counterfactual smart account cannot (no ERC-6492).
See `apps/auth-demo` for a browser-side verifier.

Brand images (logo, wallet icons) ship inside the package as bundled data URLs — you do not need a `/fluent-assets` folder.

### Connect button placement

By default the connect control floats top-right (`connectButton="fixed"`). To place it yourself:

```tsx
// Hide the default control and use your own CTA
<FluentWidget
  connectButton={false}
  config={{ clientId: "your_fluent_connect_app_id", network: "testnet", appName: "My App" }}
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

## Styles

Import the package CSS once in your app entry:

```ts
import "@fluent.xyz/connect/styles.css";
```

## License

Apache-2.0
