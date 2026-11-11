# Testing

Rules for tests, fakes and fixtures in this repository. A removed rule keeps its ID unused, so an
ID always names the same rule.

Every rule carries its source in brackets: `[measured: <path>]` for what the code already does,
`[ADR n]` for a decision recorded in `docs/adr/`, `[seen: review]` for a defect a review found,
and `[decided <date>]` for the design session that wrote the rule.

### T1 A test for a criterion drives the path the criterion names

Enter through the public entry where there is one (render `FluentWidget`, call the exported
function), take the steps the criterion describes, and assert what a user or a builder observes:
rendered text, a returned value, the request that left the browser. A test that asserts its own
fake's state, or that reaches the behaviour by calling an internal helper the criterion never
mentions, does not cover the criterion [seen: review].

### T2 A bug fix starts with a test that fails on the base commit

Write it first and watch it fail, so the test is known to cover the defect and not its
neighbourhood [decided 2026-10-15].

### T3 A fake reproduces the real library's contract and call order

For every behaviour the test depends on, a fake answers the way the real library answers and in
the order the real library uses: AppKit's hydration before its connection sync, Privy's session
before an account is readable, a bundler's receipt only after its user-operation hash. State the
library and version the fake mirrors in its header. A fake that skips a step the real library
takes makes the test pass over code that cannot work [seen: review].

### T4 Fakes sit at external boundaries only

Fake the network, Privy, the ZeroDev bundler and paymaster, AppKit and browser storage; the
module under test and the rest of this repository run for real. A test file whose header lists
its fakes keeps that list exact (see `docs-and-comments.md` D3) [seen: review].

### T5 Test files are named for what they cover

`<module>.test.ts` or `.test.tsx` beside the module; one scenario of a component in
`<Component>.<scenario>.test.tsx`; a live test that needs a network in `<module>.fork.test.ts`,
skipped behind an environment variable. New tests are TypeScript, and a `.test.mjs` file is
converted when it is next changed [measured:
`packages/connect/src/widget/FluentWidget.quickSign.test.tsx`,
`packages/connect/src/widget/kernelSignature.fork.test.ts`].

### T6 Time is controlled, never slept through

Advance fake timers or await the event the code emits. A test that waits for wall-clock time is
both slow and flaky [decided 2026-10-15].

### T7 A test name is the behaviour, in the present tense

A test name is a verb phrase in the present tense, without "should", stating the behaviour and
the condition it depends on; a `describe` names the unit or the condition its tests share. The
name is what a reader sees when it fails. A name compares with no earlier version and carries no
criterion number (`docs-and-comments.md` D8, D9).
Bad: `it("resolves both ids")`, which names neither the ids nor the config they come from.
Good: `it("stays in step with the gas tokens on every network")` [measured: the test names
in `packages/connect/src`; decided 2026-11-11].
