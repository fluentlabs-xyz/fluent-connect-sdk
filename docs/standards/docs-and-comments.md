# Docs and comments

Rules for what this repository writes about itself: `README.md`, the guides in
`packages/connect/docs/`, TSDoc, comments, and the style of the source they sit in. A removed
rule keeps its ID unused, so an ID always names the same rule.

Every rule carries its source in brackets: `[measured: <path>]` for what the code already does,
`[ADR n]` for a decision recorded in `docs/adr/`, `[seen: review]` for a defect a review found,
and `[decided 2026-10-15]` for the design session that wrote this file.

`AGENTS.md` triggers this file on every added or changed JavaScript or TypeScript source line, so
D5 applies to every source diff, whether or not the diff touches a document.

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

What it does, its parameters, the errors it throws, and an `@example` for a hook or a function a
builder calls. The exported name is the one piece of this repository a builder cannot read the
source of [measured: `packages/connect/src/core/browserStorage.ts`,
`packages/connect/src/core/debugLogger.ts`; decided 2026-10-15].

### D5 Style: double quotes, semicolons, lines up to 100 columns

Strings use double quotes, each statement ends with a semicolon, and a line is at most 100
columns. This is the repository's existing style, and until a formatter is configured it is a
review rule: it applies to the lines a diff adds or changes, not to the file around them
[measured: zero single-quoted import specifiers in `packages/*/src`; 324 of 26618 non-test source
lines exceed 100 columns; decided 2026-10-15].

### D6 `GLOSSARY.md` terms name their concepts

In identifiers, comments, documents and UI copy alike. A word from a definition's _Avoid_ list is
a defect; a concept `GLOSSARY.md` lacks is either invented language or a gap in the glossary, and
the term is written before the code [measured: `GLOSSARY.md`].

### D7 A change that contradicts an ADR stops and asks

`docs/adr/` records decisions, and an ADR wins over any rule in this directory. Work that needs a
recorded decision reversed raises it instead of writing around it; the answer lands as a new ADR
[measured: `docs/adr/0001` to `docs/adr/0004`].

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
