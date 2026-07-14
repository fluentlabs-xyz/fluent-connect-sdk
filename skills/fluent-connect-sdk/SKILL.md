---
name: fluent-connect-sdk
description: Use this skill when setting up, running, debugging, or integrating the Fluent Connect SDK, especially the React widget, hosted Fluent Connect login, Kernel/ZeroDev smart wallet derivation, Fluent Testnet balances, faucet/on-ramp/bridge actions, or the chess demo app.
metadata:
  short-description: Integrate and run Fluent Connect SDK apps
---

# Fluent Connect SDK

This skill helps an agent integrate the Fluent Connect SDK into a builder app or run the local chess demo from the `fluent-connect-sdk` monorepo.

## Core Model

- Builder apps should not mount Fluent's primary Privy app directly.
- Builder apps use hosted Fluent Connect login through an authorize URL.
- The embedded Privy wallet is an implementation detail and should stay hidden.
- User-facing actions should use the Kernel/ZeroDev smart wallet address.
- The default SDK path does not require the builder to know Fluent's Privy app id, Reown project id, or ZeroDev project id.

## Repository

Expected repo root:

```bash
/Users/user/projects/fluent/fluent-connect-sdk
```

Useful packages/apps:

```txt
packages/react          React widget and Fluent account hooks
packages/connect-sdk    Hosted authorize/session SDK
packages/wallet-sdk     Fluent chain/token helpers
apps/chess              Chess demo app
mocks/fluent-connect-main  Local hosted-authorize mock
config/local.env        Local non-secret demo config
```

Use `rg` for search. Do not duplicate SDK config inside apps; keep Fluent-specific defaults in SDK packages and app-specific values in the app env/config.

## Install

From repo root:

```bash
corepack enable
pnpm install
```

Requires Node `>=20` and pnpm via Corepack.

## Run Chess Demo With VPS Hosted Login

Use this when the developer only has the SDK repo and wants the easiest local setup.

Create `apps/chess/.env.local`:

```bash
VITE_FLUENT_CLIENT_ID=demo_app
VITE_FLUENT_APP_NAME=Fluent Chess Blitz Demo
VITE_FLUENT_AUTHORIZE_URL=https://fluent-connect.46.101.102.12.sslip.io/authorize

VITE_FLUENT_SESSION_ENDPOINT=
VITE_FLUENT_HOSTED_SESSION_ENDPOINT=
VITE_FLUENT_FAUCET_ENDPOINT=https://eco-faucet-api.fluent.xyz/fluent-connect/pre-fund
VITE_FLUENT_EVENTS_ENDPOINT=
VITE_FLUENT_PUBLIC_API_URL=https://fluent-connect.api.fluent.xyz/api/v1
VITE_FLUENT_BRIDGE_URL=https://portal.fluent.xyz/bridge

VITE_FLUENT_SWAPPER_ENABLED=true
VITE_FLUENT_SWAPPER_INTEGRATOR_ID=a5ece18d4332815e6480
VITE_FLUENT_SWAPPER_DST_CHAIN_ID=25363
VITE_FLUENT_SWAPPER_DST_TOKEN_ADDRESS=0xD48e565561416dE59DA1050ED70b8d75e8eF28f9

VITE_USDNR_TOKEN_ADDRESS=
VITE_BLEND_PAY_RECIPIENT=0xdC9BF18a1c307ce1A84e2775C7645e57eB373CD4

VITE_CHESS_CONTRACT_ADDRESS=0xA6ECe42bf2f1Df4FFA25578E8ff4097dD5AEBB3b
VITE_CHESS_GAME_ID=1
VITE_CHESS_FROM_BLOCK=31351387
VITE_CHESS_TREASURY_ADDRESS=0x1C92DffBCe76670F69007F22A54e31ff3Ab45d5E
VITE_CHESS_BOT_PLAYER_ADDRESS=0x1C92DffBCe76670F69007F22A54e31ff3Ab45d5E
VITE_CHESS_BOT_CONTROL_ENDPOINT=/chess-bot
```

Run:

```bash
pnpm --filter app-chess dev --host 0.0.0.0 --port 8050
```

Open:

```txt
http://localhost:8050/chess
```

Expected flow:

1. The chess app opens locally.
2. User clicks Fluent Connect.
3. Browser redirects to the hosted authorize URL.
4. User logs in with Fluent Connect.
5. Browser returns to the local chess app.
6. SDK derives the Kernel/ZeroDev smart wallet.

If login fails, check that the redirect origin `http://localhost:8050` is allowed by the hosted auth configuration.

## Run Fully Local Hosted Login Mock

Use this when the VPS hosted main app is unavailable or local auth mock behavior must be tested.

Terminal 1:

```bash
pnpm dev:main:local
```

Terminal 2:

```bash
pnpm dev:chess:local
```

Open:

```txt
http://localhost:8050/chess
```

The local config comes from `config/local.env`. Do not put secrets there.

## Chess Bot Limitation

The chess app proxies bot control calls:

```txt
/chess-bot -> http://127.0.0.1:8091
```

This is configured in `apps/chess/vite.config.ts`. Without a chess bot service on port `8091`, login, widget, balances, explorer, on-ramp, and UI can still be tested, but autonomous bot play and bot pause/resume controls will not fully work.

## Builder Integration Pattern

Prefer the React widget for app integration:

```tsx
import { FluentWidget, createFluentWidgetConfigFromEnv } from "@fluent/react";

const fluentWidgetConfig = createFluentWidgetConfigFromEnv(import.meta.env);

export function App() {
  return (
    <FluentWidget
      config={fluentWidgetConfig}
      onSession={(session) => {
        console.log(session.wallet.smartAccountAddress);
      }}
    />
  );
}
```

Minimal builder env:

```bash
VITE_FLUENT_APP_NAME=My Fluent App
VITE_FLUENT_AUTHORIZE_URL=https://connect.fluent.xyz/authorize
VITE_FLUENT_PUBLIC_API_URL=https://fluent-connect.api.fluent.xyz/api/v1
```

For the current demo environment, use:

```bash
VITE_FLUENT_AUTHORIZE_URL=https://fluent-connect.46.101.102.12.sslip.io/authorize
```

## Smart Wallet Rule

When displaying addresses or opening explorer/on-ramp/bridge actions:

- Use `session.wallet.smartAccountAddress` or `useFluentZeroDevAccount().smartAccountAddress`.
- Do not use `session.wallet.signerAddress` as a user-facing account.
- Do not expose the embedded Privy wallet as "Fluent Connect ID".
- If the smart account is not ready, show a preparing state instead of falling back to the signer address.

Relevant files:

```txt
packages/react/src/FluentWidget.tsx
packages/react/src/components/WalletMenuActionCard.tsx
packages/react/src/config.ts
```

## Batch Operations

Use the widget batch API for user-facing combined actions such as `approve + submitMove`, `approve + deposit`, or `faucet + approve` when calls are valid for one account and can execute sequentially in one UserOp.

Pattern:

```ts
const op = widget.createBatchOp({
  button: {
    label: "Batch approve + move",
    pendingLabel: "Submitting batch",
    successLabel: "Batch submitted",
  },
  calls: [
    {
      id: "approve-blend",
      label: "Approve BLEND",
      to: blendTokenAddress,
      abi: erc20Abi,
      method: "approve",
      args: [spender, amount],
    },
    {
      id: "submit-move",
      label: "Submit chess move",
      to: chessContractAddress,
      data: encodedMoveData,
    },
  ],
});

await op.execute();
```

Do not batch actions for different signers. In chess, batching both players' moves is invalid because turns alternate between different accounts.

## Validation

Before declaring setup complete:

```bash
pnpm --filter @fluent/react typecheck
pnpm --filter app-chess typecheck
pnpm --filter app-chess build
```

If the app runs but account state is stuck:

- Check browser console logs.
- Confirm the hosted authorize URL matches the environment.
- Confirm redirect origin is allowed.
- Confirm the session is stored in local storage under `fluent:widget:session:v1`.
- Confirm the Kernel smart wallet is ready before opening explorer/on-ramp.

## Production Notes

- Do not commit private keys, Privy verification keys, database credentials, or deployer secrets.
- Keep app registration, analytics persistence, and admin APIs outside the frontend-only SDK demo.
- Use hosted Fluent Connect for production builder flows so random builder domains are not added directly to Fluent's primary Privy app.
- App-specific values such as chess contract addresses belong in the app env; Fluent platform defaults belong in SDK packages.
