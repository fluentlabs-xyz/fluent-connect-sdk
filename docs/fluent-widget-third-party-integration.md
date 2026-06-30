# Fluent Widget Third-Party Integration

This guide describes the public SDK path for third-party Fluent ecosystem apps.

## Product Contract

Third-party apps should not mount Fluent's primary Privy app directly. Instead, they use a registered Fluent `clientId` and open hosted Fluent ID on a Fluent-controlled origin:

```txt
https://connect.fluent.xyz/authorize
```

That hosted page owns Privy login, embedded wallet creation, identity-token handling, and Fluent session exchange. The host app receives a Fluent session through origin-scoped `postMessage`.

## Prerequisites

1. A registered Fluent Connect app with a `clientId`.
2. Allowed origins configured for that `clientId`.
3. Enabled scopes and features for the app.
4. A WalletConnect/Reown project ID if the app wants external wallet connection.

Builders do not need Fluent's `PRIVY_APP_ID`, a Privy verification key, or Privy dashboard access for the hosted Fluent ID path.

## Install


If the app also wants the standard external wallet modal:

```bash
pnpm add @reown/appkit @reown/appkit-adapter-wagmi wagmi viem @tanstack/react-query
```

## External Wallets

The SDK should not become a hand-rolled wallet connector. Use Reown AppKit, RainbowKit, or the host app's existing wagmi setup for normal wallets, and keep Fluent ID as a first-class custom entry alongside those wallets.

Builders should normally create their own WalletConnect/Reown project ID. That gives them separate analytics, rate limits, branding metadata, and incident isolation.

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
pnpm --filter example-privy-connect dev --host 0.0.0.0 --port 5173
```

Open:

```txt
http://localhost:5173
```

The demo uses `/authorize` as a local stand-in for `connect.fluent.xyz/authorize`.

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
- Configure Reown/WalletConnect project ID for external wallets.
- Fetch app config by `clientId`.
- Confirm faucet behavior against `eco-faucet-api`.
- Confirm no secrets are logged or emitted in analytics.
