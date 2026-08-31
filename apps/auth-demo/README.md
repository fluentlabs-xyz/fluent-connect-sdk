# Auth demo

Proves two things about `getAuthToken()` from `@fluent.xyz/connect`, and nothing else:

1. **A partner does not need Fluent to verify the token.** After the widget hands over the JWT,
   this page does what a partner backend would do: fetch the JWKS from the **pinned** issuer,
   verify the ES256 signature, check `iss`, `aud` (its own `clientId`) and `exp`, then read
   `sub`. `src/verify.ts` is that code — `jose`, the issuer, the client id, no Fluent imports.
2. **Scopes are enforced by the service, not the client.** With the partner's
   *Share wallet addresses* scope on, the token carries `addresses`; with it off, the claim is
   absent. The page says which.

3. **What a partner does next.** `server/partnerBackend.ts` is a dev-server route set —
   the smallest partner backend that is still one. `POST /api/login` takes the Fluent token as
   a bearer **once**, verifies it against the JWKS, upserts a user row keyed on `sub`, and
   answers with its own `HttpOnly` cookie. `GET /api/me` then serves `sub`, address and a login
   counter off that cookie alone; the Fluent token is never sent again. In-memory, dev only —
   `vite build` ships without it.

Both branches of the widget are covered: a Fluent ID (Privy embedded wallet → smart account) and
an external wallet (MetaMask, Rabby, OKX, Coinbase, WalletConnect) that signs an EIP-712 challenge.

## Running it

```bash
pnpm --filter app-auth-demo dev
```

| Env | Default | Notes |
|---|---|---|
| `VITE_PORT` | `5173` | The only localhost origin registered for this Privy client **and** for the Auth demo partner on the auth service. On any other port direct auth fails with `invalid_origin`, silently — the login button no-ops. `apps/chess`, `apps/erc4626-vault` and `apps/sponsorship-bench` share the port; run one at a time. |

The service side is dev (`https://api.fluent-connect.dev.gblend.xyz`), partner *Auth demo*,
`clientId` in `src/consts.ts`. Nothing to run locally.

## The partner session

1. Get a token, click **Sign in to partner backend** — the response shows `sub`, address,
   `logins: 1`, and the browser now holds the partner cookie.
2. **GET /api/me** — same row, no token in the request (check the Network tab).
3. Get a fresh token (wait for the cache margin or disconnect/reconnect), sign in again —
   `logins: 2` on the **same** `sub`: the pairwise id is what a partner keys on.
4. Sign in with the other branch (Privy vs external wallet) — a different `sub`, a different row.

## The scope proof

1. Sign in, click **Get Fluent token** — `addresses` shows `{ account, signer? }`.
2. In the partner console, switch *Share wallet addresses* off for Auth demo.
3. Disconnect, sign in again, click **Get Fluent token** — `addresses` reads *absent*.

Re-login matters: the widget reuses a token until `authTokenRenewalOffsetSeconds` (default 30) before `exp`, and a token already issued is not re-scoped.
Clicking twice inside that window shows the same token tagged **cached** — the second call cost
no request and, for an external wallet, no signature prompt.

## What the errors mean

- `hosted_not_supported` — `authMode` is `hosted`; the bridge hands over only the identity
  token and the service needs both Privy tokens. Direct auth only in v1.
- `client_not_auth_enabled`, `origin_not_allowed` — partner configuration on the service, not
  this page: auth switched off, or this origin not registered.
- `address_already_linked` — this wallet address is already bound to another Fluent identity for
  this app; sign in with the method that registered it.
- MetaMask refusing to sign — the challenge is bound to Fluent testnet (chain 20994); switch the
  wallet to that chain first.

An external wallet that is a **not-yet-deployed** smart-contract account cannot sign in: the
service verifies contract wallets via ERC-1271 and has no ERC-6492 path. EOAs and deployed
contract wallets are fine.
