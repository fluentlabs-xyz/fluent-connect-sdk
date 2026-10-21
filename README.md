# fluent-connect-sdk

Frontend SDK and demos for Fluent Connect.

The public integration path is Direct login:

- third-party apps render the SDK widget, and Fluent's sign-in dialog opens inside their own page
- Privy is mounted in the App's page, so the App's origin has to be registered on the Privy app client Fluent issues for it (`privyClientId`)
- apps identify themselves by origin by default; registered `clientId` is an advanced production override
- external wallets are handled through Reown AppKit / WalletConnect-compatible flows
- BLEND onboarding uses the protected Fluent faucet API

The Go service for app registration, auth tokens, user settings and analytics lives in the sibling `connect-sdk-service` project. This repository should stay frontend-only.

## Packages

- `packages/connect`: publishable React widget (`@fluent.xyz/connect`) — Privy + ZeroDev, styles at `@fluent.xyz/connect/styles.css`.
- `packages/connect-sdk`: headless Fluent Connect SDK with `fluent.initialize({ network })`, origin-derived app identity, session persistence, chain metadata, bridge helpers, balances, families, and permissions clients (bundled into `@fluent.xyz/connect` for npm).
- `packages/registry`: network and integration registry helpers (bundled into `@fluent.xyz/connect` for npm).
- `apps/chess`: builder-facing chess demo app.

The chess bot runtime is intentionally not part of this frontend SDK workspace. It lives in the standalone deployable service at `../fluent-chess-bot`.

## Builder Docs

- [Builder Integration Quickstart](./docs/builder-integration-quickstart.md)
- [Third-Party Integration Notes](./docs/fluent-widget-third-party-integration.md)

## Run The Demo

Environment-specific demo config lives in `config/` and is loaded by `scripts/with-config.mjs`.

`http://localhost:5173` is the only localhost origin registered in the Fluent Privy project, and every demo mounts Privy in its own page, so a locally served demo must run on that port. Only one demo can hold it, so run one at a time.

Run the builder-facing chess app:

```bash
pnpm dev:chess:local
```

Open:

```txt
http://localhost:5173
http://localhost:5173/chess
```

The chess dev server uses `strictPort`, so it fails immediately if 5173 is taken rather than falling back to a port Privy will reject. Because the demos share the origin, they also share widget session state in `localStorage`; clear site data when switching between them if a stale session shows up.

You can run any command against a named config:

```bash
pnpm config:run local -- pnpm --filter app-chess build
pnpm config:run vps -- pnpm --filter app-chess dev --host 0.0.0.0 --port 8050
```

Deployed environments (Docker Compose and the VPS) still serve chess on 8050 behind its own domain, which is registered in Privy separately.

The chess app is intentionally under `apps/` because it represents a third-party builder app.

For the chess demo, run the standalone bot separately and keep `VITE_CHESS_BOT_CONTROL_ENDPOINT=/chess-bot` in the selected config so the chess app's Vite proxy forwards control calls to the bot service.

Builders should not need access to Fluent's primary Privy project or register their app domain in it for basic mode. Production apps can still use registered app metadata and a `clientId` when they need stricter scopes, limits, attribution, or display configuration. Builders need a WalletConnect/Reown project ID only if they want the standard external wallet modal.
