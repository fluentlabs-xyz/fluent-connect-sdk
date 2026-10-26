# Fluent Connect SDK

An embeddable widget and SDK that gives dapp builders a smart-account wallet experience on Fluent: login, account management, token balances and gas-sponsored execution.

## Language

### Identity

**Fluent ID**:
A person's account on Fluent, created at Direct login: the primary identity the person is given and the address user-facing actions target.
_Avoid_: smart wallet, kernel account, AA account, Fluent wallet

**Signer**:
The key that authorizes actions for a Fluent ID. Not shown in the widget's everyday screens; a person may export it, and an App's backend may see its address.
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

**User settings**:
What one person has chosen about how the widget behaves for them — Quick sign, their Gas token, and their User tokens. Held per person on the service, reached with an Auth token, and kept in browser storage only where no Auth token can exist.
_Avoid_: preferences, widget config, profile, user config

### Auth

**App**:
The builder whose app embeds the widget, named by the AppId the widget is configured with. The unit every auth, sponsorship and analytics decision is made for.
_Avoid_: partner, client, tenant

**Direct login**:
The one way to log in to a Fluent ID: it happens inside the App's own page. Requires the App's origin to be allow-listed beforehand. Since 0.5.0 there is no other login to contrast it with (FLU-1566).
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

### Signing

**Prompt mode**:
How a Signer signs when the person confirms each signature: the widget shows its own Review and signs once it is confirmed, with no second screen from the Signer's provider.
_Avoid_: interactive signing, confirmation mode, UI signing

**Silent mode**:
How a Signer signs with no Review: the widget asks the Signer's provider to sign directly. What Quick sign asks for.
_Avoid_: headless signing, background signing, auto signing

**Quick sign**:
A person's choice, kept in their User settings, to have operations signed in Silent mode. The App may narrow it to a list of call targets; it never applies to an External wallet.
_Avoid_: auto-confirm, one-click signing, session signing, silent signing

### Widget

**Batch operation**:
An ordered list of contract calls the widget executes for the Widget account as one unit: atomically in one transaction for a Fluent ID, one transaction per call for an External wallet. The one way an App sends anything.
_Avoid_: transaction, tx, bundle, UserOp, send

**Review**:
The widget's own screen that shows what a Batch operation or a signature will do and waits for the person to confirm or dismiss it. Shown in Prompt mode, skipped in Silent mode.
_Avoid_: confirmation, confirmation popup, approval screen, signature request

**Widget API**:
What the widget gives an App's code to act for the Widget account: its state, Batch operations, signatures and the current Gas payment. Reached as `widget` in the render context or from `useFluentWidget()`.
_Avoid_: batch API, wallet API, SDK

**Widget session**:
What the widget tells an App about who is signed in: the Widget account's address and type, and when the widget built that snapshot. Not a credential: an App proves who the person is with an Auth token.
_Avoid_: session (bare), Fluent session, login session, identity

**Service session**:
The sign-in the service holds for one person in one browser, lasting up to thirty days and renewed by a refresh credential the widget stores; every Auth token is minted from it. Never exposed to the App.
_Avoid_: refresh family, Fluent session, Privy session

**Network**:
Which of Fluent's two deployments, testnet or mainnet, the widget runs on: one chain, its tokens and its service. Chosen once per deployment of the App.
_Avoid_: environment, env, stage, cluster

**Iframe bridge**:
The connection through which a page the App embeds in an iframe uses the Widget account as its wallet: the page's wallet requests are answered by the widget, with the same Review the App's own requests get.
_Avoid_: iframe provider, marketplace bridge, embedded wallet, postMessage provider

**Account avatar**:
The image that stands for the Widget account on the connect button and in the account drawer: the person's linked X picture when they have one, else the App's default logo, else the Fluent mark.
_Avoid_: user logo, profile picture, PFP, account tile

**Linked X account**:
The X account the service has bound to a person: at most one per person, used for their Account avatar and reputation. Linking it is the only identity change an App can start.
_Avoid_: Twitter account, social account, Privy linked account

**Auth method**:
A way a person proves who they are to reach a Fluent ID: X, Google, email or passkey. X is always offered; the App chooses which of the others are.
_Avoid_: login method, sign-in method, login provider, OAuth provider

**Sponsorship**:
The App paying the gas of a Fluent ID's operation through Fluent's sponsorship service, asked for per operation. When it is refused the account pays its own gas instead, which is the fallback; an External wallet is never sponsored.
_Avoid_: gasless, free gas, gas sponsorship policy, paymaster (for the payer)

**Gas payment**:
How one operation's gas is paid: in native ETH or in a Gas token, and whether Sponsorship is asked for.
_Avoid_: fee payment, gas mode, payment token

**Connect**:
To give the widget a Widget account: log in to a Fluent ID by Direct login, or connect an External wallet. Its opposite is disconnect, which ends the Widget session and the Service session.
_Avoid_: sign in (for the whole act), log on, authenticate

## Relationships

- An **Auth token** names its user by a **Client subject** and its App by that App's AppId.
- **Direct login** is what produces an **Auth token** for a **Fluent ID**: it leaves the login's credentials in the App's page, which is where the widget exchanges them for one.
- An **External wallet** signs a **Sign-in challenge** to reach an **Auth token**; a **Fluent ID** does not, because its login already proves the same thing.
- **User settings** are keyed by the person an **Auth token** names, not by the **App**: the same person sees one set of them in every App they sign in to.
- **Quick sign** in a person's **User settings** decides whether an operation is signed in **Silent mode** or in **Prompt mode**; both sign for the same **Fluent ID**, and the **Signer** is the same one either way.
- Two sign-ins share one **Client subject** only where the service resolves them to the same person. An **External wallet** it has not seen before is a new person, and so a new **Client subject**; a wallet already bound to someone else is refused rather than merged.

## Flagged ambiguities

- "integrator", "builder" and "partner" were all used for **App**. Resolved: **App**, matching the AppId the SDK config carries since 0.3.0 (the 0.2.x name was Partner). The Tokens entries above still say "builder" and "integrator"; **Integrator token** keeps its name because it names a Token source, not a person.
