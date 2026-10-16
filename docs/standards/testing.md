# Testing

Rules for tests, fakes and fixtures in this repository. A removed rule keeps its ID unused, so an
ID always names the same rule.

Every rule carries its source in brackets: `[measured: <path>]` for what the code already does,
`[ADR n]` for a decision recorded in `docs/adr/`, `[seen: FLU-N]` for a defect a review found,
and `[decided 2026-10-15]` for the design session that wrote this file.

### T1 A test for a criterion drives the path the criterion names

Enter through the public entry where there is one (render `FluentWidget`, call the exported
function), take the steps the criterion describes, and assert what a user or a builder observes:
rendered text, a returned value, the request that left the browser. A test that asserts its own
fake's state, or that reaches the behaviour by calling an internal helper the criterion never
mentions, does not cover the criterion [seen: FLU-1522, FLU-1552, FLU-1524].

### T2 A bug fix starts with a test that fails on the base commit

Write it first and watch it fail, so the test is known to cover the defect and not its
neighbourhood [decided 2026-10-15].

### T3 A fake reproduces the real library's contract and call order

For every behaviour the test depends on, a fake answers the way the real library answers and in
the order the real library uses: AppKit's hydration before its connection sync, Privy's session
before an account is readable, a bundler's receipt only after its user-operation hash. State the
library and version the fake mirrors in its header. A fake that skips a step the real library
takes makes the test pass over code that cannot work [seen: FLU-1555, FLU-1482].

### T4 Fakes sit at external boundaries only

Fake the network, Privy, the ZeroDev bundler and paymaster, AppKit and browser storage; the
module under test and the rest of this repository run for real. A test file whose header lists
its fakes keeps that list exact (see `docs-and-comments.md` D3) [seen: FLU-1485, FLU-1505].

### T5 Test files are named for what they cover

`<module>.test.ts` or `.test.tsx` beside the module; one scenario of a component in
`<Component>.<scenario>.test.tsx`; a live test that needs a network in `<module>.fork.test.ts`,
skipped behind an environment variable. New tests are TypeScript, and a `.test.mjs` file is
converted when it is next changed [measured: 56 `.test.ts`, 14 `.test.tsx` and 5 `.test.mjs`
files, e.g. `packages/connect/src/widget/FluentWidget.quickSign.test.tsx`,
`packages/connect/src/widget/kernelSignature.fork.test.ts`].

### T6 Time is controlled, never slept through

Advance fake timers or await the event the code emits. A test that waits for wall-clock time is
both slow and flaky. Existing widget tests still sleep, so this is a rule for the tests a diff
adds or changes, not a sweep of the files around them [decided 2026-10-15; measured:
`vi.useFakeTimers` in 3 test files, against wall-clock `settle` helpers of 300 to 1500 ms in
`packages/connect/src/widget`, e.g. `FluentWidget.quickSign.test.tsx:210`].

### T7 A test's name is a sentence about behaviour

`it("keeps the trigger usable after a sign-in")`, not `it("works")`. The name is what a reader
sees when it fails [measured: `packages/connect/src/core/authToken.test.ts`].
