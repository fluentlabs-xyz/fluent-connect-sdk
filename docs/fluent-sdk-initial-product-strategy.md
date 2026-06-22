# Fluent SDK Initial Product Strategy

## Direction

Fluent SDK should make Fluent onboarding simple for early users and easy for ecosystem apps to integrate. The initial product bet is a low-friction embedded experience built around:

- `Connect with Fluent` as an extension to the standard `Connect Wallet` flow
- multiple wallet connection options plus Fluent ID through Privy ID
- Privy authentication and embedded wallets
- Fluent faucet funding
- BLEND token support
- first-party Fluent session exchange
- app-level analytics and attribution

For the first version, we are prioritizing Privy + Faucet instead of a full smart-account/paymaster stack. Privy currently supports paymaster flows for the BLEND token, so the SDK should lean into that supported path and avoid introducing extra wallet/account complexity before the core onboarding funnel is proven.

ZeroDev remains a useful option for Fluent SDK later. It can give apps smart accounts, session keys, sponsored transactions, batched execution, and a more advanced account-abstraction UX. Those are valuable once an app needs programmable accounts rather than a simple embedded wallet.

We are not making ZeroDev mandatory in the first version because it adds a second account address, a separate project configuration, and an extra mental model for early users. For the initial onboarding funnel, the simpler path is Privy ID, embedded wallet, BLEND faucet, and a verified Fluent session. Once this funnel is stable, ZeroDev can return as an optional mode for apps that specifically need smart-account behavior.

## Product Goal

Help a user land in a Fluent app, authenticate, receive usable BLEND funding, and continue into the app with minimal wallet knowledge.

For app developers, the SDK should provide a compact integration surface:

```tsx
<FluentWidget
  clientId="my-app"
  sessionEndpoint="https://connect.fluent.xyz/widget/session/exchange"
  faucetEndpoint="https://eco-faucet-api.fluent.xyz/fluent-connect/pre-fund"
  analyticsEndpoint="https://connect.fluent.xyz/widget/events"
/>
```

The app should not need to understand Privy token verification, faucet eligibility, campaign attribution, or backend wallet derivation.

## SDK Shape

Split the product into dedicated services and packages:

- `@fluent/connect-sdk`: TS/JS client SDK on top of Reown AppKit / WalletConnect-compatible connection flows, with Fluent ID as an additional connection option.
- `connect-sdk-service`: hosted auth exchange, Privy verification, session exchange, app registration, and app-config APIs.
- Analytics service: first-party event ingestion, attribution, funnels, and product intelligence.

The wallet layer should not become a hand-rolled wallet connector framework. The SDK should keep a narrow adapter boundary:

- discover injected wallets through EIP-6963 where available
- use strict EIP-1193 fallback only when a provider actually matches the selected wallet
- use Reown AppKit / WalletConnect protocol plumbing for QR, mobile, and injected wallet sessions
- keep Fluent ID as a first-party custom path inside or alongside the wallet modal

For production apps, Fluent should use Reown AppKit as the standard wallet modal and keep Fluent ID as a custom Fluent-owned entry. The first demo implementation opens Reown AppKit for normal wallets and opens Privy for Fluent ID. A deeper Fluent ID entry inside the Reown modal should be implemented as a custom connector or custom AppKit view once the exact production UX is finalized.

App registration remains in Postgres. The registry is operational state, not analytics state, and should continue to own `clientId`, origins, scopes, faucet configuration, campaign metadata, and display configuration.

Faucet verification and abuse controls belong to the protected `eco-faucet-api` service. The SDK should call that API with a Privy identity token and `visitorId`, while allowing apps to override faucet behavior through a dedicated callback when needed.

Longer term, Fluent SDK should support native session verification built on top of the `fluentbase` engine. This gives Fluent a path to verify richer session and account primitives directly instead of relying only on a vendor-specific auth token. The native path should support EIP-7702 flows and token or credential verification providers such as Nitro, Google, and other supported identity sources.

## Initial User Flow

1. App embeds the Fluent widget or React component.
2. User opens the existing connect-wallet flow.
3. App shows standard wallet options plus `Connect with Fluent`.
4. User selects `Connect with Fluent`.
5. Privy authenticates the user and creates or loads the embedded wallet.
6. Fluent Connect verifies the Privy token server-side.
7. Fluent Connect creates or loads the Fluent user record.
8. Fluent Connect returns a signed Fluent session token to the widget.
9. Widget exposes the user, embedded wallet, and funding state to the host app.
10. User claims BLEND from the faucet or receives another recommended action.
11. Host app receives analytics events for funnel measurement.

## Account Model

The first product version should keep the account model simple:

- Privy embedded wallet is the primary user wallet.
- Faucet funds BLEND to the embedded wallet or suggests an option to bridge tokens from other chains.
- Smart-account support remains an upgrade path, not the default onboarding requirement.

This avoids confusing new users with multiple addresses during the first session. If smart accounts become necessary for a specific app, the SDK can expose that as an advanced or app-configured mode later.

## Current Implementation Status

Implemented in the first SDK pass:

- `Connect with Fluent` can be shown inside a connect-wallet-style modal alongside host-provided wallet options.
- External wallet options are now routed through Reown AppKit instead of a hand-rolled wallet selector.
- The demo registers Fluent ID as a custom Reown wallet entry and keeps a first-class Fluent ID action in the connect choice sheet.
- The SDK exposes a provider-agnostic bridge adapter for route discovery, quote creation, execution, and status tracking.
- The widget smart menu can trigger bridge route discovery and quote creation.

Still missing for production:

- Real WalletConnect/Reown project ID and production wallet metadata.
- A custom Fluent ID connector or custom AppKit view if Fluent ID must live fully inside the Reown modal interaction model.
- Real bridge provider integration for quotes, execution, and status tracking.
- App registration fields that describe supported bridge assets, source chains, destination chain, and preferred route providers.
- Transaction preflight that decides whether to suggest faucet, bridge, swap, approval, or direct app execution.
