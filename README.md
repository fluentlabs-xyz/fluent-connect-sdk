# fluent-connect-sdk

Frontend SDK and demos for Fluent Connect.

The public integration path is hosted Fluent ID:

- third-party apps render the SDK widget or open the hosted authorize flow
- Privy is mounted only on a Fluent-controlled origin such as `connect.fluent.xyz`
- apps identify themselves with a registered `clientId`
- external wallets are handled through Reown AppKit / WalletConnect-compatible flows
- BLEND onboarding uses the protected Fluent faucet API

The Go service for app registration, hosted session exchange, and analytics lives in the sibling `connect-sdk-service` project. This repository should stay frontend-only.

## Packages

- `packages/react`: React SDK components, hooks, bridge adapter types, hosted widget.
- `packages/chains`: Fluent chain metadata.
- `packages/registry`: network and integration registry helpers.
- `examples/privy-connect`: local Fluent Connect demo.

## Run The Demo

```bash
pnpm install
pnpm --filter example-privy-connect dev --host 0.0.0.0 --port 5173
```

Open:

```txt
http://localhost:5173
```

The local demo uses `/authorize` as a stand-in for the hosted Fluent-controlled auth domain.

## Third-Party Integration

Prefer `FluentHostedWidget` for external apps:

```tsx
import { FluentHostedWidget } from "@fluent/react";

<FluentHostedWidget
  clientId="my-app"
  authorizeUrl="https://connect.fluent.xyz/authorize"
  scopes={["openid", "profile", "wallet", "faucet"]}
  source="connect_button"
  campaign="launch"
  onSession={(session) => {
    console.log(session);
  }}
/>
```

Builders should not need access to Fluent's primary Privy project or register their app domain in it. They only need a Fluent `clientId`, allowed origins in Fluent Connect app registration, and a WalletConnect/Reown project ID if they want the standard external wallet modal.

