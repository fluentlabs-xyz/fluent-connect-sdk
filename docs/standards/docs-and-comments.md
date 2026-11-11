# Docs and comments

Rules for what this repository writes about itself: `README.md`, the guides in
`packages/connect/docs/`, TSDoc, comments, and the style of the source they sit in. A removed
rule keeps its ID unused, so an ID always names the same rule.

Every rule carries its source in brackets: `[measured: <path>]` for what the code already does,
`[ADR n]` for a decision recorded in `docs/adr/`, `[seen: review]` for a defect a review found,
and `[decided <date>]` for the design session that wrote the rule.

`AGENTS.md` triggers this file on every added or changed JavaScript or TypeScript source line, so
D5 and the comment rules D9 to D13 apply to every source diff, whether or not the diff touches a
document.

### D1 A change a builder can observe updates the guides in the same pull request

A new or renamed prop, a changed default, a new error a builder can catch, a step that is no
longer needed: the guides in `packages/connect/docs/` are where a builder reads it, and
`README.md` too where it is shown there. A pull request that changes observable behaviour and
leaves the guides alone ships guides that lie [seen: review]. The reference
`packages/connect/docs/api.md` is generated from the TSDoc, so a changed export updates its
TSDoc and reruns `pnpm --filter @fluent.xyz/connect docs:api` [decided 2026-10-26].

### D2 Docs, TSDoc and comments state only what the code guarantees

Write the guarantee together with the conditions it holds under: which account kind (Fluent ID,
External wallet), which network, which auth state. Absolute words ("never", "always", "silently",
"only") appear only where the code enforces them on every path. A sentence promising more than
the code does is a defect, and it is the defect reviews here find most often
[seen: review].

### D3 A comment says why, and a comment that counts changes with what it counts

Prefer the reason, the hazard or the caller over a restatement of the signature. A comment that
counts or enumerates ("three things are mocked, and no more", "the two callers", "both branches")
is a statement about the code beside it: it is updated or removed in the same change as that
code, and a count that no longer matches is a defect even when the code is right
[seen: review].

### D4 Every public export carries TSDoc

In the form D10 and D11 give, with an `@example` for a hook or a function a builder calls. The
exported name is the one piece of this repository a builder cannot read the source of
[decided 2026-10-15].

### D5 Style: double quotes, semicolons, lines up to 100 columns

Strings use double quotes, each statement ends with a semicolon, and a line is at most 100
columns. This is the repository's existing style, and until a formatter is configured it is a
review rule: it applies to the lines a diff adds or changes, not to the file around them
[measured: zero single-quoted import specifiers in `packages/*/src`; a small share of non-test
source lines exceed 100 columns; decided 2026-10-15].

### D6 `GLOSSARY.md` terms name their concepts

In identifiers, comments, documents and UI copy alike. A word from a definition's _Avoid_ list is
a defect; a concept `GLOSSARY.md` lacks is either invented language or a gap in the glossary, and
the term is written before the code [decided 2026-10-15].

### D7 A change that contradicts an ADR stops and asks

`docs/adr/` records decisions, and an ADR wins over any rule in this directory. Work that needs a
recorded decision reversed raises it instead of writing around it; the answer lands as a new ADR
[decided 2026-10-15].

### D8 A file names no tracker id and no Issue criterion number

The repository and the npm package are public and the tracker is not, so a reader without tracker
access cannot resolve a tracker id or an Issue criterion number, and a comment, TSDoc block, test
name or document that carries one in place of its reason tells that reader nothing. A file of the
repository names no tracker id and no Issue criterion number, and writes the behaviour, condition
or defect instead: "a send reads its fees off the chain and falls back to the bundler's quote"
rather than the id of the change that made it, and a test named for what it checks rather than
for the criterion it came from. Commit messages and pull request bodies are not files of the
repository and keep their ids.
`packages/connect/test/trackerIds.test.ts` fails on any tracked line that breaks this rule
[decided 2026-11-11].

### D9 A comment describes the code as it is now, and why

A comment, TSDoc block or test name describes the code as it is now and says why: a constraint, a
hazard, a non-obvious decision or an external contract. What the code did before, what a change
added or removed, and which review or incident found it is change history, and it belongs to the
commit message and the pull request, where it stays attached to the change. A comment that only
restates the code or its history is deleted, not reworded: "`showDebugPayload` has been dropped
from the props" tells a reader what changed, not what the code does today [decided 2026-11-11].

Bad: a block on `sendUserOperationWithTiming` that quotes the early return a commit deleted,
with that commit's hash and line. Good: "Submits one user operation and measures it, whatever
`debugLogging` is set to; the flag decides only whether the measurement is also printed."

### D10 A doc block opens with one sentence that says what the code does or is

The first sentence stands alone in hover text and in `docs/api.md`: present tense, ending with a
period. A function, hook or method opens with a verb in the third person ("Returns …", "Reads …",
"Submits …", "Reports whether …" for a boolean); a type, constant, error class or component opens
with a noun phrase ("A Gas token payment the widget could not prepare."). What follows is what a
caller needs and the signature does not show: the conditions it holds under (D2), the default,
the edge values and the errors (D11). Each field of an options or result type carries its own
doc, and the function's block does not repeat it.
Bad: "Access the Fluent widget render context from any component rendered inside
`<FluentWidget>` … so host apps need not prop-drill it." Good: "Returns the render context of the
enclosing `<FluentWidget>`: the object `renderHome` and `renderPage` receive."
[decided 2026-11-11].

### D11 A doc block names what its code throws, and its example compiles

A call that throws a public error class carries one `@throws` per class, in the form
`` @throws `FluentAuthError` with `code` `not_connected` when … ``, naming every code it can throw
and the condition of each: `packages/connect/test/errorsDoc.test.ts` checks these tags against
`docs/errors.md`. Any other error is a sentence of the block: "Throws an `Error` when …".
`@example` compiles as written, imports from `@fluent.xyz/connect` (or `/internal` for an
Internal export), and shows a result as a trailing `//` comment. `@param` and `@returns` appear
only where a parameter or result has no documented type to point to; `@deprecated` names the
replacement. A link points only to what a reader outside the team can open: a guide, an EIP, a
vendor's docs, a public issue (D8).
Bad: a block that reads "The methods the dialog shows beside X, in the host's own order." and
says nothing of the `FluentWidgetConfigError` with `code` `invalid_option` its function throws for
a value that is not a list.
Good: the `@throws` tags of `signMessage` in `packages/connect/src/widget/signRequest.ts`
[measured: `packages/connect/test/errorsDoc.test.ts`; decided 2026-11-11].

### D12 An inline comment gives the reason the code cannot show, on the line it explains

An inline comment states a hazard, an order that matters, an external system's behaviour, an
invariant the types do not enforce, or the origin of a value. It sits directly above the
statement it explains and runs one to three lines. A comment that narrates the next step
("Update result", "Fetch the token") is deleted.
Bad: a 12-line comment in `FluentWidgetContent.tsx` that retells a remount loop and names the
site it happened on, where the reason fits in two lines: "Until the smart account is back, the
settings subject stays the Fluent ID: an External wallet would take it and remount the widget."
Good: "// Checked before the wallet opens: a mismatch is a proxied or spoofed challenge, and the
user must not be asked to sign it." [measured:
`packages/connect/src/core/authToken.ts`; decided 2026-11-11].

### D13 A comment is as long as its reason

A doc block is its summary, at most one short paragraph of conditions and errors, and its
example; a block that needs more becomes a guide in `packages/connect/docs/` or a split of the
code. A test file's header names the behaviour under test and lists its fakes, one line per fake
with the library and version it mirrors (`testing.md` T3, T4); how each fake answers is read in
the fake. A date, a run or an observation is history (D9) and stays out.
Bad: a 40-line test header that narrates each request every fake answers, and the date a run
met the error it reproduces. Good: "Fakes: the chain's JSON-RPC endpoint, a `viem@2.52.0`
`custom()` transport; the paymaster RPC behind `fetch`, as `@zerodev/sdk@5.5.10` calls it; …"
[decided 2026-11-11].

## Checklist for a comment

Applied to every comment, TSDoc block and test name a change writes or touches:

1. Does it say something the code, the names and the types do not? If not, delete it.
2. Does it tell the past: a change, a review, a date, a commit? Rewrite it as what holds now, or
   delete it (D9).
3. Does it name a tracker id, a criterion number, or a link a stranger cannot open (D8, D11)?
4. Is it true on every path, account kind and network it claims (D2)?
5. Doc block: does its first sentence follow D10, and are its errors and example there (D4, D11)?
6. Is it longer than its reason (D13)?
7. Inline: is it above the line it explains, at most three lines (D12)?
8. Are the `GLOSSARY.md` terms used (D6), and does each count still match its code (D3)?
9. Test name: present tense, no "should", no history (`testing.md` T7)?
