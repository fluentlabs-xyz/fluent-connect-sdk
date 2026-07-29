# Fluent Connect SDK Builder Quickstart

This guide shows how a third-party Fluent ecosystem app can add:

- `Continue with Fluent Connect`
- a Fluent account session
- BLEND faucet onboarding
- token balances for ETH, USDnr, BLEND, USDC, and USDT
- families/reputation lookup
- optional permissioned actions for app agents or bots

The current public integration path is hosted Fluent ID. Builders should not mount Fluent's primary Privy app directly and should not need Fluent's Privy app id, Privy verification key, or Privy dashboard access.

## Architecture

For the signer, validator, and ZeroDev Kernel account details behind batched execution, see [Fluent ZeroDev Signer Architecture](./fluent-zerodev-signer-architecture.md).

```txt
Builder app
  -> opens Fluent hosted authorize page
  -> user signs in with Fluent Connect ID
  -> Fluent-owned app handles Privy, embedded wallet, and ZeroDev account
  -> builder app receives a Fluent session by postMessage
  -> builder app uses the session smart account and Privy ID with SDK helpers
```

Default hosted authorize URL:

```txt
https://connect-preview.vercel.app/authorize
```

Local demo URL:

```txt
http://localhost:5173/authorize
```

## Prerequisites

1. A browser origin for your app, for example `https://game.example`.
2. A Fluent Testnet RPC endpoint if your app reads chain state directly.

For v1, `clientId` is not required for the default builder path. `fluent.initialize()` derives app identity from the browser origin and creates a stable local installation id. Registered `clientId` remains available as an advanced production override for apps that need stricter scopes, limits, attribution, or display configuration.

For hackathons or early demos, Fluent can support an anonymous/basic mode with restricted scopes and lower limits. Production apps should still use app registration so origins, scopes, faucet limits, analytics, and display metadata are explicit.

## Install

```bash
pnpm add @fluent/connect-sdk @fluent/react @fluent/connect-sdk viem
```

Fluent Connect service endpoints are built into the SDK. Builders should only configure values owned by their app, such as contract addresses.

## Session Model

The host app should treat the Fluent embedded signer as an implementation detail. The app should primarily display and use the Fluent smart account address.

```ts
export type FluentWidgetSession = {
  app: {
    mode: "origin" | "registered";
    origin: string;
    installationId: string;
    clientId?: string;
  };
  user: {
    id: string;
  };
  wallet: {
    smartAccountAddress?: `0x${string}`;
  };
  scopes: string[];
  issuedAt: number;
  idToken?: string;
};
```

Do not log or persist raw Privy identity tokens, Fluent session tokens, cookies, or authorization headers in analytics.

## Add Continue With Fluent

Initialize Fluent Connect once near app startup. No `clientId` is required by default.

```ts
import { fluent } from "@fluent/connect-sdk";

export const fluentConnect = fluent.initialize({
  network: "testnet",
  appName: "My Fluent App",
});
```

For registered production apps, `clientId` is still supported as an advanced override:

```ts
export const fluentConnect = fluent.initialize({
  network: "testnet",
  clientId: "registered_app_id",
});
```

Until the React widget package is published, builders can use the hosted authorize flow directly through the SDK.

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { fluentConnect } from "./fluent";

type FluentWidgetSession = {
  app?: {
    mode: "origin" | "registered";
    origin: string;
    installationId: string;
    clientId?: string;
  };
  user: { id: string };
  wallet: { smartAccountAddress?: `0x${string}` };
  scopes: string[];
  issuedAt: number;
  idToken?: string;
};

const FLUENT_SESSION_KEY = "fluent:widget:session:v1";

export function FluentConnectButton() {
  const authorizeUrl = "https://connect-preview.vercel.app/authorize";
  const [session, setSession] = useState<FluentWidgetSession | null>(() => {
    const raw = window.localStorage.getItem(FLUENT_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  });

  const redirectUri = useMemo(() => window.location.origin + window.location.pathname, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const expectedOrigin = new URL(authorizeUrl).origin;
      if (event.origin !== expectedOrigin) return;
      if (event.data?.type !== "fluent:session") return;

      const nextSession = event.data.session as FluentWidgetSession;
      window.localStorage.setItem(FLUENT_SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [authorizeUrl]);

  const connect = useCallback(() => {
    const url = fluentConnect.buildAuthorizeUrl(crypto.randomUUID());
    url.searchParams.set("redirect_uri", redirectUri);
    window.open(url.toString(), "fluent-connect", "popup,width=460,height=680");
  }, [redirectUri]);

  if (session?.wallet.smartAccountAddress) {
    return (
      <button type="button">
        Wallet Connected
      </button>
    );
  }

  return (
    <button type="button" onClick={connect}>
      Continue with Fluent Connect
    </button>
  );
}
```

Target packaged API:

```tsx
import { FluentWidget } from "@fluent/react";
import "@fluent/react/styles.css";

export function App() {
  return (
    <FluentWidget
      authorizeUrl="https://connect-preview.vercel.app/authorize"
      scopes={["openid", "profile", "wallet", "faucet", "families:read"]}
      onSession={(session) => {
        console.log(session.wallet.smartAccountAddress);
      }}
    />
  );
}
```

## Read Balances

Use the smart account address returned in the Fluent session.

```ts
import {
  fluentTestnet,
  fluentTestnetTokenDefaults,
  readFluentTokenBalances,
} from "@fluent/connect-sdk";
import { createPublicClient, http } from "viem";

const client = createPublicClient({
  chain: fluentTestnet,
  transport: http("https://rpc.testnet.fluent.xyz/"),
});

const balances = await readFluentTokenBalances({
  client,
  account: session.wallet.smartAccountAddress!,
  tokens: [
    fluentTestnetTokenDefaults.ETH,
    fluentTestnetTokenDefaults.USDnr,
    fluentTestnetTokenDefaults.BLEND,
    fluentTestnetTokenDefaults.USDC,
    fluentTestnetTokenDefaults.USDT,
  ],
});

console.table(
  balances.map((token) => ({
    symbol: token.symbol,
    balance: token.formatted,
    status: token.status,
  })),
);
```

If your app needs USD prices, add your own price API layer for now and join by token symbol/address. The SDK balance helper intentionally only reads chain balances.

## Copy Address UX

For bridge, explorer, and support flows, expose the Fluent smart account address as the user-facing account.

```tsx
function CopyFluentAddress({ address }: { address?: string }) {
  if (!address) return null;

  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(address)}
    >
      Copy Fluent account
    </button>
  );
}
```

## Families And Reputation

Use the public families endpoint through the SDK helper.

```ts
import { createFluentFamiliesClient } from "@fluent/connect-sdk";

const familiesClient = createFluentFamiliesClient({
  baseUrl: "https://api.fluent-connect.dev.gblend.xyz/api/v1",
});

const reputation = await familiesClient.getFamilies(session.user.id);

console.log(reputation.xHandle);
console.log(reputation.families.builder.tier);
```

The lookup uses the authenticated Privy user ID returned in the Fluent session.

## BLEND Faucet

The protected faucet verifies the user through Fluent/Privy identity. In the hosted flow, the app should call the faucet integration exposed by Fluent Connect or use the faucet endpoint configured for the widget.

```ts
async function claimBlendFaucet(identityToken: string, visitorId: string) {
  const response = await fetch(
    "https://eco-faucet-api.fluent.xyz/fluent-connect/pre-fund",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${identityToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ visitorId }),
    },
  );

  if (!response.ok) {
    throw new Error(`Faucet failed: ${response.status}`);
  }

  return response.json();
}
```

Production widgets should prefer a Fluent-controlled faucet wrapper when analytics, app limits, or campaign attribution are needed.

## Permissioned Actions

Use permissions when your app needs one user approval and then limited app/bot actions on behalf of the user.

Desired user-facing statement:

```txt
Allow this app to do exactly these things for exactly this time.
```

Current SDK direction:

```ts
import { CallType, createFluentZeroDevPermissionSession } from "@fluent/react";
import { generatePrivateKey } from "viem/accounts";

const session = await createFluentZeroDevPermissionSession({
  kernel,
  sessionPrivateKey: generatePrivateKey(),
  calls: [
    {
      target: "0xYourGameContract",
      selector: "0x...",
      callType: CallType.CALL,
    },
    {
      target: "0xYourGameContract",
      selector: "0x...",
      callType: CallType.BATCH_CALL,
    },
  ],
});

console.log(session.smartAccountAddress);
```

For the current chess demo, the permissioned runtime uses ZeroDev session accounts under the hood. A bot receives a scoped session account that can only call approved functions and optionally batch `approve + submitMove`. The old backend permission service path is intentionally not part of the current builder-facing SDK.

## Batch Transactions

Batching is useful when calls must happen atomically from the same smart account.

Good examples:

- `approve + submitMove`
- `claim faucet + approve`
- `swap + deposit`

Bad example:

- batching both chess players' moves, because turns alternate between different accounts.

The current demo uses ZeroDev smart account calls for batching. Builders should treat batching as a smart-account capability, not as a normal EOA wallet feature.

Inside `FluentWidget` render slots, use the widget batch API:

```tsx
<FluentWidget
  renderPage={({ widget }) => {
    async function approveAndMove() {
      const op = widget.createBatchOp({
        button: {
          label: "Approve + move",
          pendingLabel: "Submitting batch",
          successLabel: "Move submitted",
        },
        calls: [
          {
            id: "approve-blend",
            label: "Approve BLEND",
            to: BLEND_TOKEN_ADDRESS,
            abi: erc20Abi,
            method: "approve",
            args: [GAME_CONTRACT_ADDRESS, parseUnits("50", 18)],
          },
          {
            id: "submit-move",
            label: "Submit move",
            to: GAME_CONTRACT_ADDRESS,
            abi: gameAbi,
            method: "submitMove",
            args: [gameId, moveUci, fenAfterMove],
          },
        ],
      });

      const txHash = await op.execute();
      console.log(txHash);
    }

    return <button onClick={approveAndMove}>Approve + move</button>;
  }}
/>
```

## External Wallets

The React widget owns the default Reown AppKit bridge for normal wallets. Fluent Connect ID appears alongside those options as a first-class option. Builders can pass a custom wallet adapter only when they need to integrate an existing wallet stack.

## Bridge And On-Ramp

Current recommendation:

- Show the Fluent smart account address with one-click copy.
- Link to the Fluent bridge or Hyperlane while bridge UX is finalized.
- Add USDnr on-ramp once the Swapper Finance integration is available.
- Use balances to recommend next actions: faucet, bridge, swap, or proceed.

Example bridge link:

```tsx
<a href="https://portal.fluent.xyz/user/bridge" target="_blank" rel="noreferrer">
  Bridge to Fluent
</a>
```

## Analytics

Emit app-level events without secrets.

Recommended event names:

- `widget_loaded`
- `connect_opened`
- `login_completed`
- `wallet_connected`
- `faucet_started`
- `faucet_completed`
- `faucet_failed`
- `balances_loaded`
- `families_loaded`
- `permission_previewed`
- `permission_granted`
- `permission_revoked`
- `bridge_clicked`
- `disconnect_clicked`

Recommended dimensions:

- `origin`
- `installationId`
- `clientId`, when registered
- `campaign`
- `source`
- `chainId`
- `sessionAgeSeconds`
- `hasSmartAccount`
- `walletProvider`
- `errorCode`

Never include raw tokens, private keys, full auth headers, hCaptcha responses, or full session JWTs.

## Local Demo

From this repository:

```bash
pnpm install
pnpm --filter mock-fluent-connect-main dev --host 0.0.0.0 --port 5173
```

Open:

```txt
http://localhost:5173
```

The local demo includes:

- hosted `/authorize` mock
- Fluent Connect button and wallet menu
- balances dropdown
- families/reputation card
- chess permission demo
- Reown external wallet support when configured

## Production Checklist

- Start with origin-derived basic mode for fast integration.
- Register a Fluent Connect app and receive `clientId` only when stricter production controls are needed.
- Configure allowed origins and redirect URLs for registered production apps.
- Request only needed scopes.
- Use hosted Fluent ID on a Fluent-controlled origin.
- Display the smart account address, not the embedded signer.
- Add Reown/RainbowKit if external wallets are needed.
- Wire balances and families helpers.
- Add faucet UX and analytics.
- Add permission preview/grant/revoke UI for any on-behalf actions.
- Test blocked states: missing session, wrong origin, no smart account, faucet denied, permission expired, revoked session.
