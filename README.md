# fluent-connect-sdk

Frontend SDK and demos for Fluent Connect.

The public integration path is hosted Fluent ID:

- third-party apps render the SDK widget or open the hosted authorize flow
- Privy is mounted only on a Fluent-controlled origin such as `connect.fluent.xyz`
- apps identify themselves by origin by default; registered `clientId` is an advanced production override
- external wallets are handled through Reown AppKit / WalletConnect-compatible flows
- BLEND onboarding uses the protected Fluent faucet API

The Go service for app registration, hosted session exchange, and analytics lives in the sibling `connect-sdk-service` project. This repository should stay frontend-only.

## Packages

- `packages/connect-sdk`: hosted Fluent Connect SDK with `fluent.initialize({ network })` and origin-derived app identity.
- `packages/wallet-sdk`: Fluent wallet SDK with chain metadata, bridge helpers, balances, families, and permissions clients.
- `packages/registry`: network and integration registry helpers.
- `apps/chess`: builder-facing chess demo app. Runs separately from hosted Fluent Connect.
- `mocks/fluent-connect-main`: local hosted Fluent Connect mock used only for `/authorize` redirects.

The chess bot runtime is intentionally not part of this frontend SDK workspace. It lives in the standalone deployable service at `/Users/user/projects/fluent/apps/fluent-chess-bot`.

## Builder Docs

- [Builder Integration Quickstart](./docs/builder-integration-quickstart.md)
- [Third-Party Integration Notes](./docs/fluent-widget-third-party-integration.md)

## Run The Demo

Environment-specific demo config lives in `config/` and is loaded by `scripts/with-config.mjs`.

Run the hosted Fluent Connect mock on the Privy-allowed origin:

```bash
pnpm dev:main:local
```

Open the mock directly only to verify the hosted app is alive:

```txt
http://localhost:5173
http://localhost:5173/authorize
```

Run the builder-facing chess app separately:

```bash
pnpm dev:chess:local
```

Open:

```txt
http://localhost:8050
http://localhost:8050/chess
```

You can run any command against a named config:

```bash
pnpm config:run local -- pnpm --filter app-chess build
pnpm config:run vps -- pnpm --filter app-chess dev --host 0.0.0.0 --port 8050
```

The local hosted mock uses `/authorize` as a stand-in for the Fluent-controlled auth domain. The chess app is intentionally under `apps/` because it represents a third-party builder app.

For the chess demo, run the standalone bot separately and keep `VITE_CHESS_BOT_CONTROL_ENDPOINT=/chess-bot` in the selected config so the chess app's Vite proxy forwards control calls to the bot service.

Builders should not need access to Fluent's primary Privy project or register their app domain in it for basic mode. Production apps can still use registered app metadata and a `clientId` when they need stricter scopes, limits, attribution, or display configuration. Builders need a WalletConnect/Reown project ID only if they want the standard external wallet modal.
