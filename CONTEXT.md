# Fluent Connect SDK

An embeddable widget and SDK that gives dapp builders a smart-account wallet experience on Fluent: login, account management, token balances and gas-sponsored execution.

## Language

### Identity

**Fluent ID**:
A user's smart account on Fluent. The primary identity a user is given and the address user-facing actions target.
_Avoid_: smart wallet, kernel account, AA account, Fluent wallet

**Signer**:
The externally-owned account that authorizes actions on behalf of a Fluent ID. An implementation detail never surfaced to the end user.
_Avoid_: embedded wallet, Privy wallet, owner, EOA

**External wallet**:
A third-party wallet a user connects themselves. Acts both as a Signer and as an independent holder of balances.
_Avoid_: injected wallet, browser wallet, connected wallet

**Widget account**:
The unified account the widget renders, resolved from a Fluent ID and an optionally connected External wallet.
_Avoid_: active account, current account

### Tokens

**Display token**:
A token the widget lists with its balance. An open set: any token from any Token source can become one.
_Avoid_: token, balance token, listed token

**Gas token**:
A Default token the paymaster can charge for fees. A closed subset of Display tokens that neither integrators nor users can extend.
_Avoid_: fee token, payment token, gas payment symbol

**Token source**:
Where a Display token came from. Exactly three exist, ordered by how much we trust them: Default, Integrator, User.
_Avoid_: token origin, token provider

**Default token**:
A Display token Fluent ships in the SDK. The most trusted Token source, and the only one whose members may be Gas tokens.
_Avoid_: curated token, builtin token, official token

**Integrator token**:
A Display token a builder adds for their own users. Extends the Default set, never replaces it.
_Avoid_: custom token, builder token, host token

**User token**:
A Display token an end user adds by contract address. Its metadata is read from the chain, never accepted as typed input, and it is always labelled as user-added.
_Avoid_: custom token, imported token, manual token

**Token identity**:
The pair of chain and contract address that uniquely names a token. A symbol is not an identity: two tokens may share one.
_Avoid_: token symbol, token key, token hash

### Auth

**App**:
The builder whose app embeds the widget, named by the AppId the widget is configured with. The unit every auth, sponsorship and analytics decision is made for.
_Avoid_: partner, client, tenant

**Hosted login**:
A login to a Fluent ID that happens on an origin Fluent owns, outside the App's page. Works on any origin with no registration.
_Avoid_: popup login, hosted auth, redirect flow

**Direct login**:
A login to a Fluent ID that happens inside the App's own page. Requires the App's origin to be allow-listed beforehand.
_Avoid_: in-app login, embedded login, direct auth, native login

**Sign-in challenge**:
A message the service mints for one origin and one address, which a user signs with an External wallet to prove control of it. Single-use.
_Avoid_: nonce, SIWE message, signature request

**Auth token**:
The short-lived credential the service issues to an App for a signed-in user. The App's backend verifies it once and issues its own session from it; it is not a session itself.
_Avoid_: JWT, access token, session token, Fluent token

**Client subject**:
The name an Auth token gives a user: one per user per App, stable across logins, and never the same across two Apps.
_Avoid_: user id, subject, pairwise id, account id

**Auth scope**:
A permission an App is granted that widens what its Auth tokens say about the user. Decided when the token is issued, so an issued token is never re-scoped.
_Avoid_: permission, claim, grant

## Relationships

- An **Auth token** names its user by a **Client subject** and its App by that App's AppId.
- Only **Direct login** can produce an **Auth token**. **Hosted login** leaves the Privy credentials on the Fluent origin, and the service needs them to issue one.
- An **External wallet** signs a **Sign-in challenge** to reach an **Auth token**; a **Fluent ID** does not, because its login already proves the same thing.
- Two sign-ins share one **Client subject** only where the service resolves them to the same person. An **External wallet** it has not seen before is a new person, and so a new **Client subject**; a wallet already bound to someone else is refused rather than merged.

## Flagged ambiguities

- "integrator", "builder" and "partner" were all used for **App**. Resolved: **App**, matching the AppId the SDK config carries since 0.3.0 (the 0.2.x name was Partner). The Tokens entries above still say "builder" and "integrator"; **Integrator token** keeps its name because it names a Token source, not a person.
- **Signer** is "never surfaced to the end user", but an **Auth token** may carry it. No conflict: the audience there is the App's backend, not the user.
