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
packages/connect          React widget and Fluent account hooks
packages/connect-sdk    Hosted authorize/session SDK
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

## Run Chess Demo

Use this when the developer only has the SDK repo and wants the easiest local setup.

Create `apps/chess/.env.local`:

```bash
VITE_BLEND_PAY_RECIPIENT=0xdC9BF18a1c307ce1A84e2775C7645e57eB373CD4

VITE_CHESS_CONTRACT_ADDRESS=0xf01977020ba70fd4D36077c830037cd30400f436
VITE_CHESS_FROM_BLOCK=30477100
VITE_CHESS_TREASURY_ADDRESS=0x1C92DffBCe76670F69007F22A54e31ff3Ab45d5E
VITE_CHESS_BOT_PLAYER_ADDRESS=0x1C92DffBCe76670F69007F22A54e31ff3Ab45d5E
VITE_CHESS_BOT_CONTROL_ENDPOINT=/chess-bot
```

Run:

```bash
pnpm --filter app-chess dev --host 0.0.0.0 --port 5173
```

Open:

```txt
http://localhost:5173/chess
```

Expected flow:

1. The chess app opens locally.
2. User clicks Fluent Connect.
3. Browser redirects to the hosted authorize URL.
4. User logs in with Fluent Connect.
5. Browser returns to the local chess app.
6. SDK derives the Kernel/ZeroDev smart wallet.

The chess app uses `authMode: "direct"`, so Privy is mounted on the chess origin itself and that origin must be registered in the Fluent Privy project. `http://localhost:5173` is the only registered localhost origin, which is why the chess dev server pins that port with `strictPort`. Serving chess anywhere else locally makes Privy refuse to load with a `frame-ancestors` CSP error on `auth.privy.io`.

## Run Fully Local Hosted Login Mock

Use this when the VPS hosted main app is unavailable or local auth mock behavior must be tested.

The mock and the chess app both need 5173, so they cannot run at the same time. Start the mock, verify hosted authorize, then stop it before starting chess.

```bash
pnpm dev:main:local
```

```bash
pnpm dev:chess:local
```

Open:

```txt
http://localhost:5173/chess
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
import { FluentWidget } from "@fluent.xyz/connect";

export function App() {
  return (
    <FluentWidget
      config={{
        network: "testnet",
        appName: "My Fluent App",
      }}
      onSession={(session) => {
        console.log(session.wallet.smartAccountAddress);
      }}
    />
  );
}
```

Fluent Connect infrastructure values come from the shared package. Builder apps should not duplicate them in environment files.

## Smart Wallet Rule

When displaying addresses or opening explorer/on-ramp/bridge actions:

- Use `session.wallet.smartAccountAddress` or `useFluentZeroDevAccount().smartAccountAddress`.
- Do not use `session.wallet.signerAddress` as a user-facing account.
- Do not expose the embedded Privy wallet as "Fluent Connect ID".
- If the smart account is not ready, show a preparing state instead of falling back to the signer address.

Relevant files:

```txt
packages/connect/src/FluentWidget.tsx
packages/connect/src/components/WalletMenuActionCard.tsx
packages/connect/src/config.ts
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
pnpm --filter @fluent.xyz/connect typecheck
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
