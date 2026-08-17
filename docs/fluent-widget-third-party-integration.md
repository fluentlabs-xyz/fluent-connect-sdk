# Fluent Widget Third-Party Integration

This guide describes the public SDK path for third-party Fluent ecosystem apps.

## Product Contract

Third-party apps should not mount Fluent's primary Privy app directly. Instead, they initialize Fluent Connect from the browser origin and open hosted Fluent ID on a Fluent-controlled origin:

```txt
https://connect-preview.vercel.app/authorize
```

That hosted page owns Privy login, embedded wallet creation, identity-token handling, and Fluent session exchange. The host app receives a Fluent session through origin-scoped `postMessage`.

## Prerequisites

1. A browser origin for the app.
2. Optional registered Fluent Connect `clientId` for production apps that need stricter scopes, limits, attribution, or display configuration.

Builders do not need Fluent's `PRIVY_APP_ID`, a Privy verification key, Privy dashboard access, WalletConnect/Reown project IDs, or a manually supplied `clientId` for the hosted Fluent ID basic path.

## Install


```bash
pnpm add @fluent.xyz/connect-sdk @fluent.xyz/connect viem
```

## External Wallets

The React widget owns the default Reown AppKit bridge for normal wallets and exposes Fluent ID as a first-class option alongside those wallets. Builders can still pass an explicit wallet adapter for advanced integrations, but the default integration should not require WalletConnect/Reown environment variables.

## Faucet

BLEND onboarding uses the protected Fluent faucet API:

```txt
POST https://eco-faucet-api.fluent.xyz/fluent-connect/pre-fund
Authorization: Bearer <privy-identity-token>
Content-Type: application/json
```

Default request body:

```json
{
  "visitorId": "anon_or_fingerprint_id"
}
```

The faucet service verifies the Privy identity token and derives the eligible embedded wallet. The frontend SDK should not decide faucet eligibility or store raw Privy tokens. Apps that need a custom faucet path can pass a `requestFaucet` override.

## Analytics

The widget should emit product events without storing secrets:

- `widget_loaded`
- `connect_opened`
- `login_completed`
- `wallet_connected`
- `faucet_started`
- `faucet_completed`
- `faucet_failed`
- `bridge_started`
- `bridge_quote_ready`
- `bridge_failed`
- `disconnect_clicked`

Do not store Privy access tokens, Privy identity tokens, Fluent session JWTs, cookies, hCaptcha responses, or authorization headers in analytics.

## Local Demo

Run the frontend SDK demo:

```bash
pnpm --filter mock-fluent-connect-main dev --host 0.0.0.0 --port 5173
```

Open:

```txt
http://localhost:5173
```

The demo uses `/authorize` as a local stand-in for `connect-preview.vercel.app/authorize`.

For production-style backend testing, run the sibling service separately:

```bash
cd ../connect-sdk-service
docker compose up --build
```

Then point the frontend to that service's hosted/session/events endpoints as needed.

## Production Checklist

- Register the app in Fluent Connect.
- Configure allowed origins and redirect URLs.
- Deploy hosted auth on a Fluent-controlled origin.
- Enable Privy identity tokens and embedded wallets in the primary Fluent Privy app.
- Fetch app config by origin in basic mode or by `clientId` for registered production apps.
- Confirm faucet behavior against `eco-faucet-api`.
- Confirm no secrets are logged or emitted in analytics.
