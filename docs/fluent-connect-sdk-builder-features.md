# Fluent Connect SDK And Widget: Builder And User Feature Guide

This document describes what the Fluent Connect SDK and widget provide to ecosystem builders and to their users. It is written as a product and integration guide rather than a low-level implementation note. The goal is to make clear what a builder gets by adding Fluent Connect, what the user sees, what runs under the hood, and where the current API already exists versus where the API is the intended next shape.

The current SDK is centered around a simple product statement:

> A builder app should be able to add one Fluent entry point that lets a user log in, receive or move assets, see their Fluent account state, and authorize scoped smart-account actions without the builder managing Fluent's primary Privy setup directly.ET

The SDK does this through three layers:

1. `@fluent/connect-sdk`: hosted login/session helpers, app identity, chain metadata, balances, families, bridge helpers, and backend-style permission clients.
2. `@fluent/react`: the React widget, wallet modal, Fluent Connect ID flow, Kernel/ZeroDev smart account derivation, batch operation API, permission session API, and in-widget account actions.
3. `@fluent/wallet-sdk`: wallet-oriented exports for Fluent chain/token helpers. Today this re-exports the connect SDK helpers so builders can import token and chain utilities from a wallet-focused package.

The chess app in `apps/chess` demonstrates the product in a concrete third-party app. It uses Fluent Connect login, a user-facing Kernel smart wallet, BLEND balances, faucet/on-ramp/bridge/explorer actions, batch transactions, and permissioned bot play.

## 1. Hosted Fluent Connect Login

The first feature builders get is a hosted login flow that avoids forcing each builder to register their own domain inside Fluent's primary Privy app. This is important for ecosystem growth: hackathon teams, early DeFi apps, games, and internal prototypes should be able to try Fluent Connect without being blocked by manual Privy allow-listing.

The flow is:

```txt
Builder app
  -> opens Fluent hosted authorize page
  -> user signs in with Fluent Connect ID
  -> Fluent-owned auth page handles Privy, embedded wallet, and identity token
  -> user returns to builder app
  -> builder app receives a Fluent session
  -> widget derives or refreshes the user's Kernel smart wallet
```

The builder can initialize the base SDK directly:

```ts
import { fluent } from "@fluent/connect-sdk";

const fluentConnect = fluent.initialize({
  network: "testnet",
  appName: "My Fluent App",
  authorizeUrl: "https://connect-preview.vercel.app/authorize",
});

const authorizeUrl = fluentConnect.buildAuthorizeUrl();
window.open(authorizeUrl, "fluent-connect", "popup,width=460,height=680");
```

For registered production apps, the builder may provide a `clientId`:

```ts
const fluentConnect = fluent.initialize({
  network: "testnet",
  clientId: "my_registered_app",
  appName: "My Fluent App",
});
```

For anonymous/basic mode, `clientId` can be omitted. The SDK derives app identity from:

- browser origin
- locally generated installation id
- optional app display name
- requested scopes
- campaign/source metadata

This makes it feasible to run builder experiments without manual registration. Production apps can still move to explicit registration once they need stricter limits, scopes, attribution, or display metadata.

The session shape intentionally exposes a user and Fluent account state without exposing sensitive Privy internals as the primary product concept:

```ts
type FluentSession = {
  app: {
    mode: "origin" | "registered";
    origin: string;
    installationId: string;
    clientId?: string;
    appName?: string;
  };
  user: {
    id: string;
    email?: string;
  };
  wallet: {
    smartAccountAddress?: `0x${string}`;
  };
  scopes: string[];
  issuedAt: number;
  idToken?: string;
};
```

The key product decision is that the user-facing address should be the smart account address. The embedded Privy wallet is a signer and should usually stay hidden.

## 2. React Widget As The Primary Integration Surface

Most builders should not wire the hosted auth flow manually. They should use the React widget:

```tsx
import { FluentWidget } from "@fluent/react";

export function App() {
  return (
    <FluentWidget
      config={{
        network: "testnet",
        appName: "My Fluent App",
      }}
      onSessionChange={(session) => {
        console.log("Fluent session", session);
      }}
    />
  );
}
```

The widget provides:

- a top-right `Connect Wallet` / `Wallet Connected` control
- a combined connect modal with WalletConnect options and Fluent Connect ID
- hosted Fluent Connect login
- account menu on hover/click
- faucet action
- bridge action
- USDnr on-ramp action through Swapper Finance
- explorer action for the Kernel smart wallet
- balances for configured tokens
- reputation/families card
- optional permissions card
- batch operation API available to custom render slots
- ZeroDev smart account readiness and execution status

The widget accepts render slots so builders can embed Fluent Connect into their own product UI:

```tsx
<FluentWidget
  config={fluentWidgetConfig}
  mode="page"
  renderPage={({ session, widget, openConnect }) => (
    <main>
      {session ? (
        <button onClick={() => console.log(widget.account.address)}>
          Use Fluent Account
        </button>
      ) : (
        <button onClick={openConnect}>Continue with Fluent</button>
      )}
    </main>
  )}
/>
```

The render context gives the app:

```ts
type FluentWidgetRenderContext = {
  session: FluentWidgetSession | null;
  connectedAddress?: string;
  wallet: FluentExternalWalletState | null;
  widget: FluentBatchApi;
  openConnect: () => void;
};
```

`widget.account.address` is the account builders should use for smart-account actions once execution is ready. In the current implementation this points to the Kernel/ZeroDev smart account when it is available.

## 3. WalletConnect And Fluent Connect ID In One Modal

Builders often already have a wallet connection flow. Fluent Connect should not replace that entire mental model. Instead, it adds a new first-class option:

- connect with MetaMask, Rabby, Coinbase, WalletConnect, and similar wallets through Reown AppKit
- connect with Fluent Connect ID for Fluent-native onboarding

The current widget modal presents wallet options on one side and `Fluent Connect ID` on the other. This lets a DeFi app support conventional wallet users while also offering a Web2-like Fluent identity path.

Example user flows:

```txt
Experienced crypto user:
  Connect Wallet -> MetaMask / WalletConnect -> use app with existing wallet

New Fluent ecosystem user:
  Fluent Connect ID -> email/social login via Privy -> embedded signer -> Kernel smart wallet
```

For builders, the benefit is that they can add Fluent Connect without losing users who still expect a wallet modal. For users, the benefit is that the same top-right account control can represent both entry paths.

The external wallet state is exposed as:

```ts
type FluentExternalWalletState = {
  configured: boolean;
  connected: boolean;
  address?: string;
  chainId?: number;
  walletClient?: unknown;
  open: () => void;
  disconnect: () => void;
  switchChain: (chainId: number) => Promise<void>;
};
```

Apps can pass their own wallet adapter if they already own wallet connection, or they can use the widget's default Reown integration.

## 4. Kernel/ZeroDev Smart Wallet Derivation

The most important account-abstraction feature is automatic Kernel smart wallet derivation from the Fluent embedded signer.

Under the hood:

1. Privy creates or loads the embedded wallet.
2. Fluent wraps the Privy wallet as a viem-compatible signer.
3. ZeroDev creates an ECDSA validator from that signer.
4. ZeroDev creates a Kernel smart account with that validator.
5. The builder app uses the Kernel address as the Fluent account.

The hook is:

```ts
import { useFluentZeroDevAccount } from "@fluent/react";

function AccountStatus() {
  const account = useFluentZeroDevAccount();

  if (!account.smartAccountReady) {
    return <span>Preparing Fluent smart wallet</span>;
  }

  return <span>{account.smartAccountAddress}</span>;
}
```

The hook returns:

```ts
{
  smartAccountEnabled: boolean;
  smartAccountReady: boolean;
  smartAccountAddress?: Address;
  signerAddress?: Address;
  privyReady: boolean;
  privyAuthenticated: boolean;
  embeddedWalletCount: number;
  kernel: FluentZeroDevKernel | null;
  error: Error | null;
  ensureExecutionReady: () => Promise<FluentZeroDevKernel>;
  sendTransaction: (request) => Promise<Hash>;
  sendCalls: (calls) => Promise<Hash>;
  refresh: () => Promise<FluentZeroDevKernel | null>;
}
```

The builder-facing rule is strict:

```txt
Display and use the Kernel smart wallet.
Treat the embedded Privy wallet as an internal signer.
```

That rule affects balances, explorer links, bridge/on-ramp deposit addresses, approvals, vault shares, game accounts, and permission sessions. If the Kernel account is not ready, the app should show a preparing state. It should not silently fall back to the embedded signer as the user-facing account.

## 5. Fluent Account Menu: Faucet, Bridge, On-Ramp, Explorer, Balances, Reputation

The widget account menu is meant to be a smart navigation surface for early Fluent users. It helps answer the user's immediate question:

> What should I do next to use this app on Fluent?

The current menu includes:

### Faucet

The faucet action claims testnet BLEND using the Fluent Connect identity token:

```ts
await fetch("https://eco-faucet-api.fluent.xyz/fluent-connect/pre-fund", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${privyIdentityToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    visitorId: anonymousId,
    fluentSessionToken: session.idToken,
  }),
});
```

This gives new users a path to receive BLEND for testnet activity. For production, the same action can become an app-aware faucet wrapper with analytics, attribution, per-app limits, abuse protection, and campaign metadata.

### Bridge

The bridge action uses the Fluent portal URL configured centrally in the SDK:

```ts
export const FLUENT_CONNECT_DEFAULT_PORTAL_BRIDGE_URL = "https://portal.fluent.xyz/bridge";
```

In product terms, this is the "bring assets to Fluent" path. Later, this can be upgraded to route discovery, bridge quote, execution, and status tracking inside the widget.

### USDnr On-Ramp

The widget can open Swapper Finance for USDnr onboarding:

```ts
openSwapperModal({
  integratorId,
  dstChainId,
  dstTokenAddr,
  depositWalletAddress: smartAccountAddress,
  styles: {
    themeMode: "dark",
    componentStyles: {
      primaryColor: "#FF8FDA",
      accentColor: "#FECCEF",
      sphereColor: "#FF8FDA",
    },
  },
});
```

The important detail is `depositWalletAddress`: it should be the Kernel smart wallet. This makes the on-ramped asset arrive where the app will actually execute transactions.

### Explorer

The explorer action opens the Kernel smart wallet in FluentScan:

```ts
window.open(explorerAddress(smartAccountAddress), "_blank");
```

This is useful for support, transparency, and demos. Users can inspect their smart account, transactions, balances, and UserOps.

### Balances

The widget can show token balances for the user's Fluent smart wallet. Defaults currently include:

- ETH
- USDnr
- BLEND
- USDC
- USDT

Example:

```ts
import {
  fluentTestnet,
  fluentTestnetTokenDefaults,
  readFluentTokenBalances,
} from "@fluent/wallet-sdk";
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
```

The balance helper returns status per token, so apps can handle missing token addresses or RPC errors without breaking the whole widget:

```ts
type FluentTokenBalance = {
  symbol: string;
  raw: bigint | null;
  formatted: string | null;
  status: "ready" | "not-configured" | "error";
  error?: string;
};
```



### Reputation/Families

The widget also supports the Fluent families/reputation endpoint. The current families model includes identity, tester, builder, influential, and predictor categories with tiers `A` through `D`.

Example:

```ts
import { createFluentFamiliesClient } from "@fluent/connect-sdk";

const families = createFluentFamiliesClient({
  baseUrl: "https://api.fluent-connect.dev.gblend.xyz/api/v1",
});

const result = await families.getFamilies(session.user.id);
```

In the widget, the reputation card can help apps show lightweight trust or segmentation signals. For example:

- a game may highlight early testers
- a DeFi app may treat builder/tester tiers as product analytics dimensions
- a campaign may target users by identity or influence tier

The SDK should not use these as hard security boundaries unless the backend validates the same facts.

## 6. Batch Operations

Batch operations are one of the most important smart-wallet features. They let the builder combine multiple calls from the same smart account into one ZeroDev UserOperation.

Good examples:

- `approve + submitMove`
- `approve + deposit`
- `swap + deposit`
- `claim faucet + approve`, if both actions are implemented as compatible smart-account calls

Bad examples:

- batching two different users' actions
- batching both chess players' moves when turns alternate between different accounts
- batching calls that require different signers

Current API:

```ts
const op = widget.createBatchOp({
  id: "approve-and-move",
  button: {
    label: "Batch approve + move",
    pendingLabel: "Submitting batch",
    successLabel: "Batch submitted",
  },
  calls: [
    {
      id: "approve-blend",
      label: "Approve BLEND",
      to: BLEND_TOKEN_ADDRESS,
      abi: erc20Abi,
      method: "approve",
      args: [CHESS_CONTRACT_ADDRESS, parseUnits("20", 18)],
    },
    {
      id: "submit-move",
      label: "Submit chess move",
      to: CHESS_CONTRACT_ADDRESS,
      abi: chessAbi,
      method: "submitMove",
      args: [gameId, moveUci, fenAfterMove],
    },
  ],
});

const txHash = await op.execute();
```

The SDK supports two call shapes:

```ts
// ABI + method
{
  to: tokenAddress,
  abi: erc20Abi,
  method: "approve",
  args: [spender, amount],
}

// Raw calldata
{
  to: contractAddress,
  data: "0x...",
}
```

Internally the SDK:

1. validates that the batch contains at least one call
2. encodes ABI calls into calldata
3. checks that a Fluent smart account executor exists
4. ensures the Kernel account is ready
5. opens a Fluent transaction review modal
6. submits calls via `kernel.client.sendUserOperation`
7. waits for the UserOp receipt
8. returns the transaction hash

This gives builders a high-level API while preserving user review:

```txt
User clicks app action
  -> builder creates batch
  -> Fluent reviews encoded calls
  -> Privy signer signs through ZeroDev validator
  -> Kernel UserOp executes
  -> app receives transaction hash
```

The desired next API includes explicit confirmation modes:

```ts
await widget.createBatchOp({...}).execute({
  confirmation: "always", // default
});

await widget.createBatchOp({...}).execute({
  confirmation: "session",
});
```

Current status:

- `confirmation: "always"` is the current behavior conceptually. The widget opens the Fluent transaction review before invoking the signer.
- `confirmation: "session"` is a design target. It should only be enabled after the user opts into a session-level rule. It is not the default and should not be used for arbitrary silent signing.

The product rule should be:

```txt
If the user did not grant a bounded permission/session, show a review before signing.
```



## 7. Permission Sessions

Permission sessions are the answer to the product goal:

> One approval from the user, then the app or bot can act on behalf of the user within strict limits.

This is different from normal batching. A batch is still user-triggered. A permission session creates a delegated session account that can act later, but only according to policy.

Current React-level API:

```ts
const permission = await widget.createPermissionSession({
  label: "Chess bot session",
  expiresAt: Date.now() + 60 * 60 * 1000,
  policies: [
    widget.policies.call({
      id: "submit-move",
      to: CHESS_CONTRACT_ADDRESS,
      abi: chessAbi,
      method: "submitMove",
      args: {
        gameId: { equals: activeGameId },
      },
    }),
  ],
});
```

The policy builder supports:

```ts
widget.policies.call({
  to,
  abi,
  method,
  args,
  valueLimit,
});

widget.policies.batch({
  id,
  calls: [
    {
      to,
      abi,
      method,
      args,
      valueLimit,
    },
  ],
});
```

Argument constraints support:

```ts
{ equals: value }
{ max: value }
{ min: value }
```

For example, a vault app can allow only a bounded deposit:

```ts
const permission = await widget.createPermissionSession({
  label: "Manage stBlend deposit",
  delegate: agentAddress,
  expiresAt: Date.now() + 60 * 60 * 1000,
  policies: [
    widget.policies.batch({
      id: "approve-deposit",
      calls: [
        {
          to: BLEND_TOKEN_ADDRESS,
          abi: erc20Abi,
          method: "approve",
          args: {
            spender: { equals: vaultAddress },
            amount: { max: parseUnits("100", 18) },
          },
        },
        {
          to: vaultAddress,
          abi: vaultAbi,
          method: "deposit",
          args: {
            assets: { max: parseUnits("100", 18) },
            receiver: { equals: widget.account.address },
          },
        },
      ],
    }),
  ],
});
```

The lower-level helper is:

```ts
import {
  CallType,
  createFluentZeroDevPermissionSession,
} from "@fluent/react";
import { generatePrivateKey } from "viem/accounts";

const session = await createFluentZeroDevPermissionSession({
  kernel,
  sessionPrivateKey: generatePrivateKey(),
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  calls: [
    {
      target: gameContract,
      selector: "0x...",
      callType: CallType.CALL,
    },
  ],
});
```

This creates a ZeroDev permission account with:

- target contract restrictions
- function selector or ABI method restrictions
- optional argument constraints
- optional value limits
- optional expiry via timestamp policy
- serialized permission account for delegated execution
- session signer address
- smart account address

The intended high-level API can be made more product-readable:

```ts
await widget.createPermissionSession({
  label: "Game bot",
  expiresAt: Date.now() + 60 * 60 * 1000,
  policies: [
    {
      calls: [
        {
          to: gameContract,
          function: "executeMove(uint256)",
        },
      ],
      spend: [
        {
          token: BLEND_TOKEN_ADDRESS,
          limit: "20",
          period: "session",
        },
      ],
    },
  ],
});
```

Product statement:

```txt
Allow this app to do exactly these things for exactly this time.
```

For the chess demo, this means the user can approve a bot to submit moves on behalf of the user's Fluent smart account, bounded by the contract/method and by the BLEND allowance used for move payment.

## 8. Permission Center And Revoke UX

The widget already has a `renderPermissions` slot:

```tsx
<FluentWidget
  renderPermissions={({ session, compact }) => (
    <PermissionPanel session={session} compact={compact} />
  )}
/>
```

This allows an app to place a permissions view inside the Fluent account menu. The intended user-facing shape is:

- active permissions
- app name
- allowed calls
- spend limits
- expiry
- delegate/session signer
- revoke button
- last-used timestamp
- current status: pending, active, expired, revoked

The connect SDK also has a backend-style permission client:

```ts
import { createFluentPermissionClient } from "@fluent/connect-sdk";

const permissions = createFluentPermissionClient({
  baseUrl: "https://fluent-connect.api.fluent.xyz/api/v1",
  clientId: "my_app",
  getSessionToken: () => session.idToken!,
});

const preview = await permissions.preview({
  appId: "game_xyz",
  expiry: Math.floor(Date.now() / 1000) + 3600,
  permissions: {
    calls: [
      {
        chainId: 20994,
        to: gameContract,
        function: "executeMove(uint256)",
      },
    ],
    spend: [
      {
        chainId: 20994,
        token: BLEND_TOKEN_ADDRESS,
        symbol: "BLEND",
        limit: "20",
        period: "session",
      },
    ],
  },
});

const grant = await permissions.grant(preview.request);
const grants = await permissions.list();
await permissions.revoke(grant.id);
```

This client is useful for future Fluent-managed permission registry APIs. The current frontend demo primarily uses ZeroDev permission sessions directly. A production permission center should reconcile both:

- on-chain/account-abstraction session capabilities
- app-facing metadata, display names, analytics, and revoke history



## 9. Builder Use Cases



### Game: Permissioned Bot Play

A game can ask the user for one approval:

```txt
Allow Medium Chess Bot to submit up to 20 BLEND-paid moves for game #7 during the next hour.
```

Then the bot can play without asking for a signature every move. The user can watch real transactions in the activity table and inspect the smart account in the explorer.

Benefits:

- user sees fast on-chain actions
- app demonstrates session permissions
- bot cannot call arbitrary contracts
- bot cannot move unlimited funds if spend/allowance is bounded



### DeFi Vault: Approve + Deposit

A vault app can simplify the first deposit:

```ts
await widget
  .createBatchOp({
    id: "approve-deposit",
    button: "Approve + deposit",
    calls: [
      {
        to: assetAddress,
        abi: erc20Abi,
        method: "approve",
        args: [vaultAddress, amount],
      },
      {
        to: vaultAddress,
        abi: vaultAbi,
        method: "deposit",
        args: [amount, widget.account.address],
      },
    ],
  })
  .execute();
```

The user sees one Fluent review and signs one smart-account operation instead of dealing with two separate wallet prompts.

### Onboarding Landing Page: Faucet + Bridge + On-Ramp

A campaign app can embed the widget and let users:

- log in with Fluent Connect
- claim BLEND faucet
- bridge assets
- on-ramp USDnr
- inspect balances
- copy/open their Kernel wallet

This turns the widget into a conversion tool for ecosystem growth rather than just an auth button.

### Agent/Rebalancer: Scoped Session

A cross-chain rebalancer or portfolio agent can request scoped permissions:

```ts
await widget.createPermissionSession({
  label: "Morpho rebalancer",
  expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  policies: [
    widget.policies.call({
      to: morphoVault,
      abi: morphoAbi,
      method: "deposit",
      args: {
        assets: { max: maxDailyDeposit },
        receiver: { equals: widget.account.address },
      },
    }),
    widget.policies.call({
      to: morphoVault,
      abi: morphoAbi,
      method: "withdraw",
      args: {
        assets: { max: maxDailyWithdraw },
        receiver: { equals: widget.account.address },
        owner: { equals: widget.account.address },
      },
    }),
  ],
});
```

This is the direction for "agent SDK" use cases: the app can perform useful actions while the user remains protected by policy.

## 10. What Builders Get

Builders get:

- hosted Fluent login without managing Fluent's primary Privy app directly
- optional registered `clientId` for production attribution and controls
- a React widget that can be dropped into an app
- WalletConnect/Reown options plus Fluent Connect ID in one modal
- automatic Kernel/ZeroDev smart wallet derivation
- user-facing Fluent smart account address
- BLEND faucet onboarding
- bridge entry point
- USDnr on-ramp entry point
- explorer link
- configurable token balances
- families/reputation signals
- batch smart-account operations
- permission session primitives
- permission UI slot
- chain/token registry helpers
- local demo apps to copy from



## 11. What Users Get

Users get:

- a familiar "connect wallet" button
- an easier "Fluent Connect ID" path if they do not have a wallet ready
- an embedded signer managed through Privy
- a Fluent smart wallet they can use across apps
- a clear account menu
- faucet for initial BLEND
- bridge and on-ramp paths when they lack assets
- visibility into balances and reputation
- transaction review before normal batched operations
- the ability to grant scoped sessions for automation
- explorer links for transparency

The intended experience is not "here are two confusing wallets." The intended experience is:

```txt
You are connected with Fluent.
Your app-facing account is your Kernel smart wallet.
Fluent handles the signer and session details under the hood.
```



## 12. Current Gaps And Next Product Steps

The SDK already has the foundation, but some features are still in demo/early-product shape:

1. Explicit confirmation mode API

```ts
await widget.createBatchOp(...).execute({
  confirmation: "always",
});

await widget.createBatchOp(...).execute({
  confirmation: "session",
});
```

Current behavior is effectively `always`; `session` should be added only with clear user opt-in.

1. First-class product permission policy API

The current `createPermissionSession({ policies })` API exists, but the product-facing version should better express calls, spend, expiry, period, and revoke metadata in one stable schema.

1. Permission center

The widget has a render slot, but a reusable default permission center should be part of the SDK.

1. Bridge execution

The widget currently opens a bridge URL. Route discovery, quote, execution, and status tracking are future work.

1. Analytics

The SDK should emit clean app-level analytics without leaking secrets:

- widget_loaded
- login_started
- login_completed
- smart_account_ready
- faucet_completed
- faucet_failed
- bridge_opened
- onramp_opened
- batch_review_opened
- batch_submitted
- permission_previewed
- permission_granted
- permission_revoked

1. Production app registry

Anonymous/basic mode is valuable for hackathons, but production apps still need app registration, allowed origins, scopes, limits, display metadata, campaign metadata, and abuse controls.

1. Bot/session persistence

The chess demo proves the model, but production bots need persisted session metadata, expiry handling, revoke handling, and robust operator monitoring.

## Summary

Fluent Connect SDK is more than a login button. It is a builder onboarding, smart wallet, transaction batching, and permissioned automation layer for Fluent ecosystem apps.

For simple apps, it provides:

```txt
Connect with Fluent -> smart wallet -> balances -> faucet/bridge/on-ramp
```

For DeFi apps, it provides:

```txt
Connect -> batch approve + deposit -> smart account execution
```

For games and agents, it provides:

```txt
Connect -> grant scoped permission -> app/bot acts within policy
```

The most important product rule remains:

```txt
Use the Kernel smart wallet as the user's Fluent account.
Keep the embedded Privy wallet hidden as signer infrastructure.
Ask for explicit review unless the user granted a bounded permission session.
```
