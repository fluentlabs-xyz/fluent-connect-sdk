# Widget runtime

Rules for state, lifecycle and asynchronous work in `packages/connect/src/widget` and
`packages/connect/src/core`. A removed rule keeps its ID unused, so an ID always names the same
rule.

Every rule carries its source in brackets: `[measured: <path>]` for what the code already does,
`[ADR n]` for a decision recorded in `docs/adr/`, `[seen: FLU-N]` for a defect a review found,
and `[decided 2026-10-15]` for the design session that wrote this file.

"Subject" below means the thing an operation is about: a Fluent ID, a Signer, an External wallet,
a Widget account, one issued Auth token. It is not the **Client subject** of `GLOSSARY.md`, which
is the name an Auth token gives a user.

### R1 An async result is applied only while its subject is still the current one

Capture the subject before the await, compare it after, and drop or undo the result when the
current subject has changed. A widget outlives the account it was rendering for: a user logs out,
connects an External wallet, switches network, and a request started for the old subject still
resolves [seen: FLU-1482, FLU-1552].

### R2 State held per subject is cleared when the subject changes

Caches, sets of pending requests, resolved balances, stored markers: everything keyed to one
subject is dropped at the change, so the next subject starts empty rather than inheriting
[seen: FLU-1485, FLU-1555].

### R3 Teardown steps run in their documented order, and a test asserts the order

Where teardown has steps a caller can observe (revoke the Auth token before `disconnect()`
resolves, clear storage before the listener goes), write the order down beside the code and pin
it with a test that asserts the sequence, not just the end state [seen: FLU-1555, FLU-1552].

### R4 Diagnostics never fail the operation they observe

An operation completes with its own result when the logging, timing or analytics watching it
throws. Logging goes through `packages/connect/src/core/debugLogger.ts`; anything else that
observes an operation is wrapped so its failure cannot reach the caller
[seen: FLU-1522, FLU-1485].

### R5 Browser storage answers rather than throws

A read or a write that a browser refuses (site data blocked, no quota, no storage at all) returns
the "nothing stored" answer instead of raising into the flow. Losing persistence costs one
re-authentication; it must not cost the caller a result it already holds
[measured: `packages/connect/src/core/browserStorage.ts`].

### R6 Console output in a package goes through `debugLogger`

Builders see their own console, so the widget's diagnostics stay behind the `debugLogging` prop
on `<FluentWidget>` rather than printing unconditionally
[measured: `packages/connect/src/core/debugLogger.ts` holds every `console.*` call in
`packages/*/src` except one warning in `packages/connect/src/core/config.ts:506`].
