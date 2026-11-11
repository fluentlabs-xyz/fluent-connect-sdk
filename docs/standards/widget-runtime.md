# Widget runtime

Rules for state, lifecycle and asynchronous work in `packages/connect/src/widget` and
`packages/connect/src/core`. A removed rule keeps its ID unused, so an ID always names the same
rule.

Every rule carries its source in brackets: `[measured: <path>]` for what the code already does,
`[ADR n]` for a decision recorded in `docs/adr/`, `[seen: review]` for a defect a review found,
and `[decided <date>]` for the design session that wrote the rule.

### R1 An async result is applied only while its Widget account is still the one rendered

Capture the Widget account before the await, together with the Network or the Auth token where
the result depends on them, compare after, and drop or undo the result when any of them has
changed. A widget outlives the Widget account it was rendering: a user logs out, connects an
External wallet, switches network, and a request started for the old one still resolves
[seen: review].

### R2 State held per Widget account is cleared when the Widget account changes

Caches, sets of pending requests, resolved balances, stored markers: everything keyed to one
Widget account, or to one Auth token, is dropped at the change, so the next one starts empty
rather than inheriting [seen: review].

### R3 Teardown steps run in their documented order, and a test asserts the order

Where teardown has steps a caller can observe (revoke the Auth token before `disconnect()`
resolves, clear storage before the listener goes), write the order down beside the code and pin
it with a test that asserts the sequence, not just the end state [seen: review].

### R4 Diagnostics never fail the operation they observe

An operation completes with its own result when the logging, timing or analytics watching it
throws: whatever observes an operation is wrapped so its failure cannot reach the caller
[seen: review].

### R5 Browser storage answers rather than throws

A read or a write that a browser refuses (site data blocked, no quota, no storage at all) returns
the "nothing stored" answer instead of raising into the flow. Losing persistence costs one
re-authentication; it must not cost the caller a result it already holds
[measured: `packages/connect/src/core/browserStorage.ts`].

### R6 Console output in a package goes through `debugLogger`

Builders see their own console, so the widget's diagnostics stay behind the `debugLogging` prop
on `<FluentWidget>` rather than printing unconditionally
[measured: `packages/connect/src/core/debugLogger.ts`; the `authMode` removal warning in
`packages/connect/src/core/config.ts` is the one deliberate exception].
