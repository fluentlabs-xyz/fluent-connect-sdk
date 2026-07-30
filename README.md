# fluent-connect-sdk

Frontend SDK and demos for Fluent Connect.

The public integration path is hosted Fluent ID:

- third-party apps render the SDK widget or open the hosted authorize flow
- Privy is mounted only on a Fluent-controlled origin such as `connect-preview.vercel.app`
- apps identify themselves by origin by default; registered `clientId` is an advanced production override
- external wallets are handled through Reown AppKit / WalletConnect-compatible flows
- BLEND onboarding uses the protected Fluent faucet API

The Go service for app registration, hosted session exchange, and analytics lives in the sibling `connect-sdk-service` project. This repository should stay frontend-only.

## Packages

- `packages/connect-sdk`: hosted Fluent Connect SDK with `fluent.initialize({ network })` and origin-derived app identity.
- `packages/connect-sdk`: hosted Fluent Connect SDK with `fluent.initialize({ network })`, origin-derived app identity, chain metadata, bridge helpers, balances, families, and permissions clients.
- `packages/wallet-sdk`: compatibility package that re-exports wallet helpers from `@fluent/connect-sdk`.
- `packages/registry`: network and integration registry helpers.
- `apps/chess`: builder-facing chess demo app. Runs separately from hosted Fluent Connect.
- `mocks/fluent-connect-main`: local hosted Fluent Connect mock used only for `/authorize` redirects.

The chess bot runtime is intentionally not part of this frontend SDK workspace. It lives in the standalone deployable service at `/Users/user/projects/fluent/apps/fluent-chess-bot`.

## Builder Docs

- [Builder Integration Quickstart](./docs/builder-integration-quickstart.md)
- [Third-Party Integration Notes](./docs/fluent-widget-third-party-integration.md)

## Run The Demo

Environment-specific demo config lives in `config/` and is loaded by `scripts/with-config.mjs`.

`http://localhost:5173` is the only localhost origin registered in the Fluent Privy project, so any locally served app that mounts Privy itself (`authMode: "direct"`, used by the chess, vault, and paymaster demos) must run on that port. The hosted Fluent Connect mock uses the same port, so run one or the other, not both.

Run the hosted Fluent Connect mock on the Privy-allowed origin:

```bash
pnpm dev:main:local
```

Open the mock directly only to verify the hosted app is alive:

```txt
http://localhost:5173
http://localhost:5173/authorize
```

Run the builder-facing chess app separately, after stopping the mock:

```bash
pnpm dev:chess:local
```

Open:

```txt
http://localhost:5173
http://localhost:5173/chess
```

The chess dev server uses `strictPort`, so it fails immediately if 5173 is taken rather than falling back to a port Privy will reject. Because both apps share the origin, they also share widget session state in `localStorage`; clear site data when switching between them if a stale session shows up.

You can run any command against a named config:

```bash
pnpm config:run local -- pnpm --filter app-chess build
pnpm config:run vps -- pnpm --filter app-chess dev --host 0.0.0.0 --port 8050
```

Deployed environments (Docker Compose and the VPS) still serve chess on 8050 behind its own domain, which is registered in Privy separately.

The local hosted mock uses `/authorize` as a stand-in for the Fluent-controlled auth domain. The chess app is intentionally under `apps/` because it represents a third-party builder app.

For the chess demo, run the standalone bot separately and keep `VITE_CHESS_BOT_CONTROL_ENDPOINT=/chess-bot` in the selected config so the chess app's Vite proxy forwards control calls to the bot service.

Builders should not need access to Fluent's primary Privy project or register their app domain in it for basic mode. Production apps can still use registered app metadata and a `clientId` when they need stricter scopes, limits, attribution, or display configuration. Builders need a WalletConnect/Reown project ID only if they want the standard external wallet modal.
