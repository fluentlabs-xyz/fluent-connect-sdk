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

```tsx
import {
  FluentWidget,
  fluentTestnet,
  readFluentTokenBalances,
} from "@fluent.xyz/connect";
import "@fluent.xyz/connect/styles.css";

export function App() {
  return (
    <FluentWidget
      config={{ network: "testnet", appName: "My App", authMode: "direct" }}
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

`authMode: "direct"` requires your origin in the Fluent Privy Allowed Origins. Default `authMode: "hosted"` uses the Fluent authorize popup.

## Styles

Import the package CSS once in your app entry:

```ts
import "@fluent.xyz/connect/styles.css";
```

## License

Apache-2.0
