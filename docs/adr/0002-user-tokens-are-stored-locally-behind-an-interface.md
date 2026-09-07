# User tokens are stored locally, behind a replaceable interface

Users can add tokens by contract address, and that list has to persist somewhere. We store it in browser storage, but only ever through a `UserTokenStore` interface (list / add / remove), so that moving to server-side storage later replaces one implementation and touches no UI.

## Considered options

**Browser storage on the integrator's origin** — what we chose. The widget mounts as a React component in the host document, not an iframe, so its storage belongs to whichever site embeds it. Zero infrastructure. The cost: a user's tokens do not follow them between two different dapps, browsers, or devices.

**A hidden iframe on a Fluent origin to share storage across integrators** — rejected as non-functional, not merely complex. Safari's ITP and Firefox's Total Cookie Protection partition third-party storage by top-level site, and Chrome is moving the same way, so each embedding site would get its own partition anyway. This is the trick a future reader is most likely to reach for; it does not work.

**Server-side, scoped to a Fluent ID** — deferred, and the reason we insist on the interface. A public API and an authenticated user session already exist, so this is a couple of endpoints rather than a new service. Once the widget ships across several ecosystem products, a list that does not travel between them will start reading as a bug, and this becomes the right answer.

**On-chain, in the user's smart account** — rejected. Gas on every add, plus a reader, to persist a token list.

## Consequences

The store is keyed by chain only, not by chain and account. One human holds both a Fluent ID and possibly an External wallet and switches between them on one screen; keying by account would make their list appear to vanish when they disconnect a wallet. A consequence worth knowing: a token added on testnet is correctly invisible on mainnet.

Trust ordering on duplicate Token identities is Default > Integrator > User. When a token a user added by hand later ships as one of ours, our metadata and icon win and the user-added label disappears. The user's stored record is shadowed at read time rather than deleted, so if we ever drop that token from the Default set, their entry resurfaces instead of having been destroyed by our release.

Users may remove their own tokens but cannot hide Default or Integrator ones. Hiding would need a second persisted set with its own dedup and migration rules, for a screen that lists a handful of tokens.
