# Fluent Connect Current Progress

## Implemented In This Frontend Repo

- Hosted Fluent ID popup mode through `FluentHostedWidget`.
- Local `/authorize` demo that stands in for the future `connect.fluent.xyz/authorize` surface.
- Reown AppKit / WalletConnect path for normal external wallets.
- Top-right connect button with a connected account menu.
- Fluent Connect ID as a first-class option alongside wallet connection.
- Identity-token faucet request path against `https://eco-faucet-api.fluent.xyz/fluent-connect/pre-fund`.
- BLEND pay-in demo that checks BLEND balance and updates the CTA to `Ready to PAY` when the account has enough BLEND.
- Smart menu actions for faucet, bridge, explorer, WalletConnect, and disconnect.
- Provider-agnostic bridge adapter types for route discovery, quote, execution, and status.
- Typed app-config client through `fetchFluentAppConfig` and `useFluentAppConfig`.
- ZeroDev removed from the initial demo path; it remains a future optional account-abstraction path.

## Split Architecture

This repository is frontend-only.

The Go service belongs in the sibling `connect-sdk-service` repo and owns:

- hosted/session exchange endpoints
- Privy token verification
- app registration
- app config APIs
- analytics ingestion
- persistence

The protected `eco-faucet-api` service owns faucet verification and abuse controls.

## Current Runtime Behavior

- Before connection, the top-right button opens the connect modal.
- `Fluent Connect ID` opens hosted Fluent ID.
- Wallet options open Reown AppKit / WalletConnect when a project ID is configured.
- After connection, the top-right button shows `Wallet Connected` and opens the account menu on hover/click.
- Faucet requires a Fluent ID session and Privy identity token.
- External wallet connection is intentionally separate from Fluent ID for now.

## Missing For Production

- Wire fetched app config into the demo/widget UI and gate visible features/scopes from registration.
- Real production `connect.fluent.xyz/authorize` deployment.
- Production Reown/WalletConnect metadata and project ID strategy.
- Real bridge provider integration for native bridge and Hyperlane.
- Swapper Finance on-ramp integration.
- Token balance widget with USD prices, icons, and extensible token list.
- Copyable embedded wallet address.
- `/families/` endpoint helper on the SDK user object.
- Privy gasless transaction UX for BLEND-supported flows.
- Optional custom Fluent ID connector or custom AppKit view if Fluent ID must live fully inside the Reown modal.
