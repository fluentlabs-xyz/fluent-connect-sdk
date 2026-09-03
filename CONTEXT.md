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
